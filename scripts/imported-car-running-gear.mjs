// Remove the generated tyres/rims/calipers while retaining painted arch lips.
// Call on the calibrated, world-baked imported geometry before adding modules.
export function removeImportedRunningGear(document) {
  const removed = {}, keep = [];
  for (const node of document.getRoot().listNodes()) {
    const mesh = node.getMesh(), part = node.getExtras().partId;
    if (!mesh || !part || part === 'roof-box' || node.getExtras().surface === 'glass') continue;
    for (const primitive of [...mesh.listPrimitives()]) {
      const xyz = primitive.getAttribute('POSITION').getArray(), index = primitive.getIndices();
      const source = index.getArray(); keep.length = 0;
      for (let offset = 0; offset < source.length; offset += 3) {
        const ids = [source[offset], source[offset + 1], source[offset + 2]];
        const [x, y, z] = [0, 1, 2].map(axis => ids.reduce((sum, id) => sum + xyz[id * 3 + axis] / 3, 0));
        const axle = Math.abs(x - 1.4) < Math.abs(x + 1.359) ? 1.4 : -1.359;
        const inside = Math.abs(z) > .63 && Math.hypot(x - axle, y - .323) < .334;
        if (inside || part === 'brake-kit') removed[part] = (removed[part] ?? 0) + 1;
        else keep.push(...ids);
      }
      if (!keep.length) { mesh.removePrimitive(primitive); primitive.dispose(); }
      else index.setArray(new Uint32Array(keep));
    }
    if (part === 'wheels') node.setName('Imported Audi | preserved wheel arches').setExtras({ ...node.getExtras(), partId: 'body' });
    if (!mesh.listPrimitives().length) { node.setMesh(null); mesh.dispose(); }
  }
  return { removedTriangles: Object.values(removed).reduce((sum, count) => sum + count, 0), parts: removed, cutRadiusMetres: .334 };
}

// The native Blender file keeps every machining detail separate. The web GLB
// batches details of the same component/material while preserving component IDs.
export function batchWheelComponents(document, functions) {
  const cache = new Map(), propertyIds = new Map();
  const id = property => { if (!propertyIds.has(property)) propertyIds.set(property, propertyIds.size); return propertyIds.get(property); };
  let before = 0, after = 0;
  for (const parent of document.getRoot().listNodes().filter(node => node.getExtras().assemblyId)) {
    const groups = new Map();
    for (const node of parent.listChildren()) {
      if (!node.getMesh()) continue;
      const data = node.getExtras(), primitives = node.getMesh().listPrimitives();
      const format = primitives.map(p => `${id(p.getMaterial())}:${p.listSemantics().sort().join(',')}`).join('|');
      const key = `${data.componentId}:${data.tyreVariant ?? ''}:${format}`;
      if (!groups.has(key)) groups.set(key, []);
      groups.get(key).push(node); before++;
    }
    for (const [key, nodes] of groups) {
      after++;
      if (nodes.length < 2 || nodes.some(node => node.getMesh().listPrimitives().length !== 1)) continue;
      const cacheKey = `${key}:${nodes.map(node => `${id(node.getMesh())}:${node.getMatrix().join(',')}`).join('|')}`;
      let mesh = cache.get(cacheKey);
      if (!mesh) {
        const primitives = nodes.map(node => {
          const primitive = node.getMesh().listPrimitives()[0].clone();
          functions.compactPrimitive(primitive);
          functions.transformPrimitive(primitive, node.getMatrix());
          return primitive;
        });
        mesh = document.createMesh(`Blender | ${key}`).addPrimitive(functions.joinPrimitives(primitives));
        primitives.forEach(primitive => primitive.dispose());
        cache.set(cacheKey, mesh);
      }
      const grouped = document.createNode(`Blender | ${parent.getExtras().wheelCorner} | ${key}`)
        .setMesh(mesh).setExtras(nodes[0].getExtras());
      parent.addChild(grouped);
      for (const node of nodes) { parent.removeChild(node); node.dispose(); }
    }
  }
  return { separateBlenderObjects: before, webComponentMeshes: after };
}
