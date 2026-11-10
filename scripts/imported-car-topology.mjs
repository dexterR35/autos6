// Clean real duplicate/zero-area faces, then simplify within a bounded geometric
// error. Open borders stay locked so adjacent parts cannot open visible cracks.
export function removeRedundantCarFaces(document, { tolerance = 1e-6 } = {}) {
  let trianglesBefore = 0, duplicateFaces = 0, degenerateFaces = 0;
  const seen = new Set();
  for (const mesh of document.getRoot().listMeshes()) for (const primitive of mesh.listPrimitives()) {
    const position = primitive.getAttribute('POSITION'), index = primitive.getIndices();
    if (!position || !index || primitive.getMode() !== 4) continue;
    const xyz = position.getArray(), source = index.getArray(), kept = [];
    const pointKeys = new Map();
    const key = id => {
      if (!pointKeys.has(id)) pointKeys.set(id, [0, 1, 2].map(axis => Math.round(xyz[id * 3 + axis] / tolerance)).join(','));
      return pointKeys.get(id);
    };
    for (let offset = 0; offset < source.length; offset += 3) {
      trianglesBefore++;
      const a = source[offset], b = source[offset + 1], c = source[offset + 2];
      const ab = [0, 1, 2].map(axis => xyz[b * 3 + axis] - xyz[a * 3 + axis]);
      const ac = [0, 1, 2].map(axis => xyz[c * 3 + axis] - xyz[a * 3 + axis]);
      const area = Math.hypot(ab[1] * ac[2] - ab[2] * ac[1], ab[2] * ac[0] - ab[0] * ac[2], ab[0] * ac[1] - ab[1] * ac[0]);
      const corners = [key(a), key(b), key(c)];
      if (area < 1e-12 || new Set(corners).size !== 3) { degenerateFaces++; continue; }
      // Winding-independent: a reversed copy occupies the same surface too.
      const face = corners.sort().join('|');
      if (seen.has(face)) { duplicateFaces++; continue; }
      seen.add(face); kept.push(a, b, c);
    }
    if (kept.length !== source.length) index.setArray(new Uint32Array(kept));
  }
  return { trianglesBefore, trianglesAfter: trianglesBefore - duplicateFaces - degenerateFaces, duplicateFaces, degenerateFaces };
}

export async function optimizeImportedCarTopology(document, { functions, simplifier }) {
  const cleanup = removeRedundantCarFaces(document);
  await document.transform(functions.weld());
  const groups = {};
  for (const mesh of document.getRoot().listMeshes()) for (const primitive of mesh.listPrimitives()) {
    const name = primitive.getMaterial()?.getName() ?? '';
    const before = primitive.getIndices().getCount() / 3;
    if (before < 1200 || /glass|rings|latch|gasket|lamp/i.test(name)) continue;
    const paint = /pearl paint/.test(name), shell = /gloss black roof box/.test(name), cabin = /cabin and black grille/.test(name);
    // Paint is subdivided for curvature before this step, so its ratio only
    // matters where the error limit allows it. The cabin is seen through glass.
    functions.simplifyPrimitive(primitive, { simplifier, ratio: paint ? .22 : shell ? .45 : cabin ? .34 : .58, error: cabin ? .0007 : .00025, lockBorder: true });
    const after = primitive.getIndices().getCount() / 3;
    const group = groups[name] ??= { before: 0, after: 0 };
    group.before += before; group.after += after;
  }
  const finalCleanup = removeRedundantCarFaces(document);
  await document.transform(functions.prune());
  return { ...cleanup, trianglesAfter: finalCleanup.trianglesAfter, simplifiedFaces: cleanup.trianglesAfter - finalCleanup.trianglesBefore,
    finalDegenerateFaces: finalCleanup.degenerateFaces, finalDuplicateFaces: finalCleanup.duplicateFaces,
    relativeErrorLimit: .00025, lockedBorders: true, groups };
}
