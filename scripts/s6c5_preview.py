"""Fast review renders of the procedural S6 Avant (no garage).

blender -b --factory-startup --python scripts/s6c5_preview.py -- OUTDIR [views] [engine]
views: comma list of side,front,rear,q_front,q_rear,top (default all); engine: WORKBENCH|EEVEE
"""
import importlib
import math
import sys
import time
from pathlib import Path

import bpy
from mathutils import Vector

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT / 'scripts'))
for name in list(sys.modules):
    if name.startswith('s6c5'):
        del sys.modules[name]
import s6c5.build as build  # noqa: E402

args = sys.argv[sys.argv.index('--') + 1:] if '--' in sys.argv else []
out = Path(args[0]) if args else ROOT / 'output' / 's6' / 'preview'
views = (args[1] if len(args) > 1 else 'side,front,rear,q_front,q_rear,top').split(',')
engine = args[2] if len(args) > 2 else 'WORKBENCH'
out.mkdir(parents=True, exist_ok=True)

bpy.ops.wm.read_factory_settings(use_empty=True)
scene = bpy.context.scene
col = bpy.data.collections.new('10 | 2003 Audi S6 C5 Avant')
scene.collection.children.link(col)


def mat(name, color, metal=0.0, rough=0.4, alpha=1.0):
    m = bpy.data.materials.new(name)
    m.diffuse_color = (*color, alpha)
    m.metallic = metal
    m.roughness = rough
    m.use_nodes = True
    bs = m.node_tree.nodes['Principled BSDF']
    bs.inputs['Base Color'].default_value = (*color, 1)
    bs.inputs['Metallic'].default_value = metal
    bs.inputs['Roughness'].default_value = rough
    return m


materials = {
    'paint': mat('S6 | deep blue pearl with polished clearcoat', (0.03, 0.08, 0.22), 0.6, 0.2),
    'glass': mat('S6 | lightly tinted automotive glazing', (0.02, 0.03, 0.04), 0.2, 0.05),
    'black': mat('S6 | black grille and seals', (0.01, 0.01, 0.012), 0.1, 0.4),
    'liner': mat('S6 | wheel arch liner', (0.02, 0.02, 0.02), 0, 0.8),
    'chrome': mat('S6 | polished chrome', (0.8, 0.82, 0.85), 1.0, 0.1),
}
t0 = time.time()
builder = build.Builder(col, materials)
parts = builder.build()
print('BUILT', len(parts), 'objects in', round(time.time() - t0, 1), 's', flush=True)
tris = 0
dg = bpy.context.evaluated_depsgraph_get()
for o in parts:
    me = o.evaluated_get(dg).to_mesh()
    tris += sum(len(p.vertices) - 2 for p in me.polygons)
print('TRIANGLES', tris, flush=True)

# Ground plane and wheels placeholder so the stance reads.
bpy.ops.mesh.primitive_plane_add(size=30, location=(0, 0, 0))
ground = bpy.context.object
ground.data.materials.append(mat('ground', (0.35, 0.35, 0.36), 0, 0.8))
for x in (1.47, -1.289):
    for y in (-0.785, 0.785):
        bpy.ops.mesh.primitive_cylinder_add(radius=0.33, depth=0.25, location=(x, y, 0.33), rotation=(math.pi / 2, 0, 0), vertices=48)
        bpy.context.object.data.materials.append(mat('tyre', (0.02, 0.02, 0.02), 0, 0.7))

cams = {
    'side': ((0.0, 10.5, 0.85), (0.0, 0.0, 0.7), 30),
    'front': ((9.5, 0.0, 1.0), (0.0, 0.0, 0.7), 22),
    'rear': ((-9.5, 0.0, 1.0), (0.0, 0.0, 0.7), 22),
    'q_front': ((6.6, 6.0, 1.9), (0.1, 0.0, 0.6), 30),
    'q_rear': ((-6.6, 6.0, 1.9), (-0.1, 0.0, 0.6), 30),
    'top': ((0.0, 0.0, 14.0), (0.0, 0.0, 0.0), 26),
}
scene.render.resolution_x, scene.render.resolution_y = 1600, 900
if engine == 'EEVEE':
    scene.render.engine = 'BLENDER_EEVEE'
    world = bpy.data.worlds.new('w')
    world.color = (0.5, 0.5, 0.52)
    scene.world = world
    for loc, energy in [((3, 4, 6), 900), ((-4, -3, 5), 500), ((0, 8, 2), 400)]:
        ld = bpy.data.lights.new('l', 'AREA')
        ld.energy = energy
        ld.size = 4
        lo = bpy.data.objects.new('l', ld)
        lo.location = loc
        lo.rotation_euler = (Vector((0, 0, 0.5)) - Vector(loc)).to_track_quat('-Z', 'Y').to_euler()
        scene.collection.objects.link(lo)
else:
    scene.render.engine = 'BLENDER_WORKBENCH'
    sh = scene.display.shading
    sh.light = 'STUDIO'
    sh.color_type = 'MATERIAL'
    sh.show_cavity = True
    sh.cavity_type = 'WORLD'
    sh.show_specular_highlight = True
    sh.background_type = 'VIEWPORT'
    sh.background_color = (0.08, 0.08, 0.09)
# Cameras matched to the reference photographs (see REFERENCE_CAMERAS below).
REFERENCE_CAMERAS = {
    # name: (location, rotation (deg), lens mm, resolution, horizontal stretch of the photo)
    # Side photo: horizontally stretched ~4.5 % (wheels 210 px wide, 200 px tall).
    'ref14': ((0.16, -10.86, 0.68), (90, 0, 0), 57.0, (1914, 1116), 1.045),
}
for view in views:
    if view in REFERENCE_CAMERAS:
        loc, rot, lens, res, _ = REFERENCE_CAMERAS[view]
        cd = bpy.data.cameras.new(view)
        cd.lens = lens
        cd.sensor_fit = 'HORIZONTAL'
        cd.sensor_width = 36
        co = bpy.data.objects.new(view, cd)
        scene.collection.objects.link(co)
        co.location = loc
        co.rotation_euler = tuple(math.radians(a) for a in rot)
        scene.camera = co
        scene.render.resolution_x, scene.render.resolution_y = res
        scene.render.film_transparent = True
        ground.hide_render = True
        scene.render.filepath = str(out / f'{view}.png')
        bpy.ops.render.render(write_still=True)
        ground.hide_render = False
        scene.render.film_transparent = False
        scene.render.resolution_x, scene.render.resolution_y = 1600, 900
        print('RENDERED', view, flush=True)
        continue
    loc, target, lens = cams[view]
    cd = bpy.data.cameras.new(view)
    cd.lens = lens * 2 if view == 'top' else lens * 1.6
    cd.clip_end = 200
    co = bpy.data.objects.new(view, cd)
    scene.collection.objects.link(co)
    co.location = loc
    co.rotation_euler = (Vector(target) - Vector(loc)).to_track_quat('-Z', 'Y').to_euler()
    if view == 'top':
        co.rotation_euler = (0, 0, math.pi / 2)
    scene.camera = co
    scene.render.filepath = str(out / f'{view}.png')
    bpy.ops.render.render(write_still=True)
    print('RENDERED', view, flush=True)
bpy.ops.wm.save_as_mainfile(filepath=str(out / 'preview.blend'))
