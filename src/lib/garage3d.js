// The GLB uses glTF's Y-up coordinates. The S6 nose points along +X.
// These positions reference the editable Blender model, rather than a photograph.
export const CAR_TARGET = [0, 0.82, 0];
export const GARAGE_TARGET = [0, 1.25, -1.8];

export const CAMERA_PRESETS = {
  'exterior-a': [6.4, 2.8, 8],
  'exterior-b': [4.8, 1.9, 5.2],
  front: [8.7, 1.75, 0],
  'side-a': [0.1, 1.9, 9.2],
  'side-b': [0.1, 1.9, -9.2],
  'rear-quarter-a': [-6.3, 2.7, 7.5],
  'rear-quarter-b': [-6.3, 2.7, -7.5],
  rear: [-8.7, 1.75, 0],
};

export function cameraPreset(viewId, compact = false) {
  const position = [...(CAMERA_PRESETS[viewId] ?? CAMERA_PRESETS['exterior-a'])];
  // Keep the complete wagon in a narrower viewport without changing its proportions.
  if (compact) {
    position[0] *= 1.13;
    position[2] *= 1.13;
  }
  return { position, target: [...CAR_TARGET] };
}

export function bodyHeight(z) {
  if (z <= 0.7) return z;
  if (z < 1.075) return 0.7 + (z - 0.7) * 0.6;
  if (z < 1.45) return 0.925 + (z - 1.075) * 0.525 / 0.375;
  return z;
}

/** Multiple candidates let a part's marker follow the visible side of the real car. */
export function partAnchors3D() {
  const sides = [-1, 1];
  const side = (x, y, z) => sides.map((s) => ({ position: [x, y, z * s], normal: [0, 0, s] }));
  return {
    'roof-box': [
      { position: [-0.56, 1.845, 0], normal: [0, 1, 0] },
      ...side(-0.56, 1.68, 0.49),
      { position: [0.55, 1.655, 0], normal: [1, 0, 0] },
      { position: [-1.77, 1.655, 0], normal: [-1, 0, 0] },
    ],
    hood: [{ position: [1.5, bodyHeight(1.06) + 0.035, 0], normal: [0, 1, 0] }],
    'front-bumper': sides.map((s) => ({ position: [2.48, 0.605, 0.43 * s], normal: [1, 0, 0] })),
    wheels: side(1.365, 0.326, 0.98),
    'brake-kit': side(-1.394, 0.34, 0.98),
    'side-skirts': side(-0.05, 0.29, 0.94),
    'rear-bumper': sides.map((s) => ({ position: [-2.47, 0.58, 0.39 * s], normal: [-1, 0, 0] })),
    exhaust: sides.map((s) => ({ position: [-2.55, 0.285, 0.65 * s], normal: [-1, 0, 0] })),
  };
}

export function findMeshPart(object) {
  for (let current = object; current; current = current.parent) {
    if (typeof current.userData?.partId === 'string') return current.userData.partId;
  }
  return null;
}
