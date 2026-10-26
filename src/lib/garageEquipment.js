import * as THREE from 'three';

export const EQUIPMENT_LAYOUT = Object.freeze({
  cabinet: [13.15, 0, -3.5], trolley: [12.95, 0, -1.25], drum: [13.15, 0, 0.75], crates: [13.05, 0, -4.8],
  westTrolley: [-13.1, 0, -.8], westDrum: [-13.2, 0, .6], westJacks: [[-12.45, 0, -2.55], [-12.45, 0, -3.45]],
});

const oldCabinet = new THREE.Box3(new THREE.Vector3(10.1, .015, -3.02), new THREE.Vector3(13.25, 2.16, -1.69));
const oldCart = new THREE.Box3(new THREE.Vector3(9, .015, -.76), new THREE.Vector3(10.91, 1.18, .06));
const oldDrum = new THREE.Box3(new THREE.Vector3(10.1, -.005, .1), new THREE.Vector3(10.91, 1.14, .91));
const equipmentMaterial = /aged charcoal enamel|machined steel|polished tool edges|charcoal rubber|ivory label|black recess|deep red powdercoat|bottle |brass fittings|midnight blue enamel/i;

function moveAround(from, to, rotation = 0, ground = 0) {
  return new THREE.Matrix4().makeTranslation(to[0], ground, to[2])
    .multiply(new THREE.Matrix4().makeRotationY(rotation))
    .multiply(new THREE.Matrix4().makeTranslation(-from[0], 0, -from[2]));
}

// The western trolley and jacks overlap in the still-render layout. Classifying
// whole connected pieces keeps tools, handles and casters with their assembly.
function westernPieces(geometry, toGarage, materialName) {
  const position = geometry.attributes.position, index = geometry.index;
  const parents = Int32Array.from({ length: position.count }, (_, i) => i);
  const find = (i) => { while (parents[i] !== i) { parents[i] = parents[parents[i]]; i = parents[i]; } return i; };
  const union = (a, b) => { a = find(a); b = find(b); if (a !== b) parents[a] = b; };
  const welded = new Map(), point = new THREE.Vector3();
  for (let i = 0; i < position.count; i++) {
    const key = [position.getX(i), position.getY(i), position.getZ(i)].map((v) => Math.round(v * 1e7)).join(',');
    if (welded.has(key)) union(i, welded.get(key)); else welded.set(key, i);
  }
  for (let i = 0; i < (index?.count ?? position.count); i += 3) {
    const a = index ? index.getX(i) : i, b = index ? index.getX(i + 1) : i + 1, c = index ? index.getX(i + 2) : i + 2;
    union(a, b); union(b, c);
  }
  const boxes = new Map();
  for (let i = 0; i < position.count; i++) {
    const root = find(i);
    if (!boxes.has(root)) boxes.set(root, new THREE.Box3());
    boxes.get(root).expandByPoint(point.fromBufferAttribute(position, i).applyMatrix4(toGarage));
  }
  const categories = new Map();
  for (const [root, box] of boxes) {
    const c = box.getCenter(new THREE.Vector3());
    if (box.min.x > -10.02 && box.max.x < -9.17 && box.min.z > .89 && box.max.z < 1.71 && box.max.y < 1.01) { categories.set(root, 16); continue; }
    if (c.x < -11.6 || c.x > -10.0 || c.z < -2.8 || c.z > .12 || box.max.y > 1.34) continue;
    let jack = -1;
    if (/deep red powdercoat/i.test(materialName)) jack = c.z < -1.2 ? 0 : 1;
    else if (/charcoal rubber/i.test(materialName) && box.min.y > .3) jack = c.y > 1 ? (c.x < -10.45 ? 0 : 1) : (c.z < -.9 ? 0 : 1);
    else if (/machined steel/i.test(materialName) && box.min.z < -1.1 && box.max.y > 1) jack = c.x < -10.45 ? 0 : 1;
    else if (/aged charcoal enamel/i.test(materialName) && box.max.y < .19) {
      let closest = Infinity;
      for (let j = 0; j < 2; j++) for (const dx of [-.256, .256]) for (const dz of [-.43, .42]) {
        const distance = Math.hypot(c.x - (j ? -10.4 : -10.5) - dx, c.z - (j ? -.8 : -1.6) - dz);
        if (distance < closest && distance < .11) { closest = distance; jack = j; }
      }
    }
    if (jack >= 0) categories.set(root, jack ? 64 : 32);
    else if (box.min.x > -11.53 && box.max.x < -10.07 && box.min.z > -.72 && box.max.z < .11 && box.max.y < .91) categories.set(root, 8);
  }
  return Uint8Array.from(parents, (_, i) => categories.get(find(i)) ?? 0);
}

