"""Build the editable 2003 S6 C5 Avant, then render its website camera views.

blender -b --python scripts/build_s6_c5.py
S6_VIEWS=exterior-a S6_SAMPLES=32 S6_PERCENT=60 for a fast review render.
The existing garage and reference images are only read, never overwritten.
"""
import bpy
import math
import os
import sys
import json
from pathlib import Path
from mathutils import Vector
from bpy_extras.object_utils import world_to_camera_view

ROOT = Path(__file__).resolve().parents[1]
OUT = ROOT / 'output' / 's6'
OUT.mkdir(parents=True, exist_ok=True)
sys.path.insert(0, str(ROOT / 'scripts'))
from s6_wheels import build_wheels
from s6_lighting_badges import build_details

bpy.ops.wm.open_mainfile(filepath=str(ROOT / 'output/garage/garage_reference.blend'))
scene = bpy.context.scene
collection = bpy.data.collections.new('10 | 2003 Audi S6 C5 Avant')
scene.collection.children.link(collection)
car_objects = []

def material(name, color, metal=0, rough=.3, coat=0):
    m = bpy.data.materials.new(name)
    m.diffuse_color = (*color, 1)
    m.use_nodes = True
    bs = m.node_tree.nodes.get('Principled BSDF')
    for key, val in [('Base Color', (*color, 1)), ('Metallic', metal), ('Roughness', rough), ('Coat Weight', coat), ('Coat Roughness', .055)]:
        bs.inputs[key].default_value = val
    return m

paint = material('S6 | deep blue pearl with polished clearcoat', (.013, .044, .105), .72, .19, 1)
# Subtle flake response stays beneath a clean, sharp clearcoat.
n = paint.node_tree.nodes
noise = n.new('ShaderNodeTexNoise'); noise.inputs['Scale'].default_value = 1450
ramp = n.new('ShaderNodeValToRGB')
ramp.color_ramp.elements[0].color = (.105, .105, .105, 1)
ramp.color_ramp.elements[1].color = (.235, .235, .235, 1)
paint.node_tree.links.new(noise.outputs['Fac'], ramp.inputs[0])
paint.node_tree.links.new(ramp.outputs[0], n['Principled BSDF'].inputs['Roughness'])
materials = {
    'paint': paint,
    'rubber': material('S6 | satin tire rubber', (.014, .017, .022), 0, .66),
    'chrome': material('S6 | polished chrome', (.71, .76, .82), .96, .12),
    'alloy': material('S6 | satin Avus aluminum', (.52, .57, .64), .86, .22),
    'dark': material('S6 | black grille and seals', (.006, .009, .013), .15, .32),
    'brake': material('S6 | machined brake steel', (.25, .27, .30), .85, .35),
    'red': material('S6 | badge red', (.55, .006, .016), .18, .25),
    'glass': material('S6 | lightly tinted automotive glazing', (.64, .73, .80), 0, .035, .08),
}
materials['glass'].node_tree.nodes['Principled BSDF'].inputs['Transmission Weight'].default_value = .97
materials['glass'].node_tree.nodes['Principled BSDF'].inputs['IOR'].default_value = 1.48
dark, chrome, alloy, rubber, glass = [materials[k] for k in ['dark', 'chrome', 'alloy', 'rubber', 'glass']]
seam_mat = material('S6 | recessed painted panel gaps', (.003, .007, .013), .25, .38)
leather = material('S6 | anthracite leather upholstery', (.027, .031, .038), 0, .56)
box_paint = material('S6 | gloss black roof box', (.005, .007, .010), .5, .125, 1)

def mesh(name, verts, faces, mat, smooth=True):
    data = bpy.data.meshes.new(name)
    data.from_pydata(verts, [], faces); data.update()
    o = bpy.data.objects.new(name, data); collection.objects.link(o)
    data.materials.append(mat)
    for f in data.polygons: f.use_smooth = smooth
    car_objects.append(o)
    return o

def solid(o, thickness=.008):
    m = o.modifiers.new('Panel thickness', 'SOLIDIFY'); m.thickness = thickness
    return o

