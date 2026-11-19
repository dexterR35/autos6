import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import request from 'supertest';
import { asRole, createUser, makeOwner } from './helpers/pg.js';
import { APP_ORIGIN, createTestServer, sessionEvent, signedEvent, stripeEvent } from './helpers/server.js';
import { minimumCentsFor, validateAmountCents } from '../src/lib/money.js';
import { extractEvent } from '../server/stripeEvents.js';

const OWNER = '11111111-1111-4111-8111-111111111111';
let t;
beforeEach(async () => { t = await createTestServer(); });
afterEach(async () => { await t.pg.close(); });
const q = async (sql, p) => (await t.pg.query(sql, p)).rows;
const hook = (event) => {
  const { payload, header } = signedEvent(t.stripe, event);
  return request(t.app).post('/api/stripe/webhook').set('stripe-signature', header).set('content-type', 'application/json').send(payload);
};
const checkout = (body) => request(t.app).post('/api/donations/checkout').set('Origin', APP_ORIGIN).send({
  projectSlug: 'project-s6', amountCents: 2500, isPublic: false, attemptId: crypto.randomUUID(), termsAccepted: true, termsVersion: '2026-11-19', ...body,
});
const dispute = (type, pi, status) => stripeEvent(type, { object: 'dispute', id: 'dp_1', payment_intent: pi, status, amount: 65000, charge: 'ch_1' });

describe('minimum charge per currency (Stripe: RON 2.00)', () => {
  it('rejects RON contributions under 2 lei, one-time and monthly, before Stripe is called', async () => {
    await q("update projects set currency='ron'");
    for (const recurring of [false, true]) {
      const res = await checkout({ amountCents: 150, recurring });
      expect(res.status).toBe(400);
      expect(res.body).toMatchObject({ code: 'below_minimum', minimumCents: 200 });
      expect(res.body.error).toContain('RON');
    }
    expect(t.stripe.checkout.sessions.create).not.toHaveBeenCalled();
    expect((await checkout({ amountCents: 200 })).status).toBe(200);
  });
  it('lets one minimum contribution finish a RON part with under 2 lei left', async () => {
    await q("update projects set currency='ron'");
    await q("insert into donations(project_id,part_id,attempt_id,amount_cents,currency,status) select project_id,id,gen_random_uuid(),64950,'ron','paid' from parts where slug='hood'");
    expect((await checkout({ partId: 'hood', amountCents: 200 })).status).toBe(200);
    expect((await checkout({ partId: 'hood', amountCents: 300 })).status).toBe(400);
  });
  it('validates the same minimum in the browser', () => {
    expect(minimumCentsFor('ron')).toBe(200);
    expect(minimumCentsFor('eur')).toBe(100);
    expect(validateAmountCents(150, { currency: 'ron' })).toMatch(/minimum/);
    expect(validateAmountCents(150, { currency: 'eur' })).toBeNull();
  });
});

describe('disputes (chargebacks)', () => {
  const paid = () => q(`insert into donations(project_id,part_id,attempt_id,amount_cents,currency,status,stripe_payment_intent_id)
    select project_id,id,gen_random_uuid(),65000,'usd','paid','pi_disputed' from parts where slug='hood'`);
  const hood = async () => (await q("select status from parts where slug='hood'"))[0].status;
  const raised = async () => Number((await asRole(t.pg, 'anon', "select raised_cents from get_campaign_summary('project-s6')"))[0].raised_cents);

  it('takes a disputed payment out of totals and reopens the part; a won dispute restores it', async () => {
    await paid();
    expect(await hood()).toBe('funded');
    expect((await hook(dispute('charge.dispute.created', 'pi_disputed', 'needs_response'))).body.result).toBe('applied');
    expect(await raised()).toBe(0);
    expect(await hood()).toBe('needed');
    await hook(dispute('charge.dispute.closed', 'pi_disputed', 'won'));
    expect(await raised()).toBe(65000);
    expect(await hood()).toBe('funded');
    expect((await q('select dispute_status from donations'))[0].dispute_status).toBe('won');
  });
  it('keeps a lost dispute out of totals, and ignores disputes on other payments', async () => {
    await paid();
    await hook(dispute('charge.dispute.created', 'pi_disputed', 'needs_response'));
    await hook(dispute('charge.dispute.closed', 'pi_disputed', 'lost'));
    expect(await raised()).toBe(0);
    expect((await hook(dispute('charge.dispute.created', 'pi_someone_else', 'needs_response'))).body.result).toBe('ignored');
    // Won on appeal (Stripe dispute appeals): the money counts again.
    await hook({ ...dispute('charge.dispute.closed', 'pi_disputed', 'won'), id: 'evt_appeal_won' });
    expect(await raised()).toBe(65000);
    expect(extractEvent(stripeEvent('charge.dispute.created', { object: 'dispute' }))).toBeNull();
  });
  it('does not clear an earlier amount mismatch when a dispute is won', async () => {
    await paid();
    await q('update donations set needs_review=true');
    await hook(dispute('charge.dispute.created', 'pi_disputed', 'needs_response'));
    await hook(dispute('charge.dispute.closed', 'pi_disputed', 'won'));
    expect((await q('select needs_review from donations'))[0].needs_review).toBe(true);
  });
});

