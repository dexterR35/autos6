import { useLayoutEffect, useMemo, useState } from 'react';
import { chooseFit, computeFocusRect, computeImageRect } from '../lib/projection.js';

/** Observe an element's content size. */
export function useElementSize(ref) {
  const [size, setSize] = useState({ width: 0, height: 0 });
  useLayoutEffect(() => {
    const el = ref.current;
    if (!el) return undefined;
    const measure = () => {
      const r = el.getBoundingClientRect();
      setSize((s) => (s.width === r.width && s.height === r.height ? s : { width: r.width, height: r.height }));
    };
    measure();
    if (typeof ResizeObserver === 'undefined') {
      window.addEventListener('resize', measure);
      return () => window.removeEventListener('resize', measure);
    }
    const ro = new ResizeObserver(measure);
    ro.observe(el);
    return () => ro.disconnect();
  }, [ref]);
  return size;
}

/**
 * Projection for one view inside the stage. The returned rect is applied to the <img>
 * as explicit pixels, and hotspots use the same rect — so they can never drift apart.
 */
export function useImageProjection(stageRef, view, { fit: fitOverride } = {}) {
  const { width: stageW, height: stageH } = useElementSize(stageRef);
  return useMemo(() => {
    if (!view) return { stageW, stageH, fit: 'contain', rect: { x: 0, y: 0, width: 0, height: 0, scale: 0 } };
    const fit = fitOverride ?? chooseFit(stageW, stageH, view.width, view.height);
    if (fit === 'focus') {
      return { stageW, stageH, fit, rect: computeFocusRect({ stageW, stageH, imageW: view.width, imageH: view.height, focus: view.focus }) };
    }
    const rect = computeImageRect({
      stageW, stageH, imageW: view.width, imageH: view.height, fit,
      positionX: view.objectPosition?.x ?? 0.5,
      positionY: fit === 'cover' ? view.objectPosition?.y ?? 0.5 : 0.42,
    });
    return { stageW, stageH, fit, rect };
  }, [stageW, stageH, view, fitOverride]);
}
