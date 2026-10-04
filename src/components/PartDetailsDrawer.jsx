import { forwardRef, useEffect, useRef } from 'react';
import { Camera, EyeOff, HandHeart, X } from 'lucide-react';
import PartThumb from './PartThumb.jsx';
import StatusChip from './StatusChip.jsx';
import { formatCents } from '../lib/money.js';
import { viewHasPart, viewsContainingPart } from '../data/views.js';

/** Details for the selected part, with "Fund this part". Docked on desktop, bottom sheet on phones. */
const PartDetailsDrawer = forwardRef(function PartDetailsDrawer({ part, viewId, currency, onClose, onFund, onViewChange, showVisibility = true }, ref) {
  const closeRef = useRef(null);
  const inView = viewHasPart(viewId, part.id);
  const containing = viewsContainingPart(part.id);

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
      <div className="part-drawer__top">
        <PartThumb part={part} size="lg" />
        <div>
          <h2 id="part-drawer-title">{part.name}</h2>
          <p className="part-drawer__price">
            {formatCents(part.estimateCents, currency)} <span className="muted">estimate</span>
          </p>
          <div className="part-drawer__chips">
            <StatusChip status={part.status} />
            {part.condition && <span className="condition">{part.condition}</span>}
          </div>
        </div>
      </div>
      {part.description && <p className="part-drawer__desc">{part.description}</p>}

      {showVisibility && (
        <div className="part-drawer__views">
          {containing.length === 0 ? (
            <p className="note"><EyeOff aria-hidden="true" /> No photo shows this part yet, so it has no dot on the car.</p>
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

      {part.status === 'bought' ? (
        <p className="note note--ok">Already purchased. General contributions still help with fitting and finishing.</p>
      ) : null}
      <button type="button" className="btn btn--donate btn--block" onClick={() => onFund(part.id)}>
        <HandHeart aria-hidden="true" /> Fund this part
      </button>
      <p className="fine">Supports the restoration of this part — it isn’t a purchase of the part.</p>
    </aside>
  );
});

export default PartDetailsDrawer;
