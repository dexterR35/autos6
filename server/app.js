import express from 'express';
import helmet from 'helmet';
import { rateLimit } from 'express-rate-limit';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { SESSION_ID_RE, validateCheckoutBody } from './validation.js';
import { extractEvent, invoicePaymentIntent, refundedTotal } from './stripeEvents.js';
import { fetchCover, renderPartCard } from './ogImage.js';
import { readFile } from 'node:fs/promises';
import { createLogger } from './logger.js';
import { ROUTES, normalizePath } from '../src/seo/config.js';
import { registerSubscriptions } from './subscriptions.js';
import { contentSecurityPolicy } from './security.js';
import { formatCents } from '../src/lib/money.js';

const DEFAULT_DIST = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../dist');

function publicStatus(row) {
  let status = row.status;
  if (status === 'paid' && row.refundedCents > 0) status = row.refundedCents >= row.amountCents ? 'refunded' : 'partially_refunded';
  return { status, amountCents: row.amountCents, currency: row.currency, partName: row.partName ?? null, ...(row.refundedCents > 0 ? { refundedCents: row.refundedCents } : {}) };
}

/**
 * @param {{ stripe?: import('stripe').Stripe|null, db?: object|null, config: ReturnType<import('./config.js').readConfig>, logger?: object }} deps
 */
