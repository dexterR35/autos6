// Bounding-volume hierarchy over the static car and garage triangles, for the
// per-frame hotspot occlusion rays and pointer picking. three's Mesh.raycast tests
// every triangle of a mesh whose bounding sphere the ray touches; the exported
// meshes are merged by material and span the whole room, so each ray tested
// ~300k triangles. The index answers the same queries in a few dozen tests.
import * as THREE from 'three';

const LEAF_SIZE = 6;
// Past this depth, splits are by count, which bounds the depth and the query stack.
const SPATIAL_DEPTH = 40;
const EPSILON = 1e-7;
const matrix = new THREE.Matrix4();
const instance = new THREE.Matrix4();
const vertex = new THREE.Vector3();

/** Triangles of every mesh (instances expanded) in world space, plus their owner. */
function collect(roots) {
  const meshes = [];
  for (const root of roots) {
    root.updateMatrixWorld(true);
    root.traverse((object) => { if (object.isMesh && object.geometry?.attributes.position) meshes.push(object); });
  }
  let count = 0;
  for (const mesh of meshes) {
    const { index, attributes } = mesh.geometry;
    count += Math.floor((index ? index.count : attributes.position.count) / 3) * (mesh.isInstancedMesh ? mesh.count : 1);
  }
  const positions = new Float32Array(count * 9);
  const owners = new Uint32Array(count);
  let triangle = 0;
  meshes.forEach((mesh, owner) => {
    const { index, attributes } = mesh.geometry;
    const position = attributes.position;
    const corners = index ? index.count : position.count;
    for (let copy = 0; copy < (mesh.isInstancedMesh ? mesh.count : 1); copy++) {
      matrix.copy(mesh.matrixWorld);
      if (mesh.isInstancedMesh) matrix.multiply(mesh.getMatrixAt(copy, instance));
      for (let corner = 0; corner + 2 < corners; corner += 3) {
        for (let k = 0; k < 3; k++) {
          vertex.fromBufferAttribute(position, index ? index.getX(corner + k) : corner + k).applyMatrix4(matrix);
          const offset = triangle * 9 + k * 3;
          positions[offset] = vertex.x;
          positions[offset + 1] = vertex.y;
          positions[offset + 2] = vertex.z;
        }
        owners[triangle++] = owner;
      }
    }
  });
  return { meshes, positions, owners, count };
}

export class RayIndex {
  constructor(roots) {
    const { meshes, positions, owners, count } = collect(roots);
    this.meshes = meshes;
    this.positions = positions;
    this.owners = owners;
    this.order = new Uint32Array(count);
    const bounds = new Float32Array(count * 6);
    const centres = new Float32Array(count * 3);
    for (let t = 0; t < count; t++) {
      this.order[t] = t;
      for (let axis = 0; axis < 3; axis++) {
        const a = positions[t * 9 + axis];
        const b = positions[t * 9 + 3 + axis];
        const c = positions[t * 9 + 6 + axis];
        const low = Math.min(a, b, c);
        const high = Math.max(a, b, c);
        bounds[t * 6 + axis] = low;
        bounds[t * 6 + 3 + axis] = high;
        centres[t * 3 + axis] = (low + high) / 2;
      }
    }
    const capacity = Math.max(1, Math.ceil(count / LEAF_SIZE) * 2 + 1) * 2;
    this.boxes = new Float32Array(capacity * 6);
    // Interior: [right child, -1] with the left child next. Leaf: [first, count].
    this.nodes = new Int32Array(capacity * 2);
    this.used = 0;
    if (count) this.build(0, count, bounds, centres, 0);
    this.stack = new Int32Array(128);
  }

