import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import request from 'supertest';
import { asRole, createUser, makeOwner } from './helpers/pg.js';
import { APP_ORIGIN, createTestServer, sessionEvent, signedEvent, stripeEvent } from './helpers/server.js';
import { digestEmail, sendOwnerDigests } from '../server/digest.js';
import { extractEvent } from '../server/stripeEvents.js';
import { scrub } from '../server/monitoring.js';
import { fetchCover, wrapTitle } from '../server/ogImage.js';

const OWNER = '11111111-1111-4111-8111-111111111111';
const FAN = '22222222-2222-4222-8222-222222222222';
const FAN2 = '44444444-4444-4444-8444-444444444444';
let t;
beforeEach(async () => { t = await createTestServer(); });
afterEach(async () => { await t.pg.close(); });

const q = async (sql, params) => (await t.pg.query(sql, params)).rows;
const part = async (slug) => (await q('select * from parts where slug=$1', [slug]))[0];
const checkout = (body) => request(t.app).post('/api/donations/checkout').set('Origin', APP_ORIGIN).send({
  projectSlug: 'project-s6', amountCents: 2500, isPublic: false, attemptId: crypto.randomUUID(),
  termsAccepted: true, termsVersion: '2026-11-19', ...body,
});
const hook = async (event) => {
  const { payload, header } = signedEvent(t.stripe, event);
  return request(t.app).post('/api/stripe/webhook').set('stripe-signature', header).set('content-type', 'application/json').send(payload);
};
const pay = (slug, cents, extra = '') => q(`insert into donations(project_id,part_id,attempt_id,amount_cents,currency,status,is_public,display_name${extra ? ',' + extra.split('=')[0] : ''})
  select project_id,id,gen_random_uuid(),$2,'usd','paid',$3,$4${extra ? ',' + extra.split('=')[1] : ''} from parts where slug=$1 returning id`, [slug, cents, Boolean(extra || true), 'Ana']);

