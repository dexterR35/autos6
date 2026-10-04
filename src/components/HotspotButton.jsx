import { formatCents } from '../lib/money.js';
import { STATUS_LABELS } from '../lib/parts.js';

/** Semantic hotspot: 44px hit area, ~22px visible blue ring. Always blue regardless of status. */
export default function HotspotButton({ part, point, selected, active, onSelect, onHover, currency, delay = '0ms', covered = false }) {
  return (
    <button
      type="button"
      className={`hotspot ${selected ? 'is-selected' : ''} ${active ? 'is-active' : ''} ${covered ? 'is-covered' : ''}`}
      tabIndex={covered ? -1 : undefined}
      style={{ left: point.x, top: point.y, '--delay': delay }}
      aria-label={`${part.name}, ${STATUS_LABELS[part.status]}, estimated ${formatCents(part.estimateCents, currency)}. Show details.`}
      aria-pressed={selected}
      data-part-id={part.id}
      onClick={() => onSelect(part.id)}
      onMouseEnter={() => onHover(part.id)}
      onMouseLeave={() => onHover(null)}
      onFocus={() => onHover(part.id)}
      onBlur={() => onHover(null)}
    >
      <span className="hotspot__ring" aria-hidden="true" />
    </button>
  );
}
