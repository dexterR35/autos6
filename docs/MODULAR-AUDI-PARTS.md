# Editable Audi wheel, tyre and brake assemblies

## Current car: supplied Audi A6 C5

The active car is now the supplied **Audi A6 Avant C5**, release `a6-c5-v5-original-glass`.
Open `output/car-refinement/a6-c5-v1/audi_a6_c5_rigged.blend` for the packed,
editable model. It preserves the source body geometry, UVs and badges,
4.8 m length and 2.76 m wheelbase. Its paint uses the previous car's exact deep
blue PBR values. The source OBJ and MTL in Downloads are read only.

The cabin has dark blue Recaro-style front sport seats with separately editable
inserts, thigh/torso/shoulder bolsters, headrests, rails and RECARO embroidery.
The inserts and lateral bolsters share the same dark blue colour, with softer
bolsters shaped toward the supplied seat references. The rear bench and door
cards match. The roof is black Alcantara with an embedded microfibre normal map.
The original cream upholstery has been replaced.

Choose **Interior** in the site's camera strip to enter the cabin. It has its
own close orbit/zoom limits, a wider lens on phones and a matching image fallback.
Choosing an exterior camera restores the normal garage camera limits.

The **Engine** camera opens the bonnet automatically and frames the fitted
**2.7 V6 biturbo**. It supports close inspection on desktop and a wider lens on
phones. The bonnet remains manually operable in the car-controls panel.

The engine is reconstructed from the three supplied photos archived under
`docs/reference/v6-biturbo/`, with the supplied
[engine-parts catalogue](https://audi.oempartsonline.com/v-2004-audi-a6-quattro--base--2-7l-v6-gas/engine--engine-parts)
as a component reference. It is a visual reconstruction, not measured OEM CAD.
Expand **Engine bay | Audi 2.7 V6 biturbo** in Blender for the long block,
cylinder heads, silver Y intake, black vent panels, four-ring/V6/BITURBO badges,
orange dipstick, twin turbos, blue charge elbows, cone filter and ribbed intake,
drive belt/alternator, radiator/fans, coolant/service reservoirs, hoses and looms.
The engine stays fixed to the chassis while the bonnet and fitted insulation move.

The bonnet also carries the complete upper grille, chrome surround and Audi
rings. The lower bumper grilles and headlights remain fixed. Fitted headlight
housings, a continuous radiator support with mounted latch/fasteners, folded
blue wing gutters and arched wheel liners close the previous open bay seams.
`scripts/a6_engine_bay.py` samples the imported lamp and wing edges to build
these surfaces; they remain separately editable in the native Blender file.
The suspension aprons now roll into pressed turret shoulders. Their recessed
gutters include swages, lap seams, painted spot welds, flange bolts and clipped
wing harnesses, with a satin finish using the same deep blue base colour.

`scripts/a6_bonnet.py` builds a painted inner pressing with rolled edges and
shallow reinforcing channels around a contoured acoustic felt pad. The pad
has bound edges, ten retaining buttons and a packed fibre normal map. Frame
access recesses, hinge bolts and a safety-catch loop add underside detail.
The gas support follows the moving bonnet with a Damped Track constraint and
distance driver in Blender; `carRig.js` mirrors that orientation and piston
extension in the browser. Its moving meshes stay outside the static ray index.

`scripts/a6_engine.py` authors the engine and tests top-component clearance
against the closed bonnet and its new insulation. The old flat bay placeholder
is removed. Clearance is recorded in the release manifest for this imported
body geometry. `node scripts/verify-a6-engine.mjs` checks the actual Engine
camera, automatic/manual bonnet operation, close zoom, mobile lens, fallback
image and real geometry occlusion with the bonnet open and closed.

Dashboard ends and footwell kick panels stay on the fixed body. Four complete
inner door-card shells move with their hinges. The original window panes and
frames define the openings above the cabin sills. The boot has a horizontal floor, quarter linings, wheel
housings and a low loading sill. The original upright hatch liner follows the
tailgate instead of blocking the cargo opening. These linings are built in
`scripts/a6_cabin.py` and stay separately editable in the Blender hierarchy.

The website toolbar's **Doors, panels and steering** button opens **Explore the
A6**. Each of the four doors, bonnet and tailgate opens independently. The
steering and wheel rotation sliders demonstrate the separate axle joints.
**Close all & reset wheels** returns the complete car to its assembled pose.
Wheel colour, caliper colour, and Road/Track controls remain available under
**Customize wheels and brakes**.

In Blender, expand the Audi car hierarchy:

- `A6.Hinge.door-fl/fr/rl/rr`: four front-edge hinges with local rotation limits.
  Each carries its skin, handle, mirror (front doors), glass, trim and door card.
- `A6.Hinge.hood` and `A6.Hinge.tailgate`: separate opening panels. The bonnet
  carries its fitted insulation above the independently authored V6 engine.
- `A6.Wheel.FL/FR/RL/RR`: four axle-centred parents. Front parents steer about
  Blender Z (web Y); the source calipers and backing plates follow steering.
- `A6.Roll.FL/FR/RL/RR`: rotate rims, tyres, hubs and discs about Blender Y (web Z).
  Calipers stay on their steering parents and do not spin with the wheels.
- Road/track tyre objects are alternatives; show one per corner. Track tyres
  start hidden in Blender, and the website selects the saved tyre setting.

Twelve named animation clips are retained in the GLB and as muted NLA tracks
in Blender. Unmute a track to inspect it. The embedded **START HERE** text
explains editing and export. Studio objects are excluded from the web model.

Rebuild using Blender 5.2 and the project's pinned Node dependencies:

```powershell
& 'C:\Program Files\Blender Foundation\Blender 5.2\blender.exe' --background --factory-startup --python-exit-code 1 --python scripts/import_a6_c5.py -- --source 'C:\Users\marian.iordache\Downloads\audi-a6-avant-c5-1997-2006\source\tiT7CnSD\1998+Audi+A6+Avant.obj' --render
node scripts/release-a6-c5.mjs
# With the dev server running, refresh matching camera/part thumbnails and fallback images:
node scripts/publish-a6-previews.mjs
```

Save manual Blender edits under a new filename before rebuilding. To publish
manual edits, select the car hierarchy only, temporarily show both tyre variants,
and export GLB with Y Up, Custom Properties and NLA Tracks to
`output/car-refinement/a6-c5-v1/a6-c5-uncompressed.glb`. Run the release command
to batch static surfaces within each joint and compress the web GLB.
The web filename remains `s6-c5.glb` for existing asset-loader compatibility.
Only this current release ships in builds; older authoring releases remain local.

The source colour-chart plane and old roof box are excluded. Current checks:
`npm test -- tests/car-release.test.js tests/carRig.test.js` and
`node scripts/verify-a6-rig.mjs` with the dev server running.

## Previous generated car (archived authoring reference)

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
