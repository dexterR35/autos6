"""Build an editable Blender reconstruction of the supplied S6 garage images.

Run with: blender -b --python scripts/build_blender_garage.py
Every architectural element and prop is an ordinary named mesh in a collection.
"""
import bpy
import math
import os
import random
from mathutils import Vector

ROOT = os.path.abspath(os.path.join(os.path.dirname(__file__), '..'))
OUT = os.path.join(ROOT, 'garage_editable.blend')
REF = os.path.join(ROOT, 'public', 'assets', 'car', 'exterior-a.png')
random.seed(26)
bpy.ops.object.select_all(action='SELECT')
bpy.ops.object.delete(use_global=False)
for collection in list(bpy.data.collections):
    if collection.name != 'Collection':
        bpy.data.collections.remove(collection)
base = bpy.data.collections.get('Collection')
base.name = '00 Scene'

def coll(name):
    c = bpy.data.collections.new(name)
    bpy.context.scene.collection.children.link(c)
    return c

structure = coll('01 Structure | walls, floor, roof')
steel = coll('02 Steel | lift posts and trusses')
fixtures = coll('03 Lighting | editable neon and lamps')
workshop = coll('04 Workshop | cabinets, tools, shelving')
signage = coll('05 Signs | rings and S6 banner')
carcol = coll('06 Audi S6 | editable approximation')
refs = coll('07 References | camera overlay only')

def move(obj, collection):
    for c in list(obj.users_collection): c.objects.unlink(obj)
    collection.objects.link(obj)
    return obj

def mat(name, color, metallic=0, roughness=.5, emission=None, strength=0):
    m=bpy.data.materials.new(name)
    m.diffuse_color=(*color,1)
    m.use_nodes=True
    bs=m.node_tree.nodes.get('Principled BSDF')
    bs.inputs['Base Color'].default_value=(*color,1)
    bs.inputs['Metallic'].default_value=metallic
    bs.inputs['Roughness'].default_value=roughness
    if emission:
        bs.inputs['Emission Color'].default_value=(*emission,1)
        bs.inputs['Emission Strength'].default_value=strength
    return m

concrete=mat('Concrete | stained grey',(.095,.103,.12),.08,.8)
wall_noise=concrete.node_tree.nodes.new('ShaderNodeTexNoise')
wall_noise.inputs['Scale'].default_value=3.8
wall_noise.inputs['Detail'].default_value=4
wall_bump=concrete.node_tree.nodes.new('ShaderNodeBump')
wall_bump.inputs['Strength'].default_value=.27
wall_bump.inputs['Distance'].default_value=.09
concrete.node_tree.links.new(wall_noise.outputs['Fac'],wall_bump.inputs['Height'])
concrete.node_tree.links.new(wall_bump.outputs['Normal'],concrete.node_tree.nodes.get('Principled BSDF').inputs['Normal'])
floor_mat=mat('Floor | wet charcoal concrete',(.021,.025,.032),.32,.13)
floor_nodes=floor_mat.node_tree.nodes
noise=floor_nodes.new('ShaderNodeTexNoise'); noise.inputs['Scale'].default_value=24
noise.inputs['Detail'].default_value=3
bump=floor_nodes.new('ShaderNodeBump'); bump.inputs['Strength'].default_value=.23
bump.inputs['Distance'].default_value=.025
floor_mat.node_tree.links.new(noise.outputs['Fac'],bump.inputs['Height'])
floor_mat.node_tree.links.new(bump.outputs['Normal'],floor_nodes.get('Principled BSDF').inputs['Normal'])
dark=mat('Charcoal painted steel',(.012,.018,.027),.55,.29)
blue_steel=mat('Lift posts | deep navy',(.012,.035,.085),.7,.24)
steel_edge=mat('Metal | worn cool edge',(.16,.18,.20),.72,.34)
yellow=mat('Lift safety yellow',(.72,.40,.018),.35,.32)
red=mat('Tool chest red',(.43,.013,.029),.45,.28)
black=mat('Black rubber and plastic',(.009,.011,.016),.02,.8)
glass=mat('Tinted automotive glass',(.012,.029,.042),.1,.08)
navy=mat('S6 deep blue metallic',(.011,.044,.105),.82,.2)
chrome=mat('Chrome trim',(.62,.7,.76),.95,.12)
white=mat('Warm white tube',(.9,.86,.72),0,.2,(1,.8,.62),5)
blue=mat('Electric blue neon',(.025,.17,.9),0,.2,(.025,.25,1),10)
red_neon=mat('Red neon',(.9,.008,.035),0,.2,(1,.01,.05),8)
amber=mat('Amber lamp',(.85,.38,.08),0,.3,(1,.44,.12),5)
banner=mat('Black cloth banner',(.01,.009,.015),0,.88)
grey_cloth=mat('Grey car cover',(.22,.25,.29),0,.86)

