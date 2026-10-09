"""Fast review renders of the procedural S6 Avant in a neutral studio (no garage).

blender -b --factory-startup --python scripts/s6c5_preview.py -- OUTDIR [views] [engine] [percent]
views: comma list of ref1,ref2,ref3,ref6,ref7,ref9,side,top,wheel,grille,tail (default ref1,ref3,ref7,ref2,ref6)
engine: EEVEE (default) | CYCLES | WORKBENCH | ZEBRA (mirror paint, striped sky: surface check)
The ref* cameras approximate the angles of the reference photographs.
"""
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
from s6c5.materials import make_materials  # noqa: E402

args = sys.argv[sys.argv.index('--') + 1:] if '--' in sys.argv else []
out = Path(args[0]) if args else ROOT / 'output' / 's6' / 'preview'
views = (args[1] if len(args) > 1 else 'ref1,ref3,ref7,ref2,ref6').split(',')
engine = args[2] if len(args) > 2 else 'EEVEE'
percent = int(args[3]) if len(args) > 3 else 60
out.mkdir(parents=True, exist_ok=True)

bpy.ops.wm.read_factory_settings(use_empty=True)
scene = bpy.context.scene
col = bpy.data.collections.new('10 | 2003 Audi S6 C5 Avant')
scene.collection.children.link(col)

t0 = time.time()
builder = build.Builder(col, make_materials())
parts = builder.build()
print('BUILT', len(parts), 'objects in', round(time.time() - t0, 1), 's', flush=True)
dg = bpy.context.evaluated_depsgraph_get()
tris = 0
for o in parts:
    if o.type == 'MESH':
        me = o.evaluated_get(dg).to_mesh()
        tris += sum(len(p.vertices) - 2 for p in me.polygons)
print('TRIANGLES', tris, flush=True)

bpy.ops.mesh.primitive_plane_add(size=60, location=(0, 0, 0))
ground = bpy.context.object
gm = bpy.data.materials.new('ground')
gm.use_nodes = True
gb = gm.node_tree.nodes['Principled BSDF']
gb.inputs['Base Color'].default_value = (0.03, 0.032, 0.036, 1)
gb.inputs['Roughness'].default_value = 0.25
gb.inputs['Metallic'].default_value = 0.0
gm.diffuse_color = (0.3, 0.3, 0.32, 1)
ground.data.materials.append(gm)

world = bpy.data.worlds.new('studio')
world.use_nodes = True
wn = world.node_tree.nodes
bg = wn['Background']
grad = wn.new('ShaderNodeTexGradient')
grad.gradient_type = 'LINEAR'
mapping = wn.new('ShaderNodeMapping')
coord = wn.new('ShaderNodeTexCoord')
mapping.inputs['Rotation'].default_value = (0, -math.pi / 2, 0)
ramp = wn.new('ShaderNodeValToRGB')
ramp.color_ramp.elements[0].color = (0.02, 0.025, 0.035, 1)
ramp.color_ramp.elements[1].color = (0.55, 0.62, 0.75, 1)
links = world.node_tree.links
links.new(coord.outputs['Generated'], mapping.inputs['Vector'])
links.new(mapping.outputs['Vector'], grad.inputs['Vector'])
links.new(grad.outputs['Fac'], ramp.inputs['Fac'])
links.new(ramp.outputs['Color'], bg.inputs['Color'])
bg.inputs['Strength'].default_value = 0.6
scene.world = world
for loc, energy, size, color in [((0, 0, 6), 1600, 6, (1, 1, 1)), ((5, -6, 3), 900, 4, (0.8, 0.88, 1)),
                                  ((-6, -4, 2.5), 500, 3, (1, 0.5, 0.55)), ((-5, 6, 3), 600, 4, (0.5, 0.65, 1)),
                                  ((7, 3, 2), 500, 3, (0.9, 0.9, 1))]:
    ld = bpy.data.lights.new('l', 'AREA')
    ld.energy, ld.size, ld.color = energy, size, color
    lo = bpy.data.objects.new('l', ld)
    lo.location = loc
    lo.rotation_euler = (Vector((0, 0, 0.6)) - Vector(loc)).to_track_quat('-Z', 'Y').to_euler()
    scene.collection.objects.link(lo)

