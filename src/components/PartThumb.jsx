import { Armchair, Wrench } from 'lucide-react';
import { getPartThumbnail } from '../data/assetManifest.js';

function CoiloverIcon(props) {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true" {...props}>
      <path d="M12 2v3M12 19v3M9 5h6M9 19h6" />
      <path d="M8 7.5 16 9 8 10.5 16 12 8 13.5 16 15 8 16.5" />
    </svg>
  );
}

const ICONS = { seat: Armchair, coilover: CoiloverIcon, wrench: Wrench };

/** Dark framed thumbnail tile: a real crop when the part is visible, an outlined icon otherwise. */
export default function PartThumb({ part, size = 'md' }) {
  const thumb = getPartThumbnail(part);
  return (
    <span className={`part-thumb part-thumb--${size}`}>
      {thumb.type === 'icon' ? (
        (() => {
          const Icon = ICONS[thumb.icon] ?? Wrench;
          return <Icon className="part-thumb__icon" aria-hidden="true" />;
        })()
      ) : (
        <img src={thumb.src} alt="" loading="lazy" decoding="async" draggable="false" />
      )}
    </span>
  );
}
