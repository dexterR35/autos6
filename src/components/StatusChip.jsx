import { CircleCheck, Shield, ShoppingCart } from 'lucide-react';
import { STATUS_LABELS } from '../lib/parts.js';

const ICONS = { needed: ShoppingCart, upgrade: Shield, bought: CircleCheck };

/** Status is conveyed by icon + text, not only colour. `label` overrides the text (e.g. condition). */
export default function StatusChip({ status, label, size = 'md' }) {
  const Icon = ICONS[status] ?? ShoppingCart;
  return (
    <span className={`chip chip--${status} chip--${size}`}>
      <Icon aria-hidden="true" />
      <span>{label ?? STATUS_LABELS[status] ?? status}</span>
    </span>
  );
}
