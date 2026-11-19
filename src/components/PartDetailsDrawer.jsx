import { forwardRef, useEffect, useRef } from 'react';
import { Camera, CalendarDays, EyeOff, HandHeart, Users, X } from 'lucide-react';
import PartThumb from './PartThumb.jsx';
import StatusChip from './StatusChip.jsx';
import PartProgress from './PartProgress.jsx';
import PriorityChip from './PriorityChip.jsx';
import SubscribeButton from './SubscribeButton.jsx';
import PartMedia, { partImages } from './PartMedia.jsx';
import PartStages from './PartStages.jsx';
import BeforeAfter from './BeforeAfter.jsx';
import PartSupporters from './PartSupporters.jsx';
import ShareButton from './ShareButton.jsx';
import { formatCents as fmt } from '../lib/money.js';
import { isOpen, partKind, remainingCents, STATUS_LABELS } from '../lib/parts.js';
import { useProjectData } from '../hooks/useProjectData.jsx';
import { safeMediaUrl } from '../lib/safeMedia.js';
import { formatCents } from '../lib/money.js';
import { viewHasPart, viewsContainingPart } from '../data/views.js';

const STAGE_NOTES = {
  funded: 'Fully funded — thank you! The owner is buying this part next.',
  ordered: 'Fully funded and ordered. Fitting photos will follow.',
  bought: 'Bought. You can still help with the rest of the build through the general fund.',
  installed: 'Bought and fitted to the car.',
};

/** Details for the selected part, with "Fund this part". Docked on desktop, bottom sheet on phones. */
const PartDetailsDrawer = forwardRef(function PartDetailsDrawer({ part, viewId, currency, onClose, onFund, onViewChange, showVisibility = true }, ref) {
  const closeRef = useRef(null);
  const inView = viewHasPart(viewId, part.id);
  const containing = viewsContainingPart(part.id);
  const { updates = [] } = useProjectData();
  const log = updates.filter((u) => u.partId === part.id);
  const open = isOpen(part);
  const left = remainingCents(part);
  const hasMedia = partImages(part).length > 0 || Boolean(safeMediaUrl(part.modelUrl));

  useEffect(() => {
    const onKey = (e) => {
      if (e.key === 'Escape' && !document.querySelector('dialog[open]')) onClose();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);

  return (
    <aside ref={ref} className="panel part-drawer" aria-labelledby="part-drawer-title" aria-live="polite">
      <button ref={closeRef} type="button" className="icon-btn part-drawer__close" onClick={onClose} aria-label="Close part details">
        <X aria-hidden="true" />
      </button>
      {hasMedia && <PartMedia part={part} />}
      <div className="part-drawer__top">
        {!hasMedia && <PartThumb part={part} size="lg" />}
        <div>
          <h2 id="part-drawer-title">{part.name}</h2>
          <p className="part-drawer__price">
            {formatCents(part.estimateCents, currency)} <span className="muted">goal</span>
            {part.actualCostCents != null && <span className="muted"> · paid {formatCents(part.actualCostCents, currency)}</span>}
          </p>
          <div className="part-drawer__chips">
            <StatusChip status={part.status} />
            <PriorityChip priority={part.priority} />
            {partKind(part) === 'upgrade' && part.status !== 'upgrade' && <span className="condition">Upgrade</span>}
            {part.condition && <span className="condition">{part.condition}</span>}
          </div>
        </div>
      </div>
      {part.description && <p className="part-drawer__desc">{part.description}</p>}
      <PartStages part={part} />
      <PartProgress part={part} currency={currency} />
      <p className="part-drawer__facts">
        {open && left != null && left > 0 && <span><strong>{formatCents(left, currency)}</strong> to go</span>}
        {Number.isFinite(part.supporterCount) && part.supporterCount > 0 && <span><Users aria-hidden="true" /> {part.supporterCount} {part.supporterCount === 1 ? 'supporter' : 'supporters'}</span>}
      </p>

      {showVisibility && (
        <div className="part-drawer__views">
          {containing.length === 0 ? (
            <p className="note"><EyeOff aria-hidden="true" /> No view shows this part yet, so it has no dot on the car.</p>
          ) : (
            <>
              {!inView && <p className="note"><EyeOff aria-hidden="true" /> Not visible in this angle.</p>}
              <div className="view-links" role="group" aria-label="Angles showing this part">
                <Camera aria-hidden="true" />
                {containing.map((v) => (
                  <button key={v.id} type="button" className={`view-link ${v.id === viewId ? 'is-active' : ''}`} aria-pressed={v.id === viewId} onClick={() => onViewChange(v.id)}>
                    {v.label}
                  </button>
                ))}
              </div>
            </>
          )}
        </div>
      )}

      <BeforeAfter before={part.beforeImageUrl} after={part.afterImageUrl} name={part.name} />
      {part.receiptUrl && safeMediaUrl(part.receiptUrl) && (
        <p className="fine"><a href={safeMediaUrl(part.receiptUrl)} target="_blank" rel="noopener noreferrer">View receipt{part.actualCostCents != null ? ` (${fmt(part.actualCostCents, currency)})` : ''}</a></p>
      )}
      <PartSupporters part={part} />
      {log.length > 0 && (
        <section className="part-log" aria-labelledby="part-log-title">
          <h3 id="part-log-title">Build log</h3>
          <ol>
            {log.map((u) => (
              <li key={u.id}>
                <time dateTime={u.publishedAt}><CalendarDays aria-hidden="true" /> {new Date(u.publishedAt).toLocaleDateString(undefined, { dateStyle: 'medium' })}</time>
                <strong>{u.title}</strong>
                {u.body && <p>{u.body}</p>}
                {u.costCents != null && <p className="muted">Cost: {formatCents(u.costCents, currency)}</p>}
                {u.imageUrls?.filter(safeMediaUrl).length > 0 && (
                  <div className="part-log__photos">{u.imageUrls.filter(safeMediaUrl).map((src) => <img key={src} src={src} alt={`Photo for ${u.title}`} loading="lazy" />)}</div>
                )}
              </li>
            ))}
          </ol>
        </section>
      )}

      {open ? (
        <button type="button" className="btn btn--donate btn--block" onClick={() => onFund(part.id)}>
          <HandHeart aria-hidden="true" /> Fund this part
        </button>
      ) : (
        <>
          <p className="note note--ok" role="status">{STAGE_NOTES[part.status] ?? `${STATUS_LABELS[part.status] ?? 'Done'}.`}</p>
          <button type="button" className="btn btn--ghost btn--block" onClick={() => onFund(null)}>
            <HandHeart aria-hidden="true" /> Support the general fund
          </button>
        </>
      )}
      <ShareButton path={`/parts/${part.id}`} title={part.name} text={isOpen(part) ? `Help fund the ${part.name}` : `${part.name}: ${STATUS_LABELS[part.status]}`} />
      <SubscribeButton partId={part.id} />
    </aside>
  );
});

export default PartDetailsDrawer;
