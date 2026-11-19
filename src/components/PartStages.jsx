import { Check } from 'lucide-react';
import { STAGES, stageRank } from '../lib/parts.js';

const fmt = (iso) => (iso ? new Date(iso).toLocaleDateString(undefined, { dateStyle: 'medium' }) : null);

/** Funding → Funded → Ordered → Bought → Installed, with the date each step happened. */
export default function PartStages({ part, compact = false }) {
  const rank = stageRank(part.status);
  return (
    <ol className={`part-stages ${compact ? 'part-stages--compact' : ''}`} aria-label={`${part.name} progress`}>
      {STAGES.map((s, i) => {
        // Every reached step is done; "Funding" is still in progress while the part is open.
        const done = i < rank || (i === rank && rank > 0);
        const current = i === rank;
        const date = s.at ? fmt(part[s.at]) : null;
        return (
          <li key={s.id} className={`part-stages__step ${done ? 'is-done' : ''} ${current ? 'is-current' : ''}`} aria-current={current ? 'step' : undefined}>
            <span className="part-stages__dot" aria-hidden="true">{done ? <Check /> : null}</span>
            <span className="part-stages__label">{s.label}</span>
            {!compact && date && <time className="part-stages__date" dateTime={part[s.at]}>{date}</time>}
            <span className="visually-hidden">{done ? ' (done)' : current ? ' (current)' : ' (to do)'}</span>
          </li>
        );
      })}
    </ol>
  );
}
