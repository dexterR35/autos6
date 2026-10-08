import s6Renders from './s6RenderManifest.json';

// Camera views for the 2D image viewer. Blender exports override the source imagery
// and anchor coordinates while retaining the catalogue's existing callout layout.
//
// Hotspot x/y are NORMALIZED SOURCE-IMAGE coordinates (0..1, origin top-left of the
// original 1672 × 941 image) — never stage/percentage positions. They are projected
// onto the screen by src/lib/projection.js using the same fit/position as the <img>.
//
// callout: placement of the floating card relative to the anchor, in reference pixels
// (1983 × 793 dashboard). side = which side of the dot the card sits on, dx = gap from
// dot to the card's near edge, dy = vertical offset of the card centre from the dot.
// featured: shown as a floating card by default on wide screens (ordered by priority).
//
// Only parts genuinely visible in an image get an anchor. Coilovers and interior have
// no exterior anchor on purpose. Calibrate with ?calibrate=1 in development.

export const IMAGE_WIDTH = 1672;
export const IMAGE_HEIGHT = 941;

const view = (id, label, alt, focus, hotspots, extra = {}) => {
  const render = s6Renders[id];
  const anchors = hotspots.map(([partId, x, y, side, dx, dy, featured = true]) => ({
    id: `${id}--${partId}`,
    partId,
    x,
    y,
    featured,
    callout: { side, dx, dy },
  }));
  const renderedAnchors = new Map((render?.hotspots ?? []).map((anchor) => [anchor.partId, anchor]));

  return {
    id,
    label,
    alt,
    src: `/assets/car/web/${id}.webp`,
    original: `/assets/car/${id}.png`,
    thumb: `/assets/car/thumbs/${id}.webp`,
    width: IMAGE_WIDTH,
    height: IMAGE_HEIGHT,
    available: true,
    objectPosition: { x: 0.5, y: 0.3 },
    // Approximate car bounding box (normalized) used to zoom on small screens.
    focus: { x0: focus[0], y0: focus[1], x1: focus[2], y1: focus[3] },
    hotspots: anchors,
    ...extra,
    ...(render ? {
      src: render.src,
      original: render.original,
      thumb: render.thumb,
      width: render.width,
      height: render.height,
      focus: render.focus,
      alt: `Blender render of a glossy 2003 Audi S6 C5 Avant, ${label.toLowerCase()} view`,
      renderNote: '2003 S6 C5 Avant · Blender render',
      // An old anchor must never survive on a new image without a matching projection.
      hotspots: anchors.filter((anchor) => renderedAnchors.has(anchor.partId)).map((anchor) => {
        const projected = renderedAnchors.get(anchor.partId);
        return { ...anchor, x: projected.x, y: projected.y };
      }),
    } : {}),
  };
};

