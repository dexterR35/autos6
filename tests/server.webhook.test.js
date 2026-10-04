import request from 'supertest';
import { beforeEach, describe, expect, it } from 'vitest';
import { APP_ORIGIN, chargeRefundedEvent, createTestServer, sessionEvent, signedEvent } from './helpers/server.js';

let t;
let donation; // { id, sessionId }

async function startCheckout(amountCents = 5000, partId = 'hood') {
  const res = await request(t.app)
    .post('/api/donations/checkout')
    .set('Origin', APP_ORIGIN)
    .send({ projectSlug: 'project-s6', partId, amountCents, displayName: 'Robin', isPublic: true, attemptId: crypto.randomUUID() });
  expect(res.status).toBe(200);
  const call = t.stripe.checkout.sessions.create.mock.calls.at(-1);
  return { id: call[0].metadata.donation_id, sessionId: (await t.pg.query('select stripe_checkout_session_id as s from donations where id = $1', [call[0].metadata.donation_id])).rows[0].s };
}

const session = (over = {}) => ({
  id: donation.sessionId,
  payment_status: 'paid',
  amount_total: 5000,
  currency: 'usd',
  payment_intent: 'pi_test_abc123',
  customer_details: { email: 'robin@example.com' },
  metadata: { donation_id: donation.id },
  ...over,
});

async function deliver(event, { header } = {}) {
  const signed = signedEvent(t.stripe, event);
  return request(t.app)
    .post('/api/stripe/webhook')
    .set('Content-Type', 'application/json')
    .set('Stripe-Signature', header ?? signed.header)
    .send(signed.payload);
}

const raised = async () => Number((await t.pg.query(`select raised_cents from get_campaign_summary('project-s6')`)).rows[0].raised_cents);
const statusOf = async () => (await request(t.app).get(`/api/donations/status?session_id=${donation.sessionId}`)).body;

beforeEach(async () => {
  t = await createTestServer();
  donation = await startCheckout();
});

describe('POST /api/stripe/webhook', () => {
  it('rejects an invalid signature without touching the database', async () => {
    const res = await deliver(sessionEvent('checkout.session.completed', session()), { header: 't=1,v1=deadbeef' });
    expect(res.status).toBe(400);
    expect(await raised()).toBe(0);
    expect(Number((await t.pg.query('select count(*) from stripe_events')).rows[0].count)).toBe(0);
  });

  it('rejects a payload signed with another secret', async () => {
    const ev = sessionEvent('checkout.session.completed', session());
    const forged = signedEvent(t.stripe, ev, 'whsec_attacker');
    const res = await request(t.app).post('/api/stripe/webhook').set('Content-Type', 'application/json').set('Stripe-Signature', forged.header).send(forged.payload);
    expect(res.status).toBe(400);
  });

  it('records a completed paid session and updates the public total', async () => {
    expect((await statusOf()).status).toBe('pending');
    const res = await deliver(sessionEvent('checkout.session.completed', session()));
    expect(res.status).toBe(200);
    expect(res.body.result).toBe('applied');
    expect(await raised()).toBe(5000);
    expect(await statusOf()).toEqual({ status: 'paid', amountCents: 5000, currency: 'usd', partName: 'Hood' });
    const part = (await t.pg.query(`select status from parts where slug = 'hood'`)).rows[0];
    expect(part.status).toBe('needed'); // donations never mark parts bought
  });

  it('counts a duplicate delivery only once', async () => {
    const ev = sessionEvent('checkout.session.completed', session());
    await deliver(ev);
    const again = await deliver(ev);
    expect(again.status).toBe(200);
    expect(again.body.result).toBe('duplicate');
    expect(await raised()).toBe(5000);
  });

  it('handles delayed (async) payment success', async () => {
    await deliver(sessionEvent('checkout.session.completed', session({ payment_status: 'unpaid' })));
    expect((await statusOf()).status).toBe('processing');
    expect(await raised()).toBe(0);
    await deliver(sessionEvent('checkout.session.async_payment_succeeded', session()));
    expect((await statusOf()).status).toBe('paid');
    expect(await raised()).toBe(5000);
  });

  it('handles async payment failure', async () => {
    await deliver(sessionEvent('checkout.session.completed', session({ payment_status: 'unpaid' })));
    await deliver(sessionEvent('checkout.session.async_payment_failed', session({ payment_status: 'unpaid' })));
    expect((await statusOf()).status).toBe('failed');
    expect(await raised()).toBe(0);
  });

  it('is safe against out-of-order delivery (success before completed, expired after paid)', async () => {
    await deliver(sessionEvent('checkout.session.async_payment_succeeded', session()));
    await deliver(sessionEvent('checkout.session.completed', session({ payment_status: 'unpaid' })));
    await deliver(sessionEvent('checkout.session.expired', session({ payment_status: 'unpaid' })));
    expect((await statusOf()).status).toBe('paid');
    expect(await raised()).toBe(5000);
  });

  it('marks an abandoned session expired', async () => {
    await deliver(sessionEvent('checkout.session.expired', session({ payment_status: 'unpaid', payment_intent: null })));
    expect((await statusOf()).status).toBe('expired');
  });

  it('subtracts refunds (cumulative, order-independent)', async () => {
    await deliver(sessionEvent('checkout.session.completed', session()));
    await deliver(chargeRefundedEvent({ payment_intent: 'pi_test_abc123', amount_refunded: 3000 }));
    await deliver(chargeRefundedEvent({ payment_intent: 'pi_test_abc123', amount_refunded: 1000 })); // late, older event
    expect(await raised()).toBe(2000);
    expect((await statusOf()).status).toBe('partially_refunded');
    await deliver(chargeRefundedEvent({ payment_intent: 'pi_test_abc123', amount_refunded: 5000 }));
    expect(await raised()).toBe(0);
    expect((await statusOf()).status).toBe('refunded');
  });

  it('flags amount mismatches for review instead of counting them', async () => {
    const res = await deliver(sessionEvent('checkout.session.completed', session({ amount_total: 1 })));
    expect(res.body.result).toBe('mismatch');
    expect(await raised()).toBe(0);
  });

  it('asks Stripe to retry (500) when the donation is not visible yet, then succeeds', async () => {
    const ev = sessionEvent('checkout.session.completed', session({ id: 'cs_test_unknownsession1', metadata: { donation_id: crypto.randomUUID() } }));
    const res = await deliver(ev);
    expect(res.status).toBe(500);
    // the event row was rolled back, so a retry is processed normally later
    expect(Number((await t.pg.query('select count(*) from stripe_events where event_id = $1', [ev.id])).rows[0].count)).toBe(0);
  });

  it('allows retry on a temporary database failure', async () => {
    const broken = { ...t.db, processStripeEvent: async () => { throw new Error('connection reset'); } };
    const t2 = await createTestServer({ db: broken });
    const ev = sessionEvent('checkout.session.completed', session());
    const signed = signedEvent(t2.stripe, ev);
    const res = await request(t2.app).post('/api/stripe/webhook').set('Content-Type', 'application/json').set('Stripe-Signature', signed.header).send(signed.payload);
    expect(res.status).toBe(500);
  });

  it('ignores events that are not ours', async () => {
    const res = await deliver(sessionEvent('checkout.session.completed', session({ metadata: {} })));
    expect(res.body).toEqual({ received: true, ignored: true });
    const other = await deliver({ id: 'evt_other', object: 'event', type: 'customer.created', data: { object: { id: 'cus_1' } } });
    expect(other.body.ignored).toBe(true);
  });
});
