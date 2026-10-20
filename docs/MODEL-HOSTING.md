# Supabase model delivery and garage performance

Live mode **requires Supabase Storage**. Local GLBs and lighting are for development/demo previews. A live build without `VITE_MODEL_ASSET_BASE_URL` fails; live build output excludes local models and lighting. Original Blender files stay in the authoring workspace.

## Publish the assets

1. Apply all migrations, including the migration ending in `_model_storage.sql`. It creates the public `project-models` bucket, a 25 MB per-object limit and owner-folder write policies.
2. Configure `SUPABASE_URL` and `SUPABASE_SECRET_KEY` in **server/.env**. These credentials stay server-only.
3. Find the campaign UUID in `projects.id`, then run:

   ```bash
   npm run upload:models -- --project YOUR-PROJECT-UUID --version v1
   ```

   The command uploads exactly:

   | File | Purpose | Size |
   | --- | --- | --- |
   | `s6-c5.glb` | Car, Meshopt compressed | 1,407,932 bytes |
   | `garage.glb` | Garage, Meshopt compressed | 1,816,740 bytes |
   | `garage-lighting.hdr` | Precomputed fixture lighting | 12,853 bytes |

   Files go under `<project UUID>/v1/`. Uploads use one-year cache control and never overwrite an existing release. If an upload fails partway, use a new version name for a clean release.

4. Copy the printed public folder URL into frontend `.env`:

   ```dotenv
   VITE_DEMO_MODE=false
   VITE_MODEL_ASSET_BASE_URL=https://YOUR-REF.supabase.co/storage/v1/object/public/project-models/YOUR-PROJECT-UUID/v1
   ```

5. Set `MODEL_ASSET_BASE_URL` to the same URL on the Node API so CSP allows that origin. Rebuild and deploy the frontend, then restart the API. Keep the remaining payment/community configuration from [LAUNCH.md](LAUNCH.md).

Alternatively upload these three files in the Supabase Dashboard to the same bucket/folder. Use `model/gltf-binary` for GLBs and `image/vnd.radiance` for the HDR. The browser uses public URLs, with no secret or signed query parameter.

For the next release use `--version v2`, update both URL settings and rebuild. Browser/CDN caches can retain v1 safely because its URLs do not change. The connected project's first release is published; see [SUPABASE-STATUS.md](SUPABASE-STATUS.md).

Public website assets are intentionally downloadable by anyone with their URL. Authenticated upload, replacement and deletion require project-owner membership for the UUID folder. The trusted server-key script is for the operator. Keep original `.blend` files and private material outside this bucket. See [Supabase's public-bucket access model](https://supabase.com/docs/guides/storage/buckets/fundamentals).

## Why the first visit was slow and the image blurred

The old browser path downloaded 11,675,380 bytes of model data and rebuilt workshop lighting/reflections at runtime: a full-scene cubemap capture, many dynamic lights, a floor-reflection scene pass, bloom passes and a synchronous raycasting index. That work could stall the browser/GPU before caches warmed. Hosting changes delivery; it does not remove GPU work.

The mobile renderer capped pixel density at 1.25 and could multiply it by 0.55 during motion. That could render below one pixel per CSS pixel and stretch the result across a high-density screen. Fog, bloom and backdrop filters added softness.

The new path:

- Two models total **3,224,672 bytes (72.4% smaller)**. Triangle count, part metadata, material identity and embedded images are retained.
- A 12.9 KB precomputed fixture map replaces the full-workshop capture. Bounded lighting and one scene pass replace full-screen bloom, fog and the live floor mirror. Brickwork remains; the floor avoids the old many-sample blur.
- Raycasting-index construction runs in a Web Worker. Main-thread triangle collection yields in short slices. Loading avoids rendering half-configured scenes; StrictMode's throwaway effect does not allocate a GPU context.
- Mobile renders at up to 2x CSS resolution with antialiasing. Motion resolution bottoms out at 85% and returns to full resolution after settling.
- Garage panels no longer blur the moving canvas behind them.

The room now has simpler reflections and a crisper appearance. It still renders the real exported car and garage in 3D; Blender itself is not running in the browser. Actual startup depends on the network, phone and GPU. Local timings in `output/performance-verification/report.json` are not measurements from a physical phone.

## Reproduce checks

```bash
npm run generate:lighting
npm run build
# With npm run dev active, uses installed Edge:
node scripts/verify-garage-performance.mjs
node scripts/verify-orbit.mjs http://localhost:5173 output/performance-verification/orbit
# Builds a live-mode copy, intercepts Supabase URLs with local fixtures,
# and verifies model exclusion, CSP, WASM, workers and analytics consent:
node scripts/verify-csp.mjs
```

Original uncompressed exports for this revision are in `output/model-optimization/originals/`; Blender sources are unchanged. Compression used glTF Transform 4.5.1 `meshopt --quantize-position 16 --quantize-normal 14 --quantize-texcoord 14 --quantization-volume scene`. `scripts/publish-optimized-models.mjs` checks topology, materials and part metadata against those originals before publishing matching outputs. A new Blender export produces uncompressed GLBs; compress and validate it before the next upload.
