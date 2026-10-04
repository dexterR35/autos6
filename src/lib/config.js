const env = import.meta.env ?? {};

export const DEMO_MODE = String(env.VITE_DEMO_MODE ?? 'true').toLowerCase() !== 'false';
export const SUPABASE_URL = env.VITE_SUPABASE_URL || '';
export const SUPABASE_PUBLISHABLE_KEY = env.VITE_SUPABASE_PUBLISHABLE_KEY || '';
export const PROJECT_SLUG = env.VITE_PROJECT_SLUG || 'project-s6';
export const HAS_SUPABASE = Boolean(SUPABASE_URL && SUPABASE_PUBLISHABLE_KEY);
export const IS_DEV = Boolean(env.DEV);
