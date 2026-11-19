import { Link } from 'react-router-dom';
import { Receipt, Scale } from 'lucide-react';
import DemoBadge from '../components/DemoBadge.jsx';
import StatusChip from '../components/StatusChip.jsx';
import { formatCents } from '../lib/money.js';
import { isAcquired, isOpen } from '../lib/parts.js';
import { spendingReport } from '../lib/spending.js';
import { safeMediaUrl } from '../lib/safeMedia.js';
import { useProjectData } from '../hooks/useProjectData.jsx';

const date = (iso) => (iso ? new Date(iso).toLocaleDateString(undefined, { dateStyle: 'medium' }) : '—');

/** "Where the money went": raised vs. spent per part, with receipts, from public data only. */
export default function Spending() {
  const { parts, project, summary, isDemo, status } = useProjectData();
  const currency = project.currency ?? 'usd';
  const fmt = (c) => formatCents(c, currency);
  const { rows, totals } = spendingReport(parts, summary?.raisedCents ?? 0);
  const bought = rows.filter(isAcquired).sort((a, b) => Date.parse(b.boughtAt ?? b.installedAt ?? 0) - Date.parse(a.boughtAt ?? a.installedAt ?? 0));
  const waiting = rows.filter((p) => !isOpen(p) && !isAcquired(p));
  const open = rows.filter(isOpen);

  return (
    <div className="page spending-page">
      <header className="page-head">
        <div>
          <p className="kicker">Transparency</p>
          <h1>Where the money went {isDemo && <DemoBadge>Demo fixtures</DemoBadge>}</h1>
          <p className="muted">Every contribution, what each part cost, and what is left. Figures update live from the payment ledger.</p>
        </div>
      </header>

      {status !== 'ready' ? <p className="muted">Loading…</p> : (
        <>
          <div className="stat-row">
            <div className="panel stat"><span className="stat__label">Raised (after refunds)</span><span className="stat__value">{fmt(totals.raised)}</span></div>
            <div className="panel stat"><span className="stat__label">Spent on parts</span><span className="stat__value">{fmt(totals.spent)}</span></div>
            <div className="panel stat"><span className="stat__label">Not yet spent</span><span className="stat__value">{fmt(totals.unspent)}</span></div>
            {summary?.monthly?.activeCount > 0 && (
              <div className="panel stat"><span className="stat__label">Monthly supporters</span><span className="stat__value">{summary.monthly.activeCount}<small> · {fmt(summary.monthly.monthlyCents)}/mo</small></span></div>
            )}
          </div>

          <section className="panel spending-split" aria-labelledby="split-title">
            <h2 id="split-title"><Scale aria-hidden="true" /> How it is split</h2>
            <dl>
              <div><dt>Given to specific parts</dt><dd>{fmt(totals.designated)}</dd></div>
              <div><dt>General fund (no part chosen)</dt><dd>{fmt(totals.general)}</dd></div>
              <div><dt>Extra beyond a part’s goal → general fund</dt><dd>{fmt(totals.overflow)}</dd></div>
              <div><dt>Left over when a part cost less than raised → general fund</dt><dd>{fmt(totals.saved)}</dd></div>
              {totals.topUps > 0 && <div><dt>Paid on top of what parts raised (general fund or owner)</dt><dd>{fmt(totals.topUps)}</dd></div>}
            </dl>
            <p className="fine">The general fund pays for fitting, labour, consumables and parts that cost more than their goal. A part stops taking contributions once its goal is reached.</p>
          </section>

          <section aria-labelledby="bought-title">
            <h2 id="bought-title" className="section-title">Bought</h2>
            {bought.length === 0 ? <p className="muted">Nothing bought yet.</p> : (
              <div className="table-wrap">
                <table className="spend-table">
                  <thead><tr><th scope="col">Part</th><th scope="col">Bought</th><th scope="col">Goal</th><th scope="col">Raised</th><th scope="col">Paid</th><th scope="col">Receipt</th></tr></thead>
                  <tbody>
                    {bought.map((p) => (
                      <tr key={p.id}>
                        <th scope="row"><Link to={`/parts/${p.id}`}>{p.name}</Link> <StatusChip status={p.status} size="sm" /></th>
                        <td>{date(p.boughtAt ?? p.installedAt)}</td>
                        <td>{fmt(p.estimateCents)}</td>
                        <td>{fmt(p.raised)}</td>
                        <td>{p.spent != null ? fmt(p.spent) : <span className="muted">not entered</span>}{p.saved > 0 && <small className="spend-note"> · {fmt(p.saved)} to general fund</small>}{p.topUp > 0 && <small className="spend-note"> · {fmt(p.topUp)} topped up</small>}</td>
                        <td>{safeMediaUrl(p.receiptUrl) ? <a href={safeMediaUrl(p.receiptUrl)} target="_blank" rel="noopener noreferrer"><Receipt aria-hidden="true" /> View</a> : <span className="muted">—</span>}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </section>

          {waiting.length > 0 && (
            <section aria-labelledby="waiting-title">
              <h2 id="waiting-title" className="section-title">Funded, being bought</h2>
              <ul className="spend-list">{waiting.map((p) => <li key={p.id}><Link to={`/parts/${p.id}`}>{p.name}</Link> · {fmt(p.raised)} raised of {fmt(p.estimateCents)}{p.overflow > 0 && <> · {fmt(p.overflow)} extra to general fund</>}</li>)}</ul>
            </section>
          )}

          <section aria-labelledby="open-title">
            <h2 id="open-title" className="section-title">Still raising</h2>
            <ul className="spend-list">{open.map((p) => <li key={p.id}><Link to={`/parts/${p.id}`}>{p.name}</Link> · {fmt(p.raised)} of {fmt(p.estimateCents)}</li>)}</ul>
          </section>
        </>
      )}
    </div>
  );
}