export const views = [
  view('exterior-a', 'Exterior', 'Dark blue Audi S6 Avant, front three-quarter view, parked in a neon-lit garage with a roof box', [0.14, 0.15, 0.74, 0.73], [
    ['roof-box', 0.375, 0.255, 'right', 34, -42],
    ['hood', 0.56, 0.44, 'right', 44, -52],
    ['front-bumper', 0.655, 0.6, 'right', 58, 6],
    ['wheels', 0.405, 0.56, 'right', 40, 98],
    ['side-skirts', 0.335, 0.593, 'left', 24, 72],
    ['exhaust', 0.195, 0.585, 'left', 30, -62],
    ['brake-kit', 0.218, 0.56, 'left', 30, 40, false],
  ]),
  view('exterior-b', 'Close-up', 'Closer front three-quarter view of the Audi S6 Avant showing headlights, grille and front wheel', [0.17, 0.17, 0.8, 0.77], [
    ['roof-box', 0.405, 0.251, 'right', 60, -40],
    ['hood', 0.611, 0.471, 'right', 60, -70],
    ['front-bumper', 0.687, 0.652, 'right', 50, 10],
    ['wheels', 0.44, 0.645, 'right', 34, 46],
    ['side-skirts', 0.335, 0.634, 'left', 24, 50],
    ['rear-bumper', 0.195, 0.564, 'left', 40, -70],
    ['brake-kit', 0.231, 0.582, 'left', 30, 40, false],
  ]),
  view('front', 'Front', 'Straight-on front view of the Audi S6 Avant: headlights, grille and front bumper', [0.27, 0.14, 0.71, 0.78], [
    ['roof-box', 0.49, 0.238, 'right', 150, -40],
    ['hood', 0.493, 0.455, 'right', 340, -60],
    ['front-bumper', 0.491, 0.638, 'left', 340, 0],
  ]),
  view('side-a', 'Side A', 'Side profile of the Audi S6 Avant, nose pointing right', [0.07, 0.17, 0.86, 0.7], [
    ['roof-box', 0.385, 0.264, 'left', 270, -40],
    ['hood', 0.709, 0.449, 'right', 60, -90],
    ['front-bumper', 0.807, 0.563, 'right', 40, -60],
    ['wheels', 0.258, 0.59, 'left', 80, 62],
    ['side-skirts', 0.472, 0.615, 'left', 20, 72],
    ['rear-bumper', 0.133, 0.562, 'left', 20, -90],
    ['brake-kit', 0.683, 0.593, 'right', 30, 80, false],
  ]),
  view('side-b', 'Side B', 'Second side profile of the Audi S6 Avant, nose pointing right', [0.08, 0.18, 0.86, 0.71], [
    ['roof-box', 0.39, 0.265, 'left', 270, -40],
    ['hood', 0.72, 0.449, 'right', 60, -90],
    ['front-bumper', 0.818, 0.558, 'right', 40, -60],
    ['wheels', 0.265, 0.591, 'left', 80, 62],
    ['side-skirts', 0.478, 0.616, 'left', 20, 72],
    ['rear-bumper', 0.144, 0.557, 'left', 20, -90],
    ['brake-kit', 0.698, 0.592, 'right', 30, 80, false],
  ]),
  view('rear-quarter-a', 'Rear ¾', 'Rear three-quarter view of the Audi S6 Avant showing taillights, plate and quad exhaust tips', [0.17, 0.16, 0.74, 0.72], [
    ['roof-box', 0.443, 0.234, 'right', 120, -40],
    ['rear-bumper', 0.263, 0.567, 'left', 40, -60],
    ['exhaust', 0.359, 0.624, 'left', 60, 52],
    ['wheels', 0.5, 0.607, 'right', 40, 70],
    ['brake-kit', 0.7, 0.582, 'right', 50, -40],
    ['side-skirts', 0.606, 0.62, 'right', 30, 60, false],
  ]),
  view('rear-quarter-b', 'Rear ¾ B', 'Rear three-quarter view of the Audi S6 Avant from the opposite corner', [0.18, 0.15, 0.76, 0.73], [
    ['roof-box', 0.49, 0.227, 'left', 140, -40],
    ['rear-bumper', 0.646, 0.582, 'right', 90, -40],
    ['exhaust', 0.576, 0.648, 'right', 60, 42],
    ['wheels', 0.408, 0.61, 'left', 40, 60],
    ['brake-kit', 0.217, 0.574, 'left', 40, -60],
    ['side-skirts', 0.311, 0.621, 'left', 30, 60, false],
  ]),
  view('rear', 'Rear', 'Straight-on rear view of the Audi S6 Avant: taillights, rear bumper and exhaust tips', [0.28, 0.13, 0.71, 0.76], [
    ['roof-box', 0.495, 0.216, 'right', 150, -30],
    ['rear-bumper', 0.495, 0.606, 'right', 330, 0],
    ['exhaust', 0.383, 0.663, 'left', 180, 0],
  ]),
  // Reference strip slots with no genuine photo yet. Kept in config so the strip can
  // grow when real assets exist; never rendered as clickable broken buttons.
  { id: 'interior', label: 'Interior', available: false, hotspots: [] },
  { id: 'engine', label: 'Engine', available: false, hotspots: [] },
  { id: 'top-view', label: 'Top View', available: false, hotspots: [] },
];

export const DEFAULT_VIEW_ID = 'exterior-a';

export const availableViews = views.filter((v) => v.available);

export function getView(id) {
  return views.find((v) => v.id === id && v.available) ?? null;
}

/** Views (in strip order) containing an anchor for the part. */
export function viewsContainingPart(partId) {
  return availableViews.filter((v) => v.hotspots.some((h) => h.partId === partId));
}

export function viewHasPart(viewId, partId) {
  const v = getView(viewId);
  return Boolean(v && v.hotspots.some((h) => h.partId === partId));
}
