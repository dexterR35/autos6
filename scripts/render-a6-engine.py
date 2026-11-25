"""Render the fitted V6 biturbo with the bonnet open; leave saved pose closed."""
from pathlib import Path
import math
import bpy
from mathutils import Vector

folder = Path(__file__).resolve().parents[1] / 'output/car-refinement/a6-c5-v1'
bpy.ops.wm.open_mainfile(filepath=str(folder / 'audi_a6_c5_rigged.blend'))
bpy.data.objects['A6.Hinge.hood'].rotation_euler.y = -math.radians(62)
scene = bpy.context.scene
scene.camera.location = (3.45,-1.40,2.75)
scene.camera.rotation_euler = (Vector((1.62,0,.64))-scene.camera.location).to_track_quat('-Z','Y').to_euler()
scene.camera.data.lens = 47
scene.render.resolution_x,scene.render.resolution_y = 1500,1100
scene.cycles.samples = 32
scene.render.filepath = str(folder / 'v6-biturbo-engine.png')
bpy.ops.render.render(write_still=True)
scene.camera.location = (4.25,-1.85,2.05)
scene.camera.rotation_euler = (Vector((1.50,0,1.10))-scene.camera.location).to_track_quat('-Z','Y').to_euler()
scene.camera.data.lens = 50
scene.render.filepath = str(folder / 'bonnet-underside.png')
bpy.ops.render.render(write_still=True)
