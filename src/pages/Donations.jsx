import { useEffect, useState } from 'react';
import { Heart, Users } from 'lucide-react';
import DemoBadge from '../components/DemoBadge.jsx';
import { FundingProgress } from '../components/FundingPanel.jsx';
import { formatCents } from '../lib/money.js';
import { fetchPublicContributions } from '../lib/liveData.js';
import { useGarageState } from '../hooks/useGarageState.jsx';
import { useProjectData } from '../hooks/useProjectData.jsx';

export default function Donations() {
  const { project, summary, isDemo, status } = useProjectData();
  const { openDonation } = useGarageState();
  const [supporters, setSupporters] = useState({ state: isDemo ? 'demo' : 'loading', rows: [] });
  const currency = project.currency ?? 'usd';

  useEffect(() => {
    if (isDemo || status !== 'ready') return;
    let cancelled = false;
    fetchPublicContributions(project.slug)
      .then((rows) => !cancelled && setSupporters({ state: 'ready', rows }))
      .catch(() => !cancelled && setSupporters({ state: 'error', rows: [] }));
    return () => {
      cancelled = true;
    };
  }, [isDemo, status, project.slug]);

  return (
    <div className="page">
      <header className="page-head">
        <div>
          <p className="kicker">Campaign</p>
          <h1>Donations</h1>
        </div>
        <button type="button" className="btn btn--donate" onClick={() => openDonation()}>
          <Heart aria-hidden="true" fill="currentColor" /> Donate now
        </button>
      </header>

      <section className="panel summary-card" aria-labelledby="summary-title">
        <h2 id="summary-title">
          {project.tagline || 'Campaign summary'} {isDemo && <DemoBadge />}
        </h2>
        {summary ? (
          <>
            <p className="summary-card__totals">
              <strong>{formatCents(summary.raisedCents, currency)}</strong> raised of {formatCents(summary.goalCents, currency)} goal
            </p>
            <FundingProgress raisedCents={summary.raisedCents} goalCents={summary.goalCents} currency={currency} />
            <p className="fine">
              {isDemo
                ? 'Sample figures for design review. Live totals count only Stripe-confirmed payments, minus refunds.'
                : `Confirmed contributions minus refunds${summary.donationCount ? ` · ${summary.donationCount} contributions` : ''}. Updated every minute.`}
            </p>
          </>
        ) : (
          <p className="muted">Campaign totals are unavailable right now.</p>
        )}
      </section>

      <section className="panel" aria-labelledby="supporters-title">
        <h2 id="supporters-title"><Users aria-hidden="true" /> Supporters</h2>
        <p className="fine">Only supporters who chose to be listed appear here — display name, amount and date. Emails and payment details are never shown.</p>
        {supporters.state === 'demo' && (
          <div className="empty">
            <p>Demo mode has no supporter records. Names appear here after real, confirmed contributions from people who opted in.</p>
          </div>
        )}
        {supporters.state === 'loading' && status === 'ready' && <p className="muted">Loading supporters…</p>}
        {supporters.state === 'error' && <p className="muted">Supporter list unavailable right now.</p>}
        {supporters.state === 'ready' && supporters.rows.length === 0 && (
          <div className="empty"><p>No public supporters yet. Be the first!</p></div>
        )}
        {supporters.rows.length > 0 && (
          <ul className="supporters">
            {supporters.rows.map((r, i) => (
              <li key={i}>
                <span className="supporters__name">{r.displayName || 'Anonymous'}</span>
                <span className="muted">{r.partName ? `→ ${r.partName}` : 'General fund'}</span>
                <span className="supporters__amt">{formatCents(r.amountCents, currency)}</span>
                <time className="muted" dateTime={r.createdAt}>{new Date(r.createdAt).toLocaleDateString()}</time>
              </li>
            ))}
          </ul>
        )}
      </section>

      <section className="panel prose" aria-labelledby="how-title">
        <h2 id="how-title">How contributions are used</h2>
        <ul>
          <li>Money goes into one restoration fund. Choosing a part tells the owner what you’d like it to go toward. It doesn’t buy you that part.</li>
          <li>The owner marks a part “Bought” after actually purchasing it. A donation never changes a part’s status by itself.</li>
          <li>Payments are processed by Stripe. This is a personal project, not a registered charity, so contributions aren’t tax-deductible.</li>
        </ul>
      </section>
    </div>
  );
}
