import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { CircleCheck, Heart, Lock, Wrench } from 'lucide-react';
import DemoBadge from '../components/DemoBadge.jsx';
import FundMeter from '../components/FundMeter.jsx';
import { CAMPAIGN_GOAL_CENTS, formatCents } from '../lib/money.js';
import { fetchPublicContributions } from '../lib/liveData.js';
import { useGarageState } from '../hooks/useGarageState.jsx';
import { useProjectData } from '../hooks/useProjectData.jsx';

export default function Donations() {
  const { project, parts, summary, isDemo, status } = useProjectData();
  const { openDonation } = useGarageState();
  const [supporters, setSupporters] = useState({ state: isDemo ? 'demo' : 'loading', rows: [] });
  const currency = project.currency ?? 'usd';
  const openParts = parts.filter((p) => p.status !== 'bought');

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
    <div className="page studio">
      <header className="studio-head">
        <div>
          <h1>Donations {isDemo && <DemoBadge />}</h1>
          {summary?.donationCount > 0 && <p className="studio-head__stat">{summary.donationCount} contributions</p>}
        </div>
        <div className="studio-head__actions">
          <button type="button" className="btn btn--donate btn--lg" onClick={() => openDonation()}>
            <Heart aria-hidden="true" fill="currentColor" /> Donate now
          </button>
        </div>
      </header>

      <section className="panel studio-total" aria-label="Campaign funding">
        <span className="studio-total__label">{project.tagline || 'Campaign'}</span>
        {summary ? (
          <FundMeter label="Campaign" raisedCents={summary.raisedCents} goalCents={CAMPAIGN_GOAL_CENTS} currency={currency} size="lg" />
        ) : (
          <p className="studio-empty">Totals are unavailable right now.</p>
        )}
        {summary && summary.raisedCents >= CAMPAIGN_GOAL_CENTS && <p className="note note--ok">Goal reached. Support still helps future work.</p>}
      </section>

      {openParts.length > 0 && (
        <section className="panel" aria-labelledby="where-title">
          <h2 id="where-title" className="studio-h2">Where it goes <Link to="/parts">All parts →</Link></h2>
          <ul className="fund-list">
            {openParts.map((p) => (
              <li key={p.id}>
                <span className="fund-list__name">{p.name}</span>
                <FundMeter label={p.name} raisedCents={p.raisedCents} goalCents={p.estimateCents} currency={currency} />
              </li>
            ))}
          </ul>
        </section>
      )}

      <section className="panel" aria-labelledby="supporters-title">
        <h2 id="supporters-title" className="studio-h2">Supporters</h2>
        {supporters.state === 'demo' && <p className="studio-empty">Demo mode has no supporter records.</p>}
        {supporters.state === 'loading' && status === 'ready' && <p className="muted">Loading…</p>}
        {supporters.state === 'error' && <p className="studio-empty">Supporters are unavailable right now.</p>}
        {supporters.state === 'ready' && supporters.rows.length === 0 && <p className="studio-empty">No public supporters yet. Be the first!</p>}
        {supporters.rows.length > 0 && (
          <ul className="supporters">
            {supporters.rows.map((r, i) => (
              <li key={i}>
                <span className="supporters__name">{r.displayName || 'Anonymous'}</span>
                <span className="muted">{r.partName || 'General fund'}</span>
                <span className="supporters__amt">{formatCents(r.amountCents, currency)}</span>
                <time className="muted" dateTime={r.createdAt}>{new Date(r.createdAt).toLocaleDateString()}</time>
              </li>
            ))}
          </ul>
        )}
      </section>

      <ul className="studio-facts" aria-label="How it works">
        <li><Wrench aria-hidden="true" /> One fund for the whole restoration</li>
        <li><CircleCheck aria-hidden="true" /> Parts marked bought only after purchase</li>
        <li><Lock aria-hidden="true" /> Paid via Stripe · not tax-deductible</li>
      </ul>
    </div>
  );
}
