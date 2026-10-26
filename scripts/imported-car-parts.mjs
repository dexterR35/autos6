// Offline semantic partition for the uploaded car. Input positions/normals must
// already be baked into metres, Y up, nose +X, with identity node transforms.
// Only index lists are split: all parts retain the exact source geometry, UVs,
// material and shared attribute accessors. No texture or visible seam is added.
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { existsSync } from 'node:fs';
import path from 'node:path';

export const IMPORTED_PART_IDS = ['body', 'brake-kit', 'exhaust', 'front-bumper', 'hood', 'rear-bumper', 'roof-box', 'side-skirts', 'wheels'];
export const IMPORTED_WHEEL_CENTERS = { front: [1.351, .323], rear: [-1.376, .323] };

function decodedAttribute(accessor) {
  const count = accessor.getCount(), size = accessor.getElementSize();
  const values = new Float32Array(count * size), element = [];
  for (let i = 0; i < count; i++) { accessor.getElement(i, element); values.set(element, i * size); }
  return values;
}

// The calipers are part of the single baked mesh. Geometry first restricts the
// search to the wheel discs, then the original red caliper texels identify the
// actual visible brake surface rather than assigning arbitrary spokes to it.
async function caliperSampler(material, cliPath) {
  const texture = material?.getBaseColorTexture(), encoded = texture?.getImage();
  if (!encoded) return null;
  let loader;
  // The pinned dev dependency (or the caller's explicit CLI), never the npx cache.
  const candidates = [cliPath, path.resolve('node_modules/@gltf-transform/cli/bin/cli.js')].filter(Boolean);
  for (const candidate of candidates) if (existsSync(candidate)) {
    try { loader = createRequire(path.resolve(candidate))('sharp'); break; } catch { /* Another local tool installation may contain it. */ }
  }
  if (!loader) return null;
  const { data, info } = await loader(encoded).resize({ width: 1024, height: 1024, fit: 'inside' }).removeAlpha().raw().toBuffer({ resolveWithObject: true });
  return (u, v) => {
    const x = Math.min(info.width - 1, Math.max(0, Math.round(u * (info.width - 1))));
    const y = Math.min(info.height - 1, Math.max(0, Math.round(v * (info.height - 1))));
    const offset = (y * info.width + x) * info.channels;
    const r = data[offset], g = data[offset + 1], b = data[offset + 2];
    return r > 55 && r > g * 1.40 && r > b * 1.30;
  };
}