def cube(name, loc, scale, material, collection, bevel=0):
    bpy.ops.mesh.primitive_cube_add(size=1, location=loc)
    ob=move(bpy.context.object,collection)
    ob.name=name
    ob.dimensions=scale
    bpy.ops.object.transform_apply(location=False,rotation=False,scale=True)
    ob.data.materials.append(material)
    if bevel:
        mod=ob.modifiers.new('Edge radius | editable','BEVEL')
        mod.width=bevel
        mod.segments=2
        ob.modifiers.new('Weighted normals','WEIGHTED_NORMAL')
    return ob

def cyl(name, loc, radius, depth, material, collection, vertices=24, rotation=None):
    bpy.ops.mesh.primitive_cylinder_add(vertices=vertices,radius=radius,depth=depth,location=loc)
    ob=move(bpy.context.object,collection); ob.name=name
    if rotation: ob.rotation_euler=rotation
    ob.data.materials.append(material)
    ob.modifiers.new('Weighted normals','WEIGHTED_NORMAL')
    return ob

def beam(name,a,b,width,depth,material,collection):
    a,b=Vector(a),Vector(b)
    ob=cube(name,(a+b)/2,(width,depth,(b-a).length),material,collection)
    ob.rotation_euler=(b-a).to_track_quat('Z','Y').to_euler()
    return ob

def tube(name,a,b,material,collection,radius=.035):
    a,b=Vector(a),Vector(b)
    direction=b-a
    bpy.ops.mesh.primitive_cylinder_add(vertices=12,radius=radius,depth=direction.length,location=(a+b)/2)
    ob=move(bpy.context.object,collection); ob.name=name
    ob.rotation_euler=direction.to_track_quat('Z','Y').to_euler()
    ob.data.materials.append(material)
    return ob

def mesh_obj(name,vertices,faces,material,collection,bevel=0):
    mesh=bpy.data.meshes.new(name)
    mesh.from_pydata(vertices,[],faces); mesh.update()
    ob=bpy.data.objects.new(name,mesh); collection.objects.link(ob)
    mesh.materials.append(material)
    if bevel:
        mod=ob.modifiers.new('Soft body panel edges','BEVEL'); mod.width=bevel; mod.segments=2
        ob.modifiers.new('Weighted normals','WEIGHTED_NORMAL')
    return ob

def text_obj(name,body,loc,size,material,collection,rotation=(math.pi/2,0,0)):
    cu=bpy.data.curves.new(name,'FONT'); cu.body=body; cu.size=size; cu.extrude=.002
    ob=bpy.data.objects.new(name,cu); collection.objects.link(ob)
    ob.location=loc; ob.rotation_euler=rotation; cu.materials.append(material)
    return ob

# Hall proportions follow the visible posts and ceiling of the supplied pictures.
cube('Wet concrete floor',(-2.5,0,-.09),(30,20,.18),floor_mat,structure)
cube('Back masonry wall',(-2.5,8,3.25),(30,.25,6.5),concrete,structure)
cube('Left masonry wall',(-17.4,0,3.25),(.25,20,6.5),concrete,structure)
cube('Right masonry wall',(12.4,0,3.25),(.25,20,6.5),concrete,structure)
cube('Roof slab',(-2.5,0,6.45),(30,20,.28),dark,structure)

