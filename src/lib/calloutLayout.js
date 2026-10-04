// Places floating part cards next to their anchors without covering UI panels, other
// cards or other anchors. Cards move; anchors never do. Cards that cannot be placed are
// dropped (lowest priority first) instead of being squeezed over the car.
import { rectContains, rectsOverlap } from './projection.js';

const REFERENCE_STAGE_WIDTH = 1590; // main area width of the 1983px reference dashboard

export function calloutScale(stageW) {
  return Math.max(0.6, Math.min(1.15, stageW / REFERENCE_STAGE_WIDTH));
}

/** How many cards to float by default for a given stage width. */
export function maxCalloutsFor(stageW) {
  if (stageW >= 1280) return 6;
  if (stageW >= 1050) return 4;
  if (stageW >= 800) return 2;
  return 0;
}

function cardRectFor(anchor, side, dx, dy, s, card) {
  const x = side === 'right' ? anchor.x + dx * s : anchor.x - dx * s - card.width;
  return { x, y: anchor.y + dy * s - card.height / 2, width: card.width, height: card.height };
}

function distanceToRect(p, r) {
  const dx = Math.max(r.x - p.x, 0, p.x - (r.x + r.width));
  const dy = Math.max(r.y - p.y, 0, p.y - (r.y + r.height));
  return Math.hypot(dx, dy);
}

function clampToBounds(r, bounds) {
  return {
    ...r,
    x: Math.min(Math.max(r.x, bounds.x), bounds.x + bounds.width - r.width),
    y: Math.min(Math.max(r.y, bounds.y), bounds.y + bounds.height - r.height),
  };
}

/**
 * Leader path from the anchor to the nearest card edge: a short diagonal "elbow" then a
 * straight run, like the reference dashboard.
 */
export function leaderPath(anchor, card) {
  const ringR = 11;
  const cx0 = card.x;
  const cx1 = card.x + card.width;
  const cy0 = card.y;
  const cy1 = card.y + card.height;

  // Card directly above/below the anchor → vertical leader to its top/bottom edge.
  if (anchor.x >= cx0 + 12 && anchor.x <= cx1 - 12) {
    const toY = anchor.y < cy0 ? cy0 : cy1;
    const dir = Math.sign(toY - anchor.y) || 1;
    return { d: `M${anchor.x},${anchor.y + dir * ringR} L${anchor.x},${toY}`, end: { x: anchor.x, y: toY } };
  }
  const right = cx0 >= anchor.x;
  const endX = right ? cx0 : cx1;
  const endY = Math.min(Math.max(anchor.y, cy0 + 16), cy1 - 16);
  const dy = endY - anchor.y;
  const runX = Math.abs(endX - anchor.x);
  const kink = Math.min(Math.abs(dy), runX * 0.6);
  const sx = right ? 1 : -1;
  const sy = Math.sign(dy);
  // start on the ring edge, pointing along the first segment
  const len = Math.hypot(kink, dy) || 1;
  const startX = anchor.x + (dy ? (sx * kink) / len : sx) * ringR;
  const startY = anchor.y + (dy ? dy / len : 0) * ringR;
  const elbowX = anchor.x + sx * kink;
  const d = dy
    ? `M${startX},${startY} L${elbowX},${anchor.y + sy * Math.abs(dy)} L${endX},${endY}`
    : `M${startX},${startY} L${endX},${endY}`;
  return { d, end: { x: endX, y: endY } };
}

/**
 * Layout is deliberately STABLE: featured cards are placed in a fixed priority order and
 * never reshuffled. Only the selected part (a click, never a hover) can add a card; if
 * there's no room, the lowest-priority cards make way. Hover must not feed into this
 * function, or a card can jump out from under the cursor and flicker.
 *
 * @param {object} p
 * @param {Array<{id,partId,point:{x,y},featured:boolean,callout:{side,dx,dy}}>} p.anchors visible anchors, in priority order
 * @param {{x,y,width,height}} p.bounds area cards may occupy
 * @param {Array<{x,y,width,height}>} p.reserved UI areas cards must avoid
 * @param {{width:number,height:number}} p.card card size in px
 * @param {number} p.scale offset scale
 * @param {number} p.maxCards featured cards to show
 * @param {string|null} p.activePartId SELECTED part; gets a card even if not featured
 * @param {number} [p.maxLeader] longest allowed leader in px; cards further away are dropped
 * @returns {Array<{anchorId, partId, rect, leader}>}
 */
export function layoutCallouts({ anchors, bounds, reserved = [], card, scale = 1, maxCards = 6, activePartId = null, maxLeader = 380 * scale }) {
  const gap = 8;

  const tryPlace = (a, placed) => {
    const { side = 'right', dx = 30, dy = 0 } = a.callout ?? {};
    const flip = side === 'right' ? 'left' : 'right';
    const step = card.height + gap;
    for (const sd of [side, flip]) {
      for (const k of [0, -1, 1, -2, 2, -3, 3]) {
        const r = clampToBounds(cardRectFor(a.point, sd, dx, dy + (k * step) / scale, scale, card), bounds);
        if (r.width > bounds.width || r.height > bounds.height) return null;
        if (rectContains(r, a.point, 14)) continue;
        if (distanceToRect(a.point, r) > maxLeader) continue;
        if (reserved.some((u) => rectsOverlap(r, u, 6))) continue;
        if (placed.some((p) => rectsOverlap(r, p.rect, gap))) continue;
        if (anchors.some((o) => o.id !== a.id && rectContains(r, o.point, 14))) continue;
        return r;
      }
    }
    return null;
  };
  const entry = (a, rect) => ({ anchorId: a.id, partId: a.partId, rect, leader: leaderPath(a.point, rect) });

  let placed = [];
  for (const a of anchors.filter((x) => x.featured).slice(0, maxCards)) {
    const r = tryPlace(a, placed);
    if (r) placed.push(entry(a, r));
  }

  const active = activePartId ? anchors.find((a) => a.partId === activePartId) : null;
  if (active && !placed.some((p) => p.anchorId === active.id)) {
    const budget = Math.max(1, maxCards);
    let base = placed.length >= budget ? placed.slice(0, budget - 1) : placed;
    for (;;) {
      const r = tryPlace(active, base);
      if (r) {
        placed = [...base, entry(active, r)];
        break;
      }
      if (!base.length) break;
      base = base.slice(0, -1);
    }
  }
  return placed;
}
