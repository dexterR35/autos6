import { ChevronRight } from 'lucide-react';
import PartThumb from './PartThumb.jsx';
import StatusChip from './StatusChip.jsx';
import { formatCents } from '../lib/money.js';

// Short conditions ("Scratched", "Needs paint") read better on the card; long ones fall
// back to the status label ("Needed", "Upgrade"), as in the reference dashboard.
const calloutLabel = (part) => (part.condition && part.condition.length <= 14 ? part.condition : undefined);

/**
 * Floating card linked to a hotspot. Pointer shortcut only — the hotspot button is the
 * keyboard/screen-reader control, so the card is hidden from assistive tech.
 */
export default function PartCallout({ part, rect, active, currency, onSelect, onHover, delay = '0ms', covered = false }) {
  return (
    <div
      className={`callout ${active ? 'is-active' : ''} ${covered ? 'is-covered' : ''}`}
      style={{ left: rect.x, top: rect.y, width: rect.width, height: rect.height, '--delay': delay }}
      aria-hidden="true"
      data-callout-part={part.id}
      onClick={() => onSelect(part.id)}
      onMouseEnter={() => onHover(part.id)}
      onMouseLeave={() => onHover(null)}
    >
      <PartThumb part={part} size="sm" />
      <span className="callout__body">
        <span className="callout__name">{part.name}</span>
        <span className="callout__price">{formatCents(part.estimateCents, currency)}</span>
        <StatusChip status={part.status} label={calloutLabel(part)} size="sm" />
      </span>
      <ChevronRight className="callout__chevron" aria-hidden="true" />
    </div>
  );
}
