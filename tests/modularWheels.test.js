import { describe, expect, it } from 'vitest';
import { Document } from '@gltf-transform/core';
import * as functions from '@gltf-transform/functions';
import { batchWheelComponents, removeImportedRunningGear } from '../scripts/imported-car-running-gear.mjs';

describe('Blender running-gear integration', () => {
  it('removes the generated wheel surface while preserving the painted arch', () => {
    const doc = new Document(), buffer = doc.createBuffer();
    const positions = doc.createAccessor('', buffer).setType('VEC3').setArray(new Float32Array([
      1.4, .323, .9, 1.41, .323, .9, 1.4, .333, .9,
      1.4, .68, .91, 1.41, .68, .91, 1.4, .69, .91,
    ]));
    const primitive = doc.createPrimitive().setAttribute('POSITION', positions).setIndices(doc.createAccessor('', buffer).setType('SCALAR').setArray(new Uint16Array([0, 1, 2, 3, 4, 5])));
    const node = doc.createNode().setMesh(doc.createMesh().addPrimitive(primitive)).setExtras({ partId: 'wheels' });
    const result = removeImportedRunningGear(doc);
    expect(result.removedTriangles).toBe(1);
    expect([...primitive.getIndices().getArray()]).toEqual([3, 4, 5]);
    expect(node.getExtras().partId).toBe('body');
  });

  it('bakes hand-edited part locations when batching without changing linked source meshes', () => {
    const doc = new Document(), buffer = doc.createBuffer(), material = doc.createMaterial();
    const position = doc.createAccessor('', buffer).setType('VEC3').setArray(new Float32Array([0, 0, 0, 1, 0, 0, 0, 1, 0]));
    const source = new Float32Array(position.getArray());
    const primitive = doc.createPrimitive().setMaterial(material).setAttribute('POSITION', position).setIndices(doc.createAccessor('', buffer).setType('SCALAR').setArray(new Uint16Array([0, 1, 2])));
    const mesh = doc.createMesh().addPrimitive(primitive);
    const parent = doc.createNode().setExtras({ assemblyId: 'wheel-fl', wheelCorner: 'FL' });
    for (const x of [1, 3]) parent.addChild(doc.createNode().setMesh(mesh).setTranslation([x, 0, 0]).setExtras({ componentId: 'caliper', partId: 'brake-kit', wheelCorner: 'FL' }));
    expect(batchWheelComponents(doc, functions)).toEqual({ separateBlenderObjects: 2, webComponentMeshes: 1 });
    expect(parent.listChildren()).toHaveLength(1);
    const result = parent.listChildren()[0].getMesh().listPrimitives()[0].getAttribute('POSITION');
    expect(result.getMin([])[0]).toBe(1);
    expect(result.getMax([])[0]).toBe(4);
    expect(position.getArray()).toEqual(source);
  });
});
