import { useEffect } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { Box, Car, CircleCheck, Flag, HandHeart, Search, SearchX, Sparkles } from 'lucide-react';
import PartThumb from '../components/PartThumb.jsx';
import StatusChip from '../components/StatusChip.jsx';
import FundMeter from '../components/FundMeter.jsx';
import PartDetailsDrawer from '../components/PartDetailsDrawer.jsx';
import Modal from '../components/Modal.jsx';
import { countByStatus, filterParts, isAcquired, isOpen, partKind, remainingCents, STATUS_LABELS } from '../lib/parts.js';
import PartStages from '../components/PartStages.jsx';
import NextUpStrip from '../components/NextUpStrip.jsx';
import { partImages } from '../components/PartMedia.jsx';
import { formatCents } from '../lib/money.js';
import { safeMediaUrl } from '../lib/safeMedia.js';
import { useGarageState } from '../hooks/useGarageState.jsx';
import { useProjectData } from '../hooks/useProjectData.jsx';
import { viewsContainingPart } from '../data/views.js';
import { trackViewPart } from '../lib/analytics.js';
import NotFound from './NotFound.jsx';

const TABS = [
  { id: 'all', label: 'All' },
  { id: 'needed', label: 'Needed' },
  { id: 'upgrade', label: 'Upgrade' },
  { id: 'funded', label: 'Funded' },
  { id: 'bought', label: 'Bought' },
];

const fundedCents = (part) => (Number.isFinite(part.raisedCents) ? Math.min(Math.max(0, part.raisedCents), part.estimateCents) : 0);

