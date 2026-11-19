import * as THREE from 'three';

/**
 * Installed parts on the garage car. When a part is "installed" and has a .glb, it is
 * shown on the car:
 *   - placement "car": the model was exported in the car's own coordinates (same Blender
 *     scene as the car); it is added as-is.
 *   - placement "fit": the model is scaled and centred into the bounds of the car's
 *     original mesh for that part (meshes whose userData.partId matches).
 * In both cases the original meshes for that part are hidden, and picking still works
 * because the new meshes carry the same partId.
 */

/** Which parts to show, as a stable list (the viewer re-syncs only when this changes). */
export function installedPartList(partsById) {
  return Object.values(partsById ?? {})
    .filter((p) => p.status === 'installed' && p.modelUrl && (p.carPlacement ?? 'fit') !== 'off')
    .map((p) => ({ id: p.id, url: p.modelUrl, placement: p.carPlacement ?? 'fit' }))
    .sort((a, b) => a.id.localeCompare(b.id));
}
export const installedKey = (list) => list.map((p) => `${p.id}|${p.url}|${p.placement}`).join(',');

/** Original car meshes that belong to a part. */
export function originalMeshes(car, partId) {
  const found = [];
  car.traverse((o) => {
    if (o.isMesh && !o.userData.installedPart && partOf(o) === partId) found.push(o);
  });
  return found;
}
function partOf(object) {
  for (let o = object; o; o = o.parent) {
    if (o.userData?.installedPart) return null;
    if (typeof o.userData?.partId === 'string') return o.userData.partId;
  }
  return null;
}

/** Bounds of meshes expressed in `space`'s local coordinates. */
export function localBounds(meshes, space) {
  space.updateWorldMatrix(true, true);
  const inverse = new THREE.Matrix4().copy(space.matrixWorld).invert();
  const box = new THREE.Box3();
  const tmp = new THREE.Box3();
  for (const m of meshes) {
    if (!m.geometry.boundingBox) m.geometry.computeBoundingBox();
    tmp.copy(m.geometry.boundingBox).applyMatrix4(new THREE.Matrix4().multiplyMatrices(inverse, m.matrixWorld));
    box.union(tmp);
  }
  return box;
}

const meshesOf = (root) => { const list = []; root.traverse((o) => { if (o.isMesh) list.push(o); }); return list; };

/**
 * Scale `model` uniformly and move it so its bounds fill `target`. `model` must already be
 * a child of `space`, and `target` is expressed in `space`'s local coordinates.
 */
export function fitInto(model, target, space = model.parent) {
  model.position.set(0, 0, 0);
  model.scale.setScalar(1);
  const own = localBounds(meshesOf(model), space);
  if (own.isEmpty()) return 1;
  const size = own.getSize(new THREE.Vector3());
  const want = target.getSize(new THREE.Vector3());
  const ratios = [want.x / size.x, want.y / size.y, want.z / size.z].filter((r) => Number.isFinite(r) && r > 0);
  const scale = ratios.length ? Math.min(...ratios) : 1;
  model.scale.setScalar(scale);
  const centre = localBounds(meshesOf(model), space).getCenter(new THREE.Vector3());
  model.position.add(target.getCenter(new THREE.Vector3()).sub(centre));
  model.updateMatrixWorld(true);
  return scale;
}

/**
 * @param {{ car: THREE.Object3D, load: (url: string) => Promise<THREE.Object3D>, dispose: (o: THREE.Object3D) => void }} deps
 */
export function createInstalledParts({ car, load, dispose }) {
  const shown = new Map(); // partId → { key, model, hidden: Mesh[] }

  function remove(id) {
    const entry = shown.get(id);
    if (!entry) return;
    entry.model.parent?.remove(entry.model);
    dispose(entry.model);
    entry.hidden.forEach((m) => { m.visible = m.userData.visibleBeforeInstall ?? true; delete m.userData.visibleBeforeInstall; });
    shown.delete(id);
  }

  /** Returns true when the car changed (caller rebuilds picking and re-renders). */
  async function sync(list, signal) {
    let changed = false;
    const wanted = new Map(list.map((p) => [p.id, p]));
    for (const id of [...shown.keys()]) {
      const want = wanted.get(id);
      if (!want || shown.get(id).key !== `${want.url}|${want.placement}`) { remove(id); changed = true; }
    }
    for (const p of list) {
      if (shown.has(p.id) || signal?.aborted) continue;
      const originals = originalMeshes(car, p.id);
      // "fit" needs the original part to size against; without one there is nothing to replace.
      if (p.placement === 'fit' && !originals.length) continue;
      let model;
      try { model = await load(p.url); } catch { continue; }
      if (signal?.aborted) { dispose(model); return changed; }
      model.userData.partId = p.id;
      model.userData.installedPart = true;
      model.traverse((o) => { if (o.isMesh) { o.castShadow = true; o.receiveShadow = true; } });
      if (p.placement === 'fit') {
        const parent = originals[0].parent ?? car;
        parent.add(model);
        fitInto(model, localBounds(originals, parent), parent);
      } else {
        car.add(model);
      }
      originals.forEach((m) => { m.userData.visibleBeforeInstall = m.visible; m.visible = false; });
      shown.set(p.id, { key: `${p.url}|${p.placement}`, model, hidden: originals });
      changed = true;
    }
    return changed;
  }

  return { sync, dispose: () => [...shown.keys()].forEach(remove), get size() { return shown.size; } };
}