def cube(name, p, size, mat, bevel=.02):
    bpy.ops.mesh.primitive_cube_add(size=1, location=p)
    o = bpy.context.object; o.name = name
    for c in list(o.users_collection): c.objects.unlink(o)
    collection.objects.link(o); car_objects.append(o)
    o.dimensions = size
    bpy.ops.object.transform_apply(location=False, rotation=False, scale=True)
    o.data.materials.append(mat)
    if bevel:
        b = o.modifiers.new('Soft manufactured edge', 'BEVEL'); b.width = bevel; b.segments = 5
        o.modifiers.new('Face weighted normals', 'WEIGHTED_NORMAL')
    return o

def line(name, pts, radius, mat, cyclic=False):
    cu = bpy.data.curves.new(name, 'CURVE'); cu.dimensions = '3D'
    cu.bevel_depth = radius; cu.bevel_resolution = 3
    sp = cu.splines.new('POLY'); sp.points.add(len(pts)-1)
    for v, p in zip(sp.points, pts): v.co = (*p, 1)
    sp.use_cyclic_u = cyclic
    o = bpy.data.objects.new(name, cu); collection.objects.link(o); cu.materials.append(mat)
    car_objects.append(o)
    return o

def patch(name, corners, mat, bulge=0, nu=24, nv=10, thickness=.003):
    a,b,c,d = [Vector(p) for p in corners]
    verts=[]; faces=[]
    for i in range(nu+1):
        u=i/nu
        for j in range(nv+1):
            v=j/nv
            p=(1-v)*((1-u)*a+u*b)+v*((1-u)*d+u*c)
            p.y += (1 if p.y>0 else -1)*bulge*math.sin(math.pi*u)*math.sin(math.pi*v)
            verts.append(p)
    for i in range(nu):
        for j in range(nv):
            k=i*(nv+1)+j; faces.append((k,k+nv+1,k+nv+2,k+1))
    return solid(mesh(name, verts, faces, mat), thickness)

def interp(x, rows, column):
    # Cosine interpolation gives tangent continuity along the curved body.
    for a,b in zip(rows, rows[1:]):
        if a[0] <= x <= b[0]:
            t=(x-a[0])/(b[0]-a[0]); t=(1-math.cos(math.pi*t))/2
            return a[column]*(1-t)+b[column]*t
    return rows[0 if x<rows[0][0] else -1][column]

# Metric Euro-market envelope: 4.833 x 1.850 m, 2.759 m wheelbase.
stations=[(-2.416,.876,.995),(-2.20,.914,1.024),(-1.8,.920,1.033),
          (-1.394,.925,1.047),(-.7,.902,1.058),(.3,.904,1.069),
          (1.0,.915,1.055),(1.365,.925,1.033),(1.88,.916,1.015),(2.23,.910,.978),(2.416,.876,.947)]
axles=[-1.394,1.365]

def arch_floor(x):
    z=.255+.055*(abs(x)/2.416)**10
    for axle in axles:
        dx=x-axle; radius=.367
        if abs(dx)<radius:
            z=max(z,.326+math.sqrt(radius*radius-dx*dx))
        elif abs(dx)<.405:
            z=max(z,.255+.071*(.405-abs(dx))/.038)
    return z

def side_y(x,z):
    shoulder=interp(x,stations,2)
    q=max(0,min(1,(z-.255)/(shoulder-.255)))
    # Full S6 front/rear wings and slightly recessed lower doors.
    w=interp(x,stations,1)
    inset=.058*(1-q)**2+.067*q**7
    flare=sum(.017*math.exp(-((math.hypot(x-axle,z-.326)-.387)/.095)**2) for axle in axles)
    return w-inset+flare

def edge_x(x,y):
    if x>2.20: return x-.115*(abs(y)/.86)**3*((x-2.20)/.216)
    if x<-2.20: return x+.065*(abs(y)/.86)**3*((-x-2.20)/.216)
    return x

