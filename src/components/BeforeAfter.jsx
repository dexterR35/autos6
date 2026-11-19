import { useId, useState } from 'react';
import { safeMediaUrl } from '../lib/safeMedia.js';

/** Drag (or use the arrow keys) to compare the old part with the new one. */
export default function BeforeAfter({ before, after, name }) {
  const [pos, setPos] = useState(50);
  const id = useId();
  const b = safeMediaUrl(before);
  const a = safeMediaUrl(after);
  if (!b || !a) return null;
  return (
    <figure className="before-after">
      <div className="before-after__frame" style={{ '--pos': `${pos}%` }}>
        <img src={a} alt={`${name} after`} loading="lazy" />
        <img src={b} alt={`${name} before`} className="before-after__before" loading="lazy" />
        <span className="before-after__divider" aria-hidden="true" />
        <span className="before-after__tag before-after__tag--before" aria-hidden="true">Before</span>
        <span className="before-after__tag before-after__tag--after" aria-hidden="true">After</span>
        <input id={id} type="range" min="0" max="100" step="1" value={pos} onChange={(e) => setPos(Number(e.target.value))}
          className="before-after__range" aria-label={`Compare ${name} before and after`} aria-valuetext={`${pos}% before`} />
      </div>
      <figcaption className="fine">Before and after · drag to compare</figcaption>
    </figure>
  );
}
