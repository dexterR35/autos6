export const WHEEL_SETUP_KEY = 's6-wheel-setup-v1';
export const DEFAULT_WHEEL_SETUP = Object.freeze({ rimColor: '#657080', caliperColor: '#c81924', tyre: 'road' });
const hex = value => typeof value === 'string' && /^#[0-9a-f]{6}$/i.test(value);

export function normalizeWheelSetup(value = {}) {
  return {
    rimColor: hex(value?.rimColor) ? value.rimColor : DEFAULT_WHEEL_SETUP.rimColor,
    caliperColor: hex(value?.caliperColor) ? value.caliperColor : DEFAULT_WHEEL_SETUP.caliperColor,
    tyre: value?.tyre === 'track' ? 'track' : 'road',
  };
}
export function readWheelSetup() {
  try { return normalizeWheelSetup(JSON.parse(localStorage.getItem(WHEEL_SETUP_KEY) || '{}')); }
  catch { return { ...DEFAULT_WHEEL_SETUP }; }
}
export function saveWheelSetup(value) {
  try { localStorage.setItem(WHEEL_SETUP_KEY, JSON.stringify(normalizeWheelSetup(value))); }
  catch { /* The controls still work when browser storage is disabled. */ }
}
export function applyWheelSetup(root, value) {
  const setup = normalizeWheelSetup(value), seen = new Set();
  root?.traverse(object => {
    if (object.userData.tyreVariant) object.visible = object.userData.tyreVariant === setup.tyre;
    for (const material of [object.material].flat().filter(Boolean)) {
      if (seen.has(material)) continue;
      seen.add(material);
      if (material.name.startsWith('S6.Modular.RimPaint')) material.color.set(setup.rimColor);
      if (material.name.startsWith('S6.Modular.CaliperPaint')) material.color.set(setup.caliperColor);
    }
  });
  return setup;
}
