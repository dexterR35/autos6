// Offline denoising of the uploaded car's painted shell. Work in world-baked
// metres before glazing, semantic partition and wheel calibration. UV islands
// are welded logically, so a geometric seam never opens during smoothing.
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { existsSync } from 'node:fs';
import path from 'node:path';

const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
const smoothstep = (a, b, v) => { const t = clamp((v - a) / (b - a), 0, 1); return t * t * (3 - 2 * t); };
const normalize = (a, offset) => {
  const length = Math.hypot(a[offset], a[offset + 1], a[offset + 2]);
  if (length > 1e-20) { a[offset] /= length; a[offset + 1] /= length; a[offset + 2] /= length; }
};
function decoded(accessor) {
  const size = accessor.getElementSize(), values = new Float32Array(accessor.getCount() * size), v = [];
  for (let i = 0; i < accessor.getCount(); i++) { accessor.getElement(i, v); values.set(v, i * size); }
  return values;
}
async function colourSampler(material, cliPath) {
  const image = material?.getBaseColorTexture()?.getImage();
  assert.ok(image, 'Paint cleanup requires the original colour texture.');
  // The pinned dev dependency (or the caller's explicit CLI), never the npx cache.
  const candidates = [cliPath, path.resolve('node_modules/@gltf-transform/cli/bin/cli.js')].filter(Boolean);
  let sharp;
  for (const candidate of candidates) if (existsSync(candidate)) { try { sharp = createRequire(path.resolve(candidate))('sharp'); break; } catch { /* Try the next installed tool. */ } }
  assert.ok(sharp, 'Pass cliPath for the locally installed glTF tools and Sharp image decoder.');
  const { data, info } = await sharp(image).resize(1024, 1024, { fit: 'inside' }).removeAlpha().raw().toBuffer({ resolveWithObject: true });
  return (u, v, out) => {
    const x = clamp(Math.round(u * (info.width - 1)), 0, info.width - 1), y = clamp(Math.round(v * (info.height - 1)), 0, info.height - 1);
    const offset = (y * info.width + x) * info.channels;
    out[0] = data[offset]; out[1] = data[offset + 1]; out[2] = data[offset + 2];
  };
}

function wheelRegion(x, y, z) {
  const axle = Math.abs(x - 1.351) < Math.abs(x + 1.376) ? 1.351 : -1.376;
  // Protect the measured tyre, not the larger semantic wheel-picking envelope:
  // the latter also contains the painted rolled arch that needs denoising.
  return Math.abs(z) > .63 && y < .69 && ((x - axle) / .385) ** 2 + ((y - .323) / .323) ** 2 < 1.025;
}
function paintDomain(x, y, z) {
  if (y < .16 || y > 1.455 || wheelRegion(x, y, z)) return false;
  return (Math.abs(z) > .67 && y < 1.40) || (x > .93 && y > .70) || (x < -1.96 && y > .38) || (y > 1.28 && Math.abs(z) < .68);
}