# Floor expansion joints, grime patches and wet sheen areas are separate objects.
joint=mat('Floor joint',(.012,.015,.019),0,.9)
for x in range(-12,13,4): cube(f'Floor joint X {x}',(x,0,.006),(.015,20,.003),joint,structure)
for y in range(-9,10,4): cube(f'Floor joint Y {y}',(0,y,.006),(25,.015,.003),joint,structure)
wet=mat('Wet floor puddle',(.026,.035,.05),.35,.065)
for i in range(26):
    x=random.uniform(-10,10); y=random.uniform(-8,7)
    ob=cube(f'Wet patch {i:02d}',(x,y,.008),(random.uniform(.4,2),random.uniform(.2,.9),.005),wet,structure)
    ob.rotation_euler.z=random.uniform(-.4,.4)

for x in [-15,-10,-5,0,5,10]:
    cube(f'Back wall pilaster {x}',(x,7.78,3.1),(.36,.32,6.2),dark,structure)
    cube(f'Ceiling cross beam {x}',(x,0,6.15),(.24,19,.38),steel_edge,steel)
for y in [-7,-2,3,7]:
    cube(f'Ceiling longitudinal beam {y}',(0,y,6.03),(25,.22,.28),dark,steel)
    for x in range(-10,11,5):
        beam(f'Truss diagonal {x},{y}',(x-.8,y,5.55),(x+.8,y,6.12),.055,.055,steel_edge,steel)

# Four-post lift silhouettes with yellow mechanisms and the ground-level arms.
for i,(x,y) in enumerate([(-14.5,1.7),(-1.6,2.0),(5.2,2.2),(9.7,2.2)]):
    cube(f'Lift {i+1} column',(x,y,3.12),(.42,.53,6.24),blue_steel,steel,bevel=.035)
    cube(f'Lift {i+1} base',(x,y,.12),(.93,1.18,.24),yellow,steel,bevel=.025)
    cube(f'Lift {i+1} yellow vertical track',(x,y-.285,2.85),(.12,.06,3.25),yellow,steel)
    cube(f'Lift {i+1} carriage',(x,y-.38,.62),(.63,.25,.45),dark,steel)
    for side in [-1,1]:
        arm=beam(f'Lift {i+1} arm {side}',(x,y-.25,.25),(x+side*1.45,y-1,.25),.18,.18,yellow,steel)
        cyl(f'Lift {i+1} arm pad {side}',(x+side*1.45,y-1,.33),.19,.07,black,steel)

# Workshop wall: shelving, bottles, red cabinets, tire piles, posters.
for x in [-15.5,-13.4,-10.1,-8.0,-5.5,-3.1,2.8,5.8,8.3]:
    cube(f'Tool cabinet {x}',(x,6.6,.9),(1.65,.7,1.7),red,workshop,bevel=.025)
    for z in [.55,.84,1.13,1.42]:
        cube(f'Drawer seam {x} {z}',(x,6.195,z),(1.48,.015,.025),black,workshop)
        cube(f'Drawer handle {x} {z}',(x,6.18,z+.08),(.54,.035,.025),chrome,workshop)
    for shelfz in [2.18,3.25]:
        cube(f'Shelf {x} {shelfz}',(x,7.2,shelfz),(1.65,.55,.09),steel_edge,workshop)
        for j in range(5):
            offset=(j-2)*.26
            cyl(f'Bottle {x} {shelfz} {j}',(x+offset,7.18,shelfz+.17),.055,.29,
                [red,blue_steel,yellow,black,chrome][j],workshop,vertices=10)

for tx,ty in [(-11,2),(10.4,5.7),(11.3,1.2)]:
    for n in range(4):
        cyl(f'Tire stack {tx} {n}',(tx,ty,.17+n*.34),.48,.31,black,workshop,vertices=32)
        cyl(f'Tire hub {tx} {n}',(tx,ty,.17+n*.34),.29,.315,dark,workshop,vertices=32)

