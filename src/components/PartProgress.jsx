import { formatCents, percentOf, displayedRaised } from '../lib/money.js';

export default function PartProgress({ part, currency = 'usd', compact = false }) {
  const available = Number.isFinite(part.raisedCents);
  const raised = displayedRaised(part.raisedCents, part.estimateCents);
  const pct = percentOf(raised, part.estimateCents);
  return (
    <span className={`part-progress ${compact ? 'part-progress--compact' : ''}`}>
      <span className="part-progress__labels">
        <span>{available ? `${formatCents(raised, currency)} funded` : 'Funding unavailable'}</span>
        <span>{available ? `${pct}%` : '—'}</span>
      </span>
      <span className="progress" role="progressbar" aria-label={`${part.name} funding`} aria-valuemin={0} aria-valuemax={100} aria-valuenow={available ? pct : undefined} aria-valuetext={available ? `${formatCents(raised, currency)} of ${formatCents(part.estimateCents, currency)}` : 'Unavailable'}>
        <span className="progress__fill" style={{ width: `${pct}%` }} />
      </span>
    </span>
  );
}