// ---------------------------------------------------------------- monthly support
describe('monthly support', () => {
  const startMonthly = async (body = {}) => {
    const res = await checkout({ recurring: true, partId: 'hood', amountCents: 1500, displayName: 'Mihai', isPublic: true, notifyUpdates: true, ...body });
    expect(res.status).toBe(200);
    const params = t.stripe.checkout.sessions.create.mock.calls.at(-1)[0];
    const [rec] = await q('select * from recurring_supports order by created_at desc limit 1');
    return { params, rec };
  };
  const subscriptionCreated = (rec) => hook(sessionEvent('checkout.session.completed', {
    id: rec.stripe_checkout_session_id, mode: 'subscription', payment_status: 'paid', subscription: 'sub_1', customer: 'cus_1',
    customer_details: { email: 'Mihai@Example.com' }, metadata: { recurring_id: rec.id },
  }));
  const invoicePaid = (rec, id, amount = 1500, extra = {}) => hook(stripeEvent('invoice.paid', {
    object: 'invoice', id, amount_paid: amount, currency: 'usd', customer: 'cus_1', customer_email: 'mihai@example.com',
    parent: { subscription_details: { subscription: 'sub_1', metadata: { recurring_id: rec.id } } }, ...extra,
  }));

  it('creates a monthly Stripe subscription checkout for a part', async () => {
    const { params, rec } = await startMonthly();
    expect(params).toMatchObject({ mode: 'subscription', subscription_data: { metadata: { recurring_id: rec.id } } });
    expect(params.line_items[0].price_data).toMatchObject({ currency: 'usd', unit_amount: 1500, recurring: { interval: 'month' } });
    expect(params.submit_type).toBe('donate'); // allowed in subscription mode since API 2026-09-30.endive
    expect(rec).toMatchObject({ status: 'pending', is_public: true, notify_updates: true, display_name: 'Mihai' });
  });

  it('turns each paid invoice into exactly one donation toward the part', async () => {
    const { rec } = await startMonthly();
    expect((await subscriptionCreated(rec)).body.result).toBe('applied');
    expect((await q('select status, stripe_customer_id from recurring_supports'))[0]).toMatchObject({ status: 'active', stripe_customer_id: 'cus_1' });
    expect((await invoicePaid(rec, 'in_1')).body.result).toBe('applied');
    const replay = await invoicePaid(rec, 'in_1');
    expect(replay.status).toBe(200);
    const rows = await q("select d.*, pt.slug from donations d left join parts pt on pt.id=d.part_id where recurring_id=$1", [rec.id]);
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ slug: 'hood', amount_cents: 1500, status: 'paid', stripe_invoice_id: 'in_1', stripe_payment_intent_id: 'pi_for_in_1', is_public: true, needs_review: false });
    // Donor asked for updates: now following the part.
    expect((await q('select status, part_id from subscribers where email=$1', ['mihai@example.com']))[0]).toMatchObject({ status: 'active', part_id: (await part('hood')).id });
  });

  it('sends later months to the general fund once the part is funded', async () => {
    const { rec } = await startMonthly();
    await subscriptionCreated(rec);
    await q("insert into donations(project_id,part_id,attempt_id,amount_cents,currency,status) select project_id,id,gen_random_uuid(),65000,'usd','paid' from parts where slug='hood'");
    expect((await part('hood')).status).toBe('funded');
    await invoicePaid(rec, 'in_2');
    expect((await q('select part_id from donations where stripe_invoice_id=$1', ['in_2']))[0].part_id).toBeNull();
  });

  it('quarantines an invoice for a different amount', async () => {
    const { rec } = await startMonthly();
    await subscriptionCreated(rec);
    await invoicePaid(rec, 'in_3', 999);
    expect((await q('select needs_review from donations where stripe_invoice_id=$1', ['in_3']))[0].needs_review).toBe(true);
  });

  it('tracks failed payments and cancellation', async () => {
    const { rec } = await startMonthly();
    await subscriptionCreated(rec);
    await hook(stripeEvent('invoice.payment_failed', { object: 'invoice', id: 'in_f', amount_paid: 0, currency: 'usd', parent: { subscription_details: { subscription: 'sub_1', metadata: { recurring_id: rec.id } } } }));
    expect((await q('select status from recurring_supports'))[0].status).toBe('past_due');
    await hook(stripeEvent('customer.subscription.deleted', { object: 'subscription', id: 'sub_1', status: 'canceled', customer: 'cus_1', metadata: { recurring_id: rec.id } }));
    const [r] = await q('select status, canceled_at from recurring_supports');
    expect(r.status).toBe('canceled');
    expect(r.canceled_at).toBeTruthy();
    const [sum] = await asRole(t.pg, 'anon', "select * from get_recurring_summary('project-s6')");
    expect(Number(sum.active_count)).toBe(0);
  });

  it('ignores subscriptions and invoices that are not ours', async () => {
    const res = await hook(stripeEvent('invoice.paid', { object: 'invoice', id: 'in_other', amount_paid: 900, currency: 'usd', parent: { subscription_details: { subscription: 'sub_other', metadata: {} } } }));
    expect(res.body).toMatchObject({ received: true, ignored: true });
    expect(extractEvent(stripeEvent('customer.subscription.updated', { object: 'subscription', id: 'sub_x', metadata: {} }))).toBeNull();
  });

  it('shows monthly status on the return page and opens the billing portal for that session only', async () => {
    const { rec } = await startMonthly();
    await subscriptionCreated(rec);
    const status = await request(t.app).get('/api/donations/status').query({ session_id: rec.stripe_checkout_session_id });
    expect(status.body).toMatchObject({ status: 'paid', monthly: true, amountCents: 1500 });
    const manage = await request(t.app).post('/api/recurring/manage').set('Origin', APP_ORIGIN).send({ sessionId: rec.stripe_checkout_session_id });
    expect(manage.body.url).toContain('cus_1');
    const unknown = await request(t.app).post('/api/recurring/manage').set('Origin', APP_ORIGIN).send({ sessionId: 'cs_test_doesnotexist000' });
    expect(unknown.status).toBe(404);
  });

  it('refuses monthly support for a closed part', async () => {
    await q("insert into donations(project_id,part_id,attempt_id,amount_cents,currency,status) select project_id,id,gen_random_uuid(),65000,'usd','paid' from parts where slug='hood'");
    const res = await checkout({ recurring: true, partId: 'hood', amountCents: 1500 });
    expect(res.status).toBe(409);
  });
});