# Dense quad panels trace the actual arch openings rather than hiding tires
# behind a rectangular body. Their smooth longitudinal highlights stay intact.
nx,nz=260,20
for s in [-1,1]:
    verts=[]; faces=[]
    for i in range(nx+1):
        x=-2.416+4.832*i/nx; lo=arch_floor(x); hi=interp(x,stations,2)
        for j in range(nz+1):
            z=lo+(hi-lo)*j/nz
            y=s*side_y(x,z); verts.append((edge_x(x,y),y,z))
    for i in range(nx):
        for j in range(nz):
            k=i*(nz+1)+j; face=(k,k+nz+1,k+nz+2,k+1)
            faces.append(face if s<0 else tuple(reversed(face)))
    solid(mesh('S6 | flowing wing and door skin '+str(s),verts,faces,paint),.012)
    for axle in axles:
        pts=[]
        for i in range(100):
            a=math.radians(-11+202*i/99)
            x=axle+.369*math.cos(a); z=.326+.369*math.sin(a)
            pts.append((x,s*(side_y(x,z)+.002),z))
        line('S6 | rolled painted wheel arch lip',pts,.010,paint)
        # Recessed black liner follows the same physical wheel arch.
        vv=[]; ff=[]
        for i in range(81):
            a=math.pi*i/80
            for yy in [.65,.90]: vv.append((axle+.364*math.cos(a),s*yy,.326+.364*math.sin(a)))
        for i in range(80): ff.append((2*i,2*i+1,2*i+3,2*i+2))
        mesh('S6 | wheel housing liner',vv,ff,rubber)

# Upper body crown and bonnet. The passenger cell sits over the rear section.
verts=[]; faces=[]; ny=42
for i in range(nx+1):
    x=-2.416+4.832*i/nx; w=interp(x,stations,1)-.067; h=interp(x,stations,2)
    for j in range(ny+1):
        t=-1+2*j/ny; y=w*t
        z=h+.046*(1-t*t)
        verts.append((edge_x(x,y),y,z))
for i in range(nx):
    for j in range(ny):
        k=i*(ny+1)+j; faces.append((k,k+ny+1,k+ny+2,k+1))
solid(mesh('S6 | crowned bonnet and upper shoulder',verts,faces,paint),.008)
cube('S6 | underbody shadow',(0,0,.245),(3.87,1.52,.10),dark,.035)

# Rounded front/rear bumper caps: shaped meshes with broad reflective surfaces.
for front in [True,False]:
    vv=[]; ff=[]; na,nh=100,14
    for i in range(na+1):
        t=-1+2*i/na; y=.865*t
        for j in range(nh+1):
            u=j/nh; z=.29+(.43 if front else .82)*u
            x=(2.413-.15*abs(t)**5-.090*(1-u)**4+.018*math.sin(math.pi*u)) if front else (-2.408+.13*abs(t)**5+.070*(1-u)**4-.012*math.sin(math.pi*u))
            vv.append((x,y,z))
    for i in range(na):
        for j in range(nh):
            k=i*(nh+1)+j; f=(k,k+nh+1,k+nh+2,k+1); ff.append(f if front else tuple(reversed(f)))
    solid(mesh('S6 | '+('front' if front else 'rear')+' bumper cover',vv,ff,paint),.022)
    x=2.417 if front else -2.417
    line('S6 | bumper rub strip',[(x+(-.1 if front else .06)*abs(t)**3,.862*t,.577) for t in [-1+i/60 for i in range(121)]],.013,dark)

# Avant roof: long wagon roof, raked front glass, sloping rear hatch.
roof_rows=[(-2.28,.80,1.06),(-2.10,.744,1.345),(-1.92,.728,1.417),(-1.65,.735,1.438),(-.55,.734,1.445),(.42,.72,1.427),(.55,.741,1.375),(.99,.82,1.081)]
vv=[];ff=[];rn=120;rw=36
for i in range(rn+1):
    x=-2.005+2.465*i/rn; w=interp(x,roof_rows,1);h=interp(x,roof_rows,2)
    for j in range(rw+1):
        t=-1+2*j/rw;vv.append((x,t*w,h+.019*(1-t*t)))
for i in range(rn):
    for j in range(rw):
        k=i*(rw+1)+j;ff.append((k,k+rw+1,k+rw+2,k+1))
solid(mesh('S6 | long curved Avant roof and pillars',vv,ff,paint),.009)

