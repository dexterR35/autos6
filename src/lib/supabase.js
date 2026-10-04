import { createClient } from '@supabase/supabase-js';
import { HAS_SUPABASE, SUPABASE_URL, SUPABASE_PUBLISHABLE_KEY } from './config.js';

// Browser client uses only the publishable key; every write is still checked by RLS.
export const supabase = HAS_SUPABASE ? createClient(SUPABASE_URL, SUPABASE_PUBLISHABLE_KEY) : null;