for x in [-5.1,-2.5,9.7,11.3]:
    cube(f'Framed wall poster {x}',(x,7.82,3.6),(1.2,.04,1.75),black,signage)
    cube(f'Poster red corner {x}',(x-.32,7.79,4.12),(.52,.045,.48),red,signage)
    for j in range(5):
        cube(f'Poster stripe {x} {j}',(x,7.78,3.25-j*.12),(.83,.048,.025),steel_edge,signage)

# Audi rings: editable torus meshes, set in the plane of the back wall.
for i,x in enumerate([-15.2,-14.72,-14.24,-13.76]):
    bpy.ops.mesh.primitive_torus_add(major_radius=.29,minor_radius=.027,location=(x,7.64,4.2),
                                    rotation=(math.pi/2,0,0),major_segments=48,minor_segments=10)
    ob=move(bpy.context.object,signage); ob.name=f'Neon ring {i+1}'
    ob.data.materials.append(blue)
cube('S6 black banner',(-.1,7.72,4.12),(2.9,.07,2.05),banner,signage)
cube('S6 red badge ground',(-.65,7.665,4.15),(.96,.025,.75),red,signage)
text_obj('S6 banner lettering','S6',(-.45,7.61,3.85),.8,white,signage)

# Neon tubes are geometry as well as local lights: move or recolor them independently.
def point_light(name,loc,color,power,radius,collection):
    data=bpy.data.lights.new(name,'POINT'); data.energy=power; data.color=color; data.shadow_soft_size=radius
    data.use_shadow=False
    ob=bpy.data.objects.new(name,data); collection.objects.link(ob); ob.location=loc
    return ob
def area_light(name,loc,color,power,size,collection):
    data=bpy.data.lights.new(name,'AREA'); data.energy=power; data.color=color; data.shape='RECTANGLE'; data.size=size; data.size_y=.22
    ob=bpy.data.objects.new(name,data); collection.objects.link(ob); ob.location=loc
    ob.rotation_euler=(0,0,0) # shines downward
    return ob
for idx,x in enumerate([-10,-4.8,.8,6.5,11]):
    tube(f'Blue wall neon {idx}',(x-.55,7.52,5.05),(x+.55,7.52,5.05),blue,fixtures,.038)
    point_light(f'Blue wall light {idx}',(x,7.35,5),(.08,.32,1),250,1,fixtures)
for idx,x in enumerate([-11,-2,3.4,9.5]):
    tube(f'Red wall neon {idx}',(x,7.44,2.2),(x,7.44,3.36),red_neon,fixtures,.035)
    point_light(f'Red wall light {idx}',(x,7.12,2.85),(1,.035,.08),170,1,fixtures)
for idx,x in enumerate([-8.8,-2.9,4.3,10.3]):
    tube(f'White ceiling fixture {idx}',(x-.58,1.6,5.72),(x+.58,1.6,5.72),white,fixtures,.044)
    area_light(f'Ceiling softbox {idx}',(x,1.6,5.7),(1,.75,.54),640,2.3,fixtures)
area_light('Large front softbox',(-1.2,-7.0,5.4),(.6,.78,1),1800,6.5,fixtures)
area_light('Warm car side fill',(4.5,-4.3,4.0),(1,.64,.42),1200,4.0,fixtures)
for idx,x in enumerate([-9,-3.2,4,9]):
    tube(f'Blue side light {idx}',(x,4.9,2.1),(x,4.9,3.2),blue,fixtures,.027)
point_light('Audi sign glow',(-14.4,7.1,4.2),(.02,.22,1),420,1.1,fixtures)

# A simple second vehicle under a grey workshop cover, at image right.
covered=cube('Covered vehicle | editable shell',(9.05,4.6,1.05),(4.0,1.9,1.95),grey_cloth,workshop,bevel=.3)
for x in [7.7,10.4]:
    for y in [3.9,5.3]:
        cyl(f'Covered car wheel {x} {y}',(x,y,.43),.39,.22,black,workshop,
            rotation=(math.pi/2,0,0))