if engine == 'ZEBRA':
    # Surface inspection: paint becomes a perfect mirror of horizontal stripes.
    zebra = bpy.data.materials.new('zebra mirror')
    zebra.use_nodes = True
    zb = zebra.node_tree.nodes['Principled BSDF']
    zb.inputs['Base Color'].default_value = (1, 1, 1, 1)
    zb.inputs['Metallic'].default_value = 1.0
    zb.inputs['Roughness'].default_value = 0.0
    for o in parts:
        if o.type == 'MESH':
            for slot in o.material_slots:
                if slot.material and 'deep blue pearl' in slot.material.name:
                    slot.material = zebra
    wn.clear()
    wc = wn.new('ShaderNodeTexCoord')
    wave = wn.new('ShaderNodeTexWave')
    wave.wave_type = 'BANDS'
    wave.bands_direction = 'Z'
    wave.inputs['Scale'].default_value = 2.2
    wave.inputs['Distortion'].default_value = 0.0
    wramp = wn.new('ShaderNodeValToRGB')
    wramp.color_ramp.interpolation = 'CONSTANT'
    wramp.color_ramp.elements[1].position = 0.5
    wbg = wn.new('ShaderNodeBackground')
    wout = wn.new('ShaderNodeOutputWorld')
    links.new(wc.outputs['Generated'], wave.inputs['Vector'])
    links.new(wave.outputs['Fac'], wramp.inputs['Fac'])
    links.new(wramp.outputs['Color'], wbg.inputs['Color'])
    links.new(wbg.outputs['Background'], wout.inputs['Surface'])
    for o in scene.objects:
        if o.type == 'LIGHT':
            o.data.energy = 0
    ground.hide_render = True
    scene.render.engine = 'BLENDER_EEVEE'
    scene.eevee.taa_render_samples = 16
elif engine == 'CYCLES':
    scene.render.engine = 'CYCLES'
    scene.cycles.samples = 48
    scene.cycles.use_denoising = True
    try:
        prefs = bpy.context.preferences.addons['cycles'].preferences
        prefs.compute_device_type = 'CUDA'
        prefs.get_devices()
        for d in prefs.devices:
            d.use = d.type == 'CUDA'
        scene.cycles.device = 'GPU' if any(d.use for d in prefs.devices) else 'CPU'
    except Exception:
        scene.cycles.device = 'CPU'
elif engine == 'WORKBENCH':
    scene.render.engine = 'BLENDER_WORKBENCH'
    sh = scene.display.shading
    sh.light = 'STUDIO'
    sh.color_type = 'MATERIAL'
    sh.show_cavity = True
    sh.show_specular_highlight = True
else:
    scene.render.engine = 'BLENDER_EEVEE'
    scene.eevee.taa_render_samples = 24
    try:
        scene.eevee.use_raytracing = True
    except AttributeError:
        pass
scene.view_settings.view_transform = 'AgX'
scene.view_settings.look = 'AgX - Medium High Contrast'
scene.render.resolution_x, scene.render.resolution_y = 1672, 941
scene.render.resolution_percentage = percent

# (location, target, lens mm)
cams = {
    'ref1': ((6.3, -6.9, 1.35), (0.25, 0.0, 0.78), 42),
    'ref9': ((5.0, -4.9, 1.25), (0.6, 0.0, 0.75), 38),
    'ref3': ((0.15, -10.5, 0.95), (0.15, 0.0, 0.80), 38),
    'ref7': ((8.6, 0.0, 1.45), (0.0, 0.0, 0.85), 45),
    'ref2': ((-8.6, 0.0, 1.5), (0.0, 0.0, 0.85), 45),
    'ref6': ((-6.4, -6.0, 1.7), (-0.4, 0.0, 0.8), 40),
    'side': ((0.0, 10.5, 0.9), (0.0, 0.0, 0.75), 38),
    'top': ((0.0, 0.0, 14.0), (0.0, 0.0, 0.0), 40),
    'wheel': ((1.9, -3.0, 0.45), (1.47, -0.8, 0.33), 50),
    'grille': ((4.4, -0.9, 0.85), (2.35, -0.1, 0.62), 50),
    'tail': ((-4.3, -1.6, 1.0), (-2.3, -0.3, 0.72), 50),
    'brake': ((1.75, -2.2, 0.42), (1.50, -0.8, 0.36), 70),
    'pads': ((1.05, -1.9, 0.75), (1.33, -0.8, 0.36), 75),
    'hood': ((4.6, -2.6, 1.9), (1.2, 0.0, 0.8), 40),
}
for view in views:
    loc, target, lens = cams[view]
    cd = bpy.data.cameras.new(view)
    cd.lens = lens
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
if '--save' in sys.argv:
    bpy.ops.wm.save_as_mainfile(filepath=str(out / 'preview.blend'))
