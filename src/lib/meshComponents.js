import * as THREE from 'three';

/**
 * World-space bounds of each connected piece of a merged mesh (one per neon tube,
 * ring or bulb). glTF splits vertices along UV and normal seams, so vertices are
 * welded by position before triangles are joined.
 */
export function meshComponents(mesh) {
  const { position } = mesh.geometry.attributes;
  const parent = new Int32Array(position.count).map((_, index) => index);
  const find = (index) => {
    while (parent[index] !== index) { parent[index] = parent[parent[index]]; index = parent[index]; }
    return index;
  };
  const union = (a, b) => { a = find(a); b = find(b); if (a !== b) parent[a] = b; };
  const welded = new Map();
  for (let i = 0; i < position.count; i++) {
    const key = `${Math.round(position.getX(i) * 400)},${Math.round(position.getY(i) * 400)},${Math.round(position.getZ(i) * 400)}`;
    if (welded.has(key)) union(i, welded.get(key)); else welded.set(key, i);
  }
  const index = mesh.geometry.index;
  if (index) {
    for (let i = 0; i < index.count; i += 3) {
      union(index.getX(i), index.getX(i + 1));
      union(index.getX(i + 1), index.getX(i + 2));
    }
  }
  mesh.updateWorldMatrix(true, false);
  const boxes = new Map();
  const point = new THREE.Vector3();
  for (let i = 0; i < position.count; i++) {
    const root = find(i);
    if (!boxes.has(root)) boxes.set(root, new THREE.Box3());
    boxes.get(root).expandByPoint(point.fromBufferAttribute(position, i).applyMatrix4(mesh.matrixWorld));
  }
  return [...boxes.values()];
}
