import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from 'react';
import { DEFAULT_VIEW_ID, getView, viewHasPart, viewsContainingPart } from '../data/views.js';
import { loadDraft, saveDraft } from '../lib/donations.js';
import { track } from '../lib/analytics.js';
import { useProjectData } from './useProjectData.jsx';

const GarageContext = createContext(null);

const emptyDraft = { amountCents: 2500, partId: null, displayName: '', isPublic: false };

/**
 * Shell-level UI state shared by the header, garage stage, parts rail and dialogs:
 * camera view, selected part, search/filter and the donation draft.
 */
export function GarageStateProvider({ children, initialViewId = DEFAULT_VIEW_ID }) {
  const [viewId, setViewIdRaw] = useState(initialViewId);
  const viewIdRef = useRef(initialViewId);
  const [selectedPartId, setSelectedPartId] = useState(null);
  const [hoveredPartId, setHoveredPartId] = useState(null);
  const [search, setSearch] = useState('');
  const [statusFilter, setStatusFilter] = useState('all');
  const [draft, setDraftRaw] = useState(() => ({ ...emptyDraft, ...(loadDraft() ?? {}) }));
  const [donationOpen, setDonationOpen] = useState(false);
  const { partsById } = useProjectData();
  const partsRef = useRef(partsById);
  partsRef.current = partsById;

  // Search term analytics, debounced so we record what people settle on, not keystrokes.
  useEffect(() => {
    const term = search.trim();
    if (term.length < 2) return undefined;
    const t = setTimeout(() => track('search', { search_term: term.slice(0, 60).toLowerCase() }), 1200);
    return () => clearTimeout(t);
  }, [search]);

  const setViewId = useCallback((id) => {
    if (!getView(id)) return; // unavailable or unknown views are never selectable
    setHoveredPartId(null);
    if (viewIdRef.current !== id) track('select_angle', { angle_id: id });
    viewIdRef.current = id;
    setViewIdRaw(id);
  }, []);

  /**
   * Select a part. From the list, an off-camera part switches to the first view that
   * shows it; if no view shows it the camera stays put and details open without a dot.
   */
  const selectPart = useCallback(
    (partId, { source = 'list' } = {}) => {
      setSelectedPartId(partId);
      const part = partsRef.current[partId];
      if (part) {
        track('select_item', {
          selection_source: source,
          ecommerce: {
            item_list_id: 'parts',
            item_list_name: 'Restoration parts',
            items: [{ item_id: part.id, item_name: part.name, item_category: `part_${part.status}`, price: part.estimateCents / 100 }],
          },
        });
      }
      if (!partId || source !== 'list') return;
      if (!viewHasPart(viewId, partId)) {
        const first = viewsContainingPart(partId)[0];
        if (first) setViewId(first.id);
      }
    },
    [viewId, setViewId],
  );

  const setDraft = useCallback((patch) => {
    setDraftRaw((d) => {
      const next = { ...d, ...(typeof patch === 'function' ? patch(d) : patch) };
      saveDraft(next);
      return next;
    });
  }, []);

  const openDonation = useCallback(
    (patch = {}) => {
      setDraft(patch);
      setDonationOpen(true);
      track('donate_dialog_open', { part_id: patch.partId ?? null });
    },
    [setDraft],
  );

  const value = useMemo(
    () => ({
      viewId, setViewId,
      selectedPartId, selectPart, clearSelection: () => setSelectedPartId(null),
      hoveredPartId, setHoveredPartId,
      search, setSearch,
      statusFilter, setStatusFilter,
      draft, setDraft,
      donationOpen, openDonation, closeDonation: () => setDonationOpen(false),
    }),
    [viewId, setViewId, selectedPartId, selectPart, hoveredPartId, search, statusFilter, draft, setDraft, donationOpen, openDonation],
  );
  return <GarageContext.Provider value={value}>{children}</GarageContext.Provider>;
}

export function useGarageState() {
  const ctx = useContext(GarageContext);
  if (!ctx) throw new Error('useGarageState must be used inside GarageStateProvider');
  return ctx;
}