// ---------------------------------------------------------------- donor emails
describe('update emails for donors who ask', () => {
  const complete = async (body) => {
    expect((await checkout(body)).status).toBe(200);
    const [d] = await q('select id, stripe_checkout_session_id from donations order by created_at desc limit 1');
    return hook(sessionEvent('checkout.session.completed', {
      id: d.stripe_checkout_session_id, payment_status: 'paid', amount_total: body.amountCents ?? 2500, currency: 'usd',
      payment_intent: `pi_${d.id.slice(0, 8)}`, customer_details: { email: 'Fan@Example.com' }, metadata: { donation_id: d.id },
    }));
  };
  it('follows the part only when the box was ticked', async () => {
    await complete({ partId: 'hood', notifyUpdates: false });
    expect(await q('select * from subscribers')).toHaveLength(0);
    await complete({ partId: 'hood', notifyUpdates: true });
    const subs = await q('select email, status, part_id from subscribers');
    expect(subs).toEqual([{ email: 'fan@example.com', status: 'active', part_id: (await part('hood')).id }]);
  });
  it('never narrows an existing whole-project subscription', async () => {
    await q("insert into subscribers(project_id,email,status,consent_version) select id,'fan@example.com','active','2026-11-19' from projects");
    await complete({ partId: 'hood', notifyUpdates: true });
    expect((await q('select part_id from subscribers'))[0].part_id).toBeNull();
  });
  it('emails followers in the project currency with a readable stage', async () => {
    await q("insert into subscribers(project_id,email,status,consent_version,part_id) select p.id,'fan@example.com','active','2026-11-19',pt.id from projects p join parts pt on pt.project_id=p.id and pt.slug='hood'");
    await q("update projects set currency='eur'");
    await q("update parts set status='bought' where slug='hood'");
    const [job] = await q("select payload from email_jobs where kind='update'");
    expect(job.payload.title).toBe('Hood is bought');
    expect(job.payload.body).toContain('Goal EUR 650.00');
    expect(job.payload.path).toBe('/parts/hood');
  });
});

// ---------------------------------------------------------------- part extras
describe('part extras', () => {
  beforeEach(async () => {
    await createUser(t.pg, OWNER, 'owner@example.com');
    await makeOwner(t.pg, OWNER);
  });
  it('keeps at most three open parts in "next up" and drops funded ones', async () => {
    for (const s of ['hood', 'exhaust', 'wheels']) await asRole(t.pg, 'authenticated', 'update parts set is_next_up=true where slug=$1', [s], OWNER);
    await expect(asRole(t.pg, 'authenticated', "update parts set is_next_up=true where slug='brake-kit'", [], OWNER)).rejects.toThrow(/next_up_limit/);
    await q("insert into donations(project_id,part_id,attempt_id,amount_cents,currency,status) select project_id,id,gen_random_uuid(),65000,'usd','paid' from parts where slug='hood'");
    expect((await part('hood')).is_next_up).toBe(false);
    await asRole(t.pg, 'authenticated', "update parts set is_next_up=true where slug='brake-kit'", [], OWNER);
  });
  it('reorders all cards in one call, for owners only', async () => {
    const pid = (await q('select id from projects'))[0].id;
    await asRole(t.pg, 'authenticated', "select public.reorder_parts($1, array['roof-box','hood'])", [pid], OWNER);
    expect((await part('roof-box')).sort_order).toBe(1);
    expect((await part('hood')).sort_order).toBe(2);
    await createUser(t.pg, FAN, 'fan@example.com');
    await expect(asRole(t.pg, 'authenticated', "select public.reorder_parts($1, array['hood'])", [pid], FAN)).rejects.toThrow(/not_allowed/);
  });
  it('lets owners switch currency until money arrives in the old one', async () => {
    const pid = (await q('select id from projects'))[0].id;
    await asRole(t.pg, 'authenticated', "select public.set_project_currency($1,'eur')", [pid], OWNER);
    expect((await q('select currency from projects'))[0].currency).toBe('eur');
    await expect(asRole(t.pg, 'authenticated', "select public.set_project_currency($1,'jpy')", [pid], OWNER)).rejects.toThrow(/invalid_currency/);
    await q("insert into donations(project_id,attempt_id,amount_cents,currency,status) values($1,gen_random_uuid(),500,'eur','paid')", [pid]);
    await expect(asRole(t.pg, 'authenticated', "select public.set_project_currency($1,'ron')", [pid], OWNER)).rejects.toThrow(/currency_locked/);
    const res = await checkout({ partId: 'hood' });
    expect(t.stripe.checkout.sessions.create.mock.calls.at(-1)[0].line_items[0].price_data.currency).toBe('eur');
    expect(res.status).toBe(200);
  });
  it('lists public names behind a part, merged by name and net of refunds', async () => {
    const pid = (await q('select id from projects'))[0].id;
    const add = (name, cents, pub, refunded = 0) => q(`insert into donations(project_id,part_id,attempt_id,amount_cents,currency,status,is_public,display_name,refunded_cents)
      select $1,id,gen_random_uuid(),$2,'usd','paid',$3,$4,$5 from parts where slug='hood'`, [pid, cents, pub, name, refunded]);
    await add('Ana', 1000, true); await add('ana ', 500, true); await add('Secret', 9000, false); await add('Refunded', 800, true, 800); await add('Bob', 3000, true);
    const rows = await asRole(t.pg, 'anon', "select * from get_part_supporters('project-s6','hood')");
    expect(rows.map((r) => [r.display_name, Number(r.total_cents)])).toEqual([['Bob', 3000], ['Ana', 1500]]);
  });
});

