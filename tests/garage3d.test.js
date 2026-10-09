import { describe, expect, it } from 'vitest';
import { CAR_TARGET, cameraPreset, findMeshPart, partAnchors3D } from '../src/lib/garage3d.js';
import { availableViews } from '../src/data/views.js';
import { demoParts } from '../src/data/demoProject.js';
import sceneInfo from '../public/models/scene-info.json';

const distance = ({ position, target }) => Math.hypot(...position.map((value, index) => value - target[index]));

describe('3D garage coordinates', () => {
  it('uses real opposing camera positions for front/rear and each side', () => {
    expect(cameraPreset('front').position[0]).toBeGreaterThan(0);
    expect(cameraPreset('rear').position[0]).toBeLessThan(0);
    expect(cameraPreset('side-a').position[2]).toBeGreaterThan(0);
    expect(cameraPreset('side-b').position[2]).toBeLessThan(0);
    for (const view of availableViews) {
      const desktop = cameraPreset(view.id);
      const mobile = cameraPreset(view.id, true);
      expect(desktop.position.every(Number.isFinite), view.id).toBe(true);
      expect(desktop.target).toEqual(CAR_TARGET);
      expect(distance(desktop), view.id).toBeGreaterThan(3.3);
      expect(distance(mobile), view.id).toBeGreaterThan(distance(desktop));
    }
  });

  it('returns independent camera vectors and falls back safely for an unknown preset', () => {
    const original = cameraPreset('front');
    const changed = cameraPreset('front');
    changed.position[0] = 999;
    changed.target[1] = 999;
    expect(cameraPreset('front')).toEqual(original);
    expect(cameraPreset('missing')).toEqual(cameraPreset('exterior-a'));
  });

  it('only anchors exterior parts and provides finite positions and unit facing normals', () => {
    const anchors = partAnchors3D();
    const known = new Set(demoParts.map((part) => part.id));
    expect(anchors.coilovers).toBeUndefined();
    expect(anchors.interior).toBeUndefined();
    for (const [id, candidates] of Object.entries(anchors)) {
      expect(known.has(id), id).toBe(true);
      expect(candidates.length, id).toBeGreaterThan(0);
      for (const { position, normal } of candidates) {
        expect(position).toHaveLength(3);
        expect(position.every(Number.isFinite), id).toBe(true);
        expect(position[1], id).toBeGreaterThan(0);
        expect(position[1], id).toBeLessThan(2);
        expect(Math.hypot(...normal), id).toBeCloseTo(1);
      }
    }
    expect(anchors.wheels.map(({ normal }) => normal[2]).sort()).toEqual([-1, 1]);
    expect(anchors['front-bumper'].every(({ position }) => position[0] > 0)).toBe(true);
    expect(anchors['rear-bumper'].every(({ position }) => position[0] < 0)).toBe(true);
  });

  it('places every anchor on the exported car, not beside it', () => {
    const { min, max } = sceneInfo.car.bounds;
    for (const [id, candidates] of Object.entries(partAnchors3D())) {
      for (const { position } of candidates) {
        position.forEach((value, axis) => {
          expect(value, `${id} axis ${axis}`).toBeGreaterThan(min[axis] - 0.05);
          expect(value, `${id} axis ${axis}`).toBeLessThan(max[axis] + 0.05);
        });
      }
    }
  });

  it('resolves exported part metadata through GLB mesh ancestors without inventing selections', () => {
    const wheel = { userData: { partId: 'wheels' }, parent: null };
    const untaggedSpoke = { userData: {}, parent: wheel };
    const brakeDisc = { userData: { partId: 'brake-kit' }, parent: wheel };
    expect(findMeshPart(untaggedSpoke)).toBe('wheels');
    expect(findMeshPart(brakeDisc)).toBe('brake-kit');
    expect(findMeshPart({ userData: { partId: 42 }, parent: wheel })).toBe('wheels');
    expect(findMeshPart({ name: 'looks-like-a-wheel', parent: null })).toBeNull();
    expect(findMeshPart(null)).toBeNull();
  });
});
