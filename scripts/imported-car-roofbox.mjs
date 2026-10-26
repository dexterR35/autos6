// Smooth replacement for the wrinkled, texture-baked roof box in the import.
// World coordinates refer to the 4.797 m preview BEFORE chassis calibration.
// The caller should subsequently run the same geometric warp as the car.

export const IMPORTED_ROOFBOX = Object.freeze({
  centerX: -.743, centerZ: 0, halfLength: 1.055, halfWidth: .540,
  seamY: 1.545, lidHeight: .305, baseDepth: .050,
  planExponent: 3.0, sectionExponent: 2.8, longitudeSegments: 128, latitudeSegments: 48,
});

const add = (a, b) => a.map((v, i) => v + b[i]);
const subtract = (a, b) => a.map((v, i) => v - b[i]);
const scale = (p, amount) => p.map(v => v * amount);
const dot = (a, b) => a.reduce((sum, v, i) => sum + v * b[i], 0);
const cross = (a, b) => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
const unit = p => scale(p, 1 / Math.max(Math.hypot(...p), 1e-12));
const power = (v, exponent) => Math.sign(v) * Math.abs(v) ** exponent;
const clamp = (v, lo, hi) => Math.max(lo, Math.min(hi, v));

function shellPoint(theta, phi) {
  const b = IMPORTED_ROOFBOX, p = 2 / b.sectionExponent;
  const radial = Math.abs(Math.cos(phi)) ** p;
  const px = b.halfLength * power(Math.cos(theta), 2 / b.planExponent) * radial;
  const pz = b.halfWidth * power(Math.sin(theta), 2 / b.planExponent) * radial;
  const nose = Math.max(0, px / b.halfLength);
  const seam = b.seamY - .010 * nose ** 2;
  const vertical = power(Math.sin(phi), p);
  const y = seam + (vertical >= 0 ? b.lidHeight * (1 - .18 * nose ** 2) : b.baseDepth) * vertical;
  return [b.centerX + px, y, b.centerZ + pz * (1 - .12 * nose ** 2)];
}

function shellNormal(theta, phi) {
  if (Math.abs(phi) >= Math.PI / 2 - 1e-8) return [0, Math.sign(phi), 0];
  const e = 1e-5;
  const du = subtract(shellPoint(theta + e, phi), shellPoint(theta - e, phi));
  const dv = subtract(shellPoint(theta, Math.min(Math.PI / 2, phi + e)), shellPoint(theta, Math.max(-Math.PI / 2, phi - e)));
  return unit(cross(dv, du));
}

function smoothShell() {
  const b = IMPORTED_ROOFBOX, u = b.longitudeSegments, v = b.latitudeSegments;
  const positions = [], normals = [], indices = [];
  positions.push(...shellPoint(0, -Math.PI / 2)); normals.push(0, -1, 0);
  for (let j = 1; j < v; j++) {
    const phi = -Math.PI / 2 + Math.PI * j / v;
    for (let i = 0; i < u; i++) {
      const theta = i * Math.PI * 2 / u;
      positions.push(...shellPoint(theta, phi)); normals.push(...shellNormal(theta, phi));
    }
  }
  const top = positions.length / 3;
  positions.push(...shellPoint(0, Math.PI / 2)); normals.push(0, 1, 0);
  const oriented = (a, b, c) => {
    const pa = positions.slice(a * 3, a * 3 + 3);
    const face = cross(subtract(positions.slice(b * 3, b * 3 + 3), pa), subtract(positions.slice(c * 3, c * 3 + 3), pa));
    const normal = add(add(normals.slice(a * 3, a * 3 + 3), normals.slice(b * 3, b * 3 + 3)), normals.slice(c * 3, c * 3 + 3));
    if (dot(face, normal) >= 0) indices.push(a, b, c); else indices.push(a, c, b);
  };
  for (let i = 0; i < u; i++) oriented(0, 1 + i, 1 + (i + 1) % u);
  for (let j = 0; j < v - 2; j++) for (let i = 0; i < u; i++) {
    const a = 1 + j * u + i, b = 1 + j * u + (i + 1) % u, c = a + u, d = b + u;
    oriented(a, b, d); oriented(a, d, c);
  }
  const last = 1 + (v - 2) * u;
  for (let i = 0; i < u; i++) oriented(last + i, last + (i + 1) % u, top);
  return { positions, normals, indices };
}

