// The GLB uses glTF's Y-up coordinates. The S6 nose points along +X.
// These positions reference the editable Blender model, rather than a photograph:
// scripts/build_s6_c5.py writes the same anchors to output/s6/anchors-3d.json.
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

/** Multiple candidates let a part's marker follow the visible side of the real car. */
export function partAnchors3D() {
  const sides = [-1, 1];
  const side = (x, y, z) => sides.map((s) => ({ position: [x, y, z * s], normal: [0, 0, s] }));
  return {
    'roof-box': [
      { position: [-0.48, 1.775, 0], normal: [0, 1, 0] },
      ...side(-0.48, 1.6, 0.425),
      { position: [0.55, 1.57, 0], normal: [1, 0, 0] },
      { position: [-1.51, 1.6, 0], normal: [-1, 0, 0] },
    ],
    hood: [{ position: [1.72, 0.89, 0], normal: [0, 1, 0] }],
    'front-bumper': sides.map((s) => ({ position: [2.427, 0.472, 0.431 * s], normal: [1, 0, 0] })),
    wheels: side(1.5, 0.34, 0.935),
    'brake-kit': side(-1.345, 0.35, 0.935),
    'side-skirts': side(-0.05, 0.29, 0.921),
    'rear-bumper': sides.map((s) => ({ position: [-2.378, 0.501, 0.391 * s], normal: [-1, 0, 0] })),
    exhaust: sides.map((s) => ({ position: [-2.35, 0.262, 0.523 * s], normal: [-1, 0, 0] })),
  };
}

export function findMeshPart(object) {
  for (let current = object; current; current = current.parent) {
    if (typeof current.userData?.partId === 'string') return current.userData.partId;
  }
  return null;
}
