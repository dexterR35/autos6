"""Build the editable 2003 S6 C5 Avant in the workshop, then render its website camera views.

blender -b --python scripts/build_s6_c5.py
S6_VIEWS=exterior-a S6_SAMPLES=32 S6_PERCENT=60 for a fast review render.
The car itself comes from scripts/s6c5 (parametric body, lamps, grille,
wheels, cabin, roof box); scripts/s6c5_preview.py renders it without the garage.
The existing garage and reference images are only read, never overwritten.
"""
import json
import math
import os
import sys
from pathlib import Path

import bpy
import numpy as np
from bpy_extras.object_utils import world_to_camera_view
from mathutils import Vector

ROOT = Path(__file__).resolve().parents[1]
OUT = ROOT / 'output' / 's6'
OUT.mkdir(parents=True, exist_ok=True)
sys.path.insert(0, str(ROOT / 'scripts'))
from s6c5 import spec  # noqa: E402
from s6c5.build import Builder  # noqa: E402
from s6c5.materials import make_materials  # noqa: E402
from s6c5.roof import BOX  # noqa: E402

bpy.ops.wm.open_mainfile(filepath=str(ROOT / 'output/garage/garage_reference.blend'))
scene = bpy.context.scene
collection = bpy.data.collections.new('10 | 2003 Audi S6 C5 Avant')
scene.collection.children.link(collection)

builder = Builder(collection, make_materials())
car_objects = builder.build()
root = bpy.data.objects.new('S6 | vehicle master - rotate for angle', None)
collection.objects.link(root)
for o in car_objects:
    o.parent = root
root.location = (0, -5.5, 0)
root.rotation_euler.z = math.radians(-31)
root['Vehicle'] = '2003 Audi S6 C5 Avant, as in the reference photographs'
root['Dimensions'] = '4.81 m length / 1.85 m body width / 2.845 m wheelbase (reference proportions)'
root['Finish'] = 'Deep blue pearl, polished clearcoat; graphite five-spoke 20 in wheels, red calipers'
root['Accessory'] = 'Removable black roof cargo box and crossbars'
root['Fidelity'] = 'Procedural visual reconstruction; not an OEM CAD or dimensional scan'

# Focused rectangular lights produce long clean reflections in the clearcoat.
studio = bpy.data.collections.new('11 | S6 reflection lighting')
scene.collection.children.link(studio)


def area(name, p, target, color, energy, size, size_y):
    d = bpy.data.lights.new(name, 'AREA')
    d.shape = 'RECTANGLE'
    d.energy, d.color, d.size, d.size_y = energy, color, size, size_y
    o = bpy.data.objects.new(name, d)
    studio.objects.link(o)
    o.location = p
    o.rotation_euler = (Vector(target) - o.location).to_track_quat('-Z', 'Y').to_euler()


area('S6 | long overhead key', (-1, -5.0, 4.25), (0, -4.1, .5), (.76, .86, 1), 650, 5, .68)
area('S6 | front softbox', (3, -8.4, 3.0), (0, -4.1, .8), (.83, .9, 1), 380, 3.7, 1.15)
area('S6 | blue edge reflection', (-2, -2.2, 2.7), (0, -4.1, 1), (.08, .28, 1), 220, 3.7, .18)
area('S6 | warm edge reflection', (1.5, -1.9, 3.3), (0, -4.1, 1), (1, .58, .32), 130, 3.4, .28)
area('S6 | low soft fill', (-3, -7.2, 1.65), (0, -4.1, .65), (.52, .69, 1), 110, 2.6, .85)
for light_ob in studio.objects:
    light_ob.location.y -= 1.4

# Keep foreground workshop equipment beside the car instead of over its nose.
for c_name in ['04 | Red workshop cabinets and benches', '05 | Tools bottles tires and foreground equipment']:
    for o in bpy.data.collections[c_name].objects:
        center = sum((o.matrix_world @ Vector(p) for p in o.bound_box), Vector()) / 8
        if center.y < -2.6:
            o.location.x += 2.7 if center.x > 0 else -1.2

