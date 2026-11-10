// Low-frequency panel fairing. A robust curved fit removes generated dents
// without flattening the bonnet crown or the doors' shoulder and lower crease.
const clamp = (value, a, b) => Math.max(a, Math.min(b, value));
const fade = (a, b, value) => { const t = clamp((value - a) / (b - a), 0, 1); return t * t * (3 - 2 * t); };
const evaluate = (terms, coefficients) => terms.reduce((sum, value, index) => sum + value * coefficients[index], 0);

function solve(matrix, rhs) {
  const size = rhs.length, rows = matrix.map((row, index) => [...row, rhs[index]]);
  for (let column = 0; column < size; column++) {
    let best = column;
    for (let row = column + 1; row < size; row++) if (Math.abs(rows[row][column]) > Math.abs(rows[best][column])) best = row;
    if (Math.abs(rows[best][column]) < 1e-12) return null;
    [rows[column], rows[best]] = [rows[best], rows[column]];
    const scale = rows[column][column];
    for (let entry = column; entry <= size; entry++) rows[column][entry] /= scale;
    for (let row = 0; row < size; row++) if (row !== column) {
      const multiple = rows[row][column];
      for (let entry = column; entry <= size; entry++) rows[row][entry] -= multiple * rows[column][entry];
    }
  }
  return rows.map(row => row[size]);
}

function fit(samples) {
  const size = samples[0].terms.length;
  let coefficients = null;
  for (let pass = 0; pass < 5; pass++) {
    const matrix = Array.from({ length: size }, () => new Array(size).fill(0)), rhs = new Array(size).fill(0);
    for (const sample of samples) {
      const residual = coefficients ? Math.abs(evaluate(sample.terms, coefficients) - sample.value) : 0;
      const weight = residual > .008 ? .008 / residual : 1;
      for (let row = 0; row < size; row++) {
        rhs[row] += sample.terms[row] * sample.value * weight;
        for (let column = 0; column < size; column++) matrix[row][column] += sample.terms[row] * sample.terms[column] * weight;
      }
    }
    coefficients = solve(matrix, rhs);
    if (!coefficients) return null;
  }
  return coefficients;
}

export function fairImportedCarPanels(points, original, normals, paintWeights, pinned, maxDisplacement) {
  const normalTargets = new Float64Array(points.length), normalWeights = new Float32Array(points.length / 3);
  const panels = [
    { name: 'bonnet crown', axis: 1,
      select: (x, y, z, nx, ny) => x > 1.02 && x < 2.16 && y > .755 && y < 1.01 && Math.abs(z) < .69 && ny > .66,
      terms: (x, y, z) => { const u = (x - 1.59) / .57, v = z / .69; return [1, u, u * u, v * v, u * v * v, u * u * v * v]; },
      blend: (x, y, z) => fade(1.02, 1.16, x) * (1 - fade(2.01, 2.16, x)) * (1 - fade(.51, .69, Math.abs(z))) },
    ...[-1, 1].map(side => ({ name: side > 0 ? 'left door skin' : 'right door skin', axis: 2,
      select: (x, y, z, nx, ny, nz) => x > -.96 && x < .94 && y > .37 && y < .77 && z * side > .72 && nz * side > .80,
      terms: (x, y) => { const u = x, v = (y - .57) / .20; return [1, u, v, u * u, u * v, v * v, v * v * v]; },
      blend: (x, y) => fade(-.96, -.79, x) * (1 - fade(.75, .94, x)) * fade(.37, .44, y) * (1 - fade(.69, .77, y)) })),
  ];
  const report = [];
  for (const panel of panels) {
    const samples = [];
    for (let id = 0; id < points.length / 3; id++) {
      if (paintWeights[id] < .5) continue;
      const offset = id * 3, position = Array.from(points.subarray(offset, offset + 3));
      if (!panel.select(...position, ...normals.subarray(offset, offset + 3))) continue;
      samples.push({ id, position, terms: panel.terms(...position), value: points[offset + panel.axis] });
    }
    if (samples.length < 50) continue;
    const coefficients = fit(samples);
    if (!coefficients) continue;
    let moved = 0, maximum = 0;
    for (const sample of samples) {
      const offset = sample.id * 3, axis = panel.axis;
      const blend = panel.blend(...sample.position);
      // Analytic derivatives of the fitted curved surface give the clearcoat
      // a coherent highlight instead of amplifying the source's vertex noise.
      const axes = axis === 1 ? [0, 2] : [0, 1], slopes = axes.map(direction => {
        const plus = [...sample.position], minus = [...sample.position];
        plus[direction] += 1e-4; minus[direction] -= 1e-4;
        return (evaluate(panel.terms(...plus), coefficients) - evaluate(panel.terms(...minus), coefficients)) / 2e-4;
      });
      const n = axis === 1 ? [-slopes[0], 1, -slopes[1]] : [-slopes[0], -slopes[1], 1];
      const side = axis === 2 ? Math.sign(sample.position[2]) : 1, normalLength = Math.hypot(...n);
      for (let k = 0; k < 3; k++) normalTargets[offset + k] = n[k] * side / normalLength;
      normalWeights[sample.id] = blend;
      if (pinned[sample.id]) continue;
      const delta = clamp(evaluate(sample.terms, coefficients) - sample.value, -.014, .014) * panel.blend(...sample.position);
      if (Math.abs(delta) < 1e-6) continue;
      points[offset + axis] += delta;
      const length = Math.hypot(...[0, 1, 2].map(k => points[offset + k] - original[offset + k]));
      if (length > maxDisplacement) for (let k = 0; k < 3; k++) points[offset + k] = original[offset + k] + (points[offset + k] - original[offset + k]) * maxDisplacement / length;
      moved++; maximum = Math.max(maximum, Math.abs(delta));
    }
    report.push({ panel: panel.name, samples: samples.length, moved, maximumProjectionMetres: maximum });
  }
  return { report, normalTargets, normalWeights };
}
