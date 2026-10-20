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
  it('publishes only after owner review and enforces rate limits and column protection', async () => {
    await createUser(pg,OWNER,'owner@example.com'); await createUser(pg,MEMBER,'member@example.com'); await createUser(pg,OTHER,'other@example.com'); await makeOwner(pg,OWNER);
    const sql = "select create_community_post('project-s6',null,'Helpful member','help','Suspension question','Can anyone help source this part?','2026-10-21') as id";
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
});