function sweptTube(points, radius, sides = 8, closed = true) {
  const positions = [], normals = [], indices = [], count = points.length;
  for (let i = 0; i < count; i++) {
    const prev = points[closed ? (i - 1 + count) % count : Math.max(0, i - 1)];
    const next = points[closed ? (i + 1) % count : Math.min(count - 1, i + 1)];
    const tangent = unit(subtract(next, prev));
    const reference = Math.abs(tangent[1]) < .90 ? [0, 1, 0] : [1, 0, 0];
    const axisA = unit(cross(tangent, reference)), axisB = unit(cross(tangent, axisA));
    for (let side = 0; side < sides; side++) {
      const angle = side * Math.PI * 2 / sides;
      const n = add(scale(axisA, Math.cos(angle)), scale(axisB, Math.sin(angle)));
      positions.push(...add(points[i], scale(n, radius))); normals.push(...n);
    }
  }
  for (let i = 0; i < (closed ? count : count - 1); i++) for (let side = 0; side < sides; side++) {
    const a = i * sides + side, b = i * sides + (side + 1) % sides;
    const c = ((i + 1) % count) * sides + side, d = ((i + 1) % count) * sides + (side + 1) % sides;
    indices.push(a, c, d, a, d, b);
  }
  return { positions, normals, indices };
}

function roundedBlock(center, size, exponent = 4) {
  const positions = [], normals = [], indices = [], u = 24, v = 12, p = 2 / exponent;
  for (let j = 0; j <= v; j++) for (let i = 0; i <= u; i++) {
    const phi = -Math.PI / 2 + j * Math.PI / v, theta = i * Math.PI * 2 / u;
    const q = [power(Math.cos(phi), p) * power(Math.cos(theta), p), power(Math.sin(phi), p), power(Math.cos(phi), p) * power(Math.sin(theta), p)];
    positions.push(...q.map((value, axis) => center[axis] + value * size[axis] / 2));
    normals.push(...unit(q.map((value, axis) => power(value, exponent - 1) / size[axis])));
  }
  for (let j = 0; j < v; j++) for (let i = 0; i < u; i++) {
    const a = j * (u + 1) + i, b = a + 1, c = a + u + 1, d = c + 1;
    if (j > 0) indices.push(a, d, b);
    if (j < v - 1) indices.push(a, c, d);
  }
  return { positions, normals, indices };
}

function mergeGeometry(parts) {
  const result = { positions: [], normals: [], indices: [] };
  for (const part of parts) {
    const offset = result.positions.length / 3;
    result.positions.push(...part.positions); result.normals.push(...part.normals);
    result.indices.push(...part.indices.map(i => i + offset));
  }
  return result;
}

function sideWidth(x) {
  const b = IMPORTED_ROOFBOX, f = clamp((x - b.centerX) / b.halfLength, -1, 1);
  return b.halfWidth * Math.max(0, 1 - Math.abs(f) ** b.planExponent) ** (1 / b.planExponent) * (1 - .12 * Math.max(0, f) ** 2);
}

function rearSurfaceX(y, z) {
  const b = IMPORTED_ROOFBOX, p = 2 / b.sectionExponent;
  const vertical = clamp((y - b.seamY) / b.lidHeight, 0, .999);
  const phi = Math.asin(vertical ** (1 / p)), radial = Math.cos(phi) ** p;
  const remaining = Math.max(0, 1 - Math.abs(z / (b.halfWidth * radial)) ** b.planExponent);
  return b.centerX - b.halfLength * radial * remaining ** (1 / b.planExponent);
}

function audiRings() {
  const positions = [], normals = [], indices = [], ringRadius = .026, tube = .0022, around = 56, section = 8;
  for (let ring = 0; ring < 4; ring++) {
    const cz = (ring - 1.5) * ringRadius * 1.38, cy = 1.655;
    const start = positions.length / 3;
    for (let i = 0; i < around; i++) {
      const angle = i * Math.PI * 2 / around;
      const radial = [0, Math.sin(angle), Math.cos(angle)];
      const centerY = cy + ringRadius * .75 * Math.sin(angle), centerZ = cz + ringRadius * Math.cos(angle);
      const center = [rearSurfaceX(centerY, centerZ) - .0032, centerY, centerZ];
      for (let j = 0; j < section; j++) {
        const phi = j * Math.PI * 2 / section;
        const n = [-Math.cos(phi), radial[1] * Math.sin(phi), radial[2] * Math.sin(phi)];
        positions.push(...add(center, scale(n, tube))); normals.push(...n);
      }
    }
    for (let i = 0; i < around; i++) for (let j = 0; j < section; j++) {
      const a = start + i * section + j, b = start + i * section + (j + 1) % section;
      const c = start + ((i + 1) % around) * section + j, d = start + ((i + 1) % around) * section + (j + 1) % section;
      indices.push(a, c, d, a, d, b);
    }
  }
  return { positions, normals, indices };
}

