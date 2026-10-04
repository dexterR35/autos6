# Asset mapping

The original files in the repository root are **never modified**. They were copied byte-for-byte to stable names under `public/assets/car/`. Optimized derivatives are generated from those copies by `scripts/make-derivatives.py` (Python 3 + Pillow).

## Originals → local names

All car images are 1672 × 941 RGB PNGs. Each is a full garage scene, not a cut-out.

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
