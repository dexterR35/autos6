import { Link } from 'react-router-dom';
import { useProjectData } from '../hooks/useProjectData.jsx';
import { formatCents } from '../lib/money.js';
import { ANALYTICS_ENABLED, openConsentSettings } from '../lib/analytics.js';

// Placeholder copy where facts are unknown — edit freely (or move to Supabase `projects.description`).
export default function About() {
  const { project, parts, isDemo } = useProjectData();
  const currency = project.currency ?? 'usd';
  const needed = parts.filter((p) => p.status === 'needed');
  return (
    <div className="page page--narrow prose">
      <p className="kicker">About</p>
      <h1>{project.title}</h1>
      <p className="lead">{project.vehicleDisplayName}</p>

      <h2>The project</h2>
      <p>{project.description || 'Project description coming soon.'}</p>
      <p className="placeholder">[Owner story placeholder: who you are, how you found the car, and why it matters to you.]</p>

      <h2>Restoration plan</h2>
      <p>Work is planned part by part. Current list of jobs still needed:</p>
      <ul>
        {needed.map((p) => (
          <li key={p.id}>
            <strong>{p.name}</strong>: {p.condition?.toLowerCase()} ({formatCents(p.estimateCents, currency)} estimate)
          </li>
        ))}
      </ul>
      <p className="placeholder">[Placeholder: order of work, who does it (DIY or shop), and expected timeline.]</p>

      <h2>How funding works</h2>
      <p>
        The campaign goal{project.goalCents ? ` of ${formatCents(project.goalCents, currency)}` : ''} is set separately from the
        individual part estimates. Contributions go to one restoration fund. Picking a part shows what you’d like your money to go toward.
        Payments run through Stripe Checkout, and totals count only confirmed payments, minus refunds.
        {isDemo && ' Figures currently shown on the site are demo samples.'}
      </p>
      <p>
        See the <Link to="/progress">progress log</Link> for updates, or the <Link to="/donations">donations page</Link> for the campaign summary.
      </p>
      {ANALYTICS_ENABLED && (
        <>
          <h2>Privacy</h2>
          <p>
            Analytics runs only if you allow it. Payment details are handled by Stripe and never reach this site.{' '}
            <button type="button" className="link-btn" onClick={openConsentSettings}>Cookie settings</button>
          </p>
        </>
      )}
      <h2>Garage imagery</h2>
      <p className="fine">Explore the 2003 Audi S6 C5 Avant and its garage in 3D: drag to orbit, zoom in, and select a part. The editable model is a visual reconstruction of the project car. Rendered images are available as a fallback.</p>
    </div>
  );
}
