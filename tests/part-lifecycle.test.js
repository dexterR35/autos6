import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import request from 'supertest';
import { asRole, createUser, makeOwner } from './helpers/pg.js';
import { APP_ORIGIN, createTestServer, sessionEvent, signedEvent } from './helpers/server.js';

const OWNER = '11111111-1111-4111-8111-111111111111';
const STRANGER = '33333333-3333-4333-8333-333333333333';
let t;

beforeEach(async () => { t = await createTestServer(); });
afterEach(async () => { await t.pg.close(); });

const part = async (slug) => (await t.pg.query('select * from parts where slug=$1', [slug])).rows[0];
const projectId = async () => (await t.pg.query('select id from projects')).rows[0].id;
const pay = async (slug, cents, extra = {}) => t.pg.query(
  `insert into donations(project_id,part_id,attempt_id,amount_cents,currency,status,stripe_payment_intent_id)
   select project_id,id,gen_random_uuid(),$2,'usd','paid',$3 from parts where slug=$1 returning id`,
  [slug, cents, extra.pi ?? null],
);
const checkout = (body) => request(t.app).post('/api/donations/checkout').set('Origin', APP_ORIGIN).send({
  projectSlug: 'project-s6', amountCents: 2500, isPublic: false, attemptId: crypto.randomUUID(),
  termsAccepted: true, termsVersion: '2026-11-19', ...body,
});

describe('automatic funded status', () => {
  it('marks a part funded exactly when net paid support reaches the goal', async () => {
    await pay('hood', 64999);
    expect((await part('hood')).status).toBe('needed');
    await pay('hood', 1);
    const hood = await part('hood');
    expect(hood.status).toBe('funded');
    expect(hood.funded_at).toBeTruthy();
    expect(hood.kind).toBe('repair');
  });

  it('reopens a funded part after a refund, keeping its kind', async () => {
    const [{ id }] = (await pay('wheels', 120000)).rows;
    expect((await part('wheels')).status).toBe('funded');
    await t.pg.query('update donations set refunded_cents=5000 where id=$1', [id]);
    const wheels = await part('wheels');
    expect(wheels.status).toBe('upgrade');
    expect(wheels.funded_at).toBeNull();
  });

  it('follows goal changes and never touches owner stages', async () => {
    await pay('hood', 65000);
    await t.pg.query("update parts set estimate_cents=90000 where slug='hood'");
    expect((await part('hood')).status).toBe('needed');
    await t.pg.query("update parts set estimate_cents=60000 where slug='hood'");
    expect((await part('hood')).status).toBe('funded');
    await t.pg.query("update parts set status='bought' where slug='hood'");
    await t.pg.query("update parts set estimate_cents=999999 where slug='hood'");
    expect((await part('hood')).status).toBe('bought');
  });

  it('ignores pending, review and foreign-currency money', async () => {
    const pid = await projectId();
    await t.pg.query(`insert into donations(project_id,part_id,attempt_id,amount_cents,currency,status,needs_review)
      select $1::uuid,id,gen_random_uuid(),99999,'usd','pending',false from parts where slug='hood'
      union all select $1,id,gen_random_uuid(),99999,'usd','paid',true from parts where slug='hood'
      union all select $1,id,gen_random_uuid(),99999,'eur','paid',false from parts where slug='hood'`, [pid]);
    expect((await part('hood')).status).toBe('needed');
  });

  it('moves the webhook-paid donation into funded through the real Stripe flow', async () => {
    const res = await checkout({ partId: 'side-skirts', amountCents: 45000 });
    expect(res.status).toBe(200);
    const session = (await t.pg.query('select id, stripe_checkout_session_id from donations')).rows[0];
    const ev = sessionEvent('checkout.session.completed', {
      id: session.stripe_checkout_session_id, payment_status: 'paid', amount_total: 45000, currency: 'usd',
      payment_intent: 'pi_test_skirts', customer_details: { email: 'x@example.com' }, metadata: { donation_id: session.id },
    });
    const { payload, header } = signedEvent(t.stripe, ev);
    const hook = await request(t.app).post('/api/stripe/webhook').set('stripe-signature', header).set('content-type', 'application/json').send(payload);
    expect(hook.body.result).toBe('applied');
    expect((await part('side-skirts')).status).toBe('funded');
  });
});

describe('checkout limits per part', () => {
  it('refuses part checkouts above what is left and reports the remainder', async () => {
    await pay('hood', 60000);
    const over = await checkout({ partId: 'hood', amountCents: 6000 });
    expect(over.status).toBe(400);
    expect(over.body).toMatchObject({ code: 'amount_exceeds_remaining', remainingCents: 5000 });
    expect((await checkout({ partId: 'hood', amountCents: 5000 })).status).toBe(200);
  });

  it('closes a part once it is funded, bought or installed, while the general fund stays open', async () => {
    await pay('hood', 65000);
    const closed = await checkout({ partId: 'hood' });
    expect(closed.status).toBe(409);
    expect(closed.body.code).toBe('part_closed');
    expect((await checkout({ partId: 'roof-box' })).status).toBe(409);
    expect((await checkout({ partId: null, amountCents: 900000 })).status).toBe(200);
  });

  it('still lets a donor retry an attempt that was created before the part closed', async () => {
    const attemptId = crypto.randomUUID();
    expect((await checkout({ partId: 'hood', attemptId, amountCents: 1000 })).status).toBe(200);
    await pay('hood', 65000);
    const retry = await checkout({ partId: 'hood', attemptId, amountCents: 1000 });
    expect(retry.status).toBe(200);
  });

  it('allows a $1 contribution to finish a part with less than $1 left', async () => {
    await pay('hood', 64950);
    expect((await checkout({ partId: 'hood', amountCents: 100 })).status).toBe(200);
    expect((await checkout({ partId: 'hood', amountCents: 200 })).status).toBe(400);
  });
});

