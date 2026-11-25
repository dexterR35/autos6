"""Render a close view of the editable blue sport interior, without saving the pose."""
from pathlib import Path
import math
import bpy
from mathutils import Vector

folder = Path(__file__).resolve().parents[1] / 'output/car-refinement/a6-c5-v1'
bpy.ops.wm.open_mainfile(filepath=str(folder / 'audi_a6_c5_rigged.blend'))
readme = bpy.data.texts.get('START HERE | Audi A6 C5 rig')
if readme:
    original = readme.as_string()
    updated = original.replace('royal-blue inserts, midnight-blue bolsters', 'matching dark-blue inserts and lateral bolsters').replace('dashboard and headlining are charcoal/navy', 'dashboard is navy and headlining is black Alcantara')
    if updated != original:
        readme.clear()
        readme.write(updated)
    bpy.ops.wm.save_as_mainfile(filepath=str(folder / 'audi_a6_c5_rigged.blend'))
for key, angle in [('door-fl', 68), ('door-fr', -68)]:
    bpy.data.objects['A6.Hinge.' + key].rotation_euler.z = math.radians(angle)
scene = bpy.context.scene
camera = scene.camera
camera.location = (1.40, -2.30, 1.90)
camera.rotation_euler = (Vector((-.12, .04, .85)) - camera.location).to_track_quat('-Z', 'Y').to_euler()
camera.data.lens = 53
scene.render.resolution_x, scene.render.resolution_y = 1400, 1000
scene.cycles.samples = 40
scene.render.filepath = str(folder / 'blue-recaro-interior.png')
bpy.ops.render.render(write_still=True)
