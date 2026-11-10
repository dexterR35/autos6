# Editable Audi wheel, tyre and brake assemblies

Open `output/car-refinement/imported-v3/audi_s6_modular.blend` in Blender.
The current imported Audi body is the fit reference. Its generated wheel
surfaces have been removed and replaced with newly constructed Blender parts.
The original upload is preserved.

In the Outliner, expand **10 | Modular wheels, tyres and brakes**. FL, FR,
RL and RR each have an assembly parent at the axle. Each wheel contains
separately selectable rim, polished lip, hub/cap, Audi badge, bolts, tyre,
drilled brake disc, rotor hat, caliper halves/bridges, pads and backing panels.
The project also has an embedded **START HERE** text with editing instructions.

## Change colours and tyres

- Rim colour: edit the Base Color of `S6.Modular.RimPaint`.
- Caliper colour: edit the Base Color of `S6.Modular.CaliperPaint`.
- Tyres: hide the `Tyre | road` object and unhide `Tyre | track` in each wheel
  collection. Both alternatives have the same bead and axle placement.
- Components use linked meshes where they are identical. To edit one wheel's
  geometry independently, use **Object > Relations > Make Single User >
  Object & Data** first.

In the website, choose **Customize wheels and brakes** in the camera toolbar.
It has preset/custom rim and caliper colours, Road/Track tyre buttons, and a
reset action. Settings are saved in this browser. Tyre switching changes the
visible geometry; hidden alternatives are excluded from picking and occlusion.

## Rebuild and export

`node scripts/build-imported-car.mjs --publish` rebuilds the body and invokes
Blender to construct the running gear, save the native project and export its
GLB. This regenerates the working Blender project, so save personal changes
under another name before rebuilding from the script.

To use edits from Blender, export just the four wheel assembly parents and
their mesh children to `output/car-refinement/imported-v3/modular-wheels.glb`.
Temporarily show both tyre alternatives, enable **Custom Properties**, retain
the named component materials and metadata, and exclude the body/studio.
Then run `node scripts/build-imported-car.mjs --reuse-wheels --publish`.
This command preserves the hand-edited Blender project and wheel GLB.

The native project keeps machining details separate. The web export batches
details of the same component/material to limit draw calls, while retaining
component IDs and the four independent assembly parents. Meshes are shared
between corners where possible. The release contains both tyre alternatives;
only the chosen alternative is rendered.

## Validation

`node scripts/verify-wheel-setup.mjs` checks real WebGL colour/tyre changes,
reload persistence, reset, keyboard dismissal and the mobile controls.
The car release tests decode the compressed GLB and verify all four corners,
component IDs, both tyre variants, finite geometry, scale and asset checksums.