// ---------------------------------------------------------------- votes
describe('supporter votes', () => {
  let pollId, optA, optB, pid;
  beforeEach(async () => {
    await createUser(t.pg, OWNER, 'owner@example.com');
    await createUser(t.pg, FAN, 'fan@example.com');
    await createUser(t.pg, FAN2, 'fan2@example.com');
    await q('update auth.users set email_confirmed_at=now()');
    await makeOwner(t.pg, OWNER);
    pid = (await q('select id from projects'))[0].id;
    [{ id: pollId }] = await asRole(t.pg, 'authenticated', "insert into polls(project_id,question) values($1,'Which wheels next?') returning id", [pid], OWNER);
    [{ id: optA }] = await asRole(t.pg, 'authenticated', "insert into poll_options(poll_id,project_id,label,estimate_cents) values($1,$2,'RS6 rotors',140000) returning id", [pollId, pid], OWNER);
    [{ id: optB }] = await asRole(t.pg, 'authenticated', "insert into poll_options(poll_id,project_id,label) values($1,$2,'OEM Avus') returning id", [pollId, pid], OWNER);
  });
  const results = async () => Object.fromEntries((await asRole(t.pg, 'anon', "select * from get_poll_results('project-s6')")).map((r) => [r.option_id, Number(r.votes)]));

  it('counts one vote per account, which can be changed, and keeps who voted private', async () => {
    await asRole(t.pg, 'authenticated', 'select public.cast_poll_vote($1,$2)', [pollId, optA], FAN);
    await asRole(t.pg, 'authenticated', 'select public.cast_poll_vote($1,$2)', [pollId, optA], FAN2);
    await asRole(t.pg, 'authenticated', 'select public.cast_poll_vote($1,$2)', [pollId, optB], FAN2);
    expect(await results()).toEqual({ [optA]: 1, [optB]: 1 });
    expect(await asRole(t.pg, 'authenticated', 'select option_id from poll_votes', [], FAN)).toEqual([{ option_id: optA }]);
    await expect(asRole(t.pg, 'anon', 'select * from poll_votes')).rejects.toThrow(/permission denied/);
  });
  it('rejects anonymous, unconfirmed and closed-poll votes and options from other polls', async () => {
    await expect(asRole(t.pg, 'anon', 'select public.cast_poll_vote($1,$2)', [pollId, optA])).rejects.toThrow(/permission denied/);
    await q('update auth.users set email_confirmed_at=null where id=$1', [FAN]);
    await expect(asRole(t.pg, 'authenticated', 'select public.cast_poll_vote($1,$2)', [pollId, optA], FAN)).rejects.toThrow(/email_unconfirmed/);
    const [{ id: other }] = await q("insert into polls(project_id,question) values($1,'Other poll') returning id", [pid]);
    await expect(asRole(t.pg, 'authenticated', 'select public.cast_poll_vote($1,$2)', [other, optA], FAN2)).rejects.toThrow(/option_not_found/);
    await q("update polls set closes_at=now()-interval '1 minute' where id=$1", [pollId]);
    await expect(asRole(t.pg, 'authenticated', 'select public.cast_poll_vote($1,$2)', [pollId, optA], FAN2)).rejects.toThrow(/poll_closed/);
  });
  it('closes with a winner that becomes an open upgrade card', async () => {
    await expect(asRole(t.pg, 'authenticated', 'select public.close_poll($1,$2,true)', [pollId, optB], OWNER)).rejects.toThrow(/estimate_required/);
    const [{ slug }] = await asRole(t.pg, 'authenticated', 'select public.close_poll($1,$2,true) as slug', [pollId, optA], OWNER);
    expect(slug).toBe('rs6-rotors');
    expect(await part('rs6-rotors')).toMatchObject({ name: 'RS6 rotors', status: 'upgrade', kind: 'upgrade', estimate_cents: 140000 });
    expect((await q('select status, winner_option_id from polls where id=$1', [pollId]))[0]).toEqual({ status: 'closed', winner_option_id: optA });
    await expect(asRole(t.pg, 'authenticated', 'select public.close_poll($1,$2,true)', [pollId, optA], FAN)).rejects.toThrow(/not_allowed/);
    await expect(asRole(t.pg, 'authenticated', "insert into polls(project_id,question) values($1,'Hijack')", [pid], FAN)).rejects.toThrow(/row-level security/);
  });
});

