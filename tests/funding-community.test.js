import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import request from 'supertest';
import { asRole, createTestDb, createPgliteServerDb, createUser, makeOwner } from './helpers/pg.js';
import { createApp } from '../server/app.js';
import { readConfig } from '../server/config.js';
import { hashToken, unsubscribeToken } from '../server/subscriptions.js';
import { deliverEmailJobs } from '../server/emailWorker.js';
import { displayedRaised } from '../src/lib/money.js';

const OWNER = '11111111-1111-4111-8111-111111111111';
const MEMBER = '22222222-2222-4222-8222-222222222222';
const OTHER = '33333333-3333-4333-8333-333333333333';
const origin = 'http://localhost:5173';
const config = readConfig({ APP_ORIGIN: origin, RESEND_API_KEY: 'test-key', EMAIL_FROM: 'Project S6 <updates@example.com>', SUBSCRIPTION_SIGNING_SECRET: 'a'.repeat(64) });
let pg, db, app, projectId;
const logger = { warn: vi.fn(), error: vi.fn() };
const subscribe = (body) => request(app).post('/api/subscriptions').set('Origin', origin).send({ projectSlug: 'project-s6', email: 'member@example.com', consent: '2026-10-21', ...body });
const denied = (p) => expect(p).rejects.toThrow(/permission denied|row-level security/i);

beforeEach(async () => {
  pg = await createTestDb(); db = createPgliteServerDb(pg);
  app = createApp({ db, config, logger });
  projectId = (await pg.query('select id from projects')).rows[0].id;
});
afterEach(async () => { await pg.close(); });

describe('part funding and immutable accounting', () => {
  it('counts a part contribution once in each projection, nets refunds, excludes pending and review, and retains overflow', async () => {
    await pg.query(`insert into donations(project_id,part_id,attempt_id,amount_cents,currency,status,refunded_cents,needs_review)
      select $1,id,gen_random_uuid(),1200000,'usd','paid',10000,false from parts where slug='hood'`, [projectId]);
    await pg.query(`insert into donations(project_id,attempt_id,amount_cents,currency,status) values($1,gen_random_uuid(),5000,'usd','paid'),($1,gen_random_uuid(),5000,'usd','pending')`, [projectId]);
    const [campaign] = await asRole(pg,'anon',"select * from get_campaign_summary('project-s6')");
    const [part] = await asRole(pg,'anon',"select * from get_part_funding('project-s6') where part_slug='hood'");
    expect(Number(campaign.raised_cents)).toBe(1195000);
    expect(Number(part.raised_cents)).toBe(1190000);
    expect(displayedRaised(Number(campaign.raised_cents))).toBe(1000000);
    expect((await pg.query("select status from parts where slug='hood'")).rows[0].status).toBe('needed');
    await pg.query("update donations set needs_review=true where part_id is not null");
    expect(Number((await asRole(pg,'anon',"select * from get_part_funding('project-s6') where part_slug='hood'"))[0].raised_cents)).toBe(0);
  });
  it('records consent atomically and rejects altered recognition preferences on retry', async () => {
    const input = { attemptId: crypto.randomUUID(), projectSlug: 'project-s6', partSlug: 'hood', amountCents: 2500, displayName: 'Member', isPublic: false, termsVersion: '2026-10-21' };
    await db.createPendingDonation(input);
    await expect(db.createPendingDonation({ ...input, isPublic: true })).rejects.toMatchObject({ code: 'attempt_mismatch' });
    const [record] = (await pg.query('select terms_version,terms_accepted_at,is_public from donations')).rows;
    expect(record.terms_version).toBe('2026-10-21'); expect(record.terms_accepted_at).toBeTruthy(); expect(record.is_public).toBe(false);
  });
});

