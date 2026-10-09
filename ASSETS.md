# Asset mapping

The original files in the repository root are **never modified**. They were copied byte-for-byte to stable names under `public/assets/car/`. Optimized derivatives are generated from those copies by `scripts/make-derivatives.py` (Python 3 + Pillow).

## Interactive 3D garage

The default viewer loads real car and garage geometry with Three.js and OrbitControls. Drag to orbit freely through 360 degrees, scroll or pinch to zoom, and right-drag or use two fingers to pan. Camera thumbnails move the camera to presets in the same scene.

`scripts/export_s6_web.py` exports the editable scene to `public/models/s6-c5.glb` and `public/models/garage.glb`. It converts curves and modifiers, simplifies dense details, and combines static surfaces by material. Car groups retain part identifiers for picking. The car is centered at the origin with its nose along +X and +Y up. The garage is offset to match that origin. Browser lighting recreates the polished paint and neon workshop without an external environment download.

### Workshop look in the browser

The GLB only carries geometry and flat PBR values, so `src/lib/garageLook.js` rebuilds the look of the Blender renders at runtime:

- **Neon and practicals.** The blue and red neon, the white wall fluorescents and the bulbs are HDR emissives. Each fixture found in those meshes gets a coloured point light that washes the wall behind it, within a fixed light budget. Spot "workshop bounce" lights from the room side light the cabinets, as in the Blender scene.
- **Bloom and tone mapping.** `UnrealBloomPass` thresholds the brightest colour channel, so saturated blue neon glows while white paint highlights do not. Its fine mips carry most of the weight, giving a tight glow around each tube instead of a haze over the room. Khronos PBR Neutral tone mapping keeps the neon blue and red in hue; ACES pushed bright blue toward lavender-white.
- **Audi sign.** Thicker tori are fitted over the four exported rings, which are found in the blue neon mesh. The sign has its own material, wall-wash light and additive blue halo, matching the reference sign and its glow on the masonry.
- **Practical light levels.** Neon lights only tint the wall around each tube; the reference keeps the masonry dark. White spot washes light the red cabinets and lower shelves, and a cool blue-grey hemisphere keeps the rest of the room readable.
- **Wet floor.** A planar mirror of the scene is sampled with vertical streaking, a puddle mask, Fresnel and procedural cracked-slab concrete.
- **Masonry.** Procedural 0.85 × 0.42 m blocks with mortar relief, matching the Blender brick shader.
- **Reflections.** An environment probe of the lit workshop is used by the garage and the car, so paint and glass reflect the neon and cabinets.

- **Ceiling lights switch.** The **Lights** button in the 3D toolbar turns on the rows of twin-tube fluorescents under the trusses. They start row by row with a fluorescent flicker (instantly with reduced motion), and white ceiling lights, a brighter fill and a second environment probe of the lit room flood the garage and the car. The probe puts rows of tube reflections in the paint. Switching off fades back to the neon mood. The nine ceiling lights stay in the scene at zero intensity when off, so the switch never recompiles shaders.

`src/lib/garageExtension.js` completes the room for a 360° orbit. The exported side walls stop beside the car, and the front is open. It adds the front wall (roller doors, the S6 flag, neon), the side-wall extensions (cabinets, shelves with bottles, prints, neon, piers), ceiling trusses and fluorescent battens. These reuse the GLB's own materials and artwork.

Performance, with no visible change:

- Hotspot occlusion and part picking use a bounding-volume hierarchy over the car and garage triangles (`src/lib/rayIndex.js`). three's brute-force raycast had to test ~300k triangles per ray, and that limited orbiting to ~18 fps.
- The shader skips the BRDF for any point or spot light whose attenuated colour is zero at that pixel.
- Every material is compiled at load (`compileAsync`), so the first view of each part of the room never hitches.
- While the camera moves, the pixel ratio steps down if the median frame misses a 60 Hz budget. Once the camera settles, the still image is redrawn at full resolution. `data-render-scale` on the viewer shows the current scale.