// ---------------------------------------------------------------- share images
describe('share cards', () => {
  it('serves a PNG card and injects it into the part page head', async () => {
    const { mkdtempSync, mkdirSync, writeFileSync } = await import('node:fs');
    const { tmpdir } = await import('node:os');
    const path = await import('node:path');
    const dist = mkdtempSync(path.join(tmpdir(), 'dist-'));
    mkdirSync(path.join(dist, 'parts/hood'), { recursive: true });
    writeFileSync(path.join(dist, 'parts/hood/index.html'), '<html><head><meta property="og:image" content="https://x/old.png" data-seo="og:image" /><meta property="og:title" content="Old" data-seo="og:title" /></head><body></body></html>');
    writeFileSync(path.join(dist, '404.html'), 'nf');
    const { createApp } = await import('../server/app.js');
    const app = createApp({ db: t.db, config: { ...t.config, serveStatic: true, distDir: dist }, logger: t.logger });
    const png = await request(app).get('/api/og/parts/hood.png');
    expect(png.status).toBe(200);
    expect(png.headers['content-type']).toBe('image/png');
    expect(png.body.subarray(1, 4).toString()).toBe('PNG');
    expect((await request(app).get('/api/og/parts/nope.png')).status).toBe(404);
    const page = await request(app).get('/parts/hood');
    expect(page.text).toContain(`content="${APP_ORIGIN}/api/og/parts/hood.png"`);
    expect(page.text).not.toContain('old.png');
    expect(page.text).toMatch(/og:title" content="Hood · 0% funded/);
    expect(page.text).toContain('twitter:card');
  });
  it('only fetches cover images from trusted origins', async () => {
    const fetchImpl = vi.fn(async () => new Response(Buffer.from([1, 2, 3]), { headers: { 'content-type': 'image/png' } }));
    expect(await fetchCover('https://evil.example/a.png', ['https://abc.supabase.co'], fetchImpl)).toBeNull();
    expect(await fetchCover('http://169.254.169.254/latest', ['https://abc.supabase.co'], fetchImpl)).toBeNull();
    expect(fetchImpl).not.toHaveBeenCalled();
    expect(await fetchCover('https://abc.supabase.co/a.png', ['https://abc.supabase.co'], fetchImpl)).toMatch(/^data:image\/png;base64,/);
    expect(wrapTitle('Front bumper with RS6 honeycomb grille insert and more words', 16, 3)).toHaveLength(3);
  });
});