for s in [-1,1]:
    # Broad painted C and D pillars, black B pillar and chrome window surround.
    windows=[
        [(-2.10,s*.839,1.075),(-1.25,s*.863,1.083),(-1.245,s*.742,1.388),(-1.82,s*.737,1.382)],
        [(-1.182,s*.864,1.074),(-.353,s*.874,1.085),(-.32,s*.744,1.400),(-1.175,s*.743,1.395)],
        [(-.282,s*.874,1.085),(.891,s*.856,1.083),(.402,s*.731,1.389),(-.246,s*.744,1.401)],
    ]
    for k,pts in enumerate(windows):
        patch('S6 | side window '+str(s)+' '+str(k),pts,glass,.012)
        line('S6 | window rubber seal',pts,.010,dark,True)
    # Open glass apertures: painted pillars do not form an opaque panel behind glass.
    for k in [0,1]:
        left,right=windows[k],windows[k+1]
        patch('S6 | black window pillar', [left[1],right[0],right[3],left[2]], dark)
    patch('S6 | broad sculpted D pillar',[(-2.28,s*.806,1.04),(-2.10,s*.839,1.075),(-1.82,s*.737,1.382),(-2.005,s*.73,1.418)],paint,.012)
    line('S6 | curved D pillar',[(-2.26,s*.833,1.030),(-2.214,s*.825,1.105),(-2.04,s*.77,1.308),(-1.95,s*.73,1.416)],.037,paint)
    line('S6 | swept A pillar',[(.962,s*.829,1.072),(.805,s*.816,1.182),(.628,s*.771,1.31),(.448,s*.716,1.423)],.025,paint)
    line('S6 | upper side roof edge',[(-1.956,s*.732,1.417),(-1.61,s*.734,1.44),(-.30,s*.73,1.437),(.44,s*.72,1.424)],.023,paint)
    line('S6 | glazing lower painted belt',[(-2.216,s*.832,1.045),(-1.15,s*.861,1.055),(-.28,s*.865,1.063),(.958,s*.828,1.063)],.023,paint)
    perimeter=[(-2.14,s*.846,1.051),(.948,s*.854,1.059),(.429,s*.727,1.420),(-1.845,s*.734,1.416),(-2.14,s*.846,1.051)]
    line('S6 | satin aluminum side window surround',perimeter,.009,chrome)
    # Body-color side moldings, flowing door cut lines and recessed handles.
    for height,rad,mat in [(.543,.018,paint),(.277,.015,dark),(.997,.0035,seam_mat)]:
        pts=[(x,s*(side_y(x,height)+.005),height) for x in [-.985+i*1.98/100 for i in range(101)]]
        line('S6 | lower door molding',pts,rad,mat)
    for x_top,x_bottom in [(-1.23,-.965),(-.314,-.318),(.994,.975)]:
        pts=[]
        for i in range(30):
            t=i/29;z=.29+.743*t;x=x_bottom+(x_top-x_bottom)*t
            if z<arch_floor(x)+.02: continue
            pts.append((x,s*(side_y(x,z)+.005),z))
        if len(pts)>1:line('S6 | precise door shut line',pts,.003,seam_mat)
    for x in [-1.03,-.13]:
        z=.959;y=s*(side_y(x,z)+.004)
        cube('S6 | door handle pocket',(x,y,z),(.177,.012,.050),seam_mat,.019)
        cube('S6 | body-color flush pull handle',(x,y+s*.014,z+.005),(.150,.021,.026),paint,.011)
    # Factory aluminum mirror cap, black pedestal, visible dark glass insert.
    cube('S6 | mirror triangular mounting',(.724,s*.845,1.104),(.135,.072,.102),dark,.023)
    cube('S6 | mirror neck',(.701,s*.919,1.114),(.078,.142,.034),dark,.016)
    cube('S6 | aluminum mirror housing',(.688,s*.988,1.132),(.217,.144,.106),alloy,.047)
    cube('S6 | mirror reflective inset',(.587,s*.989,1.132),(.009,.114,.074),chrome,.025)
    # Slim rails supported by feet, with the original website's removable box.
    line('S6 | aluminum Avant roof rail',[(x,s*.616,z) for x,z in [(-1.91,1.439),(-1.79,1.49),(-1.48,1.511),(-.3,1.515),(.15,1.478),(.25,1.424)]],.012,alloy)
    for x in [-1.64,-.04]:cube('S6 | rail foot',(x,s*.616,1.455),(.13,.051,.037),dark,.012)