export function createApp({ stripe = null, db = null, config, logger = createLogger(), monitor = null }) {
  const app = express();
  app.disable('x-powered-by');
  if (config.trustProxy) app.set('trust proxy', config.trustProxy);
  app.use(helmet({ contentSecurityPolicy: contentSecurityPolicy(config, config.distDir || DEFAULT_DIST), referrerPolicy: { policy: 'no-referrer' } }));
  app.use('/api', (_req, res, next) => { res.set('Cache-Control', 'no-store'); next(); });
  const originGuard = (req, res, next) => {
    if (req.get('origin') && req.get('origin') !== config.appOrigin || req.get('sec-fetch-site') === 'cross-site') return res.status(403).json({ error: 'Origin not allowed.' });
    next();
  };

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
    if (Boolean(event.livemode) !== config.stripeLive) return res.status(400).json({ error: 'Payment mode mismatch.' });

    const args = extractEvent(event);
    if (!args) return res.json({ received: true, ignored: true });

    try {
      if (args.kind === 'dispute') {
        const result = await db.processDisputeEvent(args);
        logger.info(`webhook ${event.type} ${event.id}: ${result}`);
        return res.json({ received: true, result });
      }
      if (args.kind === 'recurring') {
        if (args.type === 'invoice.paid' && !args.paymentIntentId && args.invoiceId) {
          // Needed so refunds of a monthly payment find their donation.
          args.paymentIntentId = await invoicePaymentIntent(stripe, args.invoiceId);
          // Without it a later refund or dispute of this month can't be matched.
          if (!args.paymentIntentId) logger.warn(`invoice ${args.invoiceId} has no payment intent; refunds of it need manual review`);
        }
        const result = await db.processRecurringEvent(args);
        logger.info(`webhook ${event.type} ${event.id}: ${result}`);
        return res.json({ received: true, result });
      }
      if (args.syncRefunds) args.amountRefunded = await refundedTotal(stripe, args.paymentIntentId);
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
  registerSubscriptions(app, { db, config, json, limiter, originGuard, logger });

  app.get('/api/health', (_req, res) => {
    res.json({ ok: true, payments: Boolean(stripe && db), webhooks: Boolean(stripe && db && config.stripeWebhookSecret) });
  });

  // ---- Create a Checkout Session for a donation attempt.
  app.post('/api/donations/checkout', limiter(config.rateLimit.checkoutPerMinute), originGuard, json, async (req, res) => {
    const origin = req.get('origin');
    if (origin && origin !== config.appOrigin) return res.status(403).json({ error: 'Origin not allowed.' });
    if (!stripe || !db || !config.stripeWebhookSecret) return res.status(503).json({ error: 'Donations are not available right now (payments are not configured).' });

    const { value, error } = validateCheckoutBody(req.body, config);
    if (error) return res.status(400).json({ error });
    if (value.recurring) return startMonthlyCheckout(value, res);

    let donation;
    try {
      donation = await db.createPendingDonation(value);
    } catch (err) {
      if (err.code === 'project_not_found') return res.status(404).json({ error: 'Unknown project.' });
      if (err.code === 'part_not_found') return res.status(400).json({ error: 'Unknown part.' });
      if (err.code === 'part_closed') return res.status(409).json({ code: 'part_closed', error: 'This part is already fully funded. Please choose another part or the general fund.' });
      if (err.code === 'amount_exceeds_remaining') {
        const remainingCents = err.remainingCents ?? 0;
        return res.status(400).json({ code: 'amount_exceeds_remaining', remainingCents, error: 'That is more than this part still needs. Lower the amount, or give the rest to the general fund.' });
      }
      if (err.code === 'below_minimum') return res.status(400).json({ code: 'below_minimum', minimumCents: err.minimumCents, error: `The minimum contribution is ${formatCents(err.minimumCents, err.currency, { compact: false })}.` });
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
          consent_collection: { terms_of_service: 'required' },
          custom_text: { terms_of_service_acceptance: { message: `I agree to the [donation terms](${config.appOrigin}/terms) and have read the [privacy notice](${config.appOrigin}/privacy).` } },
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
          metadata: { donation_id: donation.donationId, project_slug: value.projectSlug, part_slug: donation.partSlug ?? '', terms_version: value.termsVersion },
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

  // ---- Monthly support: a Stripe subscription; each paid invoice becomes a donation.
  async function startMonthlyCheckout(value, res) {
    let rec;
    try {
      rec = await db.createRecurring(value);
    } catch (err) {
      if (err.code === 'project_not_found') return res.status(404).json({ error: 'Unknown project.' });
      if (err.code === 'part_not_found') return res.status(400).json({ error: 'Unknown part.' });
      if (err.code === 'part_closed') return res.status(409).json({ code: 'part_closed', error: 'This part is already fully funded. Please choose another part or the general fund.' });
      if (err.code === 'attempt_mismatch') return res.status(409).json({ error: 'This checkout attempt changed. Please start again.' });
      if (err.code === 'below_minimum') return res.status(400).json({ code: 'below_minimum', minimumCents: err.minimumCents, error: `The minimum contribution is ${formatCents(err.minimumCents, err.currency, { compact: false })}.` });
      logger.error('createRecurring failed', err.message);
      return res.status(500).json({ error: 'Could not start checkout. Please try again.' });
    }
    if (rec.status !== 'pending') return res.status(409).json({ error: 'This checkout attempt is already finished. Please start again.' });
    const productName = rec.partName ? `Project S6 monthly support — ${rec.partName}` : 'Project S6 monthly support';
    const cancelParams = new URLSearchParams({ amount: (rec.amountCents / 100).toFixed(2), monthly: '1' });
    if (rec.partSlug) cancelParams.set('part', rec.partSlug);
    let session;
    try {
      session = await stripe.checkout.sessions.create(
        {
          mode: 'subscription',
          // Allowed in subscription mode on the SDK's pinned API version (2026-09-30.endive).
          submit_type: 'donate',
          consent_collection: { terms_of_service: 'required' },
          custom_text: { terms_of_service_acceptance: { message: `I agree to the [donation terms](${config.appOrigin}/terms) and have read the [privacy notice](${config.appOrigin}/privacy). I can cancel any time.` } },
          line_items: [{
            quantity: 1,
            price_data: {
              currency: rec.currency,
              unit_amount: rec.amountCents,
              recurring: { interval: 'month' },
              product_data: { name: productName, description: 'Monthly contribution toward a personal car restoration project. Not a purchase of parts; not tax-deductible. Cancel any time.' },
            },
          }],
          success_url: `${config.appOrigin}/donation/success?session_id={CHECKOUT_SESSION_ID}&monthly=1`,
          cancel_url: `${config.appOrigin}/donation/cancel?${cancelParams}`,
          client_reference_id: rec.recurringId,
          metadata: { recurring_id: rec.recurringId, project_slug: value.projectSlug, part_slug: rec.partSlug ?? '', terms_version: value.termsVersion },
          subscription_data: { metadata: { recurring_id: rec.recurringId }, description: productName },
        },
        { idempotencyKey: `recurring-checkout-${value.attemptId}` },
      );
    } catch (err) {
      logger.error('stripe subscription checkout failed', err.message);
      return res.status(502).json({ error: 'The payment provider is unavailable. Please try again shortly.' });
    }
    try {
      if (!await db.attachRecurringSession(rec.recurringId, session.id)) return res.status(409).json({ error: 'This checkout attempt has expired. Please start again.' });
    } catch (err) {
      logger.error('attachRecurringSession failed', err.message);
      return res.status(500).json({ error: 'Could not start checkout. Please try again.' });
    }
    return res.json({ url: session.url });
  }

  // Stripe's customer portal (change card, cancel), reachable only with the Checkout
  // Session id from the supporter's own return page.
  app.post('/api/recurring/manage', limiter(10), originGuard, json, async (req, res) => {
    const sessionId = req.body?.sessionId;
    if (typeof sessionId !== 'string' || !SESSION_ID_RE.test(sessionId)) return res.status(400).json({ error: 'Invalid session.' });
    if (!stripe || !db) return res.status(503).json({ error: 'Not available right now.' });
    try {
      // Only shortly after checkout; later, supporters sign in through Stripe's own
      // email login (STRIPE portal login link) or the link in their receipts.
      const customerId = await db.getRecurringPortalCustomer(sessionId);
      if (!customerId) return res.status(404).json({ code: 'portal_unavailable', error: 'This link has expired or isn’t ready yet. Use “Manage monthly support” on the Donations page or the link in your Stripe receipt.' });
      const portal = await stripe.billingPortal.sessions.create({ customer: customerId, return_url: `${config.appOrigin}/donations` });
      return res.json({ url: portal.url });
    } catch (err) {
      logger.error('billing portal failed', err.message);
      return res.status(502).json({ error: 'Could not open the billing page. Please try again shortly.' });
    }
  });

  // ---- Share image for a part (Open Graph / Twitter). Cached for 10 minutes.
  const ogCache = new Map();
  const trustedImageOrigins = () => [config.supabaseUrl, config.appOrigin, config.modelAssetBaseUrl]
    .map((u) => { try { return new URL(u).origin; } catch { return null; } }).filter(Boolean);
  app.get('/api/og/parts/:file', limiter(120), async (req, res) => {
    const slug = req.params.file.match(/^([a-z0-9-]{1,60})\.png$/)?.[1];
    if (!slug) return res.status(404).json({ error: 'Not found.' });
    if (!db?.getPartCard) return res.status(503).json({ error: 'Unavailable.' });
    const hit = ogCache.get(slug);
    if (hit && Date.now() - hit.at < 600_000) {
      res.set({ 'Content-Type': 'image/png', 'Cache-Control': 'public, max-age=600' });
      return res.end(hit.png);
    }
    try {
      const card = await partCard(slug);
      if (!card) return res.status(404).json({ error: 'Not found.' });
      const cover = card.coverUrl ? await fetchCover(new URL(card.coverUrl, config.appOrigin).href, trustedImageOrigins()) : null;
      const png = renderPartCard(card, cover);
      if (ogCache.size > 200) ogCache.delete(ogCache.keys().next().value);
      ogCache.set(slug, { at: Date.now(), png });
      res.set({ 'Content-Type': 'image/png', 'Cache-Control': 'public, max-age=600' });
      return res.end(png);
    } catch (err) {
      logger.error('og image failed', err.message);
      return res.status(500).json({ error: 'Could not render image.' });
    }
  });

  // ---- Status for the return page, scoped to the unguessable Checkout Session id.
  app.get('/api/donations/status', limiter(config.rateLimit.statusPerMinute), async (req, res) => {
    res.set('Cache-Control', 'no-store');
    const sessionId = req.query.session_id;
    if (typeof sessionId !== 'string' || !SESSION_ID_RE.test(sessionId)) return res.status(400).json({ error: 'Invalid session.' });
    if (!db) return res.status(503).json({ error: 'Status unavailable.' });
    try {
      const row = await db.getDonationStatus(sessionId);
      if (row) return res.json(publicStatus(row));
      const rec = db.getRecurringBySession ? await db.getRecurringBySession(sessionId) : null;
      if (rec) {
        // Monthly: "paid" once Stripe confirmed the subscription.
        const status = rec.status === 'active' ? 'paid' : rec.status === 'pending' ? 'processing' : rec.status === 'past_due' ? 'processing' : 'failed';
        return res.json({ status, monthly: true, amountCents: rec.amountCents, currency: rec.currency, partName: rec.partName ?? null });
      }
      return res.status(404).json({ error: 'Not found.' });
    } catch (err) {
      logger.error('getDonationStatus failed', err.message);
      return res.status(500).json({ error: 'Status unavailable.' });
    }
  });

  app.use('/api', (_req, res) => res.status(404).json({ error: 'Not found.' }));

  // Optional: serve the built frontend from the same process (single-service deploys).
  // Each route has its own pre-rendered HTML (correct <head> for crawlers); unknown paths
  // get 404.html with a real 404 status instead of a "soft 404".
  // Short cache of live part slugs, so share links to new parts resolve without a DB hit each time.
  let partSlugs = { at: 0, set: new Set() };
  const livePartExists = async (slug) => {
    if (!db?.listPartSlugs) return false;
    if (Date.now() - partSlugs.at > 60_000) {
      try { partSlugs = { at: Date.now(), set: new Set(await db.listPartSlugs(config.projectSlug)) }; }
      catch (err) { logger.warn('listPartSlugs failed', err.message); return false; }
    }
    return partSlugs.set.has(slug);
  };
  // Part cards for share images and page meta: unknown slugs never reach the database,
  // and each card is read at most once a minute.
  const cardCache = new Map();
  const partCard = async (slug) => {
    if (!await livePartExists(slug)) return null;
    const hit = cardCache.get(slug);
    if (hit && Date.now() - hit.at < 60_000) return hit.card;
    const card = await db.getPartCard(config.projectSlug, slug);
    if (cardCache.size > 500) cardCache.delete(cardCache.keys().next().value);
    cardCache.set(slug, { at: Date.now(), card });
    return card;
  };

  const htmlCache = new Map();
  const attr = (s) => String(s).replace(/&/g, '&amp;').replace(/"/g, '&quot;').replace(/</g, '&lt;');
  async function partPageHtml(dist, file, slug) {
    try {
      const card = await partCard(slug);
      if (!card) return null;
      if (!htmlCache.has(file)) htmlCache.set(file, await readFile(path.join(dist, file), 'utf8'));
      let html = htmlCache.get(file);
      const image = `${config.appOrigin}/api/og/parts/${slug}.png`;
      const pct = card.goalCents > 0 ? Math.min(100, Math.round(card.raisedCents / card.goalCents * 100)) : 0;
      const title = `${card.name} · ${pct}% funded · ${card.projectTitle}`;
      const left = Math.max(0, card.goalCents - card.raisedCents);
      const description = ['needed', 'upgrade'].includes(card.status)
        ? `${formatCents(card.raisedCents, card.currency)} of ${formatCents(card.goalCents, card.currency)} raised. ${formatCents(left, card.currency)} to go — help fund the ${card.name}.`
        : `${card.name}: ${card.status === 'funded' ? 'fully funded' : card.status}. Thanks to everyone who helped.`;
      // Replace the pre-rendered tag (marked data-seo="key") or add it before </head>.
      const set = (key, kind, content) => {
        const tag = `<meta ${kind}="${key}" content="${attr(content)}" data-seo="${key}" />`;
        const re = new RegExp(`<meta[^>]*(?:data-seo|${kind})="${key.replace(/[.:]/g, '\\$&')}"[^>]*>`);
        // Replacer functions: "$&"-style patterns in a part name must stay literal text.
        html = re.test(html) ? html.replace(re, () => tag) : html.replace('</head>', () => `    ${tag}\n  </head>`);
      };
      set('og:image', 'property', image);
      set('og:image:type', 'property', 'image/png');
      set('og:image:width', 'property', '1200');
      set('og:image:height', 'property', '630');
      set('og:image:alt', 'property', `${card.name} funding progress`);
      set('twitter:image', 'name', image);
      set('twitter:image:alt', 'name', `${card.name} funding progress`);
      set('twitter:card', 'name', 'summary_large_image');
      set('og:title', 'property', title);
      set('og:description', 'property', description);
      return html;
    } catch (err) {
      logger.warn('part page meta failed', err.message);
      return null;
    }
  }

  if (config.serveStatic) {
    const DIST = config.distDir || DEFAULT_DIST;
    app.use('/assets', express.static(path.join(DIST, 'assets'), { immutable: true, maxAge: '1y' }));
    app.use(express.static(DIST, { index: false, redirect: false, maxAge: '1h' }));
    app.get(/^(?!\/api\/).*/, async (req, res) => {
      const route = normalizePath(req.path);
      res.set('Cache-Control', 'no-cache');
      const partSlug = route.match(/^\/parts\/([a-z0-9-]{1,60})$/)?.[1];
      const prerendered = ROUTES.some((r) => r.path === route);
      // Part pages get a live share card (photo + progress) for social previews.
      if (partSlug && db?.getPartCard && (prerendered || await livePartExists(partSlug))) {
        const html = await partPageHtml(DIST, prerendered ? `${route.slice(1)}/index.html` : 'parts/index.html', partSlug);
        if (html) return res.type('html').send(html);
      }
      if (prerendered) {
        return res.sendFile(path.join(DIST, route === '/' ? 'index.html' : `${route.slice(1)}/index.html`));
      }
      // Parts added from the admin page have no pre-rendered page yet. When the slug is a
      // real part, serve the parts page (the app opens its card); otherwise a real 404.
      if (partSlug && await livePartExists(partSlug)) return res.sendFile(path.join(DIST, 'parts/index.html'));
      return res.status(404).sendFile(path.join(DIST, '404.html'));
    });
  }

  // eslint-disable-next-line no-unused-vars
  app.use((err, _req, res, _next) => {
    if (err.type === 'entity.parse.failed') return res.status(400).json({ error: 'Invalid JSON.' });
    if (err.type === 'entity.too.large') return res.status(413).json({ error: 'Request too large.' });
    logger.error('unhandled error', err.message);
    monitor?.captureException?.(err);
    return res.status(500).json({ error: 'Server error.' });
  });

  return app;
}