// ---------------------------------------------------------------- owner digest
describe('owner digest', () => {
  it('sends one digest per project per day to confirmed owners', async () => {
    await createUser(t.pg, OWNER, 'owner@example.com');
    await q('update auth.users set email_confirmed_at=now()');
    await makeOwner(t.pg, OWNER);
    // Paid "today" (UTC) at 01:00; tomorrow's digest covers today.
    await q(`insert into donations(project_id,part_id,attempt_id,amount_cents,currency,status,paid_at)
      select project_id,id,gen_random_uuid(),65000,'usd','paid',date_trunc('day', now() at time zone 'utc') at time zone 'utc' + interval '1 hour' from parts where slug='hood'`);
    await q("update parts set funded_at = date_trunc('day', now() at time zone 'utc') at time zone 'utc' + interval '1 hour' where slug='hood'");
    const tomorrow = new Date(Date.now() + 86_400_000).toISOString().slice(0, 10);
    const fetchImpl = vi.fn(async () => new Response(JSON.stringify({ id: 'em_1' }), { status: 200 }));
    const config = { ...t.config, emailApiKey: 're_x', emailFrom: 'S6 <a@b.c>', ownerDigest: true, digestHourUtc: 6 };
    expect(await sendOwnerDigests({ db: t.db, config, logger: t.logger, now: new Date(`${tomorrow}T05:00:00Z`), fetchImpl })).toBe(0);
    expect(await sendOwnerDigests({ db: t.db, config, logger: t.logger, now: new Date(`${tomorrow}T09:00:00Z`), fetchImpl })).toBe(1);
    expect(await sendOwnerDigests({ db: t.db, config, logger: t.logger, now: new Date(`${tomorrow}T09:10:00Z`), fetchImpl })).toBe(0);
    expect(fetchImpl).toHaveBeenCalledTimes(1);
    const body = JSON.parse(fetchImpl.mock.calls[0][1].body);
    expect(body.to).toEqual(['owner@example.com']);
    expect(body.subject).toContain('$650 from 1 contribution(s) · 1 part(s) funded');
    expect(body.text).toContain('Ready to buy (record the purchase in admin):\n  • Hood');
  });
  it('retries a digest whose send failed', async () => {
    await createUser(t.pg, OWNER, 'owner@example.com');
    await q('update auth.users set email_confirmed_at=now()');
    await makeOwner(t.pg, OWNER);
    await q("insert into donations(project_id,attempt_id,amount_cents,currency,status,paid_at) select id,gen_random_uuid(),500,'usd','paid',now() - interval '1 minute' from projects");
    const tomorrow = new Date(Date.now() + 86_400_000).toISOString().slice(0, 10);
    const config = { ...t.config, emailApiKey: 're_x', emailFrom: 'S6 <a@b.c>', ownerDigest: true, digestHourUtc: 6 };
    const failing = vi.fn(async () => new Response('no', { status: 500 }));
    expect(await sendOwnerDigests({ db: t.db, config, logger: t.logger, now: new Date(`${tomorrow}T09:00:00Z`), fetchImpl: failing })).toBe(0);
    const ok = vi.fn(async () => new Response(JSON.stringify({ id: 'em_2' }), { status: 200 }));
    expect(await sendOwnerDigests({ db: t.db, config, logger: t.logger, now: new Date(`${tomorrow}T09:10:00Z`), fetchImpl: ok })).toBe(1);
  });
  it('builds a readable summary and flags quiet days', () => {
    const s = { raised_cents: 4200, contributions: 3, refunded_cents: 0, needs_review: 1, newly_funded: ['Hood'], ready_to_buy: ['Hood'], pending_posts: 0, monthly_active: 2, monthly_past_due: 0 };
    const e = digestEmail({ projectTitle: 'Project S6', currency: 'eur', summary: s }, 'https://s6.example');
    expect(e.subject).toBe('Project S6 daily: €42 from 3 contribution(s) · 1 part(s) funded');
    expect(e.text).toContain('1 payment(s) need review');
    expect(e.quiet).toBe(false);
    expect(digestEmail({ projectTitle: 'P', currency: 'usd', summary: { ...s, contributions: 0, newly_funded: [], ready_to_buy: [], needs_review: 0 } }, 'x').quiet).toBe(true);
  });
});

describe('monitoring', () => {
  it('scrubs emails, bodies and user data', () => {
    const e = scrub({ message: 'failed for a@b.co', request: { data: '{}', cookies: 'x', headers: {} }, user: { email: 'a@b.co' }, exception: { values: [{ value: 'x y@z.io' }] } });
    expect(e).toEqual({ message: 'failed for [email]', request: {}, user: undefined, exception: { values: [{ value: 'x [email]' }] } });
  });
});
