// Geometric calibration for the uploaded, already world-baked Audi GLB.
// Source coordinates are the preserved 4.797 m model-web preview. Only the
// chassis/overhang mapping changes length; wheel and arch neighbourhoods are
// rounded locally instead of stretching their circular details with the body.
export const IMPORTED_CAR_CALIBRATION = Object.freeze({
  source: {
    length: 4.797,
    bodyWidth: 1.875,
    rearAxle: -1.376,
    frontAxle: 1.351,
    wheelCentreY: .323,
    wheelRadiusX: .385,
    wheelRadiusY: .323,
  },
  target: {
    length: 4.913,
    bodyWidth: 1.850,
    rearAxle: -1.359,
    frontAxle: 1.400,
    wheelbase: 2.759,
  },
  dimensionSource: 'https://www.audiworld.com/model/s6/03/03s6avant.pdf',
  notes: [
    'Length and wheelbase follow the 2003 Audi S6 Avant North American technical sheet.',
    'Body-width measurement excludes the oversized mirrors of the generated source model.',
    'Source tyre faces are approximately 0.77 m wide by 0.646 m high; local X correction restores circularity.',
    'Roof-box height and tyre grounding are preserved; this remains a reference-guided visual reconstruction.',
  ],
});

const { source, target } = IMPORTED_CAR_CALIBRATION;
const zScale = target.bodyWidth / source.bodyWidth;
const clamp = (x, lo, hi) => Math.max(lo, Math.min(hi, x));
const smooth = (lo, hi, value) => {
  const t = clamp((value - lo) / (hi - lo), 0, 1);
  return t * t * (3 - 2 * t);
};
const sourceX = [-source.length / 2, source.rearAxle, source.frontAxle, source.length / 2];
const targetX = [-target.length / 2, target.rearAxle, target.frontAxle, target.length / 2];
const spans = sourceX.slice(1).map((x, i) => x - sourceX[i]);
const slopes = spans.map((h, i) => (targetX[i + 1] - targetX[i]) / h);
const tangents = [slopes[0], 0, 0, slopes[2]];
for (let i = 1; i < 3; i++) {
  const w1 = 2 * spans[i] + spans[i - 1], w2 = spans[i] + 2 * spans[i - 1];
  tangents[i] = (w1 + w2) / (w1 / slopes[i - 1] + w2 / slopes[i]);
}

export function mapImportedChassisX(x) {
  const interval = x < sourceX[1] ? 0 : x < sourceX[2] ? 1 : 2;
  const h = spans[interval], t = (x - sourceX[interval]) / h;
  // Monotone Hermite interpolation preserves each measured landmark while
  // matching tangent directions where chassis and overhang intervals meet.
  return (2 * t ** 3 - 3 * t ** 2 + 1) * targetX[interval]
    + (t ** 3 - 2 * t ** 2 + t) * h * tangents[interval]
    + (-2 * t ** 3 + 3 * t ** 2) * targetX[interval + 1]
    + (t ** 3 - t ** 2) * h * tangents[interval + 1];
}

/** World point mapping. Use this for glass, anchors and all imported geometry. */
export function mapImportedCarPoint(point, out = [0, 0, 0]) {
  const [x, y, z] = point;
  const bodyX = mapImportedChassisX(x);
  let correctedX = bodyX;
  const nearest = Math.abs(x - source.rearAxle) < Math.abs(x - source.frontAxle) ? 0 : 1;
  const oldAxle = nearest ? source.frontAxle : source.rearAxle;
  const newAxle = nearest ? target.frontAxle : target.rearAxle;
  const dx = x - oldAxle;
  const radial = Math.hypot(dx / source.wheelRadiusX, (y - source.wheelCentreY) / source.wheelRadiusY);
  // Include the rolled wheel-arch lip and smoothly release into the wing. The
  // wheel faces and the opening therefore stay concentric after rounding.
  const weight = (1 - smooth(1.04, 1.53, radial)) * smooth(.48, .72, Math.abs(z));
  if (weight > 0) {
    const wheelX = newAxle + dx * source.wheelRadiusY / source.wheelRadiusX;
    correctedX += weight * (wheelX - bodyX);
  }
  out[0] = correctedX;
  out[1] = y;
  out[2] = z * zScale;
  return out;
}

/** Inverse-transpose Jacobian keeps normals perpendicular to the warped mesh. */
export function mapImportedCarNormal(point, normal, out = [0, 0, 0]) {
  const eps = 1e-4;
  const plus = [0, 0, 0], minus = [0, 0, 0], p = [...point];
  const derivative = [];
  for (let axis = 0; axis < 3; axis++) {
    p[axis] = point[axis] + eps; mapImportedCarPoint(p, plus);
    p[axis] = point[axis] - eps; mapImportedCarPoint(p, minus);
    p[axis] = point[axis]; derivative[axis] = (plus[0] - minus[0]) / (2 * eps);
  }
  const [fx, fy, fz] = derivative;
  if (!(fx > .1)) throw new Error('Imported car warp would fold its surface.');
  out[0] = normal[0] / fx;
  out[1] = normal[1] - fy * out[0];
  out[2] = (normal[2] - fz * out[0]) / zScale;
  const length = Math.hypot(...out);
  if (!(length > 0) || !Number.isFinite(length)) throw new Error('Invalid warped normal.');
  out[0] /= length; out[1] /= length; out[2] /= length;
  return out;
}

/** Mutates Float32 world-space POSITION/NORMAL accessors once, preserving UVs. */
export function calibrateImportedCar(document) {
  const primitives = document.getRoot().listMeshes().flatMap(mesh => mesh.listPrimitives());
  const positions = new Map(), normals = new Map();
  for (const primitive of primitives) {
    const position = primitive.getAttribute('POSITION');
    const normal = primitive.getAttribute('NORMAL');
    if (!position) continue;
    if (!(position.getArray() instanceof Float32Array) || position.getNormalized()) {
      throw new Error('Bake source positions into Float32 world coordinates before calibration.');
    }
    if (!positions.has(position)) positions.set(position, new Float32Array(position.getArray()));
    if (normal && !normals.has(normal)) normals.set(normal, { position, values: new Float32Array(normal.getArray()) });
  }
  const p = [0, 0, 0], n = [0, 0, 0], result = [0, 0, 0];
  const min = [Infinity, Infinity, Infinity], max = [-Infinity, -Infinity, -Infinity];
  let vertices = 0;
  for (const [attribute, values] of positions) {
    const output = new Float32Array(values.length);
    for (let i = 0; i < values.length; i += 3) {
      p[0] = values[i]; p[1] = values[i + 1]; p[2] = values[i + 2];
      mapImportedCarPoint(p, result);
      for (let axis = 0; axis < 3; axis++) {
        output[i + axis] = result[axis];
        min[axis] = Math.min(min[axis], result[axis]); max[axis] = Math.max(max[axis], result[axis]);
      }
      vertices++;
    }
    attribute.setArray(output);
  }
  for (const [attribute, { position, values }] of normals) {
    const old = positions.get(position), output = new Float32Array(values.length);
    if (old.length !== values.length) throw new Error('Position and normal counts do not match.');
    for (let i = 0; i < values.length; i += 3) {
      p[0] = old[i]; p[1] = old[i + 1]; p[2] = old[i + 2];
      n[0] = values[i]; n[1] = values[i + 1]; n[2] = values[i + 2];
      mapImportedCarNormal(p, n, result);
      output.set(result, i);
    }
    attribute.setArray(output);
  }
  return { ...IMPORTED_CAR_CALIBRATION, zScale, vertices, bounds: { min, max, size: max.map((v, axis) => v - min[axis]) } };
}
