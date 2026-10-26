// Offline panel finish for the uploaded Audi. Run after semantic partition and
// surface cleanup, before the wheel/chassis calibration. Textured trim keeps its
// original geometry and UVs; only classified paint gets a clean PBR surface.
const POSITION_TOLERANCE = 1e-5;
const MAX_EDGE_CORRECTION = .003;

const triangleKey = (a, b, c) => `${a},${b},${c}`;
const edgeKey = (a, b) => a < b ? `${a}:${b}` : `${b}:${a}`;
const unit = (vector, fallback = [0, 1, 0]) => {
  const length = Math.hypot(...vector);
  return length > 1e-12 ? vector.map(value => value / length) : [...fallback];
};
const pointKey = (array, offset) => [0, 1, 2].map(axis => Math.round(array[offset + axis] / POSITION_TOLERANCE)).join(',');

/**
 * @param {import('@gltf-transform/core').Document} document
 * @param {import('@gltf-transform/core').Node[]} partNodes
 * @param {{paintTriangleKeys:Set<string>,clearcoatExtension?:object,paintMaterial?:object}} options
 * @returns {{material:object,geometryStats:object}}
 */
export function finishImportedCarPaint(document, partNodes, { paintTriangleKeys, clearcoatExtension, paintMaterial } = {}) {
  if (!(paintTriangleKeys instanceof Set)) throw new Error('Paint finishing needs the classified source triangle keys.');
  const material = paintMaterial ?? document.createMaterial('Imported Audi | polished blue paint')
    .setBaseColorFactor([.008, .027, .085, 1])
    .setMetallicFactor(.68).setRoughnessFactor(.18).setDoubleSided(false);
  if (!paintMaterial && clearcoatExtension) material.setExtension('KHR_materials_clearcoat', clearcoatExtension.createClearcoat()
    .setClearcoatFactor(1).setClearcoatRoughnessFactor(.035));

  const canonical = new Map(), vertices = [], edges = new Map(), jobs = [];
  const attributeIds = new Map();
  const canonicalId = (position, normal, index) => {
    const xyz = position.getArray(), nrm = normal?.getArray();
    const key = pointKey(xyz, index * 3);
    let vertex = canonical.get(key);
    if (!vertex) {
      vertex = { id: vertices.length, point: Array.from(xyz.subarray(index * 3, index * 3 + 3)), normalSum: [0, 0, 0], samples: new Set(), normal: null };
      canonical.set(key, vertex); vertices.push(vertex);
    }
    if (nrm) {
      if (!attributeIds.has(normal)) attributeIds.set(normal, attributeIds.size);
      const sample = `${attributeIds.get(normal)}:${index}`;
      if (!vertex.samples.has(sample)) {
        vertex.samples.add(sample);
        for (let axis = 0; axis < 3; axis++) vertex.normalSum[axis] += nrm[index * 3 + axis];
      }
    }
    return vertex.id;
  };
  let paintTrianglesBefore = 0, trimTriangles = 0;
  for (const node of partNodes) {
    const mesh = node.getMesh();
    if (!mesh) continue;
    const part = node.getExtras().partId ?? 'body';
    for (const primitive of [...mesh.listPrimitives()]) {
      const position = primitive.getAttribute('POSITION'), normal = primitive.getAttribute('NORMAL');
      const uv = primitive.getAttribute('TEXCOORD_0');
      let uvValues = null;
      if (uv) {
        uvValues = new Float32Array(uv.getCount() * 2);
        const element = [];
        for (let i = 0; i < uv.getCount(); i++) { uv.getElement(i, element); uvValues.set(element, i * 2); }
      }
      if (material.getBaseColorTexture() && !uv) throw new Error('A textured paint finish needs original texture coordinates.');
      const index = primitive.getIndices();
      if (!position || !index || primitive.getMode() !== 4) continue;
      if (!(position.getArray() instanceof Float32Array) || position.getNormalized()) throw new Error('Paint geometry needs world-space Float32 positions.');
      if (normal && (!(normal.getArray() instanceof Float32Array) || normal.getNormalized())) throw new Error('Paint geometry needs Float32 normals.');
      const source = index.getArray(), paint = [], trim = [];
      const idCache = new Map();
      const id = index => {
        if (!idCache.has(index)) idCache.set(index, canonicalId(position, normal, index));
        return idCache.get(index);
      };
      for (let offset = 0; offset < source.length; offset += 3) {
        const a = source[offset], b = source[offset + 1], c = source[offset + 2];
        const painted = part !== 'roof-box' && paintTriangleKeys.has(triangleKey(a, b, c));
        const ids = [id(a), id(b), id(c)];
        if (painted) { paint.push({ ids, source: [a, b, c] }); paintTrianglesBefore++; }
        else { trim.push(a, b, c); trimTriangles++; }
        for (let edge = 0; edge < 3; edge++) {
          const first = ids[edge], second = ids[(edge + 1) % 3], key = edgeKey(first, second);
          let record = edges.get(key);
          if (!record) { record = { a: first, b: second, paint: 0, trim: 0, midpoint: null }; edges.set(key, record); }
          if (painted) record.paint++; else record.trim++;
        }
      }
      jobs.push({ node, mesh, primitive, index, position, normal, uvValues, part, paint, trim });
    }
  }
  for (const vertex of vertices) vertex.normal = unit(vertex.normalSum);
  const boundaryVertices = new Set();
  for (const edge of edges.values()) {
    edge.linear = edge.trim !== 0 || edge.paint !== 2;
    if (edge.paint && edge.linear) { boundaryVertices.add(edge.a); boundaryVertices.add(edge.b); }
  }

  let curvedEdges = 0, linearEdges = 0, maxEdgeDisplacement = 0;
  function midpoint(first, second) {
    const record = edges.get(edgeKey(first, second));
    if (record.midpoint) return record.midpoint;
    const a = vertices[record.a], b = vertices[record.b];
    const point = a.point.map((value, axis) => (value + b.point[axis]) * .5);
    const normal = unit(a.normal.map((value, axis) => value + b.normal[axis]), a.normal);
    // A PN-triangle edge is a cubic Bezier whose end tangents lie in the
    // supplied normal planes. At t=.5 this is its closed-form correction.
    // Mixed paint/trim, exterior and nonmanifold edges stay exactly linear;
    // both materials therefore continue sharing an identical boundary.
    if (!record.linear) {
      const edge = b.point.map((value, axis) => value - a.point[axis]);
      const da = edge.reduce((sum, value, axis) => sum + value * a.normal[axis], 0);
      const db = edge.reduce((sum, value, axis) => sum + value * b.normal[axis], 0);
      const correction = a.normal.map((value, axis) => (b.normal[axis] * db - value * da) / 8);
      const length = Math.hypot(...correction), scale = length > MAX_EDGE_CORRECTION ? MAX_EDGE_CORRECTION / length : 1;
      for (let axis = 0; axis < 3; axis++) point[axis] += correction[axis] * scale;
      maxEdgeDisplacement = Math.max(maxEdgeDisplacement, length * scale); curvedEdges++;
    } else linearEdges++;
    record.midpoint = { point, normal };
    return record.midpoint;
  }

  const partPaintTriangles = {};
  for (const job of jobs) {
    if (!job.paint.length) continue;
    const points = [], normals = [], texcoords = [], indices = [], localVertices = new Map();
    const local = (key, data, uv) => {
      if (!localVertices.has(key)) {
        localVertices.set(key, points.length / 3); points.push(...data.point); normals.push(...data.normal);
        if (job.uvValues) texcoords.push(...uv);
      }
      return localVertices.get(key);
    };
    const originalNormal = index => job.normal ? unit(Array.from(job.normal.getArray().subarray(index * 3, index * 3 + 3))) : [0, 1, 0];
    const originalUv = index => job.uvValues ? Array.from(job.uvValues.subarray(index * 2, index * 2 + 2)) : null;
    const corner = (id, sourceIndex) => {
      const vertex = vertices[id];
      // The adjacent trim still uses the original normal field. Match it
      // exactly along their shared boundary, rather than introducing a new
      // averaged normal only on the refined side of that edge.
      const normal = boundaryVertices.has(id) ? originalNormal(sourceIndex) : vertex.normal;
      return local(`v${sourceIndex}`, { point: vertex.point, normal }, originalUv(sourceIndex));
    };
    const edgeVertex = (a, b, sourceA, sourceB) => {
      const record = edges.get(edgeKey(a, b)), middle = midpoint(a, b);
      const normal = record.linear ? unit(originalNormal(sourceA).map((value, axis) => value + originalNormal(sourceB)[axis])) : middle.normal;
      const uvA = originalUv(sourceA), uvB = originalUv(sourceB);
      const uv = uvA ? uvA.map((value, axis) => (value + uvB[axis]) / 2) : null;
      // Original indices retain separate UV islands at atlas seams. Geometry
      // midpoint positions remain canonical and identical on both islands.
      return local(`e${edgeKey(sourceA, sourceB)}`, { point: middle.point, normal }, uv);
    };
    for (const { ids: [a, b, c], source: [sourceA, sourceB, sourceC] } of job.paint) {
      const aa = corner(a, sourceA), bb = corner(b, sourceB), cc = corner(c, sourceC);
      const ab = edgeVertex(a, b, sourceA, sourceB);
      const bc = edgeVertex(b, c, sourceB, sourceC);
      const ca = edgeVertex(c, a, sourceC, sourceA);
      indices.push(aa, ab, ca, ab, bb, bc, ca, bc, cc, ab, bc, ca);
    }
    const buffer = job.position.getBuffer() ?? document.getRoot().listBuffers()[0];
    const painted = document.createPrimitive().setMode(4).setMaterial(material)
      .setAttribute('POSITION', document.createAccessor(`Imported Audi | ${job.part} smooth paint positions`, buffer).setType('VEC3').setArray(new Float32Array(points)))
      .setAttribute('NORMAL', document.createAccessor(`Imported Audi | ${job.part} smooth paint normals`, buffer).setType('VEC3').setArray(new Float32Array(normals)))
      .setIndices(document.createAccessor(`Imported Audi | ${job.part} smooth paint indices`, buffer).setType('SCALAR').setArray(new Uint32Array(indices)));
    if (job.uvValues) painted.setAttribute('TEXCOORD_0', document.createAccessor(`Imported Audi | ${job.part} smooth paint UV`, buffer).setType('VEC2').setArray(new Float32Array(texcoords)));
    job.mesh.addPrimitive(painted);
    partPaintTriangles[job.part] = (partPaintTriangles[job.part] ?? 0) + indices.length / 3;
    if (job.trim.length) job.index.setArray(new Uint32Array(job.trim));
    else { job.mesh.removePrimitive(job.primitive); job.primitive.dispose(); job.index.dispose(); }
  }
  return { material, geometryStats: {
    paintTrianglesBefore, paintTrianglesAfter: paintTrianglesBefore * 4, addedTriangles: paintTrianglesBefore * 3,
    trimTriangles, totalSourceTriangles: paintTrianglesBefore + trimTriangles,
    curvedEdges, linearEdges, maxEdgeDisplacement, canonicalVertices: vertices.length,
    positionWeldTolerance: POSITION_TOLERANCE, edgeCorrectionLimit: MAX_EDGE_CORRECTION,
    partPaintTriangles,
  } };
}