// Rebuild indexed attributes so a moved part never drags a shared vertex from an
// adjacent object. This also preserves UVs and rotates normals with the assembly.
function rewrite(mesh, garage, additions) {
  const geometry = mesh.geometry, source = geometry.attributes.position;
  const toGarage = garage.matrixWorld.clone().invert().multiply(mesh.matrixWorld);
  const fromGarage = toGarage.clone().invert();
  const cartTransform = fromGarage.clone().multiply(moveAround([9.95, 0, -.35], EQUIPMENT_LAYOUT.trolley, -Math.PI / 2, -.027)).multiply(toGarage);
  const drumTransform = fromGarage.clone().multiply(moveAround([10.5, 0, .5], EQUIPMENT_LAYOUT.drum)).multiply(toGarage);
  const localMove = (from, to, rotation, ground) => fromGarage.clone().multiply(moveAround(from, to, rotation, ground)).multiply(toGarage);
  const transforms = [new THREE.Matrix4(), cartTransform, drumTransform,
    localMove([-10.8, 0, -.3], EQUIPMENT_LAYOUT.westTrolley, Math.PI / 2, -.031),
    localMove([-9.6, 0, 1.3], EQUIPMENT_LAYOUT.westDrum, 0, 0),
    localMove([-10.5, 0, -1.6], EQUIPMENT_LAYOUT.westJacks[0], Math.PI / 2, -.005),
    localMove([-10.4, 0, -.8], EQUIPMENT_LAYOUT.westJacks[1], Math.PI / 2, -.005)];
  const normals = transforms.map((matrix) => new THREE.Matrix3().getNormalMatrix(matrix));
  const memberships = westernPieces(geometry, toGarage, mesh.material.name), point = new THREE.Vector3();
  for (let i = 0; i < source.count; i++) {
    point.fromBufferAttribute(source, i).applyMatrix4(toGarage);
    memberships[i] ||= oldCabinet.containsPoint(point) ? 1 : oldCart.containsPoint(point) ? 2 : oldDrum.containsPoint(point) ? 4 : 0;
  }
  if (!memberships.some(Boolean) && !additions?.length) return 0;
  const values = Object.fromEntries(Object.keys(geometry.attributes).map((key) => [key, []]));
  const indices = [], mapped = new Map();
  const index = geometry.index, total = index?.count ?? source.count;
  let removed = 0;
  function copy(old, transform) {
    const key = `${old}:${transform}`;
    if (mapped.has(key)) return mapped.get(key);
    const next = values.position.length / 3;
    for (const [name, attribute] of Object.entries(geometry.attributes)) {
      if (name === 'position' || name === 'normal') {
        point.fromBufferAttribute(attribute, old);
        if (name === 'position') point.applyMatrix4(transforms[transform]);
        else point.applyNormalMatrix(normals[transform]);
        values[name].push(...point.toArray());
      } else for (let k = 0; k < attribute.itemSize; k++) values[name].push(attribute.getComponent(old, k));
    }
    mapped.set(key, next); return next;
  }
  for (let i = 0; i < total; i += 3) {
    const ids = [0, 1, 2].map((k) => index ? index.getX(i + k) : i + k);
    const membership = memberships[ids[0]] & memberships[ids[1]] & memberships[ids[2]];
    if (membership & 1) { removed++; continue; }
    const transform = membership & 2 ? 1 : membership & 4 ? 2 : membership & 8 ? 3 : membership & 16 ? 4 : membership & 32 ? 5 : membership & 64 ? 6 : 0;
    indices.push(...ids.map((id) => copy(id, transform)));
  }
  for (const addition of additions ?? []) {
    addition.applyMatrix4(fromGarage);
    const offset = values.position.length / 3;
    for (const [name, attribute] of Object.entries(geometry.attributes)) {
      const added = addition.attributes[name];
      for (let i = 0; i < addition.attributes.position.count; i++) for (let k = 0; k < attribute.itemSize; k++) values[name].push(added ? added.getComponent(i, k) : 0);
    }
    const addedIndex = addition.index;
    for (let i = 0; i < (addedIndex?.count ?? addition.attributes.position.count); i++) indices.push(offset + (addedIndex ? addedIndex.getX(i) : i));
    addition.dispose();
  }
  const replacement = new THREE.BufferGeometry();
  for (const [name, attribute] of Object.entries(geometry.attributes)) replacement.setAttribute(name, new THREE.Float32BufferAttribute(values[name], attribute.itemSize));
  replacement.setIndex(indices); replacement.computeBoundingBox(); replacement.computeBoundingSphere();
  mesh.geometry = replacement; geometry.dispose();
  return removed;
}

