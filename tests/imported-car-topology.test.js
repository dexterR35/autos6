import { describe, expect, it } from 'vitest';
import { Document } from '@gltf-transform/core';
import { removeRedundantCarFaces } from '../scripts/imported-car-topology.mjs';
import { fairImportedCarPanels } from '../scripts/imported-car-panels.mjs';

describe('imported Audi surface cleanup', () => {
  it('removes reversed duplicates across UV seams and degenerate faces without changing the surviving surface', () => {
    const document = new Document(), buffer = document.createBuffer();
    const position = document.createAccessor('', buffer).setType('VEC3').setArray(new Float32Array([
      0, 0, 0, 1, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 1, 0, 1, 1, 0,
    ]));
    const uv = document.createAccessor('', buffer).setType('VEC2').setArray(new Float32Array(14).fill(.5));
    const original = new Float32Array(position.getArray());
    const primitive = indices => document.createPrimitive().setAttribute('POSITION', position).setAttribute('TEXCOORD_0', uv)
      .setIndices(document.createAccessor('', buffer).setType('SCALAR').setArray(new Uint16Array(indices)));
    const first = primitive([0, 1, 2, 5, 4, 3, 0, 0, 1]);
    const second = primitive([1, 6, 2, 3, 4, 5]);
    document.createMesh().addPrimitive(first).addPrimitive(second);
    const report = removeRedundantCarFaces(document);
    expect(report).toEqual({ trianglesBefore: 5, trianglesAfter: 2, duplicateFaces: 2, degenerateFaces: 1 });
    expect([...first.getIndices().getArray()]).toEqual([0, 1, 2]);
    expect([...second.getIndices().getArray()]).toEqual([1, 6, 2]);
    expect(position.getArray()).toEqual(original);
    expect(first.getAttribute('TEXCOORD_0')).toBe(uv);
  });

  it('fairs a noisy bonnet with finite curved normals, a bounded displacement and fixed hard seams', () => {
    const points = [], normals = [], weights = [], pins = [];
    for (let row = 0; row <= 20; row++) for (let column = 0; column <= 30; column++) {
      const x = 1.03 + column / 30 * 1.12, z = -.68 + row / 20 * 1.36;
      const y = .93 - (x - 1.03) * .12 - z * z * .06;
      const noise = .004 * Math.sin(column * 2.7 + row * 1.9);
      points.push(x, y + noise, z); normals.push(.12, .99, z * .12); weights.push(1);
      pins.push(column === 0 || column === 30 ? 1 : 0);
    }
    const current = Float64Array.from(points), original = new Float64Array(current);
    const result = fairImportedCarPanels(current, original, Float64Array.from(normals), Float32Array.from(weights), Uint8Array.from(pins), .018);
    expect(result.report.find(panel => panel.panel === 'bonnet crown').moved).toBeGreaterThan(100);
    let before = 0, after = 0;
    for (let id = 0; id < weights.length; id++) {
      const offset = id * 3, x = current[offset], z = current[offset + 2];
      const expected = .93 - (x - 1.03) * .12 - z * z * .06;
      const displacement = Math.hypot(...[0, 1, 2].map(axis => current[offset + axis] - original[offset + axis]));
      expect(displacement).toBeLessThanOrEqual(.018);
      if (pins[id]) expect([...current.subarray(offset, offset + 3)]).toEqual([...original.subarray(offset, offset + 3)]);
      if (x > 1.2 && x < 1.96 && Math.abs(z) < .5) {
        before += Math.abs(original[offset + 1] - expected); after += Math.abs(current[offset + 1] - expected);
        const normal = result.normalTargets.subarray(offset, offset + 3);
        expect(normal.every(Number.isFinite)).toBe(true);
        expect(Math.hypot(...normal)).toBeCloseTo(1, 10);
      }
    }
    expect(after).toBeLessThan(before * .25);
  });
});
