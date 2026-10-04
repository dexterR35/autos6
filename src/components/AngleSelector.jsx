import { forwardRef } from 'react';
import { availableViews } from '../data/views.js';
import { preloadImage } from '../lib/imagePreload.js';

/** Camera strip. Only views with a real photo are rendered as buttons. */
const AngleSelector = forwardRef(function AngleSelector({ viewId, onChange, selectedPartId }, ref) {
  const onKeyDown = (e) => {
    if (e.key !== 'ArrowRight' && e.key !== 'ArrowLeft') return;
    const i = availableViews.findIndex((v) => v.id === viewId);
    const next = availableViews[(i + (e.key === 'ArrowRight' ? 1 : -1) + availableViews.length) % availableViews.length];
    onChange(next.id);
    e.currentTarget.querySelector(`[data-angle="${next.id}"]`)?.focus();
    e.preventDefault();
  };
  return (
    <section ref={ref} className="panel angle-panel" aria-labelledby="angle-title">
      <h2 id="angle-title" className="panel-kicker">View angle</h2>
      <div className="angle-strip" role="group" aria-label="Camera angles" onKeyDown={onKeyDown}>
        {availableViews.map((v) => {
          const hasSelected = selectedPartId && v.hotspots.some((h) => h.partId === selectedPartId);
          return (
            <button
              key={v.id}
              type="button"
              data-angle={v.id}
              className={`angle ${v.id === viewId ? 'is-active' : ''}`}
              aria-pressed={v.id === viewId}
              onClick={() => onChange(v.id)}
              onPointerEnter={() => preloadImage(v.src).catch(() => {})}
              onFocus={() => preloadImage(v.src).catch(() => {})}
            >
              <span className="angle__thumb">
                <img src={v.thumb} alt="" loading="lazy" decoding="async" draggable="false" />
                {hasSelected && <span className="angle__marker" aria-hidden="true" />}
              </span>
              <span className="angle__label">{v.label}</span>
              {hasSelected && <span className="visually-hidden"> (shows selected part)</span>}
            </button>
          );
        })}
      </div>
    </section>
  );
});

export default AngleSelector;
