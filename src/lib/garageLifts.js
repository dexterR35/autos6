import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';

// Bay travel follows Z toward the roller doors. Each lift has two opposing
// columns across X, leaving the center display car and the rear wall clear.
export const SERVICE_LIFT_BAYS = Object.freeze([
  Object.freeze({ id: '01', center: [-6.2, 0, -7.4], postSpacing: 3.4, height: 3.65 }),
  Object.freeze({ id: '02', center: [6.2, 0, -7.4], postSpacing: 3.4, height: 3.65 }),
]);

// The source scene placed five independent posts to match a single photograph.
// Its exporter merged objects by material, so remove those measured pieces from
// the shared meshes rather than hiding whole materials (also used by furniture).
const ORIGINAL_POSTS = [
  [-8.56395, -9.51005, 0.77], [-5.36072, -10.72309, 0.77],
  [1.29679, -11.25745, 0.92], [5.75889, -11.49069, 0.92],
  [6.53064, -11.72112, 0.77],
];
const LIFT_MATERIAL = /midnight blue enamel|ochre safety|aged charcoal enamel|machined steel|polished tool edges|charcoal rubber|ivory label stock|black recess|deep red powdercoat/i;
const ORIGINAL_REGIONS = ORIGINAL_POSTS.map(([x, z, factor]) => new THREE.Box3(
  new THREE.Vector3(x - 1.28 * factor, -0.025, z - 0.53 * factor),
  new THREE.Vector3(x + 1.28 * factor, 6.65, z + 1.12 * factor),
));
const UP = new THREE.Vector3(0, 1, 0);

/** Remove complete triangles only; never cut a wall or a long beam at a region edge. */
function removeOriginalLiftFaces(mesh, garageInverse) {
  const geometry = mesh.geometry;
  const position = geometry.attributes.position;
  if (!position) return 0;
  const matrix = new THREE.Matrix4().multiplyMatrices(garageInverse, mesh.matrixWorld);
  const memberships = new Uint8Array(position.count);
  const point = new THREE.Vector3();
  for (let i = 0; i < position.count; i++) {
    point.fromBufferAttribute(position, i).applyMatrix4(matrix);
    ORIGINAL_REGIONS.forEach((box, region) => {
      if (box.containsPoint(point)) memberships[i] |= 1 << region;
    });
  }
  const index = geometry.index;
  const count = index?.count ?? position.count;
  const kept = [];
  let removed = 0;
  for (let i = 0; i < count; i += 3) {
    const a = index ? index.getX(i) : i;
    const b = index ? index.getX(i + 1) : i + 1;
    const c = index ? index.getX(i + 2) : i + 2;
    if (memberships[a] & memberships[b] & memberships[c]) removed++;
    else kept.push(a, b, c);
  }
  if (!removed) return 0;
  // Compact the attributes too: stale positions would otherwise keep the old
  // 6.6 m posts in bounds calculations and waste memory after replacing them.
  const used = [...new Set(kept)];
  const remap = new Map(used.map((old, next) => [old, next]));
  const replacement = new THREE.BufferGeometry();
  for (const [name, attribute] of Object.entries(geometry.attributes)) {
    const values = new Float32Array(used.length * attribute.itemSize);
    used.forEach((old, next) => {
      for (let k = 0; k < attribute.itemSize; k++) values[next * attribute.itemSize + k] = attribute.getComponent(old, k);
    });
    replacement.setAttribute(name, new THREE.BufferAttribute(values, attribute.itemSize));
  }
  replacement.setIndex(kept.map((old) => remap.get(old)));
  replacement.computeBoundingBox();
  replacement.computeBoundingSphere();
  mesh.geometry = replacement;
  geometry.dispose();
  mesh.userData.originalLiftFacesRemoved = removed;
  return removed;
}

