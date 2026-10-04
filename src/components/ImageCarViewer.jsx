import { lazy, Suspense, useEffect, useRef, useState } from 'react';
import { ImageOff } from 'lucide-react';
import HotspotLayer from './HotspotLayer.jsx';
import { availableViews, getView } from '../data/views.js';
import { useImageProjection } from '../hooks/useImageProjection.js';
import { unprojectPoint } from '../lib/projection.js';
import { isPreloaded, markPreloaded, preloadImage } from '../lib/imagePreload.js';
import { useParallax } from '../hooks/useParallax.js';

// Dev-only tool: statically removed from production builds.
const CalibrationPanel = import.meta.env.DEV ? lazy(() => import('./CalibrationPanel.jsx')) : null;

const SWAP_MS = 560; // keep the outgoing photo while the incoming one settles

/**
 * 2D renderer for the CarViewer contract: one photo per camera view with hotspots
 * anchored in source-image coordinates. A future Three.js renderer implements the same
 * props (viewId, selectedPartId, onPartSelect...) with its own 3D anchor metadata.
 */
export default function ImageCarViewer({
  viewId, partsById, visiblePartIds, selectedPartId, hoveredPartId, onPartSelect, onPartHover,
  reservedRefs, overlayRefs, compact, currency, calibrate = false, onViewError,
}) {
  const stageRef = useRef(null);
  const [shownId, setShownId] = useState(viewId);
  const [prevId, setPrevId] = useState(null);
  const [loaded, setLoaded] = useState(() => isPreloaded(getView(viewId)?.src));
  const [direction, setDirection] = useState(1);
  const sceneRef = useRef(null);
  const [failed, setFailed] = useState(false);
  const [calib, setCalib] = useState({ target: null, overrides: {}, last: null });

  const view = getView(shownId);
  const prevView = prevId ? getView(prevId) : null;
  const { rect, stageW, stageH, fit } = useImageProjection(stageRef, view, { fit: compact ? 'focus' : undefined });
  useParallax(stageRef, sceneRef, { enabled: !compact && !calibrate });

  // Camera switch: preload, then swap image and hotspot map together, fading the old photo out.
  useEffect(() => {
    if (viewId === shownId) return undefined;
    const next = getView(viewId);
    if (!next) return undefined;
    let cancelled = false;
    let timer;
    preloadImage(next.src)
      .then(() => {
        if (cancelled) return;
        const from = availableViews.findIndex((v) => v.id === shownId);
        const to = availableViews.findIndex((v) => v.id === viewId);
        setDirection(to >= from ? 1 : -1);
        setPrevId(shownId);
        setShownId(viewId);
        setLoaded(true);
        setFailed(false);
        timer = setTimeout(() => setPrevId(null), SWAP_MS);
      })
      .catch(() => {
        if (cancelled) return;
        onViewError?.(viewId); // keep showing the current view rather than a broken image
      });
    return () => {
      cancelled = true;
      clearTimeout(timer);
    };
  }, [viewId, shownId, onViewError]);

  // Warm the neighbouring angles once the current one is on screen.
  useEffect(() => {
    if (!loaded) return;
    const i = availableViews.findIndex((v) => v.id === shownId);
    const neighbours = [availableViews[i + 1], availableViews[i - 1]].filter(Boolean);
    const t = setTimeout(() => neighbours.forEach((v) => preloadImage(v.src).catch(() => {})), 400);
    return () => clearTimeout(t);
  }, [shownId, loaded]);

  const imgStyle = { left: rect.x, top: rect.y, width: rect.width, height: rect.height };

  const onStageClick = (e) => {
    if (!calibrate) return;
    if (e.target.closest('.hotspot, .callout, .calibration')) return;
    const s = stageRef.current.getBoundingClientRect();
    const p = unprojectPoint(rect, e.clientX - s.left, e.clientY - s.top);
    if (!p || p.x < 0 || p.x > 1 || p.y < 0 || p.y > 1) return;
    const point = { x: Math.round(p.x * 1000) / 1000, y: Math.round(p.y * 1000) / 1000 };
    console.info(`[calibrate] ${shownId}${calib.target ? ` ${calib.target}` : ''}: x=${point.x}, y=${point.y}`);
    setCalib((c) => ({
      ...c,
      last: point,
      overrides: c.target
        ? { ...c.overrides, [shownId]: { ...(c.overrides[shownId] ?? {}), [c.target]: point } }
        : c.overrides,
    }));
  };

  return (
    <div
      ref={stageRef}
      className={`viewer viewer--${fit} ${calibrate ? 'is-calibrating' : ''}`}
      style={{ '--dir': direction }}
      onClick={onStageClick}
      data-view-id={shownId}
    >
      {/* Blurred fill: visible in letterboxing and as a safety margin under the parallax drift. */}
      {view && <img className="viewer__backdrop" src={view.thumb} alt="" aria-hidden="true" />}

      {/* Photo + hotspots share one transformed layer, so dots stay locked to the bodywork. */}
      <div ref={sceneRef} className="viewer__scene">
        {prevView && prevView.id !== shownId && (
          <img key={`prev-${prevView.id}`} className="viewer__img is-leaving" src={prevView.src} alt="" aria-hidden="true" style={imgStyle} />
        )}
        {view && (
          <img
            key={`img-${view.id}`}
            className={`viewer__img ${prevView ? 'is-entering' : ''} ${loaded ? '' : 'is-loading'}`}
            src={view.src}
            alt={view.alt}
            style={imgStyle}
            fetchPriority="high"
            decoding="async"
            draggable="false"
            onLoad={() => {
              markPreloaded(view.src);
              setLoaded(true);
              setFailed(false);
            }}
            onError={() => setFailed(true)}
          />
        )}
        <div className="viewer__vignette" aria-hidden="true" />

        {loaded && !failed && (
          <HotspotLayer
            key={`layer-${shownId}`}
            view={view}
            rect={rect}
            stageW={stageW}
            stageH={stageH}
            stageRef={stageRef}
            reservedRefs={reservedRefs}
            overlayRefs={overlayRefs}
            partsById={partsById}
            visiblePartIds={visiblePartIds}
            selectedPartId={selectedPartId}
            hoveredPartId={hoveredPartId}
            onSelect={(id) => onPartSelect(id, { source: 'hotspot' })}
            onHover={onPartHover}
            compact={compact}
            currency={currency}
            overrides={calibrate ? calib.overrides[shownId] : undefined}
          />
        )}
      </div>

      {!loaded && !failed && <div className="viewer__skeleton" aria-hidden="true" />}
      {failed && (
        <div className="viewer__error" role="status">
          <ImageOff aria-hidden="true" /> This camera image could not be loaded.
        </div>
      )}

      {calibrate && CalibrationPanel && (
        <Suspense fallback={null}>
          <CalibrationPanel view={view} partsById={partsById} state={calib} setState={setCalib} />
        </Suspense>
      )}
    </div>
  );
}