# Main car: editable C5 Avant shaped body, window panels, lights and wheels.
# Local x is vehicle length, with the front/nose at positive x.
stations=[(-2.55,.78,1.35),(-2.35,.88,1.47),(-1.65,.96,1.51),
          (-.5,.98,1.53),(1.4,.95,1.49),(2.2,.85,1.39),(2.55,.72,1.31)]
verts=[]
for x,w,h in stations:
    verts.extend([(x,-2.05-w,.52),(x,-2.05-w,.92),(x,-2.05-w*.91,h),
                  (x,-2.05-w*.72,h+.035),(x,-2.05+w*.72,h+.035),
                  (x,-2.05+w*.91,h),(x,-2.05+w,.92),(x,-2.05+w,.52)])
faces=[]
for i in range(len(stations)-1):
    for j in range(8): faces.append((i*8+j,i*8+(j+1)%8,(i+1)*8+(j+1)%8,(i+1)*8+j))
faces.extend([tuple(reversed(range(8))),tuple((len(stations)-1)*8+j for j in range(8))])
car_body=mesh_obj('Body | contoured blue shell',verts,faces,navy,carcol)
for wx in [-1.67,1.57]:
    bpy.ops.mesh.primitive_cylinder_add(vertices=64,radius=.50,depth=3.2,
                                        location=(wx,-2.05,.44),rotation=(math.pi/2,0,0))
    cutter=bpy.context.object
    mod=car_body.modifiers.new(f'Wheel arch {wx}','BOOLEAN')
    mod.operation='DIFFERENCE'; mod.object=cutter
    bpy.context.view_layer.objects.active=car_body
    bpy.ops.object.modifier_apply(modifier=mod.name)
    bpy.data.objects.remove(cutter,do_unlink=True)
bevel=car_body.modifiers.new('Panel edge radius','BEVEL'); bevel.width=.06; bevel.segments=2
car_body.modifiers.new('Body weighted normals','WEIGHTED_NORMAL')

# Thin upper cabin follows the long Avant roof, sloped windscreen and rear glass.
near_y=-2.82; far_y=-1.28
roof=cube('Roof | long Avant profile',(-.34,-2.05,2.10),(2.75,1.55,.11),navy,carcol,bevel=.05)
for y in [near_y,far_y]:
    outer_y=y+(-.013 if y < -2 else .013)
    # Rear quarter, rear door, and front door glazing each have their own mesh.
    windows=[(-1.83,-1.27,-1.61,-1.22),(-1.20,-.25,-1.18,-.30),(-.18,.91,-.23,.86)]
    for k,(xb0,xb1,xt0,xt1) in enumerate(windows):
        v=[(xb0,outer_y,1.53),(xb1,outer_y,1.53),(xt1,outer_y,2.045),(xt0,outer_y,2.045)]
        mesh_obj(f'Side glass {"near" if y < -2 else "far"} {k}',v,[(0,1,2,3)],glass,carcol)
    for xb,xt in [(-1.83,-1.61),(-1.20,-1.18),(-.18,-.23),(.91,.86)]:
        beam(f'Window pillar {y} {xb}',(xb,y,1.51),(xt,y,2.10),.055,.055,chrome,carcol)
    body_y=-3.055 if y < -2 else -1.045
    cube(f'Beltline chrome {y}',(-.38,body_y,1.51),(3.58,.025,.025),chrome,carcol)
    cube(f'Door lower trim {y}',(-.38,body_y,1.01),(3.45,.028,.025),chrome,carcol)
    for x in [-1.0,.44]:
        cube(f'Door seam {y} {x}',(x,body_y,.995),(.018,.019,.96),dark,carcol)
        cube(f'Door handle {y} {x}',(x+.20,body_y,1.39),(.19,.07,.045),chrome,carcol,bevel=.018)
    cube(f'Mirror {y}',(1.10,y+(-.11 if y < -2 else .11),1.64),(.34,.22,.17),navy,carcol,bevel=.06)