# Tame the previous floor's coarse bump to reflect the car without rippling it.
floor = bpy.data.materials.get('Wet concrete | irregular puddles aggregate and cracks')
if floor:
    for n in floor.node_tree.nodes:
        if n.type == 'BUMP':
            n.inputs['Distance'].default_value *= .35

camera = scene.camera
camera.location = (1.15, -13, 1.78)
camera.rotation_euler = (Vector((0, -5.5, .70)) - camera.location).to_track_quat('-Z', 'Y').to_euler()
camera.data.lens = 37
camera.data.dof.use_dof = True
camera.data.dof.focus_object = root
camera.data.dof.aperture_fstop = 11
scene.render.resolution_x = 1672
scene.render.resolution_y = 941
scene.render.resolution_percentage = int(os.environ.get('S6_PERCENT', '100'))
scene.cycles.samples = int(os.environ.get('S6_SAMPLES', '160'))
scene.cycles.use_denoising = True
scene.cycles.max_bounces = 9
scene.cycles.transmission_bounces = 6
scene.view_settings.look = 'AgX - Medium High Contrast'
scene.view_settings.exposure = .05
prefs = bpy.context.preferences.addons['cycles'].preferences
try:
    prefs.compute_device_type = 'CUDA'
    prefs.get_devices()
    for d in prefs.devices:
        d.use = d.type == 'CUDA'
    scene.cycles.device = 'GPU' if any(d.use for d in prefs.devices) else 'CPU'
except Exception:
    scene.cycles.device = 'CPU'
print('RENDER_DEVICE', scene.cycles.device, [(d.name, d.type, d.use) for d in prefs.devices], flush=True)
scene['Scope'] = 'Editable garage with modeled 2003 S6 C5 Avant; render source for the website.'
scene['S6 specification source'] = 'https://www.audiworld.com/model/s6/03/03s6avant.pdf'
scene['S6 reconstruction'] = ('Parametric C5 facelift Avant body with exact lamp, grille and intake openings and analytic '
                              'surface normals; flake metallic paint; vented cross-drilled discs, pads and two-piece calipers; '
                              'graphite five-spoke wheels; quad exhaust. Visual reconstruction, not OEM CAD.')
scene.unit_settings.system = 'METRIC'
for screen in bpy.data.screens:
    for a in screen.areas:
        if a.type == 'VIEW_3D':
            a.spaces.active.region_3d.view_perspective = 'CAMERA'
            a.spaces.active.region_3d.view_camera_zoom = 5
            a.spaces.active.shading.type = 'MATERIAL'
bpy.context.view_layer.update()
scene.render.filepath = str(OUT / 'exterior-a.png')
bpy.ops.wm.save_as_mainfile(filepath=str(OUT / 'audi_s6_c5_2003.blend'))
print('S6_SAVED', len(car_objects), 'car objects', flush=True)

# Hotspot anchors on the real surfaces (vehicle coordinates, left side; y is
# mirrored to the camera's side). Also written for the 3D viewer in glTF axes.
b, lay = builder.body, builder.lay


def on_body(s, z, out=0.0):
    p, n = builder.frame_at(s, z, out)
    return [round(float(v), 4) for v in p], [round(float(v), 4) for v in n]