class LiftBuilder {
  constructor() { this.parts = new Map(); }
  add(material, geometry) {
    if (!this.parts.has(material)) this.parts.set(material, []);
    this.parts.get(material).push(geometry);
  }
  box(material, size, at) {
    this.add(material, new THREE.BoxGeometry(...size).translate(...at));
  }
  rod(material, start, end, radius, segments = 10) {
    const a = new THREE.Vector3(...start), b = new THREE.Vector3(...end);
    const direction = b.clone().sub(a);
    const transform = new THREE.Matrix4().compose(a.add(b).multiplyScalar(0.5),
      new THREE.Quaternion().setFromUnitVectors(UP, direction.clone().normalize()), new THREE.Vector3(1, 1, 1));
    this.add(material, new THREE.CylinderGeometry(radius, radius, direction.length(), segments).applyMatrix4(transform));
  }
  beam(material, a, b, width, height) {
    const start = new THREE.Vector3(...a), end = new THREE.Vector3(...b);
    const delta = end.clone().sub(start);
    const geometry = new THREE.BoxGeometry(width, height, delta.length());
    geometry.rotateY(Math.atan2(delta.x, delta.z)).translate(...start.add(end).multiplyScalar(0.5).toArray());
    this.add(material, geometry);
  }
  build(group) {
    for (const [material, pieces] of this.parts) {
      const mesh = new THREE.Mesh(mergeGeometries(pieces), material);
      mesh.name = `Service lifts | ${material.name}`;
      mesh.userData.serviceLift = true;
      group.add(mesh);
      pieces.forEach((piece) => piece.dispose());
    }
  }
}