export default function Parts() {
  const { parts, project, status } = useProjectData();
  const g = useGarageState();
  const navigate = useNavigate();
  // The open part lives in the address (/parts/<slug>) so every part has a shareable page.
  const { partId: openId = null } = useParams();
  const setOpenId = (id) => navigate(id ? `/parts/${id}` : '/parts');
  const { priorityFilter: priority, setPriorityFilter: setPriority } = g;
  const currency = project.currency ?? 'usd';
  const counts = countByStatus(filterParts(parts, { query: g.search, priority }));
  const rows = filterParts(parts, { query: g.search, status: g.statusFilter, priority });
  const open = parts.find((p) => p.id === openId);
  useEffect(() => { if (open) trackViewPart(open); }, [open?.id]); // eslint-disable-line react-hooks/exhaustive-deps
  const totalEstimate = parts.reduce((s, p) => s + p.estimateCents, 0);
  const totalFunded = parts.reduce((s, p) => s + fundedCents(p), 0);
  const bought = parts.filter(isAcquired).length;
  const funded = parts.filter((p) => !isOpen(p)).length;
  const clearFilters = () => { g.setSearch(''); g.setStatusFilter('all'); setPriority('all'); };

  if (openId && status === 'ready' && !open) return <NotFound />;

  return (
    <div className="page studio">
      <header className="studio-head">
        <div>
          <h1>Parts</h1>
          {parts.length > 0 && <p className="studio-head__stat">{bought} of {parts.length} bought · {funded} fully funded</p>}
        </div>
        <label className="search studio-search">
          <Search aria-hidden="true" />
          <span className="visually-hidden">Search parts</span>
          <input type="search" placeholder="Search parts" value={g.search} onChange={(e) => g.setSearch(e.target.value)} />
        </label>
      </header>

      {parts.length > 0 && (
        <section className="panel studio-total" aria-label="All parts funding">
          <span className="studio-total__label">Parts funded</span>
          <FundMeter label="All parts" raisedCents={totalFunded} goalCents={totalEstimate} currency={currency} size="lg" />
        </section>
      )}

      <div className="studio-filters">
        <div className="studio-segment" role="group" aria-label="Filter by status">
          {TABS.map((t) => (
            <button key={t.id} type="button" className={g.statusFilter === t.id ? 'is-active' : ''} aria-pressed={g.statusFilter === t.id} onClick={() => g.setStatusFilter(t.id)}>
              {t.label} ({counts[t.id]})
            </button>
          ))}
        </div>
        <button type="button" className="studio-toggle" aria-pressed={priority === 'important'} onClick={() => setPriority(priority === 'important' ? 'all' : 'important')}>
          <Flag aria-hidden="true" /> Important
        </button>
        {priority === 'standard' && <button type="button" className="studio-toggle" aria-pressed="true" onClick={() => setPriority('all')}>Standard ×</button>}
      </div>

      {status === 'loading' && <p className="muted">Loading parts…</p>}
      {status === 'unconfigured' && <p className="muted">Parts are unavailable right now.</p>}

      {status === 'ready' && g.statusFilter === 'all' && !g.search.trim() && priority === 'all' && <NextUpStrip parts={parts} currency={currency} onOpen={setOpenId} onFund={(id) => g.openDonation({ partId: id })} />}
      <ul className="part-grid">
        {rows.map((p) => {
          const cover = partImages(p)[0];
          const left = remainingCents(p);
          const open = isOpen(p);
          return (
            <li key={p.id} className={`part-card panel ${isAcquired(p) ? 'is-bought' : ''} ${!open ? 'is-closed' : ''}`}>
              <button type="button" className="part-card__open" onClick={() => setOpenId(p.id)} aria-label={`${p.name} details`}>
                <span className="part-card__media">
                  {cover ? <img src={cover} alt="" loading="lazy" decoding="async" /> : <PartThumb part={p} size="lg" />}
                  {safeMediaUrl(p.modelUrl) && <span className="part-card__badge"><Box aria-hidden="true" /> 3D</span>}
                  {partKind(p) === 'upgrade' && <span className="part-card__badge part-card__badge--kind"><Sparkles aria-hidden="true" /> Upgrade</span>}
                </span>
                <span className="part-card__text">
                  <span className="part-line__name">{p.name}</span>
                  <span className="part-line__meta">
                    <StatusChip status={p.status} size="sm" />
                    {p.priority === 'important' && <span className="part-line__flag"><Flag aria-hidden="true" /> Important</span>}
                    {p.condition && <span className="part-line__cond">{p.condition}</span>}
                  </span>
                </span>
              </button>
              <FundMeter label={p.name} raisedCents={p.raisedCents} goalCents={p.estimateCents} currency={currency} />
              <PartStages part={p} compact />
              <div className="part-card__foot">
                {open ? (
                  <>
                    <span className="part-card__left">{left != null && left > 0 ? <><strong>{formatCents(left, currency)}</strong> to go</> : 'Goal reached'}</span>
                    <button type="button" className="btn btn--donate part-line__fund" aria-label={`Fund ${p.name}`} onClick={() => g.openDonation({ partId: p.id })}>
                      <HandHeart aria-hidden="true" /> Fund
                    </button>
                  </>
                ) : (
                  <span className="part-line__done"><CircleCheck aria-hidden="true" /> {p.status === 'funded' ? 'Fully funded' : STATUS_LABELS[p.status]}</span>
                )}
              </div>
            </li>
          );
        })}
      </ul>
      {status === 'ready' && rows.length === 0 && (
        <div className="empty panel">
          <SearchX aria-hidden="true" />
          <p>No parts match{g.search ? ` “${g.search}”` : ' this filter'}.</p>
          <button type="button" className="btn btn--ghost btn--sm" onClick={clearFilters}>Clear filters</button>
        </div>
      )}

      <Modal open={Boolean(open)} onClose={() => setOpenId(null)} title={open?.name ?? 'Part'} labelledBy="part-modal-title" className="part-modal">
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
            {viewsContainingPart(open.id).length > 0 && (
              <button
                type="button"
                className="btn btn--ghost btn--block"
                onClick={() => {
                  g.selectPart(open.id, { source: 'list' });
                  navigate('/');
                }}
              >
                <Car aria-hidden="true" /> Show on the car
              </button>
            )}
          </>
        )}
      </Modal>
    </div>
  );
}
