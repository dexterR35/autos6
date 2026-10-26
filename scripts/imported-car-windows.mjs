// Glazing fitted to the apertures of the user's normalized Tripo Audi.
// Coordinates are metres, Y up, nose +X, BEFORE the release calibration warp.
// The window mesh nodes are identity transforms. The caller may deform them with
// the same map as the imported shell after this function returns.

const mirror = (p) => [p[0], p[1], -p[2]];
const add = (a, b) => a.map((value, axis) => value + b[axis]);
const subtract = (a, b) => a.map((value, axis) => value - b[axis]);
const scale = (p, amount) => p.map((value) => value * amount);
const dot = (a, b) => a.reduce((sum, value, axis) => sum + value * b[axis], 0);
const cross = (a, b) => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
const normalize = (p) => scale(p, 1 / Math.max(Math.hypot(...p), 1e-12));
const lerp = (a, b, t) => a.map((value, axis) => value + (b[axis] - value) * t);

// Each quad is ordered lower/rear -> lower/front -> upper/front -> upper/rear
// for side panes. These points were fitted to world-space aperture lip vertices,
// not to the former procedural car's greenhouse (whose pillars differ).
const side = [
  {
    name: 'quarter', privacy: true,
    corners: [[-1.936, .943, .777], [-1.214, .935, .802], [-1.052, 1.302, .603], [-1.625, 1.287, .606]],
  },
  {
    name: 'rear door', privacy: true,
    corners: [[-1.191, .929, .797], [-.385, .914, .801], [-.447, 1.313, .609], [-1.020, 1.306, .608]],
  },
  {
    name: 'front door', privacy: false,
    corners: [[-.326, .898, .808], [.914, .874, .777], [.155, 1.281, .612], [-.328, 1.307, .610]],
  },
];

export const IMPORTED_GLASS_PANES = [
  {
    name: 'windscreen', privacy: false, crown: .016, normal: [.48, .87, 0], columns: 24, rows: 14,
    // Across the car from +Z to -Z, with the bonded cover beneath the black lip.
    corners: [[1.085, .861, .728], [1.085, .861, -.728], [.237, 1.292, -.570], [.237, 1.292, .570]],
    centerBow: [.025, .008, 0],
  },
  {
    name: 'rear window', privacy: true, crown: .012, normal: [-.62, .78, 0], columns: 22, rows: 13,
    corners: [[-2.171, .938, -.620], [-2.171, .938, .620], [-1.692, 1.316, .570], [-1.692, 1.316, -.570]],
    centerBow: [-.018, .006, 0],
  },
  ...side.flatMap((pane) => [
    { ...pane, name: `left ${pane.name}`, crown: .009, normal: [0, .43, .90], columns: 16, rows: 10 },
    { ...pane, name: `right ${pane.name}`, corners: pane.corners.map(mirror), crown: .009, normal: [0, .43, -.90], columns: 16, rows: 10 },
  ]),
];

function paneGeometry(pane) {
  const { corners, columns, rows } = pane;
  const outward = normalize(pane.normal);
  function point(u, v) {
    const lower = lerp(corners[0], corners[1], u);
    const upper = lerp(corners[3], corners[2], u);
    let p = lerp(lower, upper, v);
    const crown = Math.sin(Math.PI * u) * Math.sin(Math.PI * v) * pane.crown;
    p = add(p, scale(outward, crown));
    if (pane.centerBow) p = add(p, scale(pane.centerBow, Math.sin(Math.PI * u)));
    return p;
  }
  const positions = [], normals = [], indices = [];
  for (let row = 0; row <= rows; row++) for (let column = 0; column <= columns; column++) {
    const u = column / columns, v = row / rows;
    const pu = subtract(point(Math.min(1, u + 1e-4), v), point(Math.max(0, u - 1e-4), v));
    const pv = subtract(point(u, Math.min(1, v + 1e-4)), point(u, Math.max(0, v - 1e-4)));
    let normal = normalize(cross(pu, pv));
    if (dot(normal, outward) < 0) normal = scale(normal, -1);
    positions.push(...point(u, v));
    normals.push(...normal);
  }
  for (let row = 0; row < rows; row++) for (let column = 0; column < columns; column++) {
    const a = row * (columns + 1) + column, b = a + 1, c = a + columns + 2, d = a + columns + 1;
    const p = positions.slice(a * 3, a * 3 + 3);
    const edgeA = subtract(positions.slice(b * 3, b * 3 + 3), p);
    const edgeB = subtract(positions.slice(d * 3, d * 3 + 3), p);
    if (dot(cross(edgeA, edgeB), outward) >= 0) indices.push(a, b, c, a, c, d);
    else indices.push(a, c, b, a, d, c);
  }
  return { positions: new Float32Array(positions), normals: new Float32Array(normals), indices: new Uint16Array(indices) };
}

/** Add eight separate slightly crowned glazing meshes to a baked world-space car. */
export function addImportedCarWindows(document, { scene, buffer, clearcoatExtension } = {}) {
  const root = document.getRoot();
  scene ??= root.getDefaultScene() ?? root.listScenes()[0];
  if (!scene) throw new Error('The imported car needs a scene before adding glazing.');
  buffer ??= root.listBuffers()[0] ?? document.createBuffer('Imported Audi | glazing buffer');
  const front = document.createMaterial('Imported Audi | windscreen glass')
    .setBaseColorFactor([.018, .027, .035, .32]).setMetallicFactor(.10)
    .setRoughnessFactor(.075).setAlphaMode('BLEND').setDoubleSided(true);
  const privacy = document.createMaterial('Imported Audi | privacy glass')
    .setBaseColorFactor([.010, .016, .021, .58]).setMetallicFactor(.12)
    .setRoughnessFactor(.085).setAlphaMode('BLEND').setDoubleSided(true);
  if (clearcoatExtension) {
    for (const material of [front, privacy]) material.setExtension('KHR_materials_clearcoat',
      clearcoatExtension.createClearcoat().setClearcoatFactor(1).setClearcoatRoughnessFactor(.055));
  }
  const made = [];
  for (const pane of IMPORTED_GLASS_PANES) {
    const geometry = paneGeometry(pane), name = `Imported Audi | glass | ${pane.name}`;
    const position = document.createAccessor(`${name} positions`).setType('VEC3').setArray(geometry.positions).setBuffer(buffer);
    const normal = document.createAccessor(`${name} normals`).setType('VEC3').setArray(geometry.normals).setBuffer(buffer);
    const indices = document.createAccessor(`${name} indices`).setType('SCALAR').setArray(geometry.indices).setBuffer(buffer);
    const primitive = document.createPrimitive().setAttribute('POSITION', position).setAttribute('NORMAL', normal)
      .setIndices(indices).setMaterial(pane.privacy ? privacy : front);
    const mesh = document.createMesh(name).addPrimitive(primitive);
    const node = document.createNode(name).setMesh(mesh)
      .setExtras({ category: 'car', partId: 'body', surface: 'glass', pane: pane.name });
    scene.addChild(node);
    made.push(node);
  }
  return { nodes: made, materials: { front, privacy }, panes: IMPORTED_GLASS_PANES.length,
    triangles: made.reduce((sum, node) => sum + node.getMesh().listPrimitives()[0].getIndices().getCount() / 3, 0) };
}