/** Partition one baked primitive, preserving all source triangle indices. */
export async function partitionImportedCar(document, sourceNode, options = {}) {
  const sourceMesh = sourceNode.getMesh();
  assert.ok(sourceMesh, 'The imported car source node needs a mesh.');
  assert.equal(sourceMesh.listPrimitives().length, 1, 'Review multi-primitive imported cars before partitioning.');
  const primitive = sourceMesh.listPrimitives()[0];
  assert.equal(primitive.getMode(), 4, 'The imported car must use triangle faces.');
  const position = primitive.getAttribute('POSITION');
  assert.equal(position.getComponentType(), 5126, 'Bake and dequantize the source positions before partitioning.');
  const xyz = position.getArray(), uv = primitive.getAttribute('TEXCOORD_0');
  const texcoords = uv ? decodedAttribute(uv) : null;
  const indices = primitive.getIndices()?.getArray() ?? Uint32Array.from({ length: position.getCount() }, (_, i) => i);
  const material = primitive.getMaterial();
  const isRedCaliper = await caliperSampler(material, options.cliPath);
  const centers = options.wheelCenters ?? IMPORTED_WHEEL_CENTERS;
  const buckets = Object.fromEntries(IMPORTED_PART_IDS.map((part) => [part, []]));
  const surfaces = Object.fromEntries(IMPORTED_PART_IDS.map((part) => [part, []]));
  const wheelRadius = options.wheelRadii ?? [.415, .350];
  function classify(x, y, z, a, b, c) {
    const az = Math.abs(z);
    if (y > 1.485 && x > -1.92 && x < .48) return 'roof-box';
    const center = Math.abs(x - centers.front[0]) < Math.abs(x - centers.rear[0]) ? centers.front : centers.rear;
    const dx = x - center[0], dy = y - center[1];
    const radial = (dx / wheelRadius[0]) ** 2 + (dy / wheelRadius[1]) ** 2;
    if (az > .68 && y < .745 && radial < 1.12) {
      if (isRedCaliper && texcoords && radial < .72 && az < 1.01) {
        const u = (texcoords[a * 2] + texcoords[b * 2] + texcoords[c * 2]) / 3;
        const v = (texcoords[a * 2 + 1] + texcoords[b * 2 + 1] + texcoords[c * 2 + 1]) / 3;
        if (isRedCaliper(u, v)) return 'brake-kit';
      }
      return 'wheels';
    }
    if (x < -2.19 && y > .175 && y < .335 && az > .43 && az < .77) return 'exhaust';
    if (x > 1.02 && x < 2.28 && y > .735 && y < 1.06 && az < .73) return 'hood';
    if ((x > 1.83 && y < .74) || (x > 2.13 && y < .91)) return 'front-bumper';
    if (x < -2.045 && y < .76) return 'rear-bumper';
    if (x > centers.rear[0] + .34 && x < centers.front[0] - .34 && y < .355 && az > .70) return 'side-skirts';
    return 'body';
  }
  for (let offset = 0; offset < indices.length; offset += 3) {
    const a = indices[offset], b = indices[offset + 1], c = indices[offset + 2];
    const x = (xyz[a * 3] + xyz[b * 3] + xyz[c * 3]) / 3;
    const y = (xyz[a * 3 + 1] + xyz[b * 3 + 1] + xyz[c * 3 + 1]) / 3;
    const z = (xyz[a * 3 + 2] + xyz[b * 3 + 2] + xyz[c * 3 + 2]) / 3;
    const part = classify(x, y, z, a, b, c);
    buckets[part].push(a, b, c);
    surfaces[part].push([x, y, z]);
  }
  // No invented brake geometry: missing caliper texels must be fixed in the
  // source or classifier, not hidden by assigning a random body patch to them.
  assert.ok(buckets['brake-kit'].length, 'No visible red calipers were identified in the uploaded wheel surfaces.');
  const buffer = position.getBuffer();
  const partNodes = [], counts = {};
  sourceNode.setMesh(null);
  for (const part of IMPORTED_PART_IDS) {
    assert.ok(buckets[part].length > 0, `The imported model has no ${part} surface.`);
    const split = document.createPrimitive().setMode(4).setMaterial(material)
      .setIndices(document.createAccessor(`Imported Audi | ${part} triangle indices`, buffer).setType('SCALAR').setArray(new Uint32Array(buckets[part])));
    for (const semantic of primitive.listSemantics()) split.setAttribute(semantic, primitive.getAttribute(semantic));
    const mesh = document.createMesh(`Imported Audi | ${part}`).addPrimitive(split);
    const node = document.createNode(`Imported Audi | ${part}`).setMesh(mesh).setExtras({ category: 'car', partId: part, source: 'User-provided textured mesh' });
    sourceNode.addChild(node);partNodes.push(node);counts[part] = buckets[part].length / 3;
  }
  const oldIndices = primitive.getIndices();
  primitive.dispose();sourceMesh.dispose();oldIndices?.dispose();
  assert.equal(Object.values(counts).reduce((a, b) => a + b, 0), indices.length / 3, 'The semantic partition must preserve every source triangle.');
  const targets = {
    'roof-box': [[[-.65, 1.84, 0], [0, 1, 0]], [[-.5, 1.65, .53], [0, 0, 1]], [[-.5, 1.65, -.53], [0, 0, -1]]],
    hood: [[[1.70, .88, 0], [0, 1, 0]]],
    'front-bumper': [[[2.36, .46, .42], [1, 0, 0]], [[2.36, .46, -.42], [1, 0, 0]]],
    wheels: [[[centers.front[0], centers.front[1], .94], [0, 0, 1]], [[centers.front[0], centers.front[1], -.94], [0, 0, -1]]],
    'brake-kit': [[[centers.rear[0], centers.rear[1], .95], [0, 0, 1]], [[centers.rear[0], centers.rear[1], -.95], [0, 0, -1]]],
    'side-skirts': [[[-.05, .26, .88], [0, 0, 1]], [[-.05, .26, -.88], [0, 0, -1]]],
    'rear-bumper': [[[-2.34, .50, .39], [-1, 0, 0]], [[-2.34, .50, -.39], [-1, 0, 0]]],
    exhaust: [[[-2.32, .255, .60], [-1, 0, 0]], [[-2.32, .255, -.60], [-1, 0, 0]]],
  };
  const anchors = {};
  for (const [part, candidates] of Object.entries(targets)) anchors[part] = candidates.map(([target, normal]) => {
    let best = null, distance = Infinity;
    for (const point of surfaces[part]) {
      const d = point.reduce((sum, value, axis) => sum + (value - target[axis]) ** 2, 0);
      if (d < distance) { distance = d; best = point; }
    }
    return { position: best, normal };
  });
  return { nodes: partNodes, parts: counts, anchors, sourceTriangles: indices.length / 3,
    classification: 'Spatial surface envelopes, with original red caliper texels restricted to wheel discs', wheelCenters: centers };
}
