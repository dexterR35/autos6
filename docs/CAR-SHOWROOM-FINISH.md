# Showroom finish: clean body panels, gloss paint and real reflections

Active release: `/car-releases/imported-v4/s6-c5.glb` (`CAR_RELEASE` in
`src/lib/modelAssets.js`). `imported-v3` is kept only for comparison.

## Why the body looked crumpled

Earlier releases were built from `model-web.glb`, a preview that reduced the
uploaded model to 32 % of its triangles before any cleanup. That step dented
the doors, wings and bonnet, and gloss paint made every dent visible. The
release is now built from the full 924,442-triangle upload:

    node scripts/prepare-imported-car.mjs      # model.glb -> model-clean.glb (normalized, not simplified)
    node scripts/build-imported-car.mjs --reuse-wheels --publish

Triangles are reduced once, per material and within a 1.2 mm error limit, at
the end of the build (about 530,000 triangles, 8.2 MB). The tailgate window of
the upload is a photographed solid panel; it is released as opaque privacy
glass. Side panes sit 9 mm behind the aperture lips so pillars and seals
overlap the pane edge. Paint is a mid-deep pearl blue (linear .010/.036/.155).

This is still the generated (Tripo) body. Panel gaps, lamp detail and the
window trim remain as rough as the upload; only a hand-modelled or licensed
A6 C5 Avant mesh can improve those.

## Rendering

- `src/lib/garageReflections.js` renders the garage once into a cube map from
  the car's position, and again only after the brightness slider settles. The
  car's paint, glass and chrome mirror the actual tubes and walls. The floor
  uses the same capture with a box projection. There is no per-frame cost.
- `src/lib/carLook.js` adds what glTF cannot store: pearl colour travel, fine
  flake under the clearcoat (visible close up only) and glazing whose
  reflections stay opaque while the pane stays transparent.
- `src/lib/garageLighting.js`: lower ambient light, two soft front floods for
  the flanks of the car, a 2048 px key shadow, and a sealed-concrete floor
  with per-slab gloss variation. `paint-studio.hdr` is only the fallback probe.

## Checking the result

Run `npm run dev:web`, then open
`/scripts/garage-lab.html?shot=car34&orbit=1` (also `carside`, `carrear34`,
`garage`). New lab parameters: `cam=x,y,z,tx,ty,tz,fov`, `hide=<regex>`,
`surface=clay` (geometry only) and `surface=ids` (one colour per material).
`candidate=staging` loads the unpublished build from
`output/car-refinement/imported-v4/`.
