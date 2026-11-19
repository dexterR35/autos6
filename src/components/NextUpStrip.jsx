import { HandHeart, Target } from 'lucide-react';
import { nextUpParts, remainingCents } from '../lib/parts.js';
import { formatCents } from '../lib/money.js';
import FundMeter from './FundMeter.jsx';
import PartThumb from './PartThumb.jsx';
import { partImages } from './PartMedia.jsx';

/** The (up to three) parts the owner wants funded first. */
export default function NextUpStrip({ parts, currency, onOpen, onFund }) {
  const next = nextUpParts(parts);
  if (!next.length) return null;
  return (
    <section className="next-up" aria-labelledby="next-up-title">
      <h2 id="next-up-title"><Target aria-hidden="true" /> Next up</h2>
      <p className="next-up__lead">These get bought first. Every contribution here goes straight toward them.</p>
      <ol className="next-up__list">
        {next.map((p, i) => {
          const cover = partImages(p)[0];
          const left = remainingCents(p);
          return (
            <li key={p.id} className="next-up__item panel">
              <span className="next-up__rank" aria-hidden="true">{i + 1}</span>
              <button type="button" className="next-up__open" onClick={() => onOpen(p.id)} aria-label={`${p.name} details`}>
                <span className="next-up__media">{cover ? <img src={cover} alt="" loading="lazy" /> : <PartThumb part={p} size="md" />}</span>
                <span className="next-up__name">{p.name}</span>
              </button>
              <FundMeter label={`${p.name} (next up)`} raisedCents={p.raisedCents} goalCents={p.estimateCents} currency={currency} />
              <div className="next-up__foot">
                <span>{left != null && left > 0 ? <><strong>{formatCents(left, currency)}</strong> to go</> : 'Goal reached'}</span>
                <button type="button" className="btn btn--donate btn--sm" aria-label={`Fund ${p.name} (next up)`} onClick={() => onFund(p.id)}><HandHeart aria-hidden="true" /> Fund</button>
              </div>
            </li>
          );
        })}
      </ol>
    </section>
  );
}
