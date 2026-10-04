import { createContext, useCallback, useContext, useEffect, useMemo, useState } from 'react';
import { DEMO_MODE, HAS_SUPABASE, PROJECT_SLUG } from '../lib/config.js';
import { demoParts, demoProject, demoSummary, demoUpdates } from '../data/demoProject.js';
import { fetchLiveProject, fetchLiveSummary } from '../lib/liveData.js';

const ProjectDataContext = createContext(null);
const SUMMARY_REFRESH_MS = 60_000;

// Display copy used when live data is unavailable. Contains no money or progress.
const shellProject = { ...demoProject, id: null, goalCents: null };

function initialState(mode) {
  if (mode === 'demo') {
    return { status: 'ready', project: demoProject, parts: demoParts, updates: demoUpdates, summary: demoSummary, error: null };
  }
  if (!HAS_SUPABASE) {
    return { status: 'unconfigured', project: shellProject, parts: [], updates: [], summary: null, error: 'Live data is unavailable: Supabase is not configured.' };
  }
  return { status: 'loading', project: shellProject, parts: [], updates: [], summary: null, error: null };
}

export function ProjectDataProvider({ children, mode = DEMO_MODE ? 'demo' : 'live', slug = PROJECT_SLUG }) {
  const [state, setState] = useState(() => initialState(mode));

  const load = useCallback(async () => {
    if (mode === 'demo' || !HAS_SUPABASE) return;
    setState((s) => ({ ...s, status: s.status === 'ready' ? 'ready' : 'loading', error: null }));
    try {
      const data = await fetchLiveProject(slug);
      setState({ status: 'ready', ...data, error: null });
    } catch (err) {
      setState((s) => ({ ...s, status: 'error', error: err.message || 'Could not load project data.' }));
    }
  }, [mode, slug]);

  const refreshSummary = useCallback(async () => {
    if (mode === 'demo' || !HAS_SUPABASE) return;
    try {
      const summary = await fetchLiveSummary(slug);
      setState((s) => ({ ...s, summary }));
    } catch {
      /* keep the last good summary */
    }
  }, [mode, slug]);

  useEffect(() => {
    load();
  }, [load]);

  useEffect(() => {
    if (mode === 'demo' || !HAS_SUPABASE) return undefined;
    const t = setInterval(refreshSummary, SUMMARY_REFRESH_MS);
    return () => clearInterval(t);
  }, [mode, refreshSummary]);

  const value = useMemo(
    () => ({ ...state, mode, isDemo: mode === 'demo', reload: load, refreshSummary, partsById: Object.fromEntries(state.parts.map((p) => [p.id, p])) }),
    [state, mode, load, refreshSummary],
  );
  return <ProjectDataContext.Provider value={value}>{children}</ProjectDataContext.Provider>;
}

export function useProjectData() {
  const ctx = useContext(ProjectDataContext);
  if (!ctx) throw new Error('useProjectData must be used inside ProjectDataProvider');
  return ctx;
}
