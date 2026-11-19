import { lazy, Suspense, useEffect, useMemo, useState } from 'react';
import { Box, ImageIcon } from 'lucide-react';
import PartThumb from './PartThumb.jsx';
import { safeMediaUrl } from '../lib/safeMedia.js';

const PartModelViewer = lazy(() => import('./PartModelViewer.jsx'));

/** Every displayable image for a part: its gallery first, then the card image. */
export function partImages(part) {
  const list = [...(part?.imageUrls ?? []), part?.thumbnailUrl].map(safeMediaUrl).filter(Boolean);
  return [...new Set(list)];
}

/** Photo gallery + optional 3D model for one part. Falls back to the standard thumbnail. */
export default function PartMedia({ part }) {
  const images = useMemo(() => partImages(part), [part]);
  const model = safeMediaUrl(part.modelUrl);
  const [mode, setMode] = useState('image');
  const [index, setIndex] = useState(0);
  useEffect(() => { setMode('image'); setIndex(0); }, [part.id]);

  if (!images.length && !model) return null;
  const current = images[Math.min(index, images.length - 1)];

  return (
    <div className="part-media">
      <div className="part-media__stage">
        {mode === '3d' && model ? (
          <Suspense fallback={<p className="part-model__msg">Loading 3D viewer…</p>}>
            <PartModelViewer src={model} name={part.name} />
          </Suspense>
        ) : current ? (
          <img src={current} alt={`${part.name}${images.length > 1 ? ` — photo ${index + 1} of ${images.length}` : ''}`} loading="lazy" decoding="async" />
        ) : (
          <span className="part-media__placeholder"><PartThumb part={part} size="lg" /></span>
        )}
      </div>
      {(images.length > 1 || model) && (
        <div className="part-media__strip" role="group" aria-label={`${part.name} media`}>
          {images.map((src, i) => (
            <button key={src} type="button" className={`part-media__pick ${mode === 'image' && i === index ? 'is-active' : ''}`} aria-pressed={mode === 'image' && i === index} aria-label={`Photo ${i + 1}`} onClick={() => { setMode('image'); setIndex(i); }}>
              <img src={src} alt="" loading="lazy" decoding="async" />
            </button>
          ))}
          {model && (
            <button type="button" className={`part-media__pick part-media__pick--3d ${mode === '3d' ? 'is-active' : ''}`} aria-pressed={mode === '3d'} onClick={() => setMode(mode === '3d' ? 'image' : '3d')}>
              {mode === '3d' ? <ImageIcon aria-hidden="true" /> : <Box aria-hidden="true" />}
              <span>{mode === '3d' ? 'Photos' : '3D'}</span>
            </button>
          )}
        </div>
      )}
    </div>
  );
}
