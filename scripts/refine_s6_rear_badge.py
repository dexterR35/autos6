"""Correct rear-left S6 badging in an existing render scene without rebuilding it."""
import bpy
import math
from pathlib import Path
from mathutils import Vector

ROOT=Path(__file__).resolve().parents[1]
OUT=ROOT/'output/s6'
bpy.ops.wm.open_mainfile(filepath=str(OUT/'audi_s6_c5_2003.blend'))
scene=bpy.context.scene
root=bpy.data.objects['S6 | vehicle master - rotate for angle']
for o in bpy.data.collections['10 | 2003 Audi S6 C5 Avant'].objects:
    if o.name.startswith('Rear S6 emblem'):
        if o.type=='MESH':
            for v in o.data.vertices:v.co.y=abs(v.co.y)
        elif o.type=='FONT':o.location.y=abs(o.location.y)
scene.cycles.samples=96
prefs=bpy.context.preferences.addons['cycles'].preferences
prefs.compute_device_type='CUDA';prefs.get_devices()
for d in prefs.devices:d.use=d.type=='CUDA'
scene.cycles.device='GPU' if any(d.use for d in prefs.devices) else 'CPU'
bpy.ops.wm.save_as_mainfile(filepath=str(OUT/'audi_s6_c5_2003.blend'))
for view,angle,lens in [('rear-quarter-a',145,37),('rear-quarter-b',43,37),('rear',98.72,40)]:
    root.rotation_euler.z=math.radians(angle)
    scene.camera.data.lens=lens
    scene.render.filepath=str(OUT/(view+'.png'))
    bpy.ops.render.render(write_still=True)
    print('RENDERED',view,flush=True)