mesh_obj('Windscreen | raked glass',[(1.47,near_y,1.50),(1.47,far_y,1.50),
         (.87,far_y,2.04),(.87,near_y,2.04)],[(0,1,2,3)],glass,carcol)
mesh_obj('Rear hatch glazing',[(-1.95,near_y,1.52),(-1.95,far_y,1.52),
         (-1.63,far_y,2.04),(-1.63,near_y,2.04)],[(0,1,2,3)],glass,carcol)
for y in [near_y,far_y]:
    beam(f'Windscreen A pillar {y}',(1.47,y,1.50),(.87,y,2.10),.07,.075,navy,carcol)
    beam(f'Rear hatch pillar {y}',(-1.96,y,1.50),(-1.63,y,2.10),.07,.075,navy,carcol)

for y in [-3.0,-1.10]:
    for x in [-1.67,1.57]:
        cyl(f'Tire {x} {y}',(x,y,.45),.47,.27,black,carcol,
            vertices=48,rotation=(math.pi/2,0,0))
        outside=y+(-.16 if y < -2 else .16)
        cyl(f'Dark alloy barrel {x} {y}',(x,outside,.45),.32,.045,dark,carcol,
            vertices=48,rotation=(math.pi/2,0,0))
        bpy.ops.mesh.primitive_torus_add(major_radius=.29,minor_radius=.028,
            location=(x,outside+(-.03 if y < -2 else .03),.45),
            rotation=(math.pi/2,0,0),major_segments=48,minor_segments=10)
        ob=move(bpy.context.object,carcol); ob.name=f'Alloy rim lip {x} {y}'; ob.data.materials.append(chrome)
        yy=outside+(-.06 if y < -2 else .06)
        cyl(f'Hub {x} {y}',(x,yy,.45),.09,.04,black,carcol,
            vertices=32,rotation=(math.pi/2,0,0))
        for s in range(5):
            angle=s*2*math.pi/5
            a=(x+math.sin(angle)*.08, yy, .45+math.cos(angle)*.08)
            b=(x+math.sin(angle)*.27, yy, .45+math.cos(angle)*.27)
            beam(f'Five-spoke wheel {x} {y} {s}',a,b,.05,.022,chrome,carcol)
        cyl(f'Red brake caliper {x} {y}',(x+.23,outside,.45),
            .11,.05,red,carcol,rotation=(math.pi/2,0,0))

cube('Front grille surround',(2.56,-2.05,.98),(.055,1.19,.5),chrome,carcol,bevel=.025)
cube('Front grille black',(2.6,-2.05,.98),(.058,1.08,.42),black,carcol,bevel=.025)
for y in [-2.76,-2.05,-1.34]:
    cube(f'Grille vertical {y}',(2.635,y,.98),(.025,.02,.34),steel_edge,carcol)
for y in [-2.85,-1.25]:
    cube(f'Headlamp {y}',(2.51,y,1.35),(.07,.42,.24),white,carcol,bevel=.04)
    cube(f'Fog lamp {y}',(2.56,y,.7),(.065,.22,.12),white,carcol,bevel=.025)
    cube(f'Tail lamp {y}',(-2.55,y,1.3),(.065,.4,.27),red_neon,carcol,bevel=.04)
cube('Front lower intake',(2.56,-2.05,.58),(.065,1.0,.17),black,carcol)
cube('Rear license plate',(-2.58,-2.05,1.04),(.035,.62,.17),white,carcol)
for i,y in enumerate([-2.30,-2.15,-2.0,-1.85]):
    bpy.ops.mesh.primitive_torus_add(major_radius=.083,minor_radius=.008,
        location=(2.675,y,1.04),rotation=(0,math.pi/2,0),
        major_segments=24,minor_segments=6)
    ob=move(bpy.context.object,carcol); ob.name=f'Front grille Audi ring {i+1}'
    ob.data.materials.append(chrome)
