import { CalendarDays, CircleCheck, Wrench } from 'lucide-react';
import DemoBadge from '../components/DemoBadge.jsx';
import { formatCents } from '../lib/money.js';
import { demoMilestones } from '../data/demoProject.js';
import { useProjectData } from '../hooks/useProjectData.jsx';

export default function Progress() {
  const { parts, updates, project, summary, isDemo, status } = useProjectData();
  const currency = project.currency ?? 'usd';
  const bought = parts.filter((p) => p.status === 'bought');
  const remaining = parts.filter((p) => p.status !== 'bought');
  const sum = (list) => list.reduce((s, p) => s + p.estimateCents, 0);

  return (
    <div className="page">
      <header className="page-head">
        <div>
          <p className="kicker">Restoration log</p>
          <h1>Progress {isDemo && <DemoBadge>Demo fixtures</DemoBadge>}</h1>
        </div>
      </header>

      <div className="stat-row">
        <div className="panel stat"><span className="stat__label">Parts bought</span><span className="stat__value">{bought.length} / {parts.length}</span></div>
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
              <p>{u.body}</p>
              {u.costCents != null && <p className="muted">Cost: {formatCents(u.costCents, currency)}</p>}
              {u.imageUrls?.length > 0 && (
                <div className="timeline__photos">
                  {u.imageUrls.map((src) => (
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