To compare the browser render with the references, run `npm run dev:web` and open `/scripts/garage-lab.html?shot=reference`. The shots are `reference`, `s6`, `garage`, `exterior`, `front`, `rear`, `side`, `sideb`, `rearq` and `top`. Add `&car=0` to hide the car. `node scripts/garage-lab-shot.mjs reference,garage` saves them to `output/garage/web-<shot>.png`.

The image viewer remains available explicitly through `?viewer=image` or the fallback button when WebGL or a model cannot load. It is not presented as interactive 3D. Model geometry is a visual reconstruction, not OEM CAD.

## Blender renders and fallback imagery

The glossy **2003 Audi S6 C5 Avant** Blender renders provide camera thumbnails and fallback imagery. The editable scene is `output/s6/audi_s6_c5_2003.blend`. `scripts/build_s6_c5.py` builds the scene and renders its cameras; `scripts/publish_s6_renders.py` prepares the website derivatives and writes `src/data/s6RenderManifest.json`.

The car geometry comes from `scripts/s6c5/`: `spec.py` (dimensions and body sections, with the reference car's 2.845 m wheelbase and 20-inch wheels), `features.py` (lamp, grille, intake, plate and exhaust openings and the panel shut lines), `body.py`/`build.py` (body surfaces split into front bumper, wings and doors, side skirts, tailgate and rear bumper), and `front.py`, `rear.py`, `side.py`, `wheels.py`, `cabin.py`, `roof.py` for the details. The registration plate texture is `scripts/s6c5/textures/plate-ro-b08046.png`, drawn by `scripts/make-plate.py`.

| Path | Purpose |
| --- | --- |
| `public/assets/car/s6/<view>.png` | Full-resolution Blender render |
| `public/assets/car/s6/<view>.webp` | Optimized stage image |
| `public/assets/car/s6/<view>-thumb.webp` | Angle-strip thumbnail |
| `public/assets/car/s6/parts/<part>.webp` | Crops of visible model parts |
| `src/data/s6RenderManifest.json` | Image dimensions, car bounds, and camera-projected anchors |

The eight existing camera choices retain their part callout settings. Each view takes its image and anchor coordinates from the generated manifest; an old anchor is omitted if its part is not visible in the new render. The camera panel identifies the imagery as a Blender render. Coilovers and interior retain icons without exterior hotspots.

The original references and their derivatives below remain intact. They provide fallback imagery if a view has no generated manifest entry; the two additional exterior render variants are available as assets without adding duplicate camera choices to the strip.

## Originals → local names

All original car images are 1672 × 941 RGB PNGs. Each is a full garage scene, not a cut-out.

| Original filename | Local file | View id / label | Content (verified visually) |
| --- | --- | --- | --- |
| `Neon Audi S6 Garage Dashboard.png` (1983 × 793) | `docs/reference/reference-dashboard.png` | — | UI reference only. Never shown in the app. |
| `ChatGPT Image Oct 4, 2026, 01_38_30 AM-1.png` | `public/assets/car/exterior-a.png` | `exterior-a` · **Exterior** (default) | Front three-quarter, nose right, roof box |
| `ChatGPT Image Oct 4, 2026, 01_38_31 AM-2.png` | `public/assets/car/rear.png` | `rear` · **Rear** | Straight rear: taillights, plate, quad exhaust tips |
| `ChatGPT Image Oct 4, 2026, 01_38_32 AM-3.png` | `public/assets/car/side-a.png` | `side-a` · **Side A** | Side profile, nose right |
| `ChatGPT Image Oct 4, 2026, 01_38_33 AM-4.png` | `public/assets/car/exterior-c.png` | *(not in strip)* | Front three-quarter, very close to `exterior-a`/`exterior-b`. Kept as an alternate. |
| `ChatGPT Image Oct 4, 2026, 01_38_33 AM-5.png` | `public/assets/car/rear-quarter-b.png` | `rear-quarter-b` · **Rear ¾ B** | Rear three-quarter from the other rear corner, nose pointing away to the left |
| `ChatGPT Image Oct 4, 2026, 01_38_34 AM-6.png` | `public/assets/car/rear-quarter-a.png` | `rear-quarter-a` · **Rear ¾** | Rear three-quarter, rear on the left, nose to the right |
| `ChatGPT Image Oct 4, 2026, 01_38_35 AM-7.png` | `public/assets/car/front.png` | `front` · **Front** | Straight front: headlights, grille, bumper, roof box |
| `ChatGPT Image Oct 4, 2026, 01_38_35 AM-8.png` | `public/assets/car/side-b.png` | `side-b` · **Side B** | Second side profile, also nose right |
| `ChatGPT Image Oct 4, 2026, 01_38_36 AM-9.png` | `public/assets/car/exterior-b.png` | `exterior-b` · **Close-up** | Closer front three-quarter |
| `ChatGPT Image Oct 4, 2026, 01_38_37 AM-10.png` | `public/assets/car/exterior-d.png` | *(not in strip)* | Near-duplicate of `exterior-a`. Kept as an alternate. |

**Note:** the build brief listed six car images. The folder contained ten, so the two rear three-quarter images (`-5`, `-6`) were added as extra angles. Images `-4` and `-10` nearly duplicate existing front three-quarter views, so they're copied but not shown. To show one, add a `view(...)` entry in `src/data/views.js`.

Side A and Side B both show the same side of the car with the nose pointing right. They're labelled A/B, not left/right, and no image is mirrored, since mirroring would reverse the badge and plate. `rear-quarter-b` appears to show the opposite flank, but it isn't labelled as a verified left side.

## Derivatives (generated)

| Path | Purpose | Notes |
| --- | --- | --- |
| `public/assets/car/web/<view>.webp` | Stage image | Full 1672 × 941, WebP q90 (~300 KB vs ~2.4 MB PNG). Visually equivalent. |
| `public/assets/car/thumbs/<view>.webp` | Angle-strip thumbnails, page backgrounds | 384 × 216 |
| `public/assets/car/parts/<part>.webp` | Part thumbnails | 240 × 160 crops of a view where the part is visible |

Regenerate with `python3 scripts/make-derivatives.py`. Crop centres are listed in `PART_CROPS` inside that script.

## Missing assets (gaps)

The reference strip reads Exterior, Interior, Engine, Left Side, Right Side, Rear, Top View. There are **no interior, engine, top-view, or verified opposite-side photos**, and no standalone part photos.

- `interior`, `engine` and `top-view` exist in `src/data/views.js` with `available: false`. They aren't rendered as buttons and no images were invented for them.
- Coilovers and Interior Refresh aren't visible in any photo. They use outlined icons (`assetManifest.js`) and have **no hotspot dot**, but they can still be selected from the parts list.

## Replacing part thumbnails later

`src/data/assetManifest.js` maps part id → thumbnail:

```js
'front-bumper': { type: 'crop', src: '/assets/car/parts/front-bumper.webp', sourceView: 'front' },
coilovers: { type: 'icon', icon: 'coilover' },
```

To use a real photo, put it in `public/assets/car/parts/` and change the entry to `{ type: 'image', src: '/assets/car/parts/my-photo.webp' }`. In live mode you can instead set `parts.thumbnail_url` in Supabase; it takes priority over the manifest.

## Adding a camera angle

1. Copy the photo to `public/assets/car/<id>.png` and add `<id>` to `VIEWS` in `scripts/make-derivatives.py`, then run it.
2. Add a `view('<id>', 'Label', 'alt text', [focus box], [hotspots…])` entry in `src/data/views.js`.
3. Calibrate anchors with `npm run dev`, then open `http://localhost:5173/?calibrate=1` (see the README).
