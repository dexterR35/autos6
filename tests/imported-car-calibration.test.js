import { describe, expect, it } from 'vitest';
import {
  IMPORTED_CAR_CALIBRATION,
  calibrateImportedCar,
  mapImportedCarNormal,
  mapImportedCarPoint,
  mapImportedChassisX,
} from '../scripts/imported-car-calibration.mjs';

const { source, target } = IMPORTED_CAR_CALIBRATION;
const dot = (a, b) => a.reduce((sum, value, axis) => sum + value * b[axis], 0);
const cross = (a, b) => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
const unit = (vector) => vector.map((value) => value / Math.hypot(...vector));
function tangentAfterWarp(point, tangent, epsilon = 1e-5) {
  const plus = mapImportedCarPoint(point.map((value, axis) => value + tangent[axis] * epsilon));
  const minus = mapImportedCarPoint(point.map((value, axis) => value - tangent[axis] * epsilon));
  return plus.map((value, axis) => (value - minus[axis]) / (2 * epsilon));
}

describe('uploaded C5 car calibration', () => {
  it('rounds each elliptical tyre in place while matching the axle spacing and body length', () => {
    const axlePairs = [[source.rearAxle, target.rearAxle], [source.frontAxle, target.frontAxle]];
    for (const [oldAxle, newAxle] of axlePairs) for (const side of [-1, 1]) {
      for (let sample = 0; sample < 32; sample++) {
        const angle = sample / 32 * Math.PI * 2;
        const point = [oldAxle + Math.cos(angle) * source.wheelRadiusX,
          source.wheelCentreY + Math.sin(angle) * source.wheelRadiusY, side * .9];
        const mapped = mapImportedCarPoint(point);
        expect(Math.hypot(mapped[0] - newAxle, mapped[1] - source.wheelCentreY)).toBeCloseTo(source.wheelRadiusY, 8);
        expect(mapped[1]).toBe(point[1]);
        expect(Math.sign(mapped[2])).toBe(side);
      }
    }
    const rear = mapImportedCarPoint([source.rearAxle, source.wheelCentreY, .9]);
    const front = mapImportedCarPoint([source.frontAxle, source.wheelCentreY, .9]);
    expect(front[0] - rear[0]).toBeCloseTo(2.759, 10);
    expect(mapImportedChassisX(source.length / 2) - mapImportedChassisX(-source.length / 2)).toBeCloseTo(4.913, 10);
    expect(mapImportedCarPoint([0, 1.85, 0])[1]).toBe(1.85);
  });

  it('keeps the chassis monotone and smoothly joins the axle landmarks', () => {
    let previous = -Infinity;
    for (let x = -source.length / 2; x <= source.length / 2; x += .005) {
      const mapped = mapImportedChassisX(x);
      expect(mapped).toBeGreaterThan(previous);
      previous = mapped;
    }
    const epsilon = 1e-6;
    for (const axle of [source.rearAxle, source.frontAxle]) {
      const left = (mapImportedChassisX(axle) - mapImportedChassisX(axle - epsilon)) / epsilon;
      const right = (mapImportedChassisX(axle + epsilon) - mapImportedChassisX(axle)) / epsilon;
      expect(Math.abs(left - right)).toBeLessThan(1e-5);
    }
  });

  it('keeps a positive Jacobian through the tyre-to-wing blend and normals perpendicular', () => {
    const t1 = unit([1, .25, -.2]), t2 = unit([-.15, .9, .35]);
    const originalNormal = unit(cross(t1, t2));
    let smallestDeterminant = Infinity;
    for (const axle of [source.rearAxle, source.frontAxle]) {
      for (const dx of [-.59, -.44, -.28, 0, .28, .44, .59]) {
        for (const y of [.025, .19, .323, .53, .72, .88]) {
          for (const z of [-.92, -.61, .49, .61, .92]) {
            const point = [axle + dx, y, z];
            const jx = tangentAfterWarp(point, [1, 0, 0]);
            const jy = tangentAfterWarp(point, [0, 1, 0]);
            const jz = tangentAfterWarp(point, [0, 0, 1]);
            const determinant = dot(jx, cross(jy, jz));
            smallestDeterminant = Math.min(smallestDeterminant, determinant);
            const normal = mapImportedCarNormal(point, originalNormal);
            expect(normal.every(Number.isFinite)).toBe(true);
            expect(Math.hypot(...normal)).toBeCloseTo(1, 10);
            expect(Math.abs(dot(normal, unit(tangentAfterWarp(point, t1))))).toBeLessThan(2e-6);
            expect(Math.abs(dot(normal, unit(tangentAfterWarp(point, t2))))).toBeLessThan(2e-6);
          }
        }
      }
    }
    expect(smallestDeterminant).toBeGreaterThan(.1);
  });

  it('leaves the texture coordinates intact and calibrates shared geometry once', () => {
    const accessor = (values) => ({
      array: new Float32Array(values),
      getArray() { return this.array; },
      getNormalized() { return false; },
      setArray(array) { this.array = array; return this; },
    });
    const position = accessor([source.frontAxle, .323, .9, source.frontAxle + .385, .323, .9, source.frontAxle, .646, .9]);
    const normal = accessor([0, 0, 1, 0, 0, 1, 0, 0, 1]);
    const uv = accessor([.1, .2, .3, .4, .5, .6]);
    const beforeUv = new Float32Array(uv.getArray());
    const original = new Float32Array(position.getArray());
    const primitive = { getAttribute: (semantic) => ({ POSITION: position, NORMAL: normal, TEXCOORD_0: uv })[semantic] };
    const document = { getRoot: () => ({ listMeshes: () => [{ listPrimitives: () => [primitive, primitive] }] }) };
    const report = calibrateImportedCar(document);
    expect(report.vertices).toBe(3);
    expect(uv.getArray()).toEqual(beforeUv);
    for (let index = 0; index < 3; index++) {
      const expected = mapImportedCarPoint(Array.from(original.subarray(index * 3, index * 3 + 3)));
      expected.forEach((value, axis) => expect(position.getArray()[index * 3 + axis]).toBeCloseTo(value, 6));
    }
  });
});
