import { CalendarDays, CircleCheck, Wrench } from 'lucide-react';
import DemoBadge from '../components/DemoBadge.jsx';
import { formatCents } from '../lib/money.js';
import { demoMilestones } from '../data/demoProject.js';
import { useProjectData } from '../hooks/useProjectData.jsx';
import SubscribeButton from '../components/SubscribeButton.jsx';
import { safeMediaUrl } from '../lib/safeMedia.js';
import { Link } from 'react-router-dom';
import { isAcquired, isOpen } from '../lib/parts.js';

export default function Progress() {
  const { parts, updates, project, summary, isDemo, status, partsById } = useProjectData();
  const currency = project.currency ?? 'usd';
  const bought = parts.filter(isAcquired);
  const funded = parts.filter((p) => !isOpen(p) && !isAcquired(p));
  const remaining = parts.filter(isOpen);
  const sum = (list) => list.reduce((s, p) => s + p.estimateCents, 0);

  return (
    <div className="page">
      <header className="page-head">
        <div>
          <p className="kicker">Restoration log</p>
          <h1>Progress {isDemo && <DemoBadge>Demo fixtures</DemoBadge>}</h1>
        </div>
      </header>
      <SubscribeButton className="btn btn--ghost subscribe-inline" />
      <Link to="/spending" className="btn btn--ghost subscribe-inline">Where the money went</Link>

      <div className="stat-row">
        <div className="panel stat"><span className="stat__label">Parts bought</span><span className="stat__value">{bought.length} / {parts.length}</span></div>
        <div className="panel stat"><span className="stat__label">Funded, buying next</span><span className="stat__value">{funded.length}</span></div>
        <div className="panel stat"><span className="stat__label">Bought (estimate)</span><span className="stat__value">{formatCents(sum(bought), currency)}</span></div>
        <div className="panel stat"><span className="stat__label">Still needed (estimate)</span><span className="stat__value">{formatCents(sum(remaining), currency)}</span></div>
      </div>

      {isDemo && summary && (
        <section className="panel" aria-labelledby="milestones-title">
          <h2 id="milestones-title">Milestones <DemoBadge /></h2>
          <ol className="milestones">
            {demoMilestones.map((m) => {
              const reached = summary.raisedCents >= m.targetCents;
              return (
                <li key={m.id} className={reached ? 'is-reached' : ''}>
                  {reached ? <CircleCheck aria-hidden="true" /> : <Wrench aria-hidden="true" />}
                  <span>{m.label}</span>
                  <span className="muted">{formatCents(m.targetCents, currency)}</span>
                  <span className="visually-hidden">{reached ? 'funded' : 'not yet funded'}</span>
                </li>
              );
            })}
          </ol>
        </section>
      )}

      <section aria-labelledby="updates-title">
        <h2 id="updates-title" className="section-title">Updates</h2>
        {status === 'loading' && <p className="muted">Loading updates…</p>}
        {status === 'ready' && updates.length === 0 && (
          <div className="panel empty"><p>No restoration updates yet. The owner posts photos and costs here as work happens.</p></div>
        )}
        <ol className="timeline">
          {updates.map((u) => (
            <li key={u.id} className="panel timeline__item">
              <time dateTime={u.publishedAt}><CalendarDays aria-hidden="true" /> {new Date(u.publishedAt).toLocaleDateString(undefined, { dateStyle: 'medium' })}</time>
              <h3>{u.title}</h3>
              {u.partId && partsById?.[u.partId] && <p className="timeline__part"><Link to={`/parts/${u.partId}`}>{partsById[u.partId].name}</Link></p>}
              <p>{u.body}</p>
              {u.costCents != null && <p className="muted">Cost: {formatCents(u.costCents, currency)}</p>}
              {u.imageUrls?.length > 0 && (
                <div className="timeline__photos">
                  {u.imageUrls.filter(safeMediaUrl).map((src) => (
                    <img key={src} src={src} alt={`Photo for update: ${u.title}`} loading="lazy" />
                  ))}
                </div>
              )}
            </li>
          ))}
        </ol>
      </section>
    </div>
  );
}
