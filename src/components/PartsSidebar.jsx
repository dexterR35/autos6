import { useEffect, useRef, useState } from 'react';
import { ChevronRight, Funnel, SearchX } from 'lucide-react';
import PartThumb from './PartThumb.jsx';
import StatusChip from './StatusChip.jsx';
import { formatCents } from '../lib/money.js';
import { countByStatus, filterParts, matchesSearch } from '../lib/parts.js';
import { useGarageState } from '../hooks/useGarageState.jsx';
import { useProjectData } from '../hooks/useProjectData.jsx';

const TABS = [
  { id: 'all', label: 'All' },
  { id: 'needed', label: 'Needed' },
  { id: 'bought', label: 'Bought' },
];

export default function PartsSidebar({ id = 'parts-rail' }) {
  const { parts, project, status } = useProjectData();
  const { search, setSearch, statusFilter, setStatusFilter, selectedPartId, selectPart, hoveredPartId, setHoveredPartId } = useGarageState();
  const [filterOpen, setFilterOpen] = useState(false);
  const listRef = useRef(null);
  const searched = parts.filter((p) => matchesSearch(p, search));
  const counts = countByStatus(searched);
  const rows = filterParts(parts, { query: search, status: statusFilter });
  const currency = project.currency ?? 'usd';

  // Keep the selected row in view when selection comes from the stage.
  useEffect(() => {
    if (!selectedPartId) return;
    const el = listRef.current?.querySelector(`[data-part-row="${selectedPartId}"]`);
    el?.scrollIntoView?.({ block: 'nearest', behavior: 'smooth' });
  }, [selectedPartId]);

  return (
    <aside id={id} className="parts-rail" aria-labelledby="parts-rail-title">
      <div className="parts-rail__head">
        <h2 id="parts-rail-title">Parts list</h2>
        <div className="filter-menu">
          <button
            type="button"
            className={`icon-btn ${statusFilter === 'upgrade' ? 'is-on' : ''}`}
            aria-expanded={filterOpen}
            aria-controls="parts-filter-menu"
            aria-label="More filters"
            onClick={() => setFilterOpen((o) => !o)}
          >
            <Funnel aria-hidden="true" />
          </button>
          {filterOpen && (
            <div id="parts-filter-menu" className="filter-menu__pop" role="group" aria-label="More filters">
              <button
                type="button"
                aria-pressed={statusFilter === 'upgrade'}
                onClick={() => {
                  setStatusFilter(statusFilter === 'upgrade' ? 'all' : 'upgrade');
                  setFilterOpen(false);
                }}
              >
                Upgrades only ({counts.upgrade})
              </button>
              {search && (
                <button type="button" onClick={() => { setSearch(''); setFilterOpen(false); }}>
                  Clear search “{search}”
                </button>
              )}
            </div>
          )}
        </div>
      </div>

      <div className="tabs" role="group" aria-label="Filter by status">
        {TABS.map((t) => (
          <button
            key={t.id}
            type="button"
            className={`tab ${statusFilter === t.id ? 'is-active' : ''}`}
            aria-pressed={statusFilter === t.id}
            onClick={() => setStatusFilter(t.id)}
          >
            {t.label} ({counts[t.id]})
          </button>
        ))}
      </div>
      {statusFilter === 'upgrade' && (
        <p className="filter-note">
          Showing upgrades ({counts.upgrade}) ·{' '}
          <button type="button" className="link-btn" onClick={() => setStatusFilter('all')}>show all</button>
        </p>
      )}

      {status === 'loading' && <p className="rail-msg">Loading parts…</p>}
      {status === 'unconfigured' && <p className="rail-msg">Live parts list unavailable — Supabase is not configured.</p>}
      {status === 'error' && <p className="rail-msg">Could not load parts. Try again later.</p>}

      <ul ref={listRef} className="part-rows">
        {rows.map((p) => (
          <li key={p.id}>
            <button
              type="button"
              data-part-row={p.id}
              className={`part-row ${selectedPartId === p.id ? 'is-selected' : ''} ${hoveredPartId === p.id ? 'is-hovered' : ''}`}
              aria-current={selectedPartId === p.id ? 'true' : undefined}
              onClick={() => selectPart(p.id, { source: 'list' })}
              onMouseEnter={() => setHoveredPartId(p.id)}
              onMouseLeave={() => setHoveredPartId(null)}
            >
              <PartThumb part={p} />
              <span className="part-row__text">
                <span className="part-row__name">{p.name}</span>
                <span className="part-row__price">{formatCents(p.estimateCents, currency)}</span>
              </span>
              <StatusChip status={p.status} />
              <ChevronRight className="part-row__chevron" aria-hidden="true" />
            </button>
          </li>
        ))}
      </ul>
      {status === 'ready' && rows.length === 0 && (
        <div className="empty">
          <SearchX aria-hidden="true" />
          <p>No parts match{search ? ` “${search}”` : ' this filter'}.</p>
          <button type="button" className="btn btn--ghost btn--sm" onClick={() => { setSearch(''); setStatusFilter('all'); }}>
            Clear filters
          </button>
        </div>
      )}
    </aside>
  );
}