/** Mutate positions/normals only; return masks in unchanged triangle order. */
export async function prepareImportedCarSurfaces(document, sourceNode, options = {}) {
  const primitive = sourceNode.getMesh()?.listPrimitives()[0];
  assert.ok(primitive, 'The uploaded body primitive is missing.');
  const position = primitive.getAttribute('POSITION'), normal = primitive.getAttribute('NORMAL'), texcoord = primitive.getAttribute('TEXCOORD_0');
  assert.equal(position.getComponentType(), 5126, 'Dequantize and world-bake positions before shell cleanup.');
  assert.ok(normal && texcoord, 'The uploaded shell needs normals and UVs.');
  const xyz = position.getArray(), original = new Float32Array(xyz), normals = decoded(normal), uv = decoded(texcoord);
  const indices = primitive.getIndices().getArray(), faceCount = indices.length / 3, vertexCount = position.getCount();
  const colour = await colourSampler(primitive.getMaterial(), options.cliPath);
  const paintTriangleMask = new Uint8Array(faceCount), roofBoxTriangleMask = new Uint8Array(faceCount), roofGeometry = new Uint8Array(faceCount);
  const neutralCandidates = new Uint8Array(faceCount), geometryCandidates = new Uint8Array(faceCount), faceNormals = new Float32Array(faceCount * 3), areas = new Float32Array(faceCount);
  const weld = new Uint32Array(vertexCount), map = new Map(), points = [], groups = [], quantize = options.weldTolerance ?? 1e-5;
  for (let i = 0; i < vertexCount; i++) {
    const offset = i * 3, key = `${Math.round(xyz[offset] / quantize)},${Math.round(xyz[offset + 1] / quantize)},${Math.round(xyz[offset + 2] / quantize)}`;
    let group = map.get(key);
    if (group === undefined) { group = points.length / 3; map.set(key, group); points.push(xyz[offset], xyz[offset + 1], xyz[offset + 2]); groups.push([]); }
    weld[i] = group; groups[group].push(i);
  }
  const groupCount = groups.length, current = Float64Array.from(points), initial = Float64Array.from(points);
  const adjacency = Array.from({ length: groupCount }, () => []), faceNeighbours = Array.from({ length: faceCount }, () => []);
  const edgeMap = new Map(), pinned = new Uint8Array(groupCount), allArea = new Float64Array(groupCount), smoothArea = new Float64Array(groupCount);
  const geometricNormals = new Float64Array(groupCount * 3), rgb = [];
  let degenerate = 0;
  for (let face = 0; face < faceCount; face++) {
    const a = indices[face * 3], b = indices[face * 3 + 1], c = indices[face * 3 + 2], ai = a * 3, bi = b * 3, ci = c * 3;
    const x = (xyz[ai] + xyz[bi] + xyz[ci]) / 3, y = (xyz[ai + 1] + xyz[bi + 1] + xyz[ci + 1]) / 3, z = (xyz[ai + 2] + xyz[bi + 2] + xyz[ci + 2]) / 3;
    colour((uv[a * 2] + uv[b * 2] + uv[c * 2]) / 3, (uv[a * 2 + 1] + uv[b * 2 + 1] + uv[c * 2 + 1]) / 3, rgb);
    const [r, g, blue] = rgb, isBlue = blue > r * 1.27 && blue > g * 1.065 && blue - r > 12 && blue > 24;
    if (paintDomain(x, y, z) && isBlue) paintTriangleMask[face] = 1;
    const roof = y > 1.485 && x > -1.92 && x < .48;
    roofGeometry[face] = roof ? 1 : 0;
    if (roof && Math.max(r, g, blue) < 145) roofBoxTriangleMask[face] = 1;
    // Fill small grey highlight holes inside a blue patch, while retaining
    // chrome, white Audi lettering, red lamps and dark panel-gap texture.
    neutralCandidates[face] = paintDomain(x, y, z) && blue > r * .92 && blue > g * .93 && Math.max(r, g, blue) < 185 && blue > 35 ? 1 : 0;
    // Geometry cleanup must not inherit a binary material/colour boundary.
    // Pale photographed reflections on a panel belong to the same surface.
    geometryCandidates[face] = paintDomain(x, y, z) && blue > r * .79 && blue > g * .79 && Math.max(r, g, blue) > 24 ? 1 : 0;
    const abx = xyz[bi] - xyz[ai], aby = xyz[bi + 1] - xyz[ai + 1], abz = xyz[bi + 2] - xyz[ai + 2];
    const acx = xyz[ci] - xyz[ai], acy = xyz[ci + 1] - xyz[ai + 1], acz = xyz[ci + 2] - xyz[ai + 2];
    const nx = aby * acz - abz * acy, ny = abz * acx - abx * acz, nz = abx * acy - aby * acx, length = Math.hypot(nx, ny, nz);
    if (length < 1e-14) degenerate++;
    areas[face] = length * .5;
    faceNormals[face * 3] = nx / (length || 1); faceNormals[face * 3 + 1] = ny / (length || 1); faceNormals[face * 3 + 2] = nz / (length || 1);
    const ids = [weld[a], weld[b], weld[c]];
    for (const id of ids) { allArea[id] += length; geometricNormals[id * 3] += nx; geometricNormals[id * 3 + 1] += ny; geometricNormals[id * 3 + 2] += nz; }
    for (let k = 0; k < 3; k++) {
      const u = Math.min(ids[k], ids[(k + 1) % 3]), v = Math.max(ids[k], ids[(k + 1) % 3]);
      if (u === v) continue;
      const key = u * groupCount + v, edge = edgeMap.get(key);
      if (!edge) { edgeMap.set(key, { u, v, first: face, count: 1 }); adjacency[u].push(v); adjacency[v].push(u); }
      else {
        edge.count++;faceNeighbours[face].push(edge.first);faceNeighbours[edge.first].push(face);
        const i = edge.first * 3, j = face * 3;
        if (faceNormals[i] * faceNormals[j] + faceNormals[i + 1] * faceNormals[j + 1] + faceNormals[i + 2] * faceNormals[j + 2] < .30) { pinned[u] = 1; pinned[v] = 1; }
      }
    }
  }
  for (const edge of edgeMap.values()) if (edge.count !== 2) { pinned[edge.u] = 1; pinned[edge.v] = 1; }
  // Two face-neighbour passes absorb isolated light texels without flooding
  // through the trim into other materials on the one-piece source mesh.
  for (let pass = 0; pass < 2; pass++) {
    const additions = [];
    for (let face = 0; face < faceCount; face++) if (!paintTriangleMask[face] && neutralCandidates[face]) {
      let neighbours = 0;for (const other of faceNeighbours[face]) neighbours += paintTriangleMask[other];
      if (neighbours >= 2) additions.push(face);
    }
    for (const face of additions) paintTriangleMask[face] = 1;
  }
  const denoiseTriangleMask = new Uint8Array(paintTriangleMask);
  for (let pass = 0; pass < 4; pass++) {
    const additions = [];
    for (let face = 0; face < faceCount; face++) if (!denoiseTriangleMask[face] && geometryCandidates[face]) {
      for (const other of faceNeighbours[face]) {
        if (!denoiseTriangleMask[other]) continue;
        const i = face * 3, j = other * 3;
        const dot = faceNormals[i] * faceNormals[j] + faceNormals[i + 1] * faceNormals[j + 1] + faceNormals[i + 2] * faceNormals[j + 2];
        if (dot > .55) { additions.push(face); break; }
      }
    }
    for (const face of additions) denoiseTriangleMask[face] = 1;
  }
  for (let face = 0; face < faceCount; face++) if (denoiseTriangleMask[face] || roofGeometry[face]) {
    for (let k = 0; k < 3; k++) smoothArea[weld[indices[face * 3 + k]]] += areas[face] * 2;
  }
  for (let id = 0; id < groupCount; id++) normalize(geometricNormals, id * 3);
  const weight = new Float32Array(groupCount), active = [];
  for (let id = 0; id < groupCount; id++) {
    weight[id] = wheelRegion(initial[id * 3], initial[id * 3 + 1], initial[id * 3 + 2]) ? 0 : smoothstep(.55, .95, smoothArea[id] / (allArea[id] || 1));
    if (weight[id] > 0) active.push(id);
  }
  const neighbours = new Map(), projectionNormals = new Float64Array(geometricNormals);
  for (const id of active) {
    const set = new Set(adjacency[id]);for (const next of adjacency[id]) for (const other of adjacency[next]) set.add(other);set.delete(id);
    const list = [];
    for (const other of set) {
      const dot = geometricNormals[id * 3] * geometricNormals[other * 3] + geometricNormals[id * 3 + 1] * geometricNormals[other * 3 + 1] + geometricNormals[id * 3 + 2] * geometricNormals[other * 3 + 2];
      const distance = Math.hypot(initial[id * 3] - initial[other * 3], initial[id * 3 + 1] - initial[other * 3 + 1], initial[id * 3 + 2] - initial[other * 3 + 2]);
      if (dot > .45 && distance < .065) list.push([other, dot * dot / Math.max(.006, distance)]);
    }
    neighbours.set(id, list);
    let nx = geometricNormals[id * 3] * 40, ny = geometricNormals[id * 3 + 1] * 40, nz = geometricNormals[id * 3 + 2] * 40;
    for (const [other, w] of list) { nx += geometricNormals[other * 3] * w; ny += geometricNormals[other * 3 + 1] * w; nz += geometricNormals[other * 3 + 2] * w; }
    projectionNormals[id * 3] = nx;projectionNormals[id * 3 + 1] = ny;projectionNormals[id * 3 + 2] = nz;normalize(projectionNormals, id * 3);
  }
  const iterations = options.iterations ?? 18, maxDisplacement = options.maxDisplacement ?? .020, next = new Float64Array(current);
  for (let pass = 0; pass < iterations; pass++) {
    next.set(current);
    for (const id of active) {
      if (pinned[id]) continue;
      const list = neighbours.get(id), offset = id * 3;let x = 0, y = 0, z = 0, total = 0;
      for (const [other, w] of list) { x += current[other * 3] * w; y += current[other * 3 + 1] * w; z += current[other * 3 + 2] * w; total += w; }
      if (!total) continue;
      const dx = x / total - current[offset], dy = y / total - current[offset + 1], dz = z / total - current[offset + 2];
      const normalDistance = (dx * projectionNormals[offset] + dy * projectionNormals[offset + 1] + dz * projectionNormals[offset + 2]) * .48 * weight[id];
      next[offset] += normalDistance * projectionNormals[offset];next[offset + 1] += normalDistance * projectionNormals[offset + 1];next[offset + 2] += normalDistance * projectionNormals[offset + 2];
      const moved = Math.hypot(next[offset] - initial[offset], next[offset + 1] - initial[offset + 1], next[offset + 2] - initial[offset + 2]);
      if (moved > maxDisplacement) for (let axis = 0; axis < 3; axis++) next[offset + axis] = initial[offset + axis] + (next[offset + axis] - initial[offset + axis]) * maxDisplacement / moved;
    }
    current.set(next);
  }
  let movedVertices = 0, maxMoved = 0, sumMoved = 0, pinnedActive = 0;
  for (const id of active) {
    if (pinned[id]) pinnedActive++;
    const offset = id * 3, moved = Math.hypot(current[offset] - initial[offset], current[offset + 1] - initial[offset + 1], current[offset + 2] - initial[offset + 2]);
    maxMoved = Math.max(maxMoved, moved);sumMoved += moved;
    if (moved > 1e-6) movedVertices++;
    for (const vertex of groups[id]) { xyz[vertex * 3] = current[offset];xyz[vertex * 3 + 1] = current[offset + 1];xyz[vertex * 3 + 2] = current[offset + 2]; }
  }
  // Area-weighted geometric normals after denoising, filtered over the same
  // welded surface. Duplicated UV vertices get the same normal on smooth paint.
  const smoothNormals = new Float64Array(groupCount * 3);
  for (let face = 0; face < faceCount; face++) {
    const a = indices[face * 3] * 3, b = indices[face * 3 + 1] * 3, c = indices[face * 3 + 2] * 3;
    const abx = xyz[b] - xyz[a], aby = xyz[b + 1] - xyz[a + 1], abz = xyz[b + 2] - xyz[a + 2], acx = xyz[c] - xyz[a], acy = xyz[c + 1] - xyz[a + 1], acz = xyz[c + 2] - xyz[a + 2];
    const nx = aby * acz - abz * acy, ny = abz * acx - abx * acz, nz = abx * acy - aby * acx;
    for (let k = 0; k < 3; k++) { const offset = weld[indices[face * 3 + k]] * 3;smoothNormals[offset] += nx;smoothNormals[offset + 1] += ny;smoothNormals[offset + 2] += nz; }
  }
  for (let id = 0; id < groupCount; id++) normalize(smoothNormals, id * 3);
  const filtered = new Float64Array(smoothNormals);
  for (let pass = 0; pass < 4; pass++) {
    filtered.set(smoothNormals);
    for (const id of active) {
      const offset = id * 3;let x = smoothNormals[offset] * 60, y = smoothNormals[offset + 1] * 60, z = smoothNormals[offset + 2] * 60;
      for (const [other, w] of neighbours.get(id)) {
        const dot = smoothNormals[offset] * smoothNormals[other * 3] + smoothNormals[offset + 1] * smoothNormals[other * 3 + 1] + smoothNormals[offset + 2] * smoothNormals[other * 3 + 2];
        if (dot < .55) continue;const v = w * dot * dot;x += smoothNormals[other * 3] * v;y += smoothNormals[other * 3 + 1] * v;z += smoothNormals[other * 3 + 2] * v;
      }
      filtered[offset] = x;filtered[offset + 1] = y;filtered[offset + 2] = z;normalize(filtered, offset);
    }
    smoothNormals.set(filtered);
  }
  let normalsChanged = 0;
  for (const id of active) for (const vertex of groups[id]) {
    const offset = vertex * 3, s = id * 3, dot = normals[offset] * smoothNormals[s] + normals[offset + 1] * smoothNormals[s + 1] + normals[offset + 2] * smoothNormals[s + 2];
    if (dot < .60) continue; // Retain a true corner's own side of its split normal.
    const blend = .96 * weight[id];
    for (let axis = 0; axis < 3; axis++) normals[offset + axis] = normals[offset + axis] * (1 - blend) + smoothNormals[s + axis] * blend;
    normalize(normals, offset);normalsChanged++;
  }
  const buffer = position.getBuffer();
  primitive.setAttribute('NORMAL', document.createAccessor('Imported Audi | denoised shell normals', buffer).setType('VEC3').setArray(normals));
  assert.ok(xyz.every(Number.isFinite) && normals.every(Number.isFinite), 'Shell cleanup generated invalid geometry.');
  assert.ok(maxMoved <= maxDisplacement + 1e-8, 'Shell cleanup exceeded its movement cap.');
  let untouchedMoved = 0;for (let vertex = 0; vertex < vertexCount; vertex++) if (!weight[weld[vertex]]) for (let axis = 0; axis < 3; axis++) untouchedMoved = Math.max(untouchedMoved, Math.abs(xyz[vertex * 3 + axis] - original[vertex * 3 + axis]));
  assert.equal(untouchedMoved, 0, 'Trim and wheel geometry must remain unchanged.');
  return { paintTriangleMask, roofBoxTriangleMask, denoiseTriangleMask, stats: {
    sourceTriangles: faceCount, sourceVertices: vertexCount, weldedVertices: groupCount,
    paintTriangles: paintTriangleMask.reduce((sum, v) => sum + v, 0), roofBoxTriangles: roofBoxTriangleMask.reduce((sum, v) => sum + v, 0),
    denoiseTriangles: denoiseTriangleMask.reduce((sum, v) => sum + v, 0), geometryDilationRings: 4,
    smoothingGroups: active.length, pinnedGroups: pinnedActive, movedGroups: movedVertices,
    maxMovementMetres: maxMoved, meanMovementMetres: sumMoved / (active.length || 1), normalsUpdated: normalsChanged,
    iterations, maximumAllowedMovementMetres: maxDisplacement, originalDegenerateFaces: degenerate,
    method: 'Four-ring paint-region growth, two-ring normal-direction denoising; welded UV seams; hard-edge/boundary pins; area-weighted filtered normals',
  } };
}

export const smoothImportedCarSurfaces = prepareImportedCarSurfaces;
