# Reference-guided S6 C5 Avant refinement

The orbitable car has been revised against the supplied front, side and rear
images. This is an editable procedural reconstruction, not an OEM CAD model or
a photogrammetry scan. The references guide the appearance; they are not pasted
onto the body with their photographed garage lighting baked in.

The revision adds two larger, shallow headlamp optics in a common chrome and
grey reflector assembly, outer indicator prisms, washer and tow-eye covers,
larger grille rings and a clean front bumper. The rear B 08046 plate remains.
Rear lamps use separate ruby and clear reflector cells, with a ribbed lower
valance and thicker rolled quad exhaust lips. Broader graphite five-spoke wheels,
stronger wing flares, a highlighted sill edge and a recessed floor tray improve
the body profile. Seats and glazing are darker. The touring roof box is larger
to match its proportions in the references, with lid ribs, a parting seam and
metal latches. Exterior camera presets sit closer to the reference camera height.

The later stock white-car and wireframe references also correct the greenhouse:
the rear quarter glass extends to x = -2.07 m as a broad trapezoid, the separator
leans only 70 mm, and the oversized painted D-pillar is reduced. Roof shoulders
use a curved transition. The rear glass border follows its parameter surface;
it no longer uses world-space strips that could fold into triangular patches.
Three separate rear headrests and a low tapered load cover replace the broad
interior shapes that intersected the rear glazing. Front lamps wrap less into
the wing, with the bumper seam beginning below them. Wheel faces are broader
and less deeply dished, with a brighter satin graphite finish.

## Asset delivery

`src/lib/modelAssets.js` selects the bundled versioned car at
`/car-releases/reference-v2/s6-c5.glb`, including in live builds. This is an
intentional exception to the earlier all-models-on-Supabase delivery: the
existing garage GLB and shared workshop HDR retain their configured hosting.
The original `/models/s6-c5.glb` is preserved for comparison and recovery.

The release has an offline 1024 × 512 reflection HDR for paint, chrome and the
black roof box. It adds ceiling and wall strip reflections without extra scene
cameras or rendering passes. Its strength follows the existing brightness
slider. Other materials retain the shared workshop probe.

## Rebuilding and verification

Run `node scripts/rebuild-car.mjs` with Blender and a local glTF Transform CLI.
Optional `--blender PATH` and `--cli PATH` select those tools. The wrapper builds
only the car, compresses it with Meshopt medium, and records checksums, part IDs
and dimensions in the release manifest. Medium preserves 14-bit normal precision;
the CLI's high preset would force normals to 8 bits. The garage and original car
checksums must remain unchanged. Editable Blender output and build logs go to
`output/car-refinement/reference-v2/`.

Run `node scripts/make-car-environment.mjs` to regenerate the reflection HDR.
`tests/car-release.test.js` decodes the actual compressed geometry, checks finite
positions and normals, indices, scale, interactive part IDs, checksums and HDR
validity. The garage lab now loads the same environments as production. Use its
`original=1` query to compare the preserved car under the same lighting.
