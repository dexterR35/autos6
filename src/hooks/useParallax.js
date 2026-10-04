import { useEffect } from 'react';

/**
 * Subtle "camera drift" toward the pointer. Writes the transform straight to the DOM in a
 * requestAnimationFrame loop (no React re-renders) and eases toward the target, so it
 * never jitters. Off for touch / coarse pointers and for prefers-reduced-motion.
 *
 * The scene element contains BOTH the photo and the hotspot layer, so dots stay locked to
 * the bodywork while everything drifts together.
 */
export function useParallax(stageRef, sceneRef, { maxX = 9, maxY = 5, scale = 1.014, enabled = true } = {}) {
  useEffect(() => {
    const stage = stageRef.current;
    const scene = sceneRef.current;
    if (!stage || !scene || !enabled || typeof window.matchMedia !== 'function') return undefined;
    const fine = window.matchMedia('(hover: hover) and (pointer: fine)');
    const reduce = window.matchMedia('(prefers-reduced-motion: reduce)');
    if (!fine.matches || reduce.matches) return undefined;

    let tx = 0;
    let ty = 0;
    let x = 0;
    let y = 0;
    let raf = 0;
    const apply = () => {
      scene.style.transform = `translate3d(${x.toFixed(2)}px, ${y.toFixed(2)}px, 0) scale(${scale})`;
    };
    const tick = () => {
      x += (tx - x) * 0.07;
      y += (ty - y) * 0.07;
      apply();
      raf = Math.abs(tx - x) > 0.05 || Math.abs(ty - y) > 0.05 ? requestAnimationFrame(tick) : 0;
    };
    const kick = () => {
      if (!raf) raf = requestAnimationFrame(tick);
    };
    const onMove = (e) => {
      const r = stage.getBoundingClientRect();
      const nx = ((e.clientX - r.left) / r.width) * 2 - 1;
      const ny = ((e.clientY - r.top) / r.height) * 2 - 1;
      // move slightly *against* the pointer, like looking around the car
      tx = -Math.max(-1, Math.min(1, nx)) * maxX;
      ty = -Math.max(-1, Math.min(1, ny)) * maxY;
      kick();
    };
    const onLeave = () => {
      tx = 0;
      ty = 0;
      kick();
    };
    apply();
    stage.addEventListener('pointermove', onMove, { passive: true });
    stage.addEventListener('pointerleave', onLeave);
    return () => {
      cancelAnimationFrame(raf);
      stage.removeEventListener('pointermove', onMove);
      stage.removeEventListener('pointerleave', onLeave);
      scene.style.transform = '';
    };
  }, [stageRef, sceneRef, maxX, maxY, scale, enabled]);
}
