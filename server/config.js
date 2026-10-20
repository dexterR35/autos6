import { DEFAULT_MAX_CENTS, DEFAULT_MIN_CENTS } from '../src/lib/money.js';

const int = (v, d) => (v != null && v !== '' && Number.isInteger(Number(v)) ? Number(v) : d);

export function readConfig(env = process.env) {
  const appOrigin = (env.APP_ORIGIN || 'http://localhost:5173').replace(/\/+$/, '');
  const url = new URL(appOrigin);
  if (!['http:', 'https:'].includes(url.protocol) || url.origin !== appOrigin) throw new Error('APP_ORIGIN must be an HTTP(S) origin without a path.');
  if (env.NODE_ENV === 'production' && url.protocol !== 'https:') throw new Error('Production APP_ORIGIN must use HTTPS.');
  if (env.NODE_ENV === 'production' && env.STRIPE_SECRET_KEY && (!env.OPERATOR_NAME || !/^[^\s@<>]+@[^\s@<>]+\.[^\s@<>]+$/.test(env.CONTACT_EMAIL || ''))) throw new Error('Set OPERATOR_NAME and CONTACT_EMAIL before accepting production donations.');
  const minCents = int(env.DONATION_MIN_CENTS, DEFAULT_MIN_CENTS);
  const maxCents = int(env.DONATION_MAX_CENTS, DEFAULT_MAX_CENTS);
  if (minCents < 100 || maxCents > DEFAULT_MAX_CENTS || maxCents < minCents) throw new Error('Invalid donation limits. Use $1–$10,000.');
  return {
    port: int(env.PORT, 3001),
    appOrigin,
    supabaseUrl: env.SUPABASE_URL || '',
    // Newer projects use a secret key (sb_secret_...); the legacy service_role JWT also works.
    supabaseSecretKey: env.SUPABASE_SECRET_KEY || env.SUPABASE_SERVICE_ROLE_KEY || '',
    stripeSecretKey: env.STRIPE_SECRET_KEY || '',
    stripeWebhookSecret: env.STRIPE_WEBHOOK_SECRET || '',
    minCents,
    maxCents,
    stripeLive: (env.STRIPE_SECRET_KEY || '').startsWith('sk_live_'),
    emailApiKey: env.RESEND_API_KEY || '',
    emailFrom: env.EMAIL_FROM || '',
    subscriptionSecret: env.SUBSCRIPTION_SIGNING_SECRET || '',
    modelAssetBaseUrl: env.MODEL_ASSET_BASE_URL || env.VITE_MODEL_ASSET_BASE_URL || '',
    trustProxy: env.TRUST_PROXY ? int(env.TRUST_PROXY, 1) : false,
    serveStatic: env.SERVE_STATIC === 'true',
    distDir: env.DIST_DIR || '',
    rateLimit: { checkoutPerMinute: int(env.RATE_CHECKOUT_PER_MIN, 10), statusPerMinute: int(env.RATE_STATUS_PER_MIN, 60) },
  };
}
