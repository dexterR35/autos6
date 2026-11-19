import { describe, expect, it, vi } from 'vitest';
import * as THREE from 'three';
import { createInstalledParts, fitInto, installedKey, installedPartList, localBounds } from '../src/lib/installedParts.js';

const box = (w, h, d, partId) => {
  const m = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), new THREE.MeshBasicMaterial());
  if (partId) m.userData.partId = partId;
  return m;
};
function makeCar() {
  const car = new THREE.Group();
  car.position.set(5, 0, 0);
  car.scale.setScalar(2);
  const body = box(4, 1, 2, 'body');
  const spoiler = box(1, 0.2, 1.5, 'spoiler');
  spoiler.position.set(-2, 1, 0);
  car.add(body, spoiler);
  car.updateMatrixWorld(true);
  return { car, spoiler };
}

describe('installed parts on the car', () => {
  it('lists only installed parts with a model and placement other than off', () => {
    const list = installedPartList({
      a: { id: 'a', status: 'installed', modelUrl: 'https://x/a.glb', carPlacement: 'fit' },
      b: { id: 'b', status: 'bought', modelUrl: 'https://x/b.glb' },
      c: { id: 'c', status: 'installed', modelUrl: null },
      d: { id: 'd', status: 'installed', modelUrl: 'https://x/d.glb', carPlacement: 'off' },
    });
    expect(list).toEqual([{ id: 'a', url: 'https://x/a.glb', placement: 'fit' }]);
    expect(installedKey(list)).toBe('a|https://x/a.glb|fit');
  });

  it('fits a model of any scale into the original part bounds, in the car space', () => {
    const { car, spoiler } = makeCar();
    const target = localBounds([spoiler], car);
    const model = new THREE.Group().add(box(100, 10, 50));
    car.add(model);
    fitInto(model, target, car);
    const got = localBounds([model.children[0]], car);
    expect(got.getCenter(new THREE.Vector3()).toArray().map((v) => +v.toFixed(5))).toEqual([-2, 1, 0]);
    expect(+got.getSize(new THREE.Vector3()).x.toFixed(5)).toBe(1);
    expect(got.getSize(new THREE.Vector3()).z).toBeLessThanOrEqual(1.5 + 1e-6);
  });

  it('replaces the original, keeps picking id, restores it when uninstalled', async () => {
    const { car, spoiler } = makeCar();
    const dispose = vi.fn();
    const installed = createInstalledParts({ car, load: async () => new THREE.Group().add(box(3, 1, 2)), dispose });
    const list = [{ id: 'spoiler', url: 'https://x/s.glb', placement: 'fit' }];
    expect(await installed.sync(list)).toBe(true);
    expect(spoiler.visible).toBe(false);
    const model = car.children.find((o) => o.userData.installedPart);
    expect(model.userData.partId).toBe('spoiler');
    expect(await installed.sync(list)).toBe(false);
    expect(await installed.sync([])).toBe(true);
    expect(spoiler.visible).toBe(true);
    expect(dispose).toHaveBeenCalledWith(model);
    expect(car.children.some((o) => o.userData.installedPart)).toBe(false);
  });

  it('skips "fit" parts the car has no mesh for, but adds "car" placed ones as exported', async () => {
    const { car } = makeCar();
    const load = vi.fn(async () => new THREE.Group().add(box(1, 1, 1)));
    const installed = createInstalledParts({ car, load, dispose: () => {} });
    expect(await installed.sync([{ id: 'roof-rails', url: 'u', placement: 'fit' }])).toBe(false);
    expect(load).not.toHaveBeenCalled();
    expect(await installed.sync([{ id: 'roof-rails', url: 'u', placement: 'car' }])).toBe(true);
    expect(installed.size).toBe(1);
  });

  it('ignores a model that fails to load', async () => {
    const { car, spoiler } = makeCar();
    const installed = createInstalledParts({ car, load: async () => { throw new Error('404'); }, dispose: () => {} });
    expect(await installed.sync([{ id: 'spoiler', url: 'u', placement: 'fit' }])).toBe(false);
    expect(spoiler.visible).toBe(true);
  });
});