describe('owner purchase records', () => {
  beforeEach(async () => {
    await createUser(t.pg, OWNER, 'owner@example.com');
    await createUser(t.pg, STRANGER, 'other@example.com');
    await makeOwner(t.pg, OWNER);
  });

  it('marks a part bought and posts its update in one call', async () => {
    await pay('hood', 65000);
    const { id } = await part('hood');
    const [{ update_id }] = await asRole(t.pg, 'authenticated',
      "select public.record_part_progress($1,'bought',61250,'Bought: new hood','Ordered from the dealer.',array['https://cdn.example.com/hood.jpg'],true) as update_id",
      [id], OWNER);
    const hood = await part('hood');
    expect(hood).toMatchObject({ status: 'bought', actual_cost_cents: 61250 });
    expect(hood.funded_at && hood.bought_at).toBeTruthy();
    const [u] = (await t.pg.query('select * from restoration_updates where id=$1', [update_id])).rows;
    expect(u).toMatchObject({ part_id: id, title: 'Bought: new hood', cost_cents: 61250, created_by: OWNER });
    expect(u.published_at).toBeTruthy();
    const visible = await asRole(t.pg, 'anon', 'select part_id from restoration_updates');
    expect(visible.map((r) => r.part_id)).toContain(id);
  });

  it('rejects strangers, anonymous callers and invalid stages, changing nothing', async () => {
    const { id } = await part('hood');
    await expect(asRole(t.pg, 'authenticated', "select public.record_part_progress($1,'bought')", [id], STRANGER)).rejects.toThrow(/not_allowed/);
    await expect(asRole(t.pg, 'anon', "select public.record_part_progress($1,'bought')", [id])).rejects.toThrow(/permission denied/);
    await expect(asRole(t.pg, 'authenticated', "select public.record_part_progress($1,'funded')", [id], OWNER)).rejects.toThrow(/invalid_status/);
    expect((await part('hood')).status).toBe('needed');
    expect((await t.pg.query('select count(*)::int as n from restoration_updates')).rows[0].n).toBe(0);
  });

  it('lets owners edit media, kind and cost but never the stage timestamps', async () => {
    const { id } = await part('hood');
    await asRole(t.pg, 'authenticated',
      "update parts set kind='upgrade', model_url='https://cdn.example.com/hood.glb', image_urls=array['https://cdn.example.com/a.jpg'], actual_cost_cents=100 where id=$1", [id], OWNER);
    const hood = await part('hood');
    expect(hood).toMatchObject({ kind: 'upgrade', status: 'upgrade', model_url: 'https://cdn.example.com/hood.glb' });
    await expect(asRole(t.pg, 'authenticated', 'update parts set bought_at=now() where id=$1', [id], OWNER)).rejects.toThrow(/permission denied/);
    await expect(asRole(t.pg, 'authenticated', "update parts set model_url='javascript:alert(1)' where id=$1", [id], OWNER)).rejects.toThrow(/check constraint/);
    await expect(asRole(t.pg, 'authenticated', "update parts set model_url='x' where id=$1", [id], STRANGER)).resolves.toEqual([]);
    expect((await part('hood')).model_url).toBe('https://cdn.example.com/hood.glb');
  });

  it('ignores stage timestamps sent with a new part and stamps the real one', async () => {
    const pid = await projectId();
    await asRole(t.pg, 'authenticated',
      "insert into parts(project_id,slug,name,estimate_cents,status,funded_at,bought_at) values($1,'spoiler','Roof spoiler',30000,'upgrade','2000-01-01','2000-01-01')", [pid], OWNER);
    const spoiler = await part('spoiler');
    expect(spoiler).toMatchObject({ kind: 'upgrade', funded_at: null, bought_at: null });
  });

  it('links updates only to parts of the same project', async () => {
    const { id } = await part('hood');
    const other = (await t.pg.query("insert into projects(slug,title,goal_cents) values('other','Other',100) returning id")).rows[0].id;
    await expect(t.pg.query("insert into restoration_updates(project_id,part_id,title) values($1,$2,'x')", [other, id])).rejects.toThrow(/foreign key/);
  });
});

describe('share links for parts added from admin', () => {
  it('serves the parts page for a real new part and a real 404 for an unknown one', async () => {
    const { mkdtempSync, mkdirSync, writeFileSync } = await import('node:fs');
    const { tmpdir } = await import('node:os');
    const path = await import('node:path');
    const dist = mkdtempSync(path.join(tmpdir(), 'dist-'));
    mkdirSync(path.join(dist, 'parts'));
    writeFileSync(path.join(dist, 'parts/index.html'), '<title>Parts page</title>');
    writeFileSync(path.join(dist, '404.html'), '<title>Not found</title>');
    writeFileSync(path.join(dist, 'index.html'), '<title>Home</title>');
    await t.pg.query("insert into parts(project_id,slug,name,estimate_cents) select id,'rs6-grille','RS6 grille',30000 from projects");
    const { createApp } = await import('../server/app.js');
    const app = createApp({ db: t.db, config: { ...t.config, serveStatic: true, distDir: dist }, logger: t.logger });
    const ok = await request(app).get('/parts/rs6-grille');
    expect(ok.status).toBe(200);
    expect(ok.text).toContain('Parts page');
    expect((await request(app).get('/parts/not-a-part')).status).toBe(404);
  });
});
