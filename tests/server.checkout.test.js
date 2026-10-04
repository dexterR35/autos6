import request from 'supertest';
import { beforeEach, describe, expect, it } from 'vitest';
import { APP_ORIGIN, createTestServer } from './helpers/server.js';

const attempt = () => crypto.randomUUID();
const body = (over = {}) => ({ projectSlug: 'project-s6', partId: null, amountCents: 2500, displayName: 'Alex', isPublic: true, attemptId: attempt(), ...over });

let t;
beforeEach(async () => {
  t = await createTestServer();
});

const post = (b, origin = APP_ORIGIN) => request(t.app).post('/api/donations/checkout').set('Origin', origin).send(b);

describe('POST /api/donations/checkout', () => {
  it('creates a pending donation and a hosted Checkout session for a preset amount', async () => {
    const res = await post(body());
    expect(res.status).toBe(200);
    expect(res.body.url).toMatch(/^https:\/\/checkout\.stripe\.test\//);
    const [params, opts] = t.stripe.checkout.sessions.create.mock.calls[0];
    expect(params.mode).toBe('payment');
    expect(params.line_items[0].price_data).toMatchObject({ currency: 'usd', unit_amount: 2500 });
    expect(params.success_url).toBe(`${APP_ORIGIN}/donation/success?session_id={CHECKOUT_SESSION_ID}`);
    expect(params.cancel_url).toBe(`${APP_ORIGIN}/donation/cancel?amount=25.00`);
    expect(params.metadata.donation_id).toBeTruthy();
    expect(params).not.toHaveProperty('payment_method_types');
    expect(opts.idempotencyKey).toMatch(/^donation-checkout-/);
    const rows = (await t.pg.query('select status, amount_cents, stripe_checkout_session_id, display_name, is_public from donations')).rows;
    expect(rows).toEqual([{ status: 'pending', amount_cents: 2500, stripe_checkout_session_id: expect.stringMatching(/^cs_test_/), display_name: 'Alex', is_public: true }]);
  });

  it('accepts a custom amount and a part, using the server-side part name and currency', async () => {
    const res = await post(body({ amountCents: 1234, partId: 'exhaust' }));
    expect(res.status).toBe(200);
    const [params] = t.stripe.checkout.sessions.create.mock.calls[0];
    expect(params.line_items[0].price_data.unit_amount).toBe(1234);
    expect(params.line_items[0].price_data.product_data.name).toMatch(/Exhaust System/);
    expect(params.cancel_url).toContain('part=exhaust');
  });

  it.each([
    [{ amountCents: 99 }, /minimum/],
    [{ amountCents: 1_000_001 }, /maximum/],
    [{ amountCents: 12.5 }, /valid amount/],
    [{ amountCents: '2500' }, /valid amount/],
    [{ attemptId: 'nope' }, /attempt/],
    [{ projectSlug: 'DROP TABLE' }, /project/],
    [{ partId: '../etc' }, /part/],
    [{ displayName: 'x'.repeat(41) }, /40 characters/],
    [{ isPublic: 'yes' }, /recognition/],
  ])('rejects invalid input %j', async (over, msg) => {
    const res = await post(body(over));
    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(msg);
    expect(t.stripe.checkout.sessions.create).not.toHaveBeenCalled();
  });

  it('rejects unknown projects and parts from the database', async () => {
    expect((await post(body({ projectSlug: 'other-car' }))).status).toBe(404);
    expect((await post(body({ partId: 'turbo' }))).status).toBe(400);
  });

  it('is idempotent per attempt: retries reuse the same donation and idempotency key', async () => {
    const b = body();
    const a = await post(b);
    const c = await post(b);
    expect(a.status).toBe(200);
    expect(c.status).toBe(200);
    const keys = t.stripe.checkout.sessions.create.mock.calls.map(([, o]) => o.idempotencyKey);
    expect(new Set(keys).size).toBe(1);
    expect(Number((await t.pg.query('select count(*) from donations')).rows[0].count)).toBe(1);
  });

  it('refuses to reuse an attempt id with a different amount', async () => {
    const b = body();
    await post(b);
    const res = await post({ ...b, amountCents: 9999 });
    expect(res.status).toBe(409);
  });

  it('rejects cross-origin requests', async () => {
    const res = await post(body(), 'https://evil.example');
    expect(res.status).toBe(403);
  });

  it('returns 503 when Stripe is not configured', async () => {
    const t2 = await createTestServer({ stripe: null });
    const res = await request(t2.app).post('/api/donations/checkout').set('Origin', APP_ORIGIN).send(body());
    expect(res.status).toBe(503);
  });

  it('returns 502 and leaves the donation pending when Stripe errors', async () => {
    t.stripe.checkout.sessions.create.mockRejectedValueOnce(new Error('stripe down sk_test_abc123'));
    const res = await post(body());
    expect(res.status).toBe(502);
    expect(t.logger.error).toHaveBeenCalled();
    const rows = (await t.pg.query('select status, stripe_checkout_session_id from donations')).rows;
    expect(rows).toEqual([{ status: 'pending', stripe_checkout_session_id: null }]);
  });

  it('cancellation does not change campaign totals', async () => {
    await post(body());
    const [s] = (await t.pg.query(`select * from get_campaign_summary('project-s6')`)).rows;
    expect(Number(s.raised_cents)).toBe(0);
  });
});

describe('GET /api/donations/status', () => {
  it('validates the session id format and does not leak unknown ids', async () => {
    expect((await request(t.app).get('/api/donations/status?session_id=123')).status).toBe(400);
    expect((await request(t.app).get('/api/donations/status?session_id=cs_test_doesnotexist000')).status).toBe(404);
  });

  it('reports pending until the webhook confirms (success URL proves nothing)', async () => {
    await post(body());
    const sid = (await t.pg.query('select stripe_checkout_session_id from donations')).rows[0].stripe_checkout_session_id;
    const res = await request(t.app).get(`/api/donations/status?session_id=${sid}`);
    expect(res.status).toBe(200);
    expect(res.body).toEqual({ status: 'pending', amountCents: 2500, currency: 'usd', partName: null });
    expect(res.headers['cache-control']).toBe('no-store');
  });
});