  build(start, end, bounds, centres, depth) {
    const node = this.used++;
    const box = this.boxes;
    const low = [Infinity, Infinity, Infinity];
    const high = [-Infinity, -Infinity, -Infinity];
    const centreLow = [Infinity, Infinity, Infinity];
    const centreHigh = [-Infinity, -Infinity, -Infinity];
    for (let i = start; i < end; i++) {
      const t = this.order[i];
      for (let axis = 0; axis < 3; axis++) {
        low[axis] = Math.min(low[axis], bounds[t * 6 + axis]);
        high[axis] = Math.max(high[axis], bounds[t * 6 + 3 + axis]);
        centreLow[axis] = Math.min(centreLow[axis], centres[t * 3 + axis]);
        centreHigh[axis] = Math.max(centreHigh[axis], centres[t * 3 + axis]);
      }
    }
    for (let axis = 0; axis < 3; axis++) {
      box[node * 6 + axis] = low[axis];
      box[node * 6 + 3 + axis] = high[axis];
    }
    if (end - start <= LEAF_SIZE) {
      this.nodes[node * 2] = start;
      this.nodes[node * 2 + 1] = end - start;
      return node;
    }
    const spans = centreHigh.map((value, axis) => value - centreLow[axis]);
    const axis = spans.indexOf(Math.max(...spans));
    const split = (centreLow[axis] + centreHigh[axis]) / 2;
    let i = start;
    let j = end - 1;
    while (i <= j) {
      if (centres[this.order[i] * 3 + axis] < split) i++;
      else { const swap = this.order[i]; this.order[i] = this.order[j]; this.order[j--] = swap; }
    }
    // Coincident centres cannot be separated spatially: split the list in half.
    const middle = i === start || i === end || depth > SPATIAL_DEPTH ? (start + end) >> 1 : i;
    this.build(start, middle, bounds, centres, depth + 1);
    this.nodes[node * 2] = this.build(middle, end, bounds, centres, depth + 1);
    this.nodes[node * 2 + 1] = -1;
    return node;
  }

  /**
   * Nearest hit along the ray within `far`, as { distance, object }, or null.
   * With `any`, returns the first hit found (enough to know a point is hidden).
   */
  intersect(ray, far = Infinity, any = false) {
    const { origin, direction } = ray;
    const ox = origin.x, oy = origin.y, oz = origin.z;
    const dx = direction.x, dy = direction.y, dz = direction.z;
    const ix = 1 / dx, iy = 1 / dy, iz = 1 / dz;
    const { boxes, nodes, order, positions, stack } = this;
    let nearest = far;
    let hit = -1;
    let top = 0;
    if (this.used) stack[top++] = 0;
    while (top) {
      const node = stack[--top];
      const b = node * 6;
      let t1 = (boxes[b] - ox) * ix, t2 = (boxes[b + 3] - ox) * ix;
      let enter = Math.min(t1, t2), exit = Math.max(t1, t2);
      t1 = (boxes[b + 1] - oy) * iy; t2 = (boxes[b + 4] - oy) * iy;
      enter = Math.max(enter, Math.min(t1, t2)); exit = Math.min(exit, Math.max(t1, t2));
      t1 = (boxes[b + 2] - oz) * iz; t2 = (boxes[b + 5] - oz) * iz;
      enter = Math.max(enter, Math.min(t1, t2)); exit = Math.min(exit, Math.max(t1, t2));
      if (exit < Math.max(enter, 0) || enter > nearest) continue;
      const count = nodes[node * 2 + 1];
      if (count < 0) {
        stack[top++] = nodes[node * 2];
        stack[top++] = node + 1;
        continue;
      }
      for (let i = nodes[node * 2], last = i + count; i < last; i++) {
        // Möller–Trumbore, both faces (the exported materials are double-sided).
        const p = order[i] * 9;
        const e1x = positions[p + 3] - positions[p], e1y = positions[p + 4] - positions[p + 1], e1z = positions[p + 5] - positions[p + 2];
        const e2x = positions[p + 6] - positions[p], e2y = positions[p + 7] - positions[p + 1], e2z = positions[p + 8] - positions[p + 2];
        const px = dy * e2z - dz * e2y, py = dz * e2x - dx * e2z, pz = dx * e2y - dy * e2x;
        const det = e1x * px + e1y * py + e1z * pz;
        if (det > -EPSILON && det < EPSILON) continue;
        const inverse = 1 / det;
        const sx = ox - positions[p], sy = oy - positions[p + 1], sz = oz - positions[p + 2];
        const u = (sx * px + sy * py + sz * pz) * inverse;
        if (u < 0 || u > 1) continue;
        const qx = sy * e1z - sz * e1y, qy = sz * e1x - sx * e1z, qz = sx * e1y - sy * e1x;
        const v = (dx * qx + dy * qy + dz * qz) * inverse;
        if (v < 0 || u + v > 1) continue;
        const t = (e2x * qx + e2y * qy + e2z * qz) * inverse;
        if (t > EPSILON && t < nearest) {
          nearest = t;
          hit = order[i];
          if (any) return { distance: t, object: this.meshes[this.owners[hit]] };
        }
      }
    }
    return hit < 0 ? null : { distance: nearest, object: this.meshes[this.owners[hit]] };
  }
}