# Glass panels stand slightly proud of the roof shell, with actual thickness.
wind=[(1.009,-.799,1.105),(1.009,.799,1.105),(.479,.713,1.424),(.479,-.713,1.424)]
patch('S6 | curved laminated windscreen',wind,glass,.005,36,24)
line('S6 | windscreen black ceramic surround',wind,.012,dark,True)
back=[(-2.286,.778,1.112),(-2.286,-.778,1.112),(-1.981,-.705,1.406),(-1.981,.705,1.406)]
patch('S6 | heated tailgate glass',back,glass,.001,36,18)
line('S6 | rear glass seal',back,.014,dark,True)
for i in range(7):
    t=.12+i*.105;x=-2.286+.305*t;z=1.112+.294*t
    line('S6 | rear demister wire',[(x-.003,-.70,z),(x-.003,.70,z)],.0009,alloy)
line('S6 | rear wiper',[(-2.30,0,1.118),(-2.303,.43,1.14)],.011,dark)
for s in [-1,1]:
    line('S6 | front wiper',[(.993,s*.13,1.112),(.925,s*.55,1.143),(.9,s*.70,1.158)],.009,dark)
    line('S6 | bonnet perimeter',[(x,s*(.72-.10*(x-1)/1.35),interp(x,stations,2)+.046*(1-(.72/interp(x,stations,1))**2)+.003) for x in [1.035+i*1.285/70 for i in range(71)]],.003,seam_mat)
    line('S6 | tailgate shut line',[(-2.323,s*.822,.695),(-2.327,s*.822,1.059),(-2.105,s*.742,1.363)],.003,seam_mat)
cube('S6 | subtle Avant roof spoiler',(-2.029,0,1.428),(.21,1.49,.037),paint,.017)

# Upholstery and steering wheel are real interior geometry visible through glass.
cube('S6 | dashboard',(.75,0,1.005),(.38,1.54,.15),leather,.06)
for x in [.03,-.86]:
    for y in [-.43,.43]:
        cube('S6 | leather seat cushion',(x,y,.57),(.43,.43,.14),leather,.055)
        seat=cube('S6 | leather seat back',(x-.21,y,.811),(.13,.43,.49),leather,.065)
        seat.rotation_euler.y=-.16
        cube('S6 | headrest',(x-.253,y,1.099),(.14,.253,.158),leather,.045)
line('S6 | leather steering wheel',[(.58,-.44+.167*math.cos(i*math.tau/80),.978+.167*math.sin(i*math.tau/80)) for i in range(80)],.014,dark,True)

# Gloss roof box is a removable accessory, kept separate from the factory body.
for x in [-1.44,-.14]:cube('Accessory | roof rack crossbar',(x,0,1.573),(.06,1.39,.044),dark,.018)
for upper in [False,True]:
    vv=[];ff=[];nn,ns=96,48
    for i in range(nn+1):
        t=-1+2*i/nn;x=-.61+1.145*t
        width=.48*(max(0,1-abs(t)**3))**.36
        for j in range(ns+1):
            a=math.pi*j/ns
            yy=width*math.cos(a)
            h=(.193 if upper else -.072)*math.sin(a)*(max(0,1-t*t))**.25
            vv.append((x,yy,1.691+h))
    for i in range(nn):
        for j in range(ns):
            k=i*(ns+1)+j;ff.append((k,k+ns+1,k+ns+2,k+1))
    solid(mesh('Accessory | roof box '+('lid' if upper else 'base'),vv,ff,box_paint),.006)
for s in [-1,1]:
    line('Accessory | roof box seam',[(x,s*.48*max(0,1-abs(t)**3)**.36,1.691) for t,x in [(t,-.61+1.145*t) for t in [-1+2*i/100 for i in range(101)]]],.006,dark)
cube('Accessory | roof box lock',(-.25,-.481,1.709),(.064,.013,.022),alloy,.008)

car_objects += build_details(collection,materials)
# Lower the C5 belt/bonnet while retaining the factory roof height and tire size.
# This continuous profile avoids the tall slab sides of the earlier approximation.
def c5_height(z):
    if z <= .7: return z
    if z < 1.075: return .7+(z-.7)*.60
    if z < 1.45: return .925+(z-1.075)*(1.45-.925)/.375
    return z