describe('monthly support edge cases', () => {
  const start = async () => {
    expect((await checkout({ recurring: true, amountCents: 1500 })).status).toBe(200);
    return (await q('select * from recurring_supports'))[0];
  };
  it('keeps a bank-debit monthly checkout pending until the invoice is paid', async () => {
    const rec = await start();
    await hook(sessionEvent('checkout.session.completed', { id: rec.stripe_checkout_session_id, mode: 'subscription', payment_status: 'unpaid', subscription: 'sub_9', customer: 'cus_9', metadata: { recurring_id: rec.id } }));
    expect((await q('select status from recurring_supports'))[0].status).toBe('pending');
    await hook(stripeEvent('invoice.paid', { object: 'invoice', id: 'in_9', amount_paid: 1500, currency: 'usd', customer: 'cus_9', parent: { subscription_details: { subscription: 'sub_9', metadata: { recurring_id: rec.id } } } }));
    expect((await q('select status from recurring_supports'))[0].status).toBe('active');
  });
  it('uses the Donate button label for monthly checkouts', async () => {
    await start();
    expect(t.stripe.checkout.sessions.create.mock.calls[0][0].submit_type).toBe('donate');
  });
  it('opens the billing portal from a checkout link for 2 days only', async () => {
    const rec = await start();
    await q("update recurring_supports set stripe_customer_id='cus_9'");
    const manage = () => request(t.app).post('/api/recurring/manage').set('Origin', APP_ORIGIN).send({ sessionId: rec.stripe_checkout_session_id });
    expect((await manage()).status).toBe(200);
    await q("update recurring_supports set created_at=now()-interval '3 days'");
    const late = await manage();
    expect(late.status).toBe(404);
    expect(late.body.code).toBe('portal_unavailable');
  });
});

describe('currency lock', () => {
  it('refuses to switch while a checkout in the old currency may still complete', async () => {
    await createUser(t.pg, OWNER, 'o@example.com');
    await makeOwner(t.pg, OWNER);
    const pid = (await q('select id from projects'))[0].id;
    expect((await checkout({})).status).toBe(200);
    await expect(asRole(t.pg, 'authenticated', "select public.set_project_currency($1,'eur')", [pid], OWNER)).rejects.toThrow(/currency_locked/);
    await q("update donations set created_at=now()-interval '2 days', status='expired'");
    await asRole(t.pg, 'authenticated', "select public.set_project_currency($1,'eur')", [pid], OWNER);
  });
});

describe('share card lookups', () => {
  it('never queries the database for unknown parts and caches known ones', async () => {
    let calls = 0;
    const db = { ...t.db, getPartCard: async (...a) => { calls += 1; return t.db.getPartCard(...a); } };
    const { createApp } = await import('../server/app.js');
    const app = createApp({ db, config: t.config, logger: t.logger });
    for (let i = 0; i < 5; i += 1) await request(app).get(`/api/og/parts/not-real-${i}.png`);
    expect(calls).toBe(0);
    await request(app).get('/api/og/parts/hood.png');
    await request(app).get('/api/og/parts/hood.png');
    expect(calls).toBe(1);
  });
});

describe('share page meta', () => {
  it('keeps "$&"-style text in part names literal and escaped', async () => {
    const { mkdtempSync, mkdirSync, writeFileSync } = await import('node:fs');
    const { tmpdir } = await import('node:os');
    const path = await import('node:path');
    const dist = mkdtempSync(path.join(tmpdir(), 'dist-'));
    mkdirSync(path.join(dist, 'parts'), { recursive: true });
    writeFileSync(path.join(dist, 'parts/index.html'), '<html><head><meta property="og:title" content="Old" data-seo="og:title" /></head></html>');
    writeFileSync(path.join(dist, '404.html'), 'nf');
    await q(`insert into parts(project_id,slug,name,estimate_cents) select id,'evil','Grille $& "><script>x</script>',100 from projects`);
    const { createApp } = await import('../server/app.js');
    const app = createApp({ db: t.db, config: { ...t.config, serveStatic: true, distDir: dist }, logger: t.logger });
    const page = await request(app).get('/parts/evil');
    expect(page.status).toBe(200);
    expect(page.text).toContain('content="Grille $&amp; &quot;>&lt;script>x&lt;/script> · 0% funded');
    expect(page.text).not.toContain('<script>x');
    expect(page.text.match(/og:title/g)).toHaveLength(2); // property + data-seo of one tag
  });
});
