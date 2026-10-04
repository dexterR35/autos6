import express from 'express';
import helmet from 'helmet';
import { rateLimit } from 'express-rate-limit';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { SESSION_ID_RE, validateCheckoutBody } from './validation.js';
import { extractEvent } from './stripeEvents.js';
import { createLogger } from './logger.js';
import { ROUTES, normalizePath } from '../src/seo/config.js';

const DEFAULT_DIST = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../dist');

function publicStatus(row) {
  let status = row.status;
  if (status === 'paid' && row.refundedCents > 0) status = row.refundedCents >= row.amountCents ? 'refunded' : 'partially_refunded';
  return { status, amountCents: row.amountCents, currency: row.currency, partName: row.partName ?? null };
}

/**
 * @param {{ stripe?: import('stripe').Stripe|null, db?: object|null, config: ReturnType<import('./config.js').readConfig>, logger?: object }} deps
 */
export function createApp({ stripe = null, db = null, config, logger = createLogger() }) {
  const app = express();
  app.disable('x-powered-by');
  if (config.trustProxy) app.set('trust proxy', config.trustProxy);
  app.use(helmet({ contentSecurityPolicy: false }));

  const limiter = (limit) => rateLimit({ windowMs: 60_000, limit, standardHeaders: 'draft-8', legacyHeaders: false, message: { error: 'Too many requests. Please wait a moment.' } });

  // ---- Stripe webhook: raw body is required for signature verification, so this route is
  // registered before any JSON parser.
  app.post('/api/stripe/webhook', express.raw({ type: 'application/json', limit: '1mb' }), async (req, res) => {
    if (!stripe || !db || !config.stripeWebhookSecret) return res.status(503).json({ error: 'Webhook not configured.' });
    const signature = req.get('stripe-signature');
    if (!signature || !Buffer.isBuffer(req.body)) return res.status(400).json({ error: 'Missing signature.' });

    let event;
    try {
      event = stripe.webhooks.constructEvent(req.body, signature, config.stripeWebhookSecret);
    } catch {
      logger.warn('webhook signature verification failed');
      return res.status(400).json({ error: 'Invalid signature.' });
    }

    const args = extractEvent(event);
    if (!args) return res.json({ received: true, ignored: true });

    try {
      const result = await db.processStripeEvent(args);
      logger.info(`webhook ${event.type} ${event.id}: ${result}`);
      return res.json({ received: true, result });
    } catch (err) {
      // Non-2xx makes Stripe retry later (e.g. DB temporarily down, or event before record).
      logger.error(`webhook ${event.type} ${event.id} failed: ${err.code || 'error'}`, err.message);
      return res.status(500).json({ error: 'Temporary failure, please retry.' });
    }
  });

  const json = express.json({ limit: '10kb' });

  app.get('/api/health', (_req, res) => {
    res.json({ ok: true, payments: Boolean(stripe && db), webhooks: Boolean(stripe && db && config.stripeWebhookSecret) });
  });

  // ---- Create a Checkout Session for a donation attempt.
  app.post('/api/donations/checkout', limiter(config.rateLimit.checkoutPerMinute), json, async (req, res) => {
    const origin = req.get('origin');
    if (origin && origin !== config.appOrigin) return res.status(403).json({ error: 'Origin not allowed.' });
    if (!stripe || !db) return res.status(503).json({ error: 'Donations are not available right now (payments are not configured).' });

    const { value, error } = validateCheckoutBody(req.body, config);
    if (error) return res.status(400).json({ error });

    let donation;
    try {
      donation = await db.createPendingDonation(value);
    } catch (err) {
      if (err.code === 'project_not_found') return res.status(404).json({ error: 'Unknown project.' });
      if (err.code === 'part_not_found') return res.status(400).json({ error: 'Unknown part.' });
      if (err.code === 'attempt_mismatch') return res.status(409).json({ error: 'This checkout attempt changed. Please start again.' });
      logger.error('createPendingDonation failed', err.message);
      return res.status(500).json({ error: 'Could not start checkout. Please try again.' });
    }
    if (donation.status !== 'pending') {
      return res.status(409).json({ error: 'This checkout attempt is already finished. Please start a new donation.' });
    }

    const amount = (donation.amountCents / 100).toFixed(2);
    const cancelParams = new URLSearchParams({ amount });
    if (donation.partSlug) cancelParams.set('part', donation.partSlug);
    const productName = donation.partName ? `Project S6 restoration — ${donation.partName}` : 'Project S6 restoration fund';

    let session;
    try {
      session = await stripe.checkout.sessions.create(
        {
          mode: 'payment',
          submit_type: 'donate',
          line_items: [
            {
              quantity: 1,
              price_data: {
                currency: donation.currency,
                unit_amount: donation.amountCents,
                product_data: {
                  name: productName,
                  description: 'Contribution toward a personal car restoration project. Not a purchase of parts; not tax-deductible.',
                },
              },
            },
          ],
          success_url: `${config.appOrigin}/donation/success?session_id={CHECKOUT_SESSION_ID}`,
          cancel_url: `${config.appOrigin}/donation/cancel?${cancelParams}`,
          client_reference_id: donation.donationId,
          metadata: { donation_id: donation.donationId, project_slug: value.projectSlug, part_slug: donation.partSlug ?? '' },
          payment_intent_data: { metadata: { donation_id: donation.donationId }, description: productName },
        },
        { idempotencyKey: `donation-checkout-${value.attemptId}` },
      );
    } catch (err) {
      logger.error('stripe checkout.sessions.create failed', err.message);
      return res.status(502).json({ error: 'The payment provider is unavailable. Please try again shortly.' });
    }

    try {
      const linked = await db.attachCheckoutSession(donation.donationId, session.id);
      if (!linked) return res.status(409).json({ error: 'This checkout attempt has expired. Please start a new donation.' });
    } catch (err) {
      logger.error('attachCheckoutSession failed', err.message);
      return res.status(500).json({ error: 'Could not start checkout. Please try again.' });
    }
    return res.json({ url: session.url });
  });

  // ---- Status for the return page, scoped to the unguessable Checkout Session id.
  app.get('/api/donations/status', limiter(config.rateLimit.statusPerMinute), async (req, res) => {
    res.set('Cache-Control', 'no-store');
    const sessionId = req.query.session_id;
    if (typeof sessionId !== 'string' || !SESSION_ID_RE.test(sessionId)) return res.status(400).json({ error: 'Invalid session.' });
    if (!db) return res.status(503).json({ error: 'Status unavailable.' });
    try {
      const row = await db.getDonationStatus(sessionId);
      if (!row) return res.status(404).json({ error: 'Not found.' });
      return res.json(publicStatus(row));
    } catch (err) {
      logger.error('getDonationStatus failed', err.message);
      return res.status(500).json({ error: 'Status unavailable.' });
    }
  });

  app.use('/api', (_req, res) => res.status(404).json({ error: 'Not found.' }));

  // Optional: serve the built frontend from the same process (single-service deploys).
  // Each route has its own pre-rendered HTML (correct <head> for crawlers); unknown paths
  // get 404.html with a real 404 status instead of a "soft 404".
  if (config.serveStatic) {
    const DIST = config.distDir || DEFAULT_DIST;
    app.use('/assets', express.static(path.join(DIST, 'assets'), { immutable: true, maxAge: '1y' }));
    app.use(express.static(DIST, { index: false, redirect: false, maxAge: '1h' }));
    app.get(/^(?!\/api\/).*/, (req, res) => {
      const route = normalizePath(req.path);
      res.set('Cache-Control', 'no-cache');
      if (ROUTES.some((r) => r.path === route)) {
        return res.sendFile(path.join(DIST, route === '/' ? 'index.html' : `${route.slice(1)}/index.html`));
      }
      return res.status(404).sendFile(path.join(DIST, '404.html'));
    });
  }

  // eslint-disable-next-line no-unused-vars
  app.use((err, _req, res, _next) => {
    if (err.type === 'entity.parse.failed') return res.status(400).json({ error: 'Invalid JSON.' });
    if (err.type === 'entity.too.large') return res.status(413).json({ error: 'Request too large.' });
    logger.error('unhandled error', err.message);
    return res.status(500).json({ error: 'Server error.' });
  });

  return app;
}