for ob in car_objects:
    matrix=ob.matrix_world.copy(); inverse=matrix.inverted()
    if ob.type=='MESH':
        for v in ob.data.vertices:
            p=matrix@v.co;p.z=c5_height(p.z)-(.055 if ob.name.startswith('Accessory') else 0);v.co=inverse@p
    elif ob.type=='CURVE':
        for spline in ob.data.splines:
            for p in spline.points:
                co=matrix@Vector(p.co[:3]);co.z=c5_height(co.z)-(.055 if ob.name.startswith('Accessory') else 0);p.co=(*(inverse@co),p.co.w)
    elif ob.type=='FONT':ob.location.z=c5_height(ob.location.z)
car_objects += build_wheels(collection,materials)
root=bpy.data.objects.new('S6 | vehicle master - rotate for angle',None)
collection.objects.link(root)
for o in car_objects: o.parent=root
root.location=(0,-5.5,0)
root.rotation_euler.z=math.radians(-31)
root['Vehicle']='2003 Audi S6 C5 Avant, European proportions'
root['Dimensions']='4.833 m length / 1.850 m body width / 2.759 m wheelbase'
root['Finish']='Deep blue pearl, polished clearcoat; factory aluminum mirrors and six-spoke Avus wheels'
root['Accessory']='Removable black roof cargo box and crossbars'
root['Fidelity']='Procedural visual reconstruction; not an OEM CAD or dimensional scan'

# Focused rectangular lights produce long clean reflections in the clearcoat.
studio=bpy.data.collections.new('11 | S6 reflection lighting');scene.collection.children.link(studio)
def area(name,p,target,color,energy,size,size_y):
    d=bpy.data.lights.new(name,'AREA');d.shape='RECTANGLE';d.energy=energy;d.color=color;d.size=size;d.size_y=size_y
    o=bpy.data.objects.new(name,d);studio.objects.link(o);o.location=p
    o.rotation_euler=(Vector(target)-o.location).to_track_quat('-Z','Y').to_euler()
area('S6 | long overhead key',(-1,-5.0,4.25),(0,-4.1,.5),(.76,.86,1),650,5,.68)
area('S6 | front softbox',(3,-8.4,3.0),(0,-4.1,.8),(.83,.9,1),380,3.7,1.15)
area('S6 | blue edge reflection',(-2,-2.2,2.7),(0,-4.1,1),(.08,.28,1),220,3.7,.18)
area('S6 | warm edge reflection',(1.5,-1.9,3.3),(0,-4.1,1),(1,.58,.32),300,3.4,.28)
area('S6 | low soft fill',(-3,-7.2,1.65),(0,-4.1,.65),(.52,.69,1),110,2.6,.85)
for light_ob in studio.objects:
    light_ob.location.y-=1.4
    if 'warm edge' in light_ob.name: light_ob.data.energy=130

# Keep foreground workshop equipment beside the car instead of over its nose.
for c_name in ['04 | Red workshop cabinets and benches','05 | Tools bottles tires and foreground equipment']:
    for o in bpy.data.collections[c_name].objects:
        center=sum((o.matrix_world@Vector(p) for p in o.bound_box),Vector())/8
        if center.y < -2.6:
            o.location.x += 2.7 if center.x>0 else -1.2

# Tame the previous floor's coarse bump to reflect the car without rippling it.
floor=bpy.data.materials.get('Wet concrete | irregular puddles aggregate and cracks')
if floor:
    for n in floor.node_tree.nodes:
        if n.type=='BUMP':n.inputs['Distance'].default_value*=.35

camera=scene.camera
camera.location=(1.15,-13,1.78)
camera.rotation_euler=(Vector((0,-5.5,.70))-camera.location).to_track_quat('-Z','Y').to_euler()
camera.data.lens=37
camera.data.dof.use_dof=True;camera.data.dof.focus_object=root;camera.data.dof.aperture_fstop=11
scene.render.resolution_x=1672;scene.render.resolution_y=941
scene.render.resolution_percentage=int(os.environ.get('S6_PERCENT','100'))
scene.cycles.samples=int(os.environ.get('S6_SAMPLES','64'))
scene.cycles.use_denoising=True;scene.cycles.max_bounces=9;scene.cycles.transmission_bounces=6
scene.view_settings.look='AgX - Medium High Contrast';scene.view_settings.exposure=.05
prefs=bpy.context.preferences.addons['cycles'].preferences
try:
    prefs.compute_device_type='CUDA';prefs.get_devices()
    for d in prefs.devices:d.use=d.type=='CUDA'
    scene.cycles.device='GPU' if any(d.use for d in prefs.devices) else 'CPU'
