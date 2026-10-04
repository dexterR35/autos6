// Image → stage projection shared by the <img>, hotspot dots and leader lines.
// Using one function for all three is what keeps anchors on the right bodywork when
// object-fit letterboxes or crops the image.

/**
 * Where an image of size (imageW × imageH) is drawn inside a stage (stageW × stageH)
 * for a given object-fit and object-position (0..1 on each axis, 0.5 = centred).
 * @returns {{x:number,y:number,width:number,height:number,scale:number}}
 */
export function computeImageRect({ stageW, stageH, imageW, imageH, fit = 'contain', positionX = 0.5, positionY = 0.5 }) {
  if (!(stageW > 0 && stageH > 0 && imageW > 0 && imageH > 0)) {
    return { x: 0, y: 0, width: 0, height: 0, scale: 0 };
  }
  const sx = stageW / imageW;
  const sy = stageH / imageH;
  const scale = fit === 'cover' ? Math.max(sx, sy) : Math.min(sx, sy);
  const width = imageW * scale;
  const height = imageH * scale;
  return {
    x: (stageW - width) * positionX,
    y: (stageH - height) * positionY,
    width,
    height,
    scale,
  };
}

/**
 * "Focus" fit for small screens: zoom so the car's bounding box (normalized `focus`
 * {x0,y0,x1,y1}) fills the stage, never zooming out past cover, then centre the box and
 * clamp so the photo still covers the stage. Anchors use the same rect, so they stay put.
 */
export function computeFocusRect({ stageW, stageH, imageW, imageH, focus }) {
  if (!focus) return computeImageRect({ stageW, stageH, imageW, imageH, fit: 'cover' });
  if (!(stageW > 0 && stageH > 0 && imageW > 0 && imageH > 0)) return { x: 0, y: 0, width: 0, height: 0, scale: 0 };
  const coverScale = Math.max(stageW / imageW, stageH / imageH);
  const fw = (focus.x1 - focus.x0) * imageW;
  const fh = (focus.y1 - focus.y0) * imageH;
  const scale = Math.max(coverScale, Math.min(stageW / fw, stageH / fh));
  const width = imageW * scale;
  const height = imageH * scale;
  const cx = ((focus.x0 + focus.x1) / 2) * width;
  const cy = ((focus.y0 + focus.y1) / 2) * height;
  const x = Math.min(0, Math.max(stageW - width, stageW / 2 - cx));
  const y = Math.min(0, Math.max(stageH - height, stageH / 2 - cy));
  return { x, y, width, height, scale };
}

/** Normalized source-image point (0..1) → stage pixels. */
export function projectPoint(rect, nx, ny) {
  return { x: rect.x + nx * rect.width, y: rect.y + ny * rect.height };
}

/** Stage pixels → normalized source-image point (used by calibration mode). */
export function unprojectPoint(rect, px, py) {
  if (!rect.width || !rect.height) return null;
  return { x: (px - rect.x) / rect.width, y: (py - rect.y) / rect.height };
}

/**
 * Choose fit for the stage: crop only when the stage is wider than the image (the
 * crop then removes ceiling/floor, never the car's ends); otherwise letterbox so the
 * whole car stays reachable.
 */
export function chooseFit(stageW, stageH, imageW, imageH) {
  if (!stageW || !stageH) return 'contain';
  return stageW / stageH >= imageW / imageH ? 'cover' : 'contain';
}

export function rectContains(r, p, pad = 0) {
  return p.x >= r.x - pad && p.x <= r.x + r.width + pad && p.y >= r.y - pad && p.y <= r.y + r.height + pad;
}

export function rectsOverlap(a, b, gap = 0) {
  return a.x < b.x + b.width + gap && a.x + a.width + gap > b.x && a.y < b.y + b.height + gap && a.y + a.height + gap > b.y;
}

/** Visible part of the drawn image inside the stage. */
export function visibleImageRect(rect, stageW, stageH) {
  const x = Math.max(0, rect.x);
  const y = Math.max(0, rect.y);
  return { x, y, width: Math.min(stageW, rect.x + rect.width) - x, height: Math.min(stageH, rect.y + rect.height) - y };
}

/**
 * An anchor is shown only when it lies inside the visible image and not under a
 * reserved UI area (header, bottom panels, drawers). Anchors are never clamped.
 */
export function isAnchorVisible(point, { rect, stageW, stageH, reserved = [], margin = 6 }) {
  const visible = visibleImageRect(rect, stageW, stageH);
  if (!rectContains({ x: visible.x + margin, y: visible.y + margin, width: visible.width - margin * 2, height: visible.height - margin * 2 }, point)) {
    return false;
  }
  return !reserved.some((r) => rectContains(r, point, 4));
}