hood_z = float(b.hood(np.array([1.72]), np.array([0.0]))[0, 2])
box_top = BOX['cz'] + BOX['az'] * 1.03
anchors = {
    'roof-box': ([BOX['cx'], 0.24, box_top], [0, 0, 1]),
    'hood': ([1.72, 0.30, hood_z + 0.01], [0, 0, 1]),
    'front-bumper': on_body(float(b.s_front(0.43)), 0.47, 0.01),
    'wheels': ([spec.X_AXLE_F, 0.935, spec.WHEEL_Z], [0, 1, 0]),
    'brake-kit': ([spec.X_AXLE_R, 0.935, spec.WHEEL_Z + 0.01], [0, 1, 0]),
    'side-skirts': on_body(float(b.s_of_side_x(-0.05)), 0.29, 0.01),
    'rear-bumper': on_body(float(b.s_rear(0.39)), 0.50, 0.01),
    'exhaust': on_body(float(b.s_rear(0.523)), 0.262, 0.03),
}
gltf = {k: {'position': [p[0], p[2], -p[1]], 'normal': [n[0], n[2], -n[1]]} for k, (p, n) in anchors.items()}
(OUT / 'anchors-3d.json').write_text(json.dumps({'vehicle': anchors, 'gltfLeft': gltf}, indent=2))
print('ANCHORS', json.dumps(anchors), flush=True)

angles = {
    'exterior-a': (-31, 37), 'exterior-b': (-42, 40),
    'exterior-c': (-22, 37), 'exterior-d': (-55, 37),
    'front': (-81.28, 40), 'side-a': (8.72, 35), 'side-b': (188.72, 35),
    'rear-quarter-a': (145, 37), 'rear-quarter-b': (43, 37), 'rear': (98.72, 40),
}
requested = os.environ.get('S6_VIEWS', ','.join(angles)).split(',')
if requested == ['none']:
    # Rebuild the editable scene and anchors only (for example before a web export).
    requested = []
manifest_path = OUT / 'render-manifest.json'
report = json.loads(manifest_path.read_text()) if manifest_path.exists() and len(requested) < len(angles) else {}
if not requested:
    print('ALL_S6_RENDERS_COMPLETE (scene only)', flush=True)
    raise SystemExit(0)


def projected(p):
    q = world_to_camera_view(scene, camera, root.matrix_world @ Vector(p))
    return {'x': round(q.x, 5), 'y': round(1 - q.y, 5)}


L = b.L
for view in requested:
    angle, lens = angles[view]
    root.rotation_euler.z = math.radians(angle)
    camera.data.lens = lens
    bpy.context.view_layer.update()
    inv = root.matrix_world.inverted() @ camera.location
    s = -1 if inv.y < 0 else 1
    if view == 'front':
        visible = ['roof-box', 'hood', 'front-bumper']
    elif view == 'rear':
        visible = ['roof-box', 'rear-bumper', 'exhaust']
    elif view in ['side-a', 'side-b']:
        visible = ['roof-box', 'hood', 'front-bumper', 'wheels', 'side-skirts', 'rear-bumper', 'brake-kit']
    elif view.startswith('rear-quarter'):
        visible = ['roof-box', 'rear-bumper', 'exhaust', 'wheels', 'brake-kit', 'side-skirts']
    else:
        visible = ['roof-box', 'hood', 'front-bumper', 'wheels', 'side-skirts', 'brake-kit']
    pts = [projected((x, y, z)) for x in [-2.40, 0, 2.43] for y in [-.97, .97] for z in [0, 1.45]]
    pts.extend([projected((BOX['cx'] - BOX['ax'], 0, box_top)), projected((BOX['cx'] + BOX['ax'], 0, box_top))])
    focus = {'x0': max(0, min(p['x'] for p in pts) - .025), 'y0': max(0, min(p['y'] for p in pts) - .025),
             'x1': min(1, max(p['x'] for p in pts) + .025), 'y1': min(1, max(p['y'] for p in pts) + .025)}
    hotspots = []
    for part in visible:
        (x, y, z), _ = anchors[part]
        hotspots.append({'partId': part, **projected((x, s * y, z))})
    report[view] = {'width': 1672, 'height': 941, 'focus': focus, 'hotspots': hotspots}
    scene.render.filepath = str(OUT / (view + '.png'))
    print('RENDERING', view, report[view], flush=True)
    bpy.ops.render.render(write_still=True)
    print('RENDERED', view, flush=True)
manifest_path.write_text(json.dumps(report, indent=2))
print('ALL_S6_RENDERS_COMPLETE', flush=True)