cube('S6 grille badge red',(2.67,-2.55,.90),(.017,.13,.055),red,carcol)
for y in [-3.04,-1.06]:
    cube(f'Side indicator {y}',(1.41,y,1.30),(.12,.025,.055),amber,carcol)
for y in [-2.88,-1.22]:
    cyl(f'Quad exhaust tip outer {y}',(-2.60,y,.61),.095,.15,chrome,carcol,
        rotation=(0,math.pi/2,0))
    cyl(f'Quad exhaust tip inner {y}',(-2.69,y,.61),.065,.02,black,carcol,
        rotation=(0,math.pi/2,0))

# Roof rails, rack, and the distinctive black cargo box.
for y in [-2.73,-1.37]:
    beam(f'Roof rail {y}',(-1.72,y,2.23),(1.0,y,2.23),.045,.045,chrome,carcol)
for x in [-1.22,.58]:
    beam(f'Rack crossbar {x}',(x,-2.78,2.32),(x,-1.32,2.32),.05,.05,black,carcol)
cube('Cargo box lower',(-.31,-2.05,2.49),(3.07,1.23,.22),black,carcol,bevel=.11)
cube('Cargo box upper',(-.31,-2.05,2.7),(2.83,1.1,.26),black,carcol,bevel=.12)
cube('Cargo box highlight',(-.22,-2.68,2.78),(2.28,.02,.025),chrome,carcol)
vehicle_root=bpy.data.objects.new('MOVE OR SCALE WHOLE AUDI HERE',None)
carcol.objects.link(vehicle_root)
for ob in list(carcol.objects):
    if ob != vehicle_root: ob.parent=vehicle_root
vehicle_root.scale.x=1.13

# Editable camera and source image alignment guide.
cam_data=bpy.data.cameras.new('Camera | front three-quarter')
camera=bpy.data.objects.new('Camera | front three-quarter',cam_data)
refs.objects.link(camera)
camera.location=(7.5,-11.4,3.35)
target=Vector((-.15,-.65,1.3))
camera.rotation_euler=(target-camera.location).to_track_quat('-Z','Y').to_euler()
cam_data.lens=36
bpy.context.scene.camera=camera
try:
    img=bpy.data.images.load(REF,check_existing=True)
    img.pack()
    img.filepath=bpy.path.relpath(REF,start=ROOT)
    bg=cam_data.background_images.new(); bg.image=img; bg.alpha=.35
    cam_data.show_background_images=True
    cam_data.show_passepartout=True
except Exception as exc: print('Reference image unavailable:',exc)

world=bpy.data.worlds.new('Night garage ambient')
bpy.context.scene.world=world; world.use_nodes=True
world.node_tree.nodes.get('Background').inputs['Color'].default_value=(.015,.025,.05,1)
world.node_tree.nodes.get('Background').inputs['Strength'].default_value=.3
scene=bpy.context.scene
try: scene.render.engine='BLENDER_EEVEE_NEXT'
except Exception: scene.render.engine='BLENDER_EEVEE'
scene.render.resolution_x=1672; scene.render.resolution_y=941
scene.render.resolution_percentage=100
scene.view_settings.view_transform='AgX'
scene.render.image_settings.file_format='PNG'
scene.render.filepath=os.path.join(ROOT,'garage_preview.png')
scene.camera.data.clip_end=500
scene.unit_settings.system='METRIC'

# Start in a useful camera view with collections obvious in the Outliner.
for area in bpy.context.screen.areas:
    if area.type=='VIEW_3D':
        area.spaces.active.region_3d.view_perspective='CAMERA'
        area.spaces.active.shading.type='MATERIAL'
bpy.ops.wm.save_as_mainfile(filepath=OUT)
print('Saved',OUT)
if os.environ.get('GARAGE_RENDER')=='1':
    bpy.ops.render.render(write_still=True)
    print('Rendered',scene.render.filepath)
