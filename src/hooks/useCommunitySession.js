import { useEffect, useState } from 'react';
import { supabase } from '../lib/supabase.js';
export default function useCommunitySession() {
  const [session, setSession] = useState(null);
  useEffect(() => {
    if (!supabase) return;
    let active = true;
    supabase.auth.getSession().then(({ data }) => { if (active) setSession(data.session); });
    const { data } = supabase.auth.onAuthStateChange((_event, value) => setSession(value));
    return () => { active = false; data.subscription.unsubscribe(); };
  }, []);
  return session;
}
