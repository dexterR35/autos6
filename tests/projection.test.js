import { describe, expect, it } from 'vitest';
import {
  chooseFit, computeFocusRect, computeImageRect, isAnchorVisible, projectPoint, unprojectPoint,
} from '../src/lib/projection.js';

const IW = 1672;
const IH = 941;

describe('computeImageRect', () => {
  it('contain letterboxes top/bottom when the stage is taller than the image', () => {
    const r = computeImageRect({ stageW: 1000, stageH: 1000, imageW: IW, imageH: IH, fit: 'contain' });
    expect(r.width).toBeCloseTo(1000);
    expect(r.height).toBeCloseTo((1000 * IH) / IW);
    expect(r.x).toBeCloseTo(0);
    expect(r.y).toBeCloseTo((1000 - r.height) / 2);
  });

  it('contain pillarboxes left/right when the stage is wider than the image', () => {
    const r = computeImageRect({ stageW: 2000, stageH: 500, imageW: IW, imageH: IH, fit: 'contain' });
    expect(r.height).toBeCloseTo(500);
    expect(r.x).toBeCloseTo((2000 - r.width) / 2);
    expect(r.y).toBeCloseTo(0);
  });

  it('cover crops and honours object-position', () => {
    const top = computeImageRect({ stageW: 1590, stageH: 793, imageW: IW, imageH: IH, fit: 'cover', positionY: 0 });
    const mid = computeImageRect({ stageW: 1590, stageH: 793, imageW: IW, imageH: IH, fit: 'cover', positionY: 0.5 });
    const bot = computeImageRect({ stageW: 1590, stageH: 793, imageW: IW, imageH: IH, fit: 'cover', positionY: 1 });
    expect(mid.width).toBeCloseTo(1590);
    expect(mid.height).toBeGreaterThan(793);
    expect(top.y).toBeCloseTo(0);
    expect(mid.y).toBeCloseTo((793 - mid.height) / 2);
    expect(bot.y).toBeCloseTo(793 - bot.height);
  });

  it('returns an empty rect for zero-sized stages (before layout)', () => {
    expect(computeImageRect({ stageW: 0, stageH: 0, imageW: IW, imageH: IH }).width).toBe(0);
  });
});

describe('projectPoint / unprojectPoint', () => {
  it('maps normalized source points through letterboxing', () => {
    const r = computeImageRect({ stageW: 800, stageH: 800, imageW: IW, imageH: IH, fit: 'contain' });
    const p = projectPoint(r, 0.5, 0.5);
    expect(p.x).toBeCloseTo(400);
    expect(p.y).toBeCloseTo(400);
    const corner = projectPoint(r, 0, 0);
    expect(corner.y).toBeCloseTo(r.y); // top of the letterboxed image, not the stage
  });

  it('maps through cropping (cover)', () => {
    const r = computeImageRect({ stageW: 1590, stageH: 600, imageW: IW, imageH: IH, fit: 'cover', positionY: 0.3 });
    const p = projectPoint(r, 0.5, 0.6);
    expect(p.x).toBeCloseTo(795);
    expect(p.y).toBeCloseTo(r.y + 0.6 * r.height);
  });

  it('round-trips', () => {
    const r = computeImageRect({ stageW: 1234, stageH: 567, imageW: IW, imageH: IH, fit: 'cover', positionX: 0.2, positionY: 0.7 });
    const p = projectPoint(r, 0.123, 0.456);
    const n = unprojectPoint(r, p.x, p.y);
    expect(n.x).toBeCloseTo(0.123);
    expect(n.y).toBeCloseTo(0.456);
  });

  it('keeps an anchor on the same image feature across resizes', () => {
    // A point at 30% / 60% of the image must stay at 30% / 60% of the drawn image.
    for (const [w, h] of [[1983, 793], [1440, 900], [1024, 768], [390, 219]]) {
      const fit = chooseFit(w, h, IW, IH);
      const r = computeImageRect({ stageW: w, stageH: h, imageW: IW, imageH: IH, fit });
      const p = projectPoint(r, 0.3, 0.6);
      expect((p.x - r.x) / r.width).toBeCloseTo(0.3);
      expect((p.y - r.y) / r.height).toBeCloseTo(0.6);
    }
  });
});

describe('chooseFit', () => {
  it('crops only when the stage is wider than the image aspect', () => {
    expect(chooseFit(1983, 793, IW, IH)).toBe('cover');
    expect(chooseFit(1024, 768, IW, IH)).toBe('contain');
  });
});

describe('computeFocusRect', () => {
  const focus = { x0: 0.2, y0: 0.2, x1: 0.7, y1: 0.7 };
  it('zooms so the focus box fills the stage and centres it', () => {
    const r = computeFocusRect({ stageW: 400, stageH: 250, imageW: IW, imageH: IH, focus });
    const a = projectPoint(r, 0.45, 0.45); // focus centre
    expect(a.x).toBeCloseTo(200, 0);
    expect(r.width).toBeGreaterThan(400);
  });
  it('never leaves gaps: the image still covers the stage', () => {
    const r = computeFocusRect({ stageW: 400, stageH: 250, imageW: IW, imageH: IH, focus: { x0: 0, y0: 0.1, x1: 0.2, y1: 0.3 } });
    expect(r.x).toBeLessThanOrEqual(0);
    expect(r.y).toBeLessThanOrEqual(0);
    expect(r.x + r.width).toBeGreaterThanOrEqual(400 - 1e-6);
    expect(r.y + r.height).toBeGreaterThanOrEqual(250 - 1e-6);
  });
});

describe('isAnchorVisible', () => {
  const stage = { stageW: 1000, stageH: 500 };
  const rect = computeImageRect({ ...stage, imageW: IW, imageH: IH, fit: 'cover', positionY: 0.5 });
  it('hides anchors cropped out of view instead of clamping them', () => {
    const p = projectPoint(rect, 0.5, 0.02); // above the visible crop
    expect(isAnchorVisible(p, { rect, ...stage })).toBe(false);
  });
  it('hides anchors under reserved UI areas', () => {
    const p = projectPoint(rect, 0.5, 0.5);
    expect(isAnchorVisible(p, { rect, ...stage })).toBe(true);
    expect(isAnchorVisible(p, { rect, ...stage, reserved: [{ x: p.x - 10, y: p.y - 10, width: 20, height: 20 }] })).toBe(false);
  });
});
