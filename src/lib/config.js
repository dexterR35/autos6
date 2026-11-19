const env = import.meta.env ?? {};

export const DEMO_MODE = String(env.VITE_DEMO_MODE ?? 'true').toLowerCase() !== 'false';
export const SUPABASE_URL = env.VITE_SUPABASE_URL || '';
export const SUPABASE_PUBLISHABLE_KEY = env.VITE_SUPABASE_PUBLISHABLE_KEY || '';
export const PROJECT_SLUG = env.VITE_PROJECT_SLUG || 'project-s6';
export const HAS_SUPABASE = Boolean(SUPABASE_URL && SUPABASE_PUBLISHABLE_KEY);
export const IS_DEV = Boolean(env.DEV);
// Stripe's no-code customer portal login (Settings → Billing → Customer portal → Activate link).
// Supporters sign in with their email and a one-time code to change their card or cancel.
const portal = String(env.VITE_STRIPE_PORTAL_LOGIN_URL || '');
export const STRIPE_PORTAL_LOGIN_URL = /^https:\/\/billing\.stripe\.com\/p\/login\/[A-Za-z0-9_]+$/.test(portal) ? portal : '';