/** Replace the five photographic props with two complete, visually plausible lifts. */
export function replaceGarageLifts(garage) {
  const existing = garage.getObjectByName('Garage | paired service lifts');
  if (existing) return existing;
  garage.updateMatrixWorld(true);
  const meshes = [];
  garage.traverse((object) => { if (object.isMesh) meshes.push(object); });
  const find = (pattern, fallback) => meshes.find((mesh) => !Array.isArray(mesh.material) && pattern.test(mesh.material.name))?.material
    ?? new THREE.MeshStandardMaterial(fallback);
  const m = {
    blue: find(/midnight blue enamel/i, { name: 'Lift | worn midnight blue enamel', color: '#133665', roughness: 0.4, metalness: 0.4 }),
    steel: find(/aged charcoal enamel/i, { name: 'Lift | charcoal steel', color: '#202a35', roughness: 0.55, metalness: 0.6 }),
    yellow: find(/ochre safety/i, { name: 'Lift | ochre safety paint', color: '#c89927', roughness: 0.4, metalness: 0.35 }),
    silver: find(/machined steel/i, { name: 'Lift | machined steel', color: '#9aa8b6', roughness: 0.3, metalness: 0.85 }),
    rubber: find(/charcoal rubber/i, { name: 'Lift | rubber pads', color: '#10151a', roughness: 0.85 }),
    label: find(/ivory label/i, { name: 'Lift | warning label', color: '#d2cbb8', roughness: 0.8 }),
    red: find(/deep red powdercoat/i, { name: 'Lift | emergency stop', color: '#b01b21', roughness: 0.4 }),
  };
  const inverse = garage.matrixWorld.clone().invert();
  let removed = 0;
  meshes.forEach((mesh) => {
    if (!Array.isArray(mesh.material) && LIFT_MATERIAL.test(mesh.material.name)) removed += removeOriginalLiftFaces(mesh, inverse);
  });
  const group = new THREE.Group();
  group.name = 'Garage | paired service lifts';
  group.userData = { serviceLiftBays: SERVICE_LIFT_BAYS, originalLiftFacesRemoved: removed, postCenters: [], padCenters: [] };
  const b = new LiftBuilder();
  for (const bay of SERVICE_LIFT_BAYS) {
    const [cx, , z] = bay.center;
    for (const side of [-1, 1]) {
      const x = cx + side * bay.postSpacing / 2;
      const inward = -side;
      group.userData.postCenters.push([x, bay.height / 2, z]);
      b.box(m.steel, [0.72, 0.045, 0.76], [x, 0.025, z]);
      b.box(m.blue, [0.35, bay.height, 0.42], [x, bay.height / 2 + 0.05, z]);
      // Folded mast flanges, exposed piston and moving carriage face the bay.
      for (const dz of [-0.205, 0.205]) b.box(m.steel, [0.06, bay.height, 0.055], [x + inward * 0.18, bay.height / 2 + 0.05, z + dz]);
      b.rod(m.silver, [x + inward * 0.205, 0.3, z], [x + inward * 0.205, 3.36, z], 0.035);
      b.box(m.yellow, [0.09, 1.85, 0.12], [x + inward * 0.22, 1.25, z]);
      b.box(m.blue, [0.3, 0.52, 0.64], [x + inward * 0.26, 0.52, z]);
      for (let y = 0.62; y < 3.25; y += 0.18) b.box(m.silver, [0.045, 0.027, 0.09], [x + inward * 0.205, y, z + 0.145]);
      for (const dx of [-0.255, 0.255]) for (const dz of [-0.275, 0.275]) {
        b.rod(m.silver, [x + dx, 0.047, z + dz], [x + dx, 0.085, z + dz], 0.032, 6);
      }
      // Four telescopic swing arms end at the sill lifting points, two on each
      // side of the vehicle. They stay low in this empty, lowered service bay.
      for (const fore of [-1, 1]) {
        const pivot = [x + inward * 0.33, 0.23, z + fore * 0.22];
        const elbow = [cx + side * 1.03, 0.23, z + fore * 0.8];
        const pad = [cx + side * 0.76, 0.3, z + fore * 1.22];
        b.beam(m.yellow, pivot, elbow, 0.19, 0.15);
        b.beam(m.silver, elbow, [pad[0], 0.23, pad[2]], 0.12, 0.11);
        b.rod(m.silver, [pad[0], 0.24, pad[2]], pad, 0.04);
        b.rod(m.rubber, [pad[0], 0.29, pad[2]], [pad[0], 0.35, pad[2]], 0.115, 16);
        b.rod(m.silver, [pivot[0], 0.28, pivot[2]], [pivot[0], 0.34, pivot[2]], 0.055);
        group.userData.padCenters.push(pad);
      }
      // Outward control panel and hydraulic power pack leave the opening clear.
      b.box(m.steel, [0.16, 0.28, 0.23], [x + side * 0.24, 1.35, z - 0.06]);
      b.box(m.red, [0.045, 0.065, 0.075], [x + side * 0.335, 1.4, z - 0.06]);
      b.box(m.label, [0.018, 0.23, 0.14], [x + inward * 0.186, 2.2, z - 0.08]);
      b.rod(m.rubber, [x + side * 0.24, 0.6, z + 0.08], [x + side * 0.24, 3.42, z + 0.08], 0.014, 6);
      if (side === -1) {
        b.box(m.steel, [0.24, 0.48, 0.28], [x - 0.29, 0.84, z + 0.04]);
        b.rod(m.steel, [x - 0.29, 1.08, z + 0.04], [x - 0.29, 1.35, z + 0.04], 0.09, 12);
      }
    }
    // A single overhead synchronizing bridge connects each actual pair.
    b.box(m.blue, [bay.postSpacing + 0.35, 0.18, 0.23], [cx, bay.height + 0.04, z]);
    b.rod(m.rubber, [cx - 1.7, bay.height - 0.08, z + 0.14], [cx + 1.7, bay.height - 0.08, z + 0.14], 0.016, 6);
    // Painted bay corners make the two independent working areas read clearly.
    for (const side of [-1, 1]) for (const end of [-1, 1]) {
      const edgeX = cx + side * 2.05, edgeZ = z + end * 2.7;
      b.box(m.yellow, [0.7, 0.008, 0.045], [edgeX - side * 0.35, 0.008, edgeZ]);
      b.box(m.yellow, [0.045, 0.008, 0.65], [edgeX, 0.008, edgeZ - end * 0.325]);
    }
  }
  b.build(group);
  garage.add(group);
  group.updateMatrixWorld(true);
  return group;
}