except Exception:scene.cycles.device='CPU'
print('RENDER_DEVICE',scene.cycles.device,[(d.name,d.type,d.use) for d in prefs.devices],flush=True)
scene['Scope']='Editable garage with modeled 2003 S6 C5 Avant; render source for the website.'
scene['S6 specification source']='https://www.audiworld.com/model/s6/03/03s6avant.pdf'
scene['S6 reconstruction']='Smooth procedural surfaces; six-spoke Avus wheels; separated C5 grilles; two exhaust outlets. Visual reconstruction, not OEM CAD.'
scene.unit_settings.system='METRIC'
for screen in bpy.data.screens:
    for a in screen.areas:
        if a.type=='VIEW_3D':
            a.spaces.active.region_3d.view_perspective='CAMERA'
            a.spaces.active.region_3d.view_camera_zoom=5
            a.spaces.active.shading.type='MATERIAL'
bpy.context.view_layer.update()
scene.render.filepath=str(OUT/'exterior-a.png')
bpy.ops.wm.save_as_mainfile(filepath=str(OUT/'audi_s6_c5_2003.blend'))
print('S6_SAVED',len(car_objects),'car objects',flush=True)

angles={
    'exterior-a':(-31,37), 'exterior-b':(-42,40),
    'exterior-c':(-22,37), 'exterior-d':(-55,37),
    'front':(-81.28,40), 'side-a':(8.72,35), 'side-b':(188.72,35),
    'rear-quarter-a':(145,37), 'rear-quarter-b':(43,37), 'rear':(98.72,40),
}
requested=os.environ.get('S6_VIEWS',','.join(angles)).split(',')
report={}
def projected(p):
    q=world_to_camera_view(scene,camera,root.matrix_world@Vector(p))
    return {'x':round(q.x,5),'y':round(1-q.y,5)}
for view in requested:
    angle,lens=angles[view];root.rotation_euler.z=math.radians(angle);camera.data.lens=lens
    bpy.context.view_layer.update()
    inv=root.matrix_world.inverted()@camera.location
    s=-1 if inv.y<0 else 1
    anchors={
        'roof-box':(-.56,s*.24,1.85),
        'hood':(1.50,s*.35,1.06),
        'front-bumper':(2.43,s*.43,.605),
        'wheels':(1.365,s*.942,.326),
        'brake-kit':(-1.394,s*.943,.34),
        'side-skirts':(-.05,s*.9,.29),
        'rear-bumper':(-2.425,s*.39,.58),
        'exhaust':(-2.49,s*.65,.285),
    }
    if view=='front':visible=['roof-box','hood','front-bumper']
    elif view=='rear':visible=['roof-box','rear-bumper','exhaust']
    elif view in ['side-a','side-b']:visible=['roof-box','hood','front-bumper','wheels','side-skirts','rear-bumper','brake-kit']
    elif view.startswith('rear-quarter'):visible=['roof-box','rear-bumper','exhaust','wheels','brake-kit','side-skirts']
    else:visible=['roof-box','hood','front-bumper','wheels','side-skirts','brake-kit']
    pts=[projected((x,y,z)) for x in [-2.50,0,2.45] for y in [-.97,.97] for z in [0,1.45]]
    pts.extend([projected((-1.76,0,1.89)),projected((.54,0,1.89))])
    focus={'x0':max(0,min(p['x'] for p in pts)-.025),'y0':max(0,min(p['y'] for p in pts)-.025),'x1':min(1,max(p['x'] for p in pts)+.025),'y1':min(1,max(p['y'] for p in pts)+.025)}
    report[view]={'width':1672,'height':941,'focus':focus,'hotspots':[{'partId':part,**projected((anchors[part][0],anchors[part][1],c5_height(anchors[part][2])))} for part in visible]}
    scene.render.filepath=str(OUT/(view+'.png'))
    print('RENDERING',view,report[view],flush=True)
    bpy.ops.render.render(write_still=True)
    print('RENDERED',view,flush=True)
(OUT/'render-manifest.json').write_text(json.dumps(report,indent=2))
print('ALL_S6_RENDERS_COMPLETE',flush=True)
