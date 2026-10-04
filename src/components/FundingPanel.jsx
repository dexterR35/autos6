import { forwardRef } from 'react';
import { Heart } from 'lucide-react';
import DemoBadge from './DemoBadge.jsx';
import { DONATION_PRESETS_CENTS, formatCents, percentOf } from '../lib/money.js';
import { useProjectData } from '../hooks/useProjectData.jsx';
import { useGarageState } from '../hooks/useGarageState.jsx';

export function FundingProgress({ raisedCents, goalCents, currency, compact = false }) {
  const pct = percentOf(raisedCents, goalCents);
  return (
    <div className={`funding-progress ${compact ? 'is-compact' : ''}`}>
      <div
        className="progress"
        role="progressbar"
        aria-label="Campaign funding"
        aria-valuemin={0}
        aria-valuemax={100}
        aria-valuenow={pct}
        aria-valuetext={`${formatCents(raisedCents, currency)} of ${formatCents(goalCents, currency)} raised, ${pct}%`}
      >
        <span className="progress__fill" style={{ width: `${pct}%` }} />
      </div>
      <span className="funding-progress__pct">{pct}%</span>
    </div>
  );
}

const FundingPanel = forwardRef(function FundingPanel(_props, ref) {
  const { project, summary, isDemo, status } = useProjectData();
  const { draft, setDraft, openDonation } = useGarageState();
  const currency = project.currency ?? 'usd';
  const unavailable = !summary;

  return (
    <section ref={ref} className="panel funding-panel" aria-labelledby="funding-title">
      <div className="funding-panel__head">
        <h2 id="funding-title">
          {project.tagline || 'Support the restoration'}
          {isDemo && <DemoBadge />}
        </h2>
        <p className="funding-panel__totals" aria-live="polite">
          {unavailable ? (
            <span className="muted">{status === 'loading' ? 'Loading…' : 'Totals unavailable'}</span>
          ) : (
            <>
              <strong>{formatCents(summary.raisedCents, currency)}</strong> / {formatCents(summary.goalCents, currency)}
            </>
          )}
        </p>
      </div>
      {!unavailable && <FundingProgress raisedCents={summary.raisedCents} goalCents={summary.goalCents} currency={currency} />}
      <div className="funding-panel__actions">
        <div className="presets" role="group" aria-label="Contribution amount">
          {DONATION_PRESETS_CENTS.map((c) => (
            <button
              key={c}
              type="button"
              className={`preset ${draft.amountCents === c ? 'is-active' : ''}`}
              aria-pressed={draft.amountCents === c}
              onClick={() => setDraft({ amountCents: c })}
            >
              {formatCents(c, currency)}
            </button>
          ))}
        </div>
        <button type="button" className="btn btn--donate btn--lg" onClick={() => openDonation()}>
          <Heart aria-hidden="true" fill="currentColor" />
          Donate now
        </button>
      </div>
    </section>
  );
});

export default FundingPanel;
