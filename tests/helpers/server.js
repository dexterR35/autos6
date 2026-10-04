import Stripe from 'stripe';
import { vi } from 'vitest';
import { createApp } from '../../server/app.js';
import { readConfig } from '../../server/config.js';
import { createPgliteServerDb, createTestDb } from './pg.js';

export const WEBHOOK_SECRET = 'whsec_test_secret_for_unit_tests';
export const APP_ORIGIN = 'http://localhost:5173';

/** Stripe double: real webhook signing/verification, mocked Checkout API (no network). */
export function createStripeDouble() {
  const real = new Stripe('sk_test_unit_tests_only');
  let n = 0;
  const byKey = new Map(); // Stripe returns the same object for a repeated idempotency key
  const create = vi.fn(async (params, opts) => {
    if (opts?.idempotencyKey && byKey.has(opts.idempotencyKey)) return byKey.get(opts.idempotencyKey);
    n += 1;
    const id = `cs_test_session${String(n).padStart(6, '0')}`;
    const session = { id, url: `https://checkout.stripe.test/c/pay/${id}` };
    if (opts?.idempotencyKey) byKey.set(opts.idempotencyKey, session);
    return session;
  });
  return { webhooks: real.webhooks, checkout: { sessions: { create } } };
}

export async function createTestServer(overrides = {}) {
  const pg = await createTestDb();
  const db = createPgliteServerDb(pg);
  const stripe = createStripeDouble();
  const config = {
    ...readConfig({ APP_ORIGIN, STRIPE_WEBHOOK_SECRET: WEBHOOK_SECRET, RATE_CHECKOUT_PER_MIN: '1000', RATE_STATUS_PER_MIN: '1000' }),
    stripeWebhookSecret: WEBHOOK_SECRET,
    ...overrides.config,
  };
  const logger = { info: vi.fn(), warn: vi.fn(), error: vi.fn() };
  const app = createApp({ stripe: overrides.stripe === undefined ? stripe : overrides.stripe, db: overrides.db ?? db, config, logger });
  return { app, pg, db, stripe, logger, config };
}

export function signedEvent(stripe, event, secret = WEBHOOK_SECRET) {
  const payload = JSON.stringify(event);
  const header = stripe.webhooks.generateTestHeaderString({ payload, secret });
  return { payload, header };
}

let evt = 0;
export function sessionEvent(type, session, extra = {}) {
  evt += 1;
  return { id: `evt_test_${evt}_${Math.random().toString(36).slice(2, 8)}`, object: 'event', type, livemode: false, data: { object: { object: 'checkout.session', ...session } }, ...extra };
}
export function chargeRefundedEvent(charge) {
  evt += 1;
  return { id: `evt_test_${evt}_refund`, object: 'event', type: 'charge.refunded', livemode: false, data: { object: { object: 'charge', ...charge } } };
}