/** Repair the split cabinet and park complete equipment against the east wall. */
export function arrangeGarageEquipment(garage) {
  if (garage.userData.equipmentArranged) return garage.userData.equipmentArranged;
  garage.updateMatrixWorld(true);
  const meshes = [];
  garage.traverse((object) => { if (object.isMesh && !Array.isArray(object.material) && equipmentMaterial.test(object.material.name)) meshes.push(object); });
  const additions = new Map();
  const add = (pattern, geometry) => {
    const target = meshes.find((mesh) => pattern.test(mesh.material.name));
    if (!target) { geometry.dispose(); return; }
    if (!additions.has(target)) additions.set(target, []);
    additions.get(target).push(geometry);
  };
  const box = (pattern, size, position) => add(pattern, new THREE.BoxGeometry(...size).translate(...position));
  const cylinder = (pattern, radius, height, position, axle = false) => {
    const geometry = new THREE.CylinderGeometry(radius, radius, height, 12);
    if (axle) geometry.rotateX(Math.PI / 2);
    add(pattern, geometry.translate(...position));
  };
  const red = /deep red powdercoat/i, steel = /aged charcoal enamel/i, silver = /machined steel/i, rubber = /charcoal rubber/i, black = /black recess/i, paper = /ivory label/i;
  const [x, , z] = EQUIPMENT_LAYOUT.cabinet;
  box(red, [.69, 1.5, 1], [x, .94, z]);
  box(rubber, [.73, .055, 1.045], [x, 1.7175, z]);
  for (const dx of [-.24, .24]) for (const dz of [-.4, .4]) {
    cylinder(rubber, .09, .065, [x + dx, .09, z + dz], true);
    box(silver, [.12, .15, .055], [x + dx, .125, z + dz]);
  }
  for (let row = 0; row < 7; row++) {
    const y = .25 + (1.37 / 7) * (row + .5);
    box(black, [.026, .188, .90], [x - .352, y, z]);
    box(red, [.026, .171, .875], [x - .376, y, z]);
    box(silver, [.04, .029, .80], [x - .4, y + .057, z]);
    box(paper, [.006, .033, .105], [x - .42, y, z + .28]);
  }
  for (const dz of [-.465, .465]) box(silver, [.034, 1.48, .032], [x - .37, .95, z + dz]);
  for (let i = 0; i < 5; i++) {
    const bx = x + (i % 2 ? .12 : -.1), bz = z - .34 + i * .16, height = .18 + (i % 3) * .035;
    cylinder(i % 2 ? /bottle amber/i : /bottle cream/i, .04, height, [bx, 1.745 + height / 2, bz]);
    cylinder(black, .022, .035, [bx, 1.762 + height, bz]);
  }
  const [cx, , cz] = EQUIPMENT_LAYOUT.crates;
  for (let crate = 0; crate < 2; crate++) {
    const base = crate * .5;
    box(black, [.53, .15, .76], [cx, base + .075, cz]);
    for (const dz of [-.37, .37]) box(steel, [.55, .4, .035], [cx, base + .3, cz + dz]);
    for (const dx of [-.26, .26]) for (const h of [.14, .29, .44]) box(steel, [.035, .07, .75], [cx + dx, base + h, cz]);
  }
  let removedFaces = 0;
  for (const mesh of meshes) removedFaces += rewrite(mesh, garage, additions.get(mesh));
  const report = { removedFaces, layout: EQUIPMENT_LAYOUT, addedMeshes: 0 };
  garage.userData.equipmentArranged = report;
  return report;
}
