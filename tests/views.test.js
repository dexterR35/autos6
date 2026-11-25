import { existsSync } from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { availableViews, getView, views, viewsContainingPart } from '../src/data/views.js';
import { demoParts } from '../src/data/demoProject.js';
import { partThumbnails } from '../src/data/assetManifest.js';

const pub = (p) => path.resolve(import.meta.dirname, '../public', `.${p}`);
const partIds = new Set(demoParts.map((p) => p.id));

describe('view configuration', () => {
  it('every available view has real image files on disk', () => {
    for (const v of availableViews) {
      expect(existsSync(pub(v.src)), v.src).toBe(true);
      expect(existsSync(pub(v.thumb)), v.thumb).toBe(true);
      expect(existsSync(pub(v.original)), v.original).toBe(true);
    }
  });

  it('missing reference angles are configured but unavailable (no fabricated images)', () => {
    for (const id of ['top-view']) {
      const v = views.find((x) => x.id === id);
      expect(v.available).toBe(false);
      expect(v.src).toBeUndefined();
      expect(getView(id)).toBeNull();
    }
  });

  it('offers a real interior image and camera preset without exterior dots', () => {
    const interior = getView('interior');
    expect(interior.available).toBe(true);
    expect(interior.src).toContain('/a6-c5/interior.webp');
    expect(interior.hotspots).toEqual([]);
  });

  it('offers an engine bay image with its own camera option', () => {
    const engine = getView('engine');
    expect(engine.available).toBe(true);
    expect(engine.src).toContain('/a6-c5/engine.webp');
    expect(engine.hotspots).toEqual([]);
  });

  it('hotspots are normalized, unique and reference known parts', () => {
    const ids = new Set();
    for (const v of availableViews) {
      for (const h of v.hotspots) {
        expect(partIds.has(h.partId), h.partId).toBe(true);
        expect(h.x).toBeGreaterThan(0);
        expect(h.x).toBeLessThan(1);
        expect(h.y).toBeGreaterThan(0);
        expect(h.y).toBeLessThan(1);
        expect(ids.has(h.id)).toBe(false);
        ids.add(h.id);
      }
      expect(new Set(v.hotspots.map((h) => h.partId)).size).toBe(v.hotspots.length);
    }
  });

  it('front and rear show different parts', () => {
    const front = getView('front').hotspots.map((h) => h.partId);
    const rear = getView('rear').hotspots.map((h) => h.partId);
    expect(front).toEqual(expect.arrayContaining(['hood', 'front-bumper']));
    expect(front).not.toContain('rear-bumper');
    expect(front).not.toContain('exhaust');
    expect(rear).toContain('rear-bumper');
    // The supplied A6 has no visible exhaust tip behind its bumper.
    expect(rear).not.toContain('exhaust');
    expect(rear).not.toContain('hood');
    expect(rear).not.toContain('front-bumper');
  });

  it('hidden parts (coilovers, interior) have no exterior anchor', () => {
    expect(viewsContainingPart('coilovers')).toHaveLength(0);
    expect(viewsContainingPart('interior')).toHaveLength(0);
  });

  it('every part has a thumbnail entry whose file exists', () => {
    for (const p of demoParts) {
      const t = partThumbnails[p.id];
      expect(t, p.id).toBeDefined();
      if (t.type !== 'icon') expect(existsSync(pub(t.src)), t.src).toBe(true);
    }
  });
});
