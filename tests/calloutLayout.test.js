import { describe, expect, it } from 'vitest';
import { layoutCallouts, leaderPath, maxCalloutsFor } from '../src/lib/calloutLayout.js';
import { rectsOverlap } from '../src/lib/projection.js';

const card = { width: 200, height: 70 };
const bounds = { x: 10, y: 10, width: 1580, height: 770 };
const anchor = (id, x, y, side = 'right', featured = true) => ({ id, partId: id, point: { x, y }, featured, callout: { side, dx: 30, dy: 0 } });

describe('layoutCallouts', () => {
  it('never overlaps reserved panels or other cards', () => {
    const anchors = [anchor('a', 500, 300), anchor('b', 520, 320), anchor('c', 540, 340), anchor('d', 900, 600)];
    const reserved = [{ x: 0, y: 630, width: 1590, height: 160 }];
    const placed = layoutCallouts({ anchors, bounds, reserved, card, maxCards: 6 });
    for (const p of placed) {
      for (const r of reserved) expect(rectsOverlap(p.rect, r)).toBe(false);
      for (const q of placed) if (q !== p) expect(rectsOverlap(p.rect, q.rect)).toBe(false);
    }
  });

  it('places the active part first even when not featured', () => {
    const anchors = [anchor('a', 300, 300), anchor('b', 800, 300, 'right', false)];
    const placed = layoutCallouts({ anchors, bounds, card, maxCards: 1, activePartId: 'b' });
    expect(placed.map((p) => p.partId)).toEqual(['b']);
  });

  it('selecting a featured part never moves any card (no hover/click flicker)', () => {
    const anchors = [anchor('a', 300, 200), anchor('b', 700, 300), anchor('c', 1100, 400)];
    const base = layoutCallouts({ anchors, bounds, card, maxCards: 6 });
    for (const id of ['a', 'b', 'c']) {
      expect(layoutCallouts({ anchors, bounds, card, maxCards: 6, activePartId: id })).toEqual(base);
    }
  });

  it('a selected non-featured part only displaces the lowest-priority card', () => {
    const anchors = [anchor('a', 300, 200), anchor('b', 700, 300), anchor('x', 1100, 500, 'right', false)];
    const base = layoutCallouts({ anchors, bounds, card, maxCards: 2 });
    const sel = layoutCallouts({ anchors, bounds, card, maxCards: 2, activePartId: 'x' });
    expect(sel.map((p) => p.partId)).toEqual(['a', 'x']);
    expect(sel[0]).toEqual(base[0]); // the higher-priority card stays exactly where it was
  });

  it('respects the per-width card budget', () => {
    expect(maxCalloutsFor(1590)).toBe(6);
    expect(maxCalloutsFor(1100)).toBe(4);
    expect(maxCalloutsFor(600)).toBe(0);
  });

  it('drops cards that cannot be placed instead of covering the anchor', () => {
    const tiny = { x: 0, y: 0, width: 150, height: 80 };
    expect(layoutCallouts({ anchors: [anchor('a', 75, 40)], bounds: tiny, card, maxCards: 6 })).toHaveLength(0);
  });

  it('leader ends on the card edge', () => {
    const rect = { x: 400, y: 100, width: 200, height: 70 };
    const { end } = leaderPath({ x: 300, y: 300 }, rect);
    expect(end.x).toBe(400);
    expect(end.y).toBeGreaterThanOrEqual(100);
    expect(end.y).toBeLessThanOrEqual(170);
  });
});
