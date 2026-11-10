> Superseded for the body and rendering by [CAR-SHOWROOM-FINISH.md](CAR-SHOWROOM-FINISH.md) (release `imported-v4`).

# Audi paint, panel curves and mesh cleanup

The active `/car-releases/imported-v3/s6-c5.glb` now uses clean deep-blue
pearl paint with physical clearcoat. Paint no longer samples photographed
reflections from the uploaded colour atlas. Rubber, graphite alloy, chrome,
lamp lenses, caliper enamel and cabin plastics have separate PBR finishes;
glazing and the gloss-black touring box retain their dedicated surfaces.
The original atlas still supplies lettering, plates and component details.

Body cleanup welds UV seams logically, denoises the painted shell, and fits
curved surfaces to the bonnet and door skins. Robust fitting rejects small
surface dents; analytic panel normals produce smoother highlights. Hard seams
stay fixed and total vertex movement is capped at 18 mm. This remains a
refinement of the supplied generated model, rather than an OEM CAD rebuild.

Winding-independent duplicate faces and zero-area faces are removed before
and after simplification. Simplification locks open borders, preserves all nine
interactive part IDs and uses a relative geometric error limit of 0.00025.
The initial finish revision had 253,356 triangles, down from 459,538 in the
previous release (about 45%). The later Blender running-gear revision adds
separate assemblies and two tyre alternatives; see `MODULAR-AUDI-PARTS.md` and
the current release manifest for its geometry totals. The original upload and
garage GLB are preserved and hashed.

Rebuild the staging model with `node scripts/build-imported-car.mjs`; add
`--publish` to replace the bundled release and its manifest. Both operations
use the pinned local glTF tools. Reports and the uncompressed working model
are written to `output/car-refinement/imported-v3/`.

For visual inspection, run `npm run dev:web` and open
`/scripts/garage-lab.html?shot=car34&candidate=staging&orbit=1`.
The `carside` and `carrear34` shots provide complementary views.
`surface=paint` temporarily removes the photographic trim atlas in the lab
to distinguish reflection/shading defects from texture defects.

Validation: the car-release tests decode the shipped compressed geometry and
check scale, bounds, indices, normals, checksums, material separation and the
triangle budget. Surface-cleanup tests cover UV-seam duplicates, reversed and
degenerate faces, curved panel fitting, movement caps and pinned seams.
