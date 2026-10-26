import { useCallback, useEffect, useMemo, useState } from 'react';
import { fetchGarageSupporters } from '../lib/liveData.js';

const NO_ROWS = Object.freeze([]);

export default function useGarageSupporters({ project, isDemo, status }) {
  const [attempt, setAttempt] = useState(0);
  const [supporters, setSupporters] = useState({ rows: NO_ROWS, state: 'loading', scope: 'all' });
  const reload = useCallback(() => setAttempt((value) => value + 1), []);

  useEffect(() => {
    if (isDemo || status !== 'ready') return undefined;
    const controller = new AbortController();
    let inFlight = false;
    const load = async () => {
      if (inFlight || controller.signal.aborted) return;
      inFlight = true;
      try {
        const result = await fetchGarageSupporters(project.slug, { currency: project.currency, signal: controller.signal });
        if (!controller.signal.aborted) setSupporters({ ...result, state: 'ready' });
      } catch {
        if (!controller.signal.aborted) setSupporters({ rows: NO_ROWS, state: 'error', scope: 'all' });
      } finally { inFlight = false; }
    };
    setSupporters({ rows: NO_ROWS, state: 'loading', scope: 'all' });
    load();
    const interval = setInterval(load, 60_000);
    return () => { controller.abort(); clearInterval(interval); };
  }, [project.slug, project.currency, isDemo, status, attempt]);

  // Keep the same object between renders: the 3D supporter board redraws and
  // re-uploads its large canvas texture whenever this value changes identity.
  return useMemo(() => {
    if (isDemo) return { rows: NO_ROWS, state: 'ready', scope: 'all', isDemo: true, reload };
    if (status !== 'ready') return { rows: NO_ROWS, state: status === 'loading' ? 'loading' : 'error', scope: 'all', isDemo: false, reload };
    return { ...supporters, isDemo: false, reload };
  }, [isDemo, status, supporters, reload]);
}
