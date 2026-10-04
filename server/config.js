import { DEFAULT_MAX_CENTS, DEFAULT_MIN_CENTS } from '../src/lib/money.js';

const int = (v, d) => (v != null && v !== '' && Number.isInteger(Number(v)) ? Number(v) : d);

export function readConfig(env = process.env) {
  const appOrigin = (env.APP_ORIGIN || 'http://localhost:5173').replace(/\/+$/, '');
  return {
    port: int(env.PORT, 3001),
    appOrigin,
    supabaseUrl: env.SUPABASE_URL || '',
    // Newer projects use a secret key (sb_secret_...); the legacy service_role JWT also works.
    supabaseSecretKey: env.SUPABASE_SECRET_KEY || env.SUPABASE_SERVICE_ROLE_KEY || '',
    stripeSecretKey: env.STRIPE_SECRET_KEY || '',
    stripeWebhookSecret: env.STRIPE_WEBHOOK_SECRET || '',
    minCents: int(env.DONATION_MIN_CENTS, DEFAULT_MIN_CENTS),
    maxCents: int(env.DONATION_MAX_CENTS, DEFAULT_MAX_CENTS),
    trustProxy: env.TRUST_PROXY ? int(env.TRUST_PROXY, 1) : false,
    serveStatic: env.SERVE_STATIC === 'true',
    distDir: env.DIST_DIR || '',
    rateLimit: { checkoutPerMinute: int(env.RATE_CHECKOUT_PER_MIN, 10), statusPerMinute: int(env.RATE_STATUS_PER_MIN, 60) },
  };
}
