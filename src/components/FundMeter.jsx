import { displayedRaised, formatCents, percentOf } from '../lib/money.js';

/** "$raised of $goal" with the garage's glowing bar. Shared by the studio pages. */
export default function FundMeter({ label, raisedCents, goalCents, currency = 'usd', size = 'md' }) {
  const available = Number.isFinite(raisedCents);
  const raised = available ? displayedRaised(raisedCents, goalCents) : 0;
  const pct = available ? percentOf(raised, goalCents) : 0;
  return (
    <div className={`fund-meter fund-meter--${size}`}>
      <div className="fund-meter__nums">
        <span>
          <strong>{available ? formatCents(raised, currency) : '—'}</strong>
          <span className="fund-meter__goal"> of {formatCents(goalCents, currency)}</span>
        </span>
        {available && <span className="fund-meter__pct">{pct}%</span>}
      </div>
      <span
        className="progress"
        role="progressbar"
        aria-label={`${label} funding`}
        aria-valuemin={0}
        aria-valuemax={100}
        aria-valuenow={available ? pct : undefined}
        aria-valuetext={available ? `${formatCents(raised, currency)} of ${formatCents(goalCents, currency)}` : 'Unavailable'}
      >
        <span className="progress__fill" style={{ width: `${pct}%` }} />
      </span>
    </div>
  );
}
