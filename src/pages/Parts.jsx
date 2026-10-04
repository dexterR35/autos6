import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { Car, SearchX } from 'lucide-react';
import PartThumb from '../components/PartThumb.jsx';
import StatusChip from '../components/StatusChip.jsx';
import PartDetailsDrawer from '../components/PartDetailsDrawer.jsx';
import Modal from '../components/Modal.jsx';
import { formatCents } from '../lib/money.js';
import { countByStatus, filterParts, matchesSearch } from '../lib/parts.js';
import { useGarageState } from '../hooks/useGarageState.jsx';
import { useProjectData } from '../hooks/useProjectData.jsx';
import { viewsContainingPart } from '../data/views.js';

const TABS = [
  { id: 'all', label: 'All' },
  { id: 'needed', label: 'Needed' },
  { id: 'upgrade', label: 'Upgrade' },
  { id: 'bought', label: 'Bought' },
];

export default function Parts() {
  const { parts, project, status } = useProjectData();
  const g = useGarageState();
  const navigate = useNavigate();
  const [openId, setOpenId] = useState(null);
  const currency = project.currency ?? 'usd';
  const counts = countByStatus(parts.filter((p) => matchesSearch(p, g.search)));
  const rows = filterParts(parts, { query: g.search, status: g.statusFilter });
  const open = parts.find((p) => p.id === openId);
  const totalEstimate = parts.reduce((s, p) => s + p.estimateCents, 0);

  return (
    <div className="page">
      <header className="page-head">
        <div>
          <p className="kicker">Catalogue</p>
          <h1>Parts</h1>
          <p className="muted">
            Estimates are planning figures, independent of the overall campaign goal. Combined estimate:{' '}
            {formatCents(totalEstimate, currency)}.
          </p>
        </div>
        <label className="search search--page">
          <span className="visually-hidden">Search parts</span>
          <input type="search" placeholder="Search name or condition…" value={g.search} onChange={(e) => g.setSearch(e.target.value)} />
        </label>
      </header>

      <div className="tabs tabs--page" role="group" aria-label="Filter by status">
        {TABS.map((t) => (
          <button key={t.id} type="button" className={`tab ${g.statusFilter === t.id ? 'is-active' : ''}`} aria-pressed={g.statusFilter === t.id} onClick={() => g.setStatusFilter(t.id)}>
            {t.label} ({counts[t.id]})
          </button>
        ))}
      </div>

      {status === 'loading' && <p className="muted">Loading parts…</p>}
      {status === 'unconfigured' && <p className="muted">Live parts list unavailable — Supabase is not configured.</p>}

      <ul className="parts-grid">
        {rows.map((p) => (
          <li key={p.id}>
            <button type="button" className="part-card panel" onClick={() => setOpenId(p.id)}>
              <PartThumb part={p} size="xl" />
              <span className="part-card__name">{p.name}</span>
              <span className="part-card__meta">
                <span className="part-card__price">{formatCents(p.estimateCents, currency)}</span>
                <StatusChip status={p.status} />
              </span>
              <span className="muted part-card__cond">{p.condition}</span>
            </button>
          </li>
        ))}
      </ul>
      {status === 'ready' && rows.length === 0 && (
        <div className="empty">
          <SearchX aria-hidden="true" />
          <p>No parts match{g.search ? ` “${g.search}”` : ' this filter'}.</p>
          <button type="button" className="btn btn--ghost btn--sm" onClick={() => { g.setSearch(''); g.setStatusFilter('all'); }}>Clear filters</button>
        </div>
      )}

      <Modal open={Boolean(open)} onClose={() => setOpenId(null)} title="Part details" labelledBy="part-modal-title" className="part-modal">
        {open && (
          <>
            <PartDetailsDrawer
              part={open}
              viewId={null}
              currency={currency}
              showVisibility={false}
              onClose={() => setOpenId(null)}
              onFund={(partId) => {
                setOpenId(null);
                g.openDonation({ partId });
              }}
              onViewChange={() => {}}
            />
            {viewsContainingPart(open.id).length > 0 ? (
              <button
                type="button"
                className="btn btn--ghost btn--block"
                onClick={() => {
                  g.selectPart(open.id, { source: 'list' });
                  setOpenId(null);
                  navigate('/');
                }}
              >
                <Car aria-hidden="true" /> Show on the car
              </button>
            ) : (
              <p className="fine">No photo of this part yet, so it isn’t marked on the car.</p>
            )}
          </>
        )}
      </Modal>
    </div>
  );
}