describe('email consent and delivery', () => {
  it('keeps addresses and queue private even to authenticated visitors', async () => {
    await denied(asRole(pg,'anon','select * from subscribers'));
    await denied(asRole(pg,'authenticated','select * from email_jobs'));
    await denied(asRole(pg,'authenticated',"select confirm_subscription('fake')"));
  });
  it('requires consent, blocks cross-origin requests and never reveals whether an email exists', async () => {
    expect((await subscribe({ consent: false })).status).toBe(400);
    expect((await request(app).post('/api/subscriptions').set('Origin','https://evil.example').send({})).status).toBe(403);
    expect((await subscribe({})).status).toBe(202);
    expect((await subscribe({})).body).toEqual({ ok: true });
    expect((await pg.query('select * from email_jobs')).rows).toHaveLength(1);
  });
  it('confirms once, sends only followed-part and published updates, and cancels queued emails on unsubscribe', async () => {
    const token = 'b'.repeat(64);
    await db.requestSubscription({slug:'project-s6',email:'member@example.com',partSlug:'hood',hash:hashToken(token),url:`${origin}/subscription/confirm#token=${token}`,consent:'2026-10-21'});
    expect(await db.confirmSubscription(hashToken(token))).toBe(true);
    expect(await db.confirmSubscription(hashToken(token))).toBe(false);
    await pg.query("update parts set estimate_cents=estimate_cents+100 where slug='hood'");
    await pg.query("update parts set estimate_cents=estimate_cents+100 where slug='exhaust'");
    await pg.query("insert into restoration_updates(project_id,title,body,published_at) values($1,'Draft','Draft text',null),($1,'Build progress','A real update',now())",[projectId]);
    expect((await pg.query("select * from email_jobs where kind='update'")).rows).toHaveLength(2);
    const [subscriber] = (await pg.query('select id from subscribers')).rows;
    const signed = unsubscribeToken(subscriber.id,config.subscriptionSecret);
    expect((await request(app).get(`/api/subscriptions/unsubscribe?token=${signed}`)).status).toBe(404);
    expect((await request(app).post('/api/subscriptions/unsubscribe').send({token:signed})).status).toBe(200);
    expect((await pg.query("select state from email_jobs")).rows.every((j)=>j.state==='cancelled')).toBe(true);
  });
  it('leases jobs once and uses provider idempotency while clearing sent token URLs', async () => {
    await subscribe({});
    const fetchImpl = vi.fn(async () => ({ ok:true, json:async()=>({id:'email_provider_1'}) }));
    await deliverEmailJobs({db,config,logger,fetchImpl});
    await deliverEmailJobs({db,config,logger,fetchImpl});
    expect(fetchImpl).toHaveBeenCalledTimes(1);
    const [,options] = fetchImpl.mock.calls[0];
    expect(options.headers['Idempotency-Key']).toMatch(/^s6-email-/);
    expect(JSON.parse(options.body).text).toContain('/subscription/confirm#token=');
    expect((await pg.query('select state,payload from email_jobs')).rows).toEqual([{state:'sent',payload:{}}]);
    expect((await pg.query('select status from subscribers')).rows[0].status).toBe('pending');
  });
  const activeSubscriber = async (partSlug = null) => {
    const token = 'c'.repeat(64);
    await db.requestSubscription({slug:'project-s6',email:'member@example.com',partSlug,hash:hashToken(token),url:`${origin}/subscription/confirm#token=${token}`,consent:'2026-10-21'});
    expect(await db.confirmSubscription(hashToken(token))).toBe(true);
  };
  const updateJobs = async () => (await pg.query("select id,state,payload,available_at>now()+interval '9 minutes' as delayed from email_jobs where kind='update' order by created_at,id")).rows;

  it('batches a run of part edits into one delayed email with the latest details', async () => {
    await activeSubscriber();
    await pg.query("update parts set estimate_cents=estimate_cents+100 where slug='hood'");
    await pg.query("update parts set description='Fresh paint booked' where slug='hood'");
    await pg.query("update parts set status='bought' where slug='hood'");
    const [job, ...others] = await updateJobs();
    expect(others).toHaveLength(0);
    expect(job).toMatchObject({ state: 'pending', delayed: true, payload: { title: 'Part update: Hood', path: '/parts', source: expect.stringMatching(/^part:/) } });
    expect(job.payload.body).toContain('bought');
    expect(job.payload.body).toContain('Fresh paint booked');
    expect(await db.claimEmailJobs()).toEqual([]); // still inside the batching window
    await pg.query("update email_jobs set available_at=now() where kind='update'");
    const fetchImpl = vi.fn(async () => ({ ok:true, json:async()=>({id:'email_provider_2'}) }));
    await deliverEmailJobs({db,config,logger,fetchImpl});
    expect(fetchImpl).toHaveBeenCalledTimes(1);
    expect(JSON.parse(fetchImpl.mock.calls[0][1].body).text).toContain('Fresh paint booked');
    // After that email is sent, the next edit starts a new one.
    await pg.query("update parts set condition='Primed' where slug='hood'");
    expect((await updateJobs()).map((j) => j.state)).toEqual(['sent', 'pending']);
  });

  it('emails a restoration update once: never a draft, never again on republish', async () => {
    await activeSubscriber();
    const [update] = (await pg.query("insert into restoration_updates(project_id,title,body,published_at) values($1,'Engine out','First draft',now()) returning id",[projectId])).rows;
    await pg.query("update restoration_updates set body='Corrected text' where id=$1",[update.id]);
    let jobs = await updateJobs();
    expect(jobs).toHaveLength(1);
    expect(jobs[0]).toMatchObject({ state: 'pending', payload: { title: 'Engine out', body: 'Corrected text', source: `update:${update.id}` } });
    await pg.query("update restoration_updates set published_at=null where id=$1",[update.id]);
    expect((await updateJobs())[0].state).toBe('cancelled');
    await pg.query("update restoration_updates set published_at=now() where id=$1",[update.id]);
    jobs = await updateJobs();
    expect(jobs.map((j) => j.state)).toEqual(['pending']);
    await pg.query("update email_jobs set state='sent',payload='{}' where id=$1",[jobs[0].id]);
    await pg.query("update restoration_updates set published_at=null where id=$1",[update.id]);
    await pg.query("update restoration_updates set published_at=now(), body='Edited after sending' where id=$1",[update.id]);
    expect((await updateJobs()).map((j) => j.state)).toEqual(['sent']);
  });

  it('cancels queued emails about deleted parts and updates', async () => {
    await activeSubscriber();
    await pg.query("update parts set description='Soon' where slug='hood'");
    const [update] = (await pg.query("insert into restoration_updates(project_id,title,body,published_at) values($1,'Removed','Text',now()) returning id",[projectId])).rows;
    expect((await updateJobs()).map((j) => j.state)).toEqual(['pending', 'pending']);
    await pg.query("delete from parts where slug='hood'");
    await pg.query('delete from restoration_updates where id=$1',[update.id]);
    expect((await updateJobs()).map((j) => j.state)).toEqual(['cancelled', 'cancelled']);
  });

  it('rejects forged unsubscribe tokens and expired confirmations', async () => {
    await subscribe({});
    await pg.query("update subscribers set token_expires_at=now()-interval '1 day'");
    const [subscriber] = (await pg.query('select id,token_hash from subscribers')).rows;
    expect(await db.confirmSubscription(subscriber.token_hash)).toBe(false);
    const forged = `${subscriber.id}.${'0'.repeat(64)}`;
    expect((await request(app).post('/api/subscriptions/unsubscribe').send({token:forged})).status).toBe(400);
  });
});