/** Replace the partitioned roof part; original shared shell attributes remain intact. */
export function replaceImportedCarRoofbox(document, roofNode, { buffer, clearcoatExtension } = {}) {
  if (!roofNode?.getMesh()) throw new Error('A partitioned roof-box mesh node is required.');
  const root = document.getRoot(); buffer ??= root.listBuffers()[0] ?? document.createBuffer('Imported Audi | roof box buffer');
  const oldMesh = roofNode.getMesh(), removedTriangles = oldMesh.listPrimitives().reduce((sum, p) => sum + (p.getIndices()?.getCount() ?? p.getAttribute('POSITION').getCount()) / 3, 0);
  const shell = document.createMaterial('Imported Audi | gloss black roof box')
    .setBaseColorFactor([.0035, .0045, .0060, 1]).setMetallicFactor(.24).setRoughnessFactor(.065);
  const rubber = document.createMaterial('Imported Audi | roof box lid gasket')
    .setBaseColorFactor([.0015, .002, .0025, 1]).setMetallicFactor(.02).setRoughnessFactor(.42);
  const hardware = document.createMaterial('Imported Audi | roof box latch hardware')
    .setBaseColorFactor([.11, .12, .135, 1]).setMetallicFactor(.85).setRoughnessFactor(.22);
  const chrome = document.createMaterial('Imported Audi | polished chrome roof box rings')
    .setBaseColorFactor([.70, .73, .77, 1]).setMetallicFactor(1).setRoughnessFactor(.10);
  if (clearcoatExtension) shell.setExtension('KHR_materials_clearcoat', clearcoatExtension.createClearcoat().setClearcoatFactor(1).setClearcoatRoughnessFactor(.025));

  function makeMesh(name, geometry, material) {
    const prefix = `Imported Audi | roof box | ${name}`;
    // Every detail is closed and single-sided. Align winding with its explicit
    // smooth normals, including the torus paths and the rounded clamp caps.
    for (let i = 0; i < geometry.indices.length; i += 3) {
      const a = geometry.indices[i], b = geometry.indices[i + 1], c = geometry.indices[i + 2];
      const pa = geometry.positions.slice(a * 3, a * 3 + 3);
      const face = cross(subtract(geometry.positions.slice(b * 3, b * 3 + 3), pa), subtract(geometry.positions.slice(c * 3, c * 3 + 3), pa));
      const n = add(add(geometry.normals.slice(a * 3, a * 3 + 3), geometry.normals.slice(b * 3, b * 3 + 3)), geometry.normals.slice(c * 3, c * 3 + 3));
      if (dot(face, n) < 0) { geometry.indices[i + 1] = c; geometry.indices[i + 2] = b; }
    }
    const position = document.createAccessor(`${prefix} positions`).setType('VEC3').setArray(new Float32Array(geometry.positions)).setBuffer(buffer);
    const normal = document.createAccessor(`${prefix} normals`).setType('VEC3').setArray(new Float32Array(geometry.normals)).setBuffer(buffer);
    const indices = document.createAccessor(`${prefix} indices`).setType('SCALAR').setArray(new Uint16Array(geometry.indices)).setBuffer(buffer);
    const primitive = document.createPrimitive().setAttribute('POSITION', position).setAttribute('NORMAL', normal).setIndices(indices).setMaterial(material);
    return document.createMesh(prefix).addPrimitive(primitive);
  }
  roofNode.setName('Imported Audi | smooth roof-box shell').setMesh(makeMesh('smooth aero shell', smoothShell(), shell))
    .setExtras({ ...roofNode.getExtras(), category: 'car', partId: 'roof-box', surface: 'smooth untextured clearcoat shell' });
  oldMesh.dispose();
  const points = Array.from({ length: 192 }, (_, i) => {
    const theta = i * Math.PI * 2 / 192;
    return add(shellPoint(theta, 0), scale(shellNormal(theta, 0), .0011));
  });
  const clamps = [], latches = [];
  for (const x of [-1.23, -.10]) for (const sign of [-1, 1]) {
    clamps.push(roundedBlock([x, 1.490, sign * .385], [.125, .045, .075], 3.6));
  }
  for (const x of [-1.38, -.13]) for (const sign of [-1, 1]) {
    const z = sign * (sideWidth(x) + .003);
    latches.push(roundedBlock([x, 1.571, z], [.050, .033, .014], 3.8));
  }
  const details = [
    ['lid seam', sweptTube(points, .0024, 8), rubber],
    ['underside clamps', mergeGeometry(clamps), rubber],
    ['metal latches', mergeGeometry(latches), hardware],
    ['Audi rings', audiRings(), chrome],
  ];
  const nodes = [roofNode];
  for (const [name, geometry, material] of details) {
    const node = document.createNode(`Imported Audi | roof box | ${name}`).setMesh(makeMesh(name, geometry, material))
      .setExtras({ category: 'car', partId: 'roof-box', surface: name });
    roofNode.addChild(node); nodes.push(node);
  }
  // Plain release metadata: document/node/material objects would introduce
  // cycles when the caller embeds this report in its JSON manifest.
  return { meshes: nodes.length, removedTriangles,
    triangles: nodes.reduce((sum, node) => sum + node.getMesh().listPrimitives()[0].getIndices().getCount() / 3, 0),
    shape: IMPORTED_ROOFBOX, finish: 'Smooth untextured black PBR shell with clearcoat; separate lid seam, clamps, latches and chrome rings' };
}
