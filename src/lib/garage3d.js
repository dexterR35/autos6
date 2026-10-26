import carRelease from '../../public/car-releases/imported-v3/manifest.json';

// The GLB uses Y-up, nose +X. Anchors come from actual imported triangle
// surfaces and receive the same calibration as the car and its glazing.
export const CAR_TARGET = [0, 0.82, 0];
export const GARAGE_TARGET = [0, 1.25, -1.8];

export const CAMERA_PRESETS = {
  'exterior-a': [6.4, 1.72, 8],
  'exterior-b': [4.8, 1.45, 5.2],
  // Front and rear sit near headlamp height, like the reference photographs.
  front: [8.4, 1.3, 0],
  'side-a': [0.1, 1.25, 9.2],
  'side-b': [0.1, 1.25, -9.2],
  'rear-quarter-a': [-6.3, 1.6, 7.5],
  'rear-quarter-b': [-6.3, 1.6, -7.5],
  rear: [-8.4, 1.35, 0],
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
  return Object.fromEntries(Object.entries(carRelease.anchors).map(([part,candidates])=>[
    part,candidates.map(({position,normal})=>({position:[...position],normal:[...normal]})),
  ]));
}

export function findMeshPart(object) {
  for (let current = object; current; current = current.parent) {
    if (typeof current.userData?.partId === 'string') return current.userData.partId;
  }
  return null;
}