describe('community authorization and moderation', () => {
  const sql = "select create_community_post('project-s6',null,'Helpful member','help','Suspension question','Can anyone help source this part?','2026-10-21') as id";
  it('publishes only after owner review and enforces rate limits and column protection', async () => {
    await createUser(pg,OWNER,'owner@example.com'); await createUser(pg,MEMBER,'member@example.com'); await createUser(pg,OTHER,'other@example.com'); await makeOwner(pg,OWNER);
    const [post] = await asRole(pg,'authenticated',sql,[],MEMBER);
    expect(await asRole(pg,'anon','select id from community_posts')).toHaveLength(0);
    expect(await asRole(pg,'authenticated','select id from community_posts',[],MEMBER)).toHaveLength(1);
    expect(await asRole(pg,'authenticated','select id from community_posts',[],OTHER)).toHaveLength(0);
    await expect(asRole(pg,'authenticated',sql,[],MEMBER)).rejects.toThrow(/wait/);
    expect(await asRole(pg,'authenticated',"update community_posts set status='approved' returning id",[],MEMBER)).toHaveLength(0);
    await denied(asRole(pg,'authenticated',"update community_posts set author_id=$1",[OWNER],MEMBER));
    await asRole(pg,'authenticated',"update community_posts set status='approved' where id=$1",[post.id],OWNER);
    expect(await asRole(pg,'anon','select id from community_posts')).toHaveLength(1);
    await denied(asRole(pg,'anon',sql));
  });
  it('never exposes the author account id, while members still see their own pending posts', async () => {
    await createUser(pg,OWNER,'owner@example.com'); await createUser(pg,MEMBER,'member@example.com'); await makeOwner(pg,OWNER);
    const [post] = await asRole(pg,'authenticated',sql,[],MEMBER);
    const columns = 'id,project_id,parent_id,display_name,category,title,body,status,created_at';
    expect(await asRole(pg,'authenticated',`select ${columns} from community_posts`,[],MEMBER)).toHaveLength(1);
    await denied(asRole(pg,'authenticated','select author_id from community_posts',[],MEMBER));
    await denied(asRole(pg,'authenticated','select * from community_posts',[],OWNER));
    await asRole(pg,'authenticated',"update community_posts set status='approved' where id=$1 and project_id=$2",[post.id,projectId],OWNER);
    expect(await asRole(pg,'anon',`select ${columns} from community_posts`)).toHaveLength(1);
    await denied(asRole(pg,'anon','select author_id from community_posts'));
    await denied(asRole(pg,'anon','select consent_version from community_posts'));
  });
});
