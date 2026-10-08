"""Editable garage environment reconstructed from the supplied reference photograph.

Blender background entry point. No backdrop or reference photograph is used as
rendered geometry. The central vehicle is intentionally deferred: garage first.
"""
import bpy, math, os, random, json
from mathutils import Vector
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
OUT = ROOT / 'output' / 'garage'
OUT.mkdir(parents=True, exist_ok=True)
random.seed(106)
bpy.ops.wm.read_factory_settings(use_empty=True)
scene = bpy.context.scene

def collection(name):
    c=bpy.data.collections.new(name); scene.collection.children.link(c); return c
arch=collection('01 | Concrete shell and wet floor')
steel=collection('02 | Structural steel and roof trusses')
lifts=collection('03 | Service lifts and hydraulics')
furn=collection('04 | Red workshop cabinets and benches')
props=collection('05 | Tools bottles tires and foreground equipment')
signs=collection('06 | Neon rings S6 banner and posters')
lights=collection('07 | Practical lighting and cables')
cover=collection('08 | Covered vehicle in right bay')
refs=collection('09 | Cameras and packed reference')

def material(name,col,metal=0,rough=.5,emit=0):
    m=bpy.data.materials.new(name); m.diffuse_color=(*col,1); m.use_nodes=True
    bs=m.node_tree.nodes.get('Principled BSDF')
    bs.inputs['Base Color'].default_value=(*col,1)
    bs.inputs['Metallic'].default_value=metal; bs.inputs['Roughness'].default_value=rough
    if emit:
        bs.inputs['Emission Color'].default_value=(*col,1); bs.inputs['Emission Strength'].default_value=emit
    return m

def noise_material(name,col,metal,rough,scale,depth):
    m=material(name,col,metal,rough); n=m.node_tree.nodes; l=m.node_tree.links; bs=n.get('Principled BSDF')
    tc=n.new('ShaderNodeTexCoord'); noise=n.new('ShaderNodeTexNoise')
    noise.inputs['Scale'].default_value=scale; noise.inputs['Detail'].default_value=4
    l.new(tc.outputs['Object'],noise.inputs['Vector'])
    ramp=n.new('ShaderNodeValToRGB'); ramp.color_ramp.elements[0].color=tuple(c*.35 for c in col)+(1,)
    ramp.color_ramp.elements[1].color=tuple(min(c*1.4,1) for c in col)+(1,)
    l.new(noise.outputs['Fac'],ramp.inputs[0]); l.new(ramp.outputs[0],bs.inputs['Base Color'])
    bump=n.new('ShaderNodeBump'); bump.inputs['Strength'].default_value=.32; bump.inputs['Distance'].default_value=depth
    l.new(noise.outputs['Fac'],bump.inputs['Height']); l.new(bump.outputs[0],bs.inputs['Normal'])
    return m

iron=noise_material('Steel | aged charcoal enamel',(.025,.035,.046),.75,.29,28,.009)
bluepaint=noise_material('Lift | worn midnight blue enamel',(.009,.027,.066),.52,.34,35,.006)
red=noise_material('Cabinets | deep red powdercoat',(.33,.009,.017),.55,.26,45,.002)
yellow=noise_material('Hydraulics | worn ochre safety paint',(.53,.30,.023),.58,.35,21,.005)
rubber=noise_material('Tires and grips | charcoal rubber',(.009,.012,.016),0,.67,65,.008)
silver=material('Machined steel and aluminum',(.25,.29,.32),.87,.30)
chrome=material('Polished tool edges',(.65,.69,.72),.95,.16)
brass=material('Aged brass fittings',(.36,.22,.065),.75,.3)
black=material('Black recess',(.005,.007,.009),.25,.42)
paper=material('Ivory label stock',(.62,.60,.51),0,.64)
cloth=noise_material('Dusty grey woven cover',(.16,.19,.23),.05,.84,160,.002)
blue=material('Cobalt blue neon phosphor',(.002,.06,1),0,.22,7)
redlight=material('Crimson neon phosphor',(1,.002,.008),0,.22,7)
warm=material('Warm fluorescent diffuser',(1,.70,.42),0,.26,10)
cool=material('White fluorescent diffuser',(.72,.85,1),0,.26,9)
bulbmat=material('Tungsten worklamp glass',(1,.46,.12),0,.15,16)

def mesh(name,verts,faces,mat,c):
    me=bpy.data.meshes.new(name); me.from_pydata(verts,[],faces); me.update()
    o=bpy.data.objects.new(name,me); c.objects.link(o)
    if mat: me.materials.append(mat)
    return o

boxverts=[(-.5,-.5,-.5),(.5,-.5,-.5),(.5,.5,-.5),(-.5,.5,-.5),(-.5,-.5,.5),(.5,-.5,.5),(.5,.5,.5),(-.5,.5,.5)]
boxfaces=[(0,3,2,1),(4,5,6,7),(0,1,5,4),(1,2,6,5),(2,3,7,6),(3,0,4,7)]
def box(name,p,s,m,c,bevel=0):
    o=mesh(name,[(v[0]*s[0],v[1]*s[1],v[2]*s[2]) for v in boxverts],boxfaces,m,c); o.location=p
    if bevel:
        b=o.modifiers.new('Rounded fabricated edges','BEVEL'); b.width=bevel; b.segments=3
        o.modifiers.new('Face normals','WEIGHTED_NORMAL')
    return o

cached={}
def cylinder(name,p,r,d,m,c,axis=None,n=24,r2=None):
    r2=r if r2 is None else r2
    key=(round(r,5),round(r2,5),round(d,5),m.name,n)
    if key not in cached:
        vv=[(rad*math.cos(i*math.tau/n),rad*math.sin(i*math.tau/n),z) for rad,z in [(r,-d/2),(r2,d/2)] for i in range(n)]
        ff=[(i,(i+1)%n,(i+1)%n+n,i+n) for i in range(n)]+[tuple(reversed(range(n))),tuple(range(n,2*n))]
        me=bpy.data.meshes.new(name); me.from_pydata(vv,[],ff); me.materials.append(m)
        for poly in me.polygons[:n]: poly.use_smooth=True
        cached[key]=me
    o=bpy.data.objects.new(name,cached[key]); c.objects.link(o); o.location=p
    if axis: o.rotation_euler=Vector(axis).to_track_quat('Z','Y').to_euler()
    return o

def rod(name,a,b,r,m,c):
    a,b=Vector(a),Vector(b); return cylinder(name,(a+b)/2,r,(b-a).length,m,c,b-a,n=12)
def beam(name,a,b,w,d,m,c):
    a,b=Vector(a),Vector(b); o=box(name,(a+b)/2,(w,d,(b-a).length),m,c,.006)
    o.rotation_euler=(b-a).to_track_quat('Z','Y').to_euler(); return o
def line(name,points,r,m,c,cyclic=False):
    cu=bpy.data.curves.new(name,'CURVE'); cu.dimensions='3D'; cu.bevel_depth=r; cu.bevel_resolution=2
    sp=cu.splines.new('POLY'); sp.points.add(len(points)-1)
    for v,p in zip(sp.points,points): v.co=(*p,1)
    sp.use_cyclic_u=cyclic
    o=bpy.data.objects.new(name,cu); c.objects.link(o); cu.materials.append(m); return o
def ring(name,p,r,t,m,c,axis='Y'):
    pts=[]
    for i in range(64):
        a=i*math.tau/64
        off=(r*math.cos(a),0,r*math.sin(a)) if axis=='Y' else (r*math.cos(a),r*math.sin(a),0)
        pts.append(tuple(p[j]+off[j] for j in range(3)))
    return line(name,pts,t,m,c,True)
def label(name,body,p,size,m,c=signs,align='CENTER'):
    cu=bpy.data.curves.new(name,'FONT'); cu.body=body; cu.size=size; cu.align_x=align; cu.extrude=.0008
    o=bpy.data.objects.new(name,cu); c.objects.link(o); o.location=p; o.rotation_euler=(math.pi/2,0,0); cu.materials.append(m); return o
def light(name,p,color,power,size,target=None,shape='DISK',size_y=None):
    data=bpy.data.lights.new(name,'AREA' if target is not None else 'POINT'); data.energy=power; data.color=color
    if target is not None:
        data.shape=shape; data.size=size
        if shape=='RECTANGLE': data.size_y=size_y or size
    else: data.shadow_soft_size=size
    o=bpy.data.objects.new(name,data); lights.objects.link(o); o.location=p
    if target is not None: o.rotation_euler=(Vector(target)-o.location).to_track_quat('-Z','Y').to_euler()
    return o

# Organic layered floor: puddle roughness, large worn patches, aggregate and hairline cracks.
floor=material('Wet concrete | irregular puddles aggregate and cracks',(.018,.02,.025),.08,.25)
n=floor.node_tree.nodes; l=floor.node_tree.links; bs=n.get('Principled BSDF'); tc=n.new('ShaderNodeTexCoord')
def texnoise(scale,detail=3):
    t=n.new('ShaderNodeTexNoise'); t.inputs['Scale'].default_value=scale; t.inputs['Detail'].default_value=detail; l.new(tc.outputs['Object'],t.inputs['Vector']); return t
macro=texnoise(2.8,5); micro=texnoise(125,3); bumps=texnoise(23,5)
ramp=n.new('ShaderNodeValToRGB'); ramp.color_ramp.elements[0].position=.34; ramp.color_ramp.elements[0].color=(.006,.008,.011,1)
ramp.color_ramp.elements[1].position=.70; ramp.color_ramp.elements[1].color=(.025,.027,.025,1)
l.new(macro.outputs['Fac'],ramp.inputs[0]); l.new(ramp.outputs[0],bs.inputs['Base Color'])
rr=n.new('ShaderNodeValToRGB'); rr.color_ramp.elements[0].position=.41; rr.color_ramp.elements[0].color=(.035,.035,.035,1)
rr.color_ramp.elements[1].position=.60; rr.color_ramp.elements[1].color=(.53,.53,.53,1)
l.new(macro.outputs['Fac'],rr.inputs[0]); l.new(rr.outputs[0],bs.inputs['Roughness'])
b1=n.new('ShaderNodeBump'); b1.inputs['Strength'].default_value=.44; b1.inputs['Distance'].default_value=.016; l.new(bumps.outputs['Fac'],b1.inputs['Height'])
b2=n.new('ShaderNodeBump'); b2.inputs['Strength'].default_value=.35; b2.inputs['Distance'].default_value=.009; l.new(micro.outputs['Fac'],b2.inputs['Height']); l.new(b1.outputs[0],b2.inputs['Normal']); l.new(b2.outputs[0],bs.inputs['Normal'])
bs.inputs['Coat Weight'].default_value=.13; bs.inputs['Coat Roughness'].default_value=.10
box('Continuous wet concrete slab',(0,0,-.12),(31,40,.24),floor,arch)
# Irregular cracks modeled as fine splines instead of a tiled floor grid.
for k in range(47):
    x=random.uniform(-14,14); y=random.uniform(-12,9); pts=[]
    for j in range(random.randint(4,13)):
        pts.append((x,y,.003)); x+=random.uniform(-.23,.25); y+=random.uniform(.08,.32)
    line('Concrete fracture %02d'%k,pts,.0010,black,arch)

wall=material('Wall | aged concrete block masonry',(.14,.14,.13),0,.86)
n=wall.node_tree.nodes; l=wall.node_tree.links; bs=n.get('Principled BSDF')
tc=n.new('ShaderNodeTexCoord'); sep=n.new('ShaderNodeSeparateXYZ'); combine=n.new('ShaderNodeCombineXYZ')
l.new(tc.outputs['Object'],sep.inputs[0]); l.new(sep.outputs['X'],combine.inputs['X']); l.new(sep.outputs['Z'],combine.inputs['Y']); l.new(sep.outputs['Y'],combine.inputs['Z'])
br=n.new('ShaderNodeTexBrick'); br.offset=.5; br.offset_frequency=2; br.inputs['Scale'].default_value=1
br.inputs['Brick Width'].default_value=.85; br.inputs['Row Height'].default_value=.42; br.inputs['Mortar Size'].default_value=.012
br.inputs['Color1'].default_value=(.079,.077,.070,1); br.inputs['Color2'].default_value=(.030,.035,.040,1); br.inputs['Mortar'].default_value=(.021,.024,.026,1)
l.new(combine.outputs[0],br.inputs['Vector'])
nn=n.new('ShaderNodeTexNoise'); nn.inputs['Scale'].default_value=4; nn.inputs['Detail'].default_value=5; l.new(tc.outputs['Object'],nn.inputs[0])
mix=n.new('ShaderNodeMixRGB'); mix.blend_type='MULTIPLY'; mix.inputs[0].default_value=.65; l.new(br.outputs['Color'],mix.inputs[1]); l.new(nn.outputs['Fac'],mix.inputs[2]); l.new(mix.outputs[0],bs.inputs['Base Color'])
bum=n.new('ShaderNodeBump'); bum.inputs['Strength'].default_value=.5; bum.inputs['Distance'].default_value=.034; bum.invert=True
l.new(br.outputs['Fac'],bum.inputs['Height']); fine=n.new('ShaderNodeBump'); fine.inputs['Strength'].default_value=.35; fine.inputs['Distance'].default_value=.035; l.new(nn.outputs[0],fine.inputs['Height']); l.new(bum.outputs[0],fine.inputs['Normal']); l.new(fine.outputs[0],bs.inputs['Normal'])
box('Rear masonry wall',(0,9.4,3.5),(29,.35,7),wall,arch)
box('West return wall',(-14,0,3.5),(.35,19,7),wall,arch)
box('East return wall',(14,0,3.5),(.35,19,7),wall,arch)
ceiling=noise_material('Ceiling | soot darkened panels',(.04,.045,.05),.4,.7,5,.03)
box('Ceiling deck',(0,0,7.25),(29,24,.2),ceiling,arch)
for x in range(-14,15,2): box('Corrugated roof seam',(x,0,7.1),(.06,24,.10),iron,steel)

def ibeam_vertical(name,x,y,h=6.95,width=.30):
    box(name+' web',(x,y,h/2),(.065,width,h),iron,steel,.007)
    for yy in [-width/2,width/2]: box(name+' flange',(x,y+yy,h/2),(width,.06,h),iron,steel,.009)
    box(name+' foot',(x,y,.05),(width+.28,width+.3,.1),iron,steel,.01)
    for dx in [-.2,.2]:
        for dy in [-.2,.2]: cylinder(name+' anchor bolt',(x+dx,y+dy,.125),.025,.09,silver,steel,n=6)
    for z in [1.4,3.4,5.6]:
        box(name+' splice plate',(x,y-width/2-.042,z),(width+.05,.034,.36),iron,steel,.005)
        for dx in [-.1,.1]:
            for dz in [-.12,.12]: cylinder(name+' splice rivet',(x+dx,y-width/2-.07,z+dz),.024,.025,silver,steel,axis=(0,-1,0),n=8)
for x in [-12,-9.7,-6.6,-2.8,1.6,6.6,10.3,13.5]: ibeam_vertical('Wall pier %s'%x,x,9.12)
for y in [-4,1.2,6.4]:
    for z in [6.2,6.95]: box('Roof truss chord',(0,y,z),(28,.13,.14),iron,steel,.01)
    for i in range(28):
        x=-14+i
        beam('Truss triangular web',(x,y,6.22),(x+1,y,6.91),.065,.065,silver,steel)
        beam('Truss vertical web',(x,y,6.22),(x,y,6.91),.05,.05,iron,steel)
    for x in [-12,-6.2,1.65,6.8,13]:
        box('Roof connection gusset',(x,y-.1,6.55),(.37,.05,.63),iron,steel,.005)
for x in [-12,-8,-4,0,4,8,12]: box('Long roof purlin',(x,0,6.98),(.14,24,.18),iron,steel,.01)
# Exposed steel pipework, elbows, conduits and wall switch boxes.
for z,r in [(5.88,.055),(6.09,.03),(2.04,.025)]:
    rod('Rear wall horizontal service pipe',(-14,9.02,z),(14,9.02,z),r,iron,props)
    for x in range(-13,14,2): cylinder('Pipe coupling',(x,9.02,z),r*1.35,.09,silver,props,axis=(1,0,0))
for x in [-11,-6.75,-4.5,.6,6.9,10.1]:
    rod('Electrical vertical conduit',(x,8.98,.2),(x,8.98,6),.023,iron,props)
    box('Wall electrical junction',(x,8.92,2.5),(.21,.12,.30),iron,props,.02)
    for z in [1,3.4,5.3]: box('Conduit strap',(x,8.94,z),(.11,.08,.025),silver,props)

def lift(x,y,index):
    name='Lift %02d '%index
    box(name+'blue mast',(x,y,3.3),(.38,.46,6.6),bluepaint,lifts,.025)
    for dx in [-.20,.20]: box(name+'folded edge',(x+dx,y-.25,3.3),(.055,.06,6.6),iron,lifts,.007)
    box(name+'yellow base',(x,y,.12),(.84,.93,.24),yellow,lifts,.025)
    for dx in [-.3,.3]:
        for dy in [-.32,.32]: cylinder(name+'base anchor',(x+dx,y+dy,.255),.045,.065,silver,lifts,n=6)
    rod(name+'chrome piston',(x-.06,y-.31,.45),(x-.06,y-.31,5.7),.049,chrome,lifts)
    box(name+'yellow hydraulic cylinder',(x-.06,y-.29,1.8),(.15,.14,2.6),yellow,lifts,.019)
    for z in [i*.23+.7 for i in range(21)]: box(name+'rack tooth',(x+.12,y-.27,z),(.065,.06,.05),silver,lifts)
    box(name+'sliding carriage',(x,y-.39,.6),(.58,.31,.6),bluepaint,lifts,.02)
    for side in [-1,1]:
        end=(x+side*1.12,y-.90,.22)
        beam(name+'yellow lift arm',(x,y-.40,.22),end,.19,.15,yellow,lifts)
        rod(name+'pad screw',(end[0],end[1],.20),(end[0],end[1],.35),.06,silver,lifts)
        cylinder(name+'rubber saddle',(end[0],end[1],.37),.16,.07,rubber,lifts)
    for z in [1.05,4.85]:
        box(name+'warning decal',(x+.01,y-.244,z),(.16,.01,.27),paper,lifts)
        label(name+'warning mark','!',(x+.01,y-.255,z-.055),.14,black,lifts)
    line(name+'hydraulic hose',[(x+.23,y-.1,.8),(x+.37,y-.15,2),(x+.3,y-.1,5.8),(x,y,6.4)],.023,rubber,lifts)
    box(name+'control box',(x+.27,y-.22,1.65),(.16,.21,.33),iron,lifts,.02)
    cylinder(name+'red stop button',(x+.27,y-.343,1.72),.045,.03,red,lifts,axis=(0,-1,0))
for i,p in enumerate([(-10.6,5.1),(-5.6,6.0),(.95,6.5),(5.7,6.1),(6.7,7.1)]): lift(*p,i+1)

def caster(x,y,z=.12):
    box('Caster fork',(x,y,z+.06),(.055,.12,.15),silver,furn,.008)
    cylinder('Rubber caster',(x,y,z),.09,.065,rubber,furn,axis=(1,0,0))
    cylinder('Caster hub',(x-.04,y,z),.032,.018,silver,furn,axis=(1,0,0),n=12)
def cabinet(x,y,w=1.1,h=1.55,drawers=8):
    box('Red rolling tool cabinet',(x,y,h/2+.19),(w,.69,h),red,furn,.025)
    box('Black worktop',(x,y,h+.205),(w+.045,.73,.055),rubber,furn,.012)
    for dx in [-w*.40,w*.40]:
        for dy in [-.24,.24]: caster(x+dx,y+dy)
    for j in range(drawers):
        dh=(h-.13)/drawers; z=.25+dh/2+j*dh
        box('Dark drawer gap',(x,y-.352,z),(w-.1,.025,dh-.008),black,furn,.005)
        box('Red drawer face',(x,y-.375,z),(w-.125,.025,dh-.025),red,furn,.008)
        box('Aluminum drawer pull',(x,y-.399,z+dh*.29),(w-.20,.04,.029),silver,furn,.007)
        box('Drawer label',(x+w*.28,y-.416,z),(.105,.005,.033),paper,furn)
    for dx in [-w/2+.035,w/2-.035]: box('Cabinet corner rail',(x+dx,y-.37,.2+h/2),(.032,.034,h-.02),silver,furn,.004)
    rod('Cabinet side push handle',(x+w/2+.065,y-.14,h-.08),(x+w/2+.065,y+.22,h-.08),.025,chrome,furn)
    return h+.24

cabdata=[(-10.1,8.1,.85,1.63,7),(-8.94,8.1,1.25,1.55,9),(-7.53,8.1,1.38,1.55,9),(-5.29,8.1,1.13,1.40,7),(-3.82,8.18,1.45,1.48,8),(-1.96,8.2,1.15,1.42,8),(.01,8.1,1.48,1.6,9),(2.99,8.2,1.28,1.45,7),(4.64,8.1,1.13,1.35,8),(5.65,8.1,.73,1.37,8),(11.8,8.2,1.1,1.5,8)]
tops=[]
for d in cabdata: tops.append((*d[:2],cabinet(*d)))

bottle_mats=[material('Bottle red',(.26,.015,.012),.15,.32),material('Bottle blue',(.018,.055,.18),.25,.3),material('Bottle yellow',(.58,.36,.035),.2,.35),material('Bottle cream',(.57,.54,.43),.1,.35),material('Bottle amber',(.21,.077,.018),.4,.23),iron]
def bottle(x,y,z,index):
    bm=random.choice(bottle_mats); h=random.uniform(.14,.37); r=random.uniform(.031,.059)
    cylinder('Workshop chemical bottle',(x,y,z+h*.43),r,h*.86,bm,props,n=16)
    cylinder('Bottle shoulder',(x,y,z+h*.90),r,h*.10,bm,props,n=16,r2=r*.5)
    cylinder('Bottle cap',(x,y,z+h*.99),r*.5,h*.09,black if index%3 else red,props,n=12)
    cylinder('Product wrap label',(x,y,z+h*.43),r*1.014,h*.30,paper if index%3 else silver,props,n=16)
    box('Label stripe',(x,y-r-.001,z+h*.43),(r*.9,.003,h*.075),red if index%2 else bluepaint,props)
for k,(x,y,z) in enumerate(tops):
    for j in range(random.randint(5,9)): bottle(x+random.uniform(-.4,.4),y+random.uniform(-.17,.2),z,j)
for a,b in [(-11.7,-6.9),(-5.9,.75),(2.2,5.9),(8.7,13)]:
    for z in [2.38,3.12]:
        box('Black wall shelf',((a+b)/2,8.99,z),(b-a,.48,.055),iron,furn,.008)
        for x in [a+.1,(a+b)/2,b-.1]:
            beam('Shelf triangular bracket',(x,9.13,z-.35),(x,8.78,z-.035),.035,.035,silver,furn)
        for j in range(int((b-a)/.17)):
            if random.random()<.83: bottle(a+.12+j*.17+random.uniform(-.02,.02),8.93+random.uniform(-.1,.1),z+.027,j)

# Pegboard and hanging hand tools under the left shelf.
peg=box('Left tool board',(-8.8,9.15,2.09),(3.3,.05,.50),iron,furn,.01)
for i in range(18):
    x=-10.3+i*.17; z=2.07+random.uniform(-.05,.08)
    rod('Hanging wrench shank',(x,9.08,z-.12),(x,9.08,z+.12),.012,chrome,props)
    ring('Hanging wrench box end',(x,9.077,z+.14),.031,.009,silver,props)
for x in [-11.2,-5.9,-2.9,2.1,5.9]:
    # Coiled air hoses: hanging loops read clearly in the midground.
    for i in range(6): ring('Coiled black air line',(x,8.92-i*.008,1.37),.26+i*.008,.011,rubber,props)
    line('Air hose loose tail',[(x,8.9,1.1),(x+.1,8.7,.4),(x+.4,8.4,.08),(x+.7,8.3,.055)],.016,rubber,props)

def tire(x,y,z,r=.40):
    # Revolved tire section with actual open center and rounded shoulders.
    profile=[(.23,-.12),(.33,-.13),(r-.025,-.11),(r,-.075),(r,.075),(r-.025,.11),(.33,.13),(.23,.12)]
    vv=[]; ff=[]; nn=64
    for rr,zz in profile:
        for i in range(nn): vv.append((x+rr*math.cos(i*math.tau/nn),y+rr*math.sin(i*math.tau/nn),z+zz))
    for j in range(len(profile)):
        for i in range(nn): ff.append((j*nn+i,j*nn+(i+1)%nn,((j+1)%len(profile))*nn+(i+1)%nn,((j+1)%len(profile))*nn+i))
    ob=mesh('Stacked performance tire',vv,ff,rubber,props)
    for p in ob.data.polygons:p.use_smooth=True
    for dz in [-.06,0,.06]: ring('Tread circumferential groove',(x,y,z+dz),r+.002,.005,black,props,axis='Z')
    for i in range(40):
        a=i*math.tau/40
        line('Tire tread siping',[(x+(r+.004)*math.cos(a+.03),y+(r+.004)*math.sin(a+.03),z-.075),(x+(r+.006)*math.cos(a),y+(r+.006)*math.sin(a),z+.075)],.004,black,props)
for x,y,num in [(-6.55,7.1,4),(7.65,5.7,4),(-10.6,4.0,3),(11.7,5.2,3)]:
    for j in range(num): tire(x,y,.15+j*.27)

def barrel(x,y,h=.95,r=.36):
    cylinder('Black oil drum',(x,y,h/2),r,h,iron,props,n=48)
    for z in [.035,h*.27,h*.72,h-.025]: ring('Rolled drum rib',(x,y,z),r+.011,.014,silver,props,'Z')
    cylinder('Drum top',(x,y,h+.001),r-.014,.018,black,props,n=48)
    cylinder('Drum bung',(x+.16,y,h+.026),.036,.035,brass,props,n=12)
for x,y,h in [(-10.1,3.1,1.15),(7.7,5.25,1.2),(-2.8,-6.8,.93),(3.8,-6.0,1.08)]: barrel(x,y,h)

def jack(x,y,rot=0):
    group=[]; start=set(props.objects)
    for dx in [-.16,.16]:
        box('Jack red chassis',(x+dx,y,.12),(.12,1.12,.13),red,props,.025)
        for yy in [-.43,.42]: cylinder('Jack wheel',(x+dx*1.6,y+yy,.09),.085,.08,iron,props,axis=(1,0,0))
    beam('Jack lifting arm',(x,y+.32,.13),(x,y-.28,.32),.18,.12,red,props)
    cylinder('Jack saddle',(x,y-.31,.35),.13,.045,rubber,props)
    rod('Jack handle shaft',(x,y+.43,.2),(x,y+1.04,1.2),.025,silver,props)
    rod('Jack handle grip',(x,y+.97,1.09),(x,y+1.11,1.30),.04,rubber,props)
    for o in set(props.objects)-start:
        # Pivot rotation keeps the whole floor jack a coherent movable asset.
        pass
jack(-3.7,-3.9); jack(-3.6,-4.7); jack(9.2,5.1)

# Work carts frame the foreground, with sockets and scattered hardware.
def cart(x,y,w=1.35,h=.9):
    for z in [.17,h]:
        box('Tool cart tray',(x,y,z),(w,.68,.05),iron,props,.008)
        for yy in [-.34,.34]: box('Cart raised tray edge',(x,y+yy,z+.045),(w,.024,.09),iron,props,.006)
    for dx in [-w/2+.05,w/2-.05]:
        for dy in [-.29,.29]:
            rod('Cart upright',(x+dx,y+dy,.10),(x+dx,y+dy,h+.10),.027,silver,props)
            caster(x+dx,y+dy)
    for j in range(15):
        xx=x+random.uniform(-w*.42,w*.42); yy=y+random.uniform(-.26,.26)
        cylinder('Socket on cart',(xx,yy,h+.09),random.uniform(.025,.047),random.uniform(.08,.15),chrome,props,n=12)
    for j in range(4):
        xx=x+random.uniform(-.4,.4); yy=y+random.uniform(-.25,.25)
        rod('Ratchet handle',(xx,yy,h+.04),(xx+.35,yy+.06,h+.04),.018,silver,props)
    return h
cart(3.25,-5.15,1.85,1.0); cart(-4.0,-5.2,1.4,.72)
cabinet(4.6,-3.0,1.00,1.5,7)
for j in range(6): bottle(4.6+random.uniform(-.4,.4),-3+random.uniform(-.2,.2),1.74,j)
# Open crates and spare parts at the lower right.
for x,y in [(3.9,-2.8),(4.5,-3.5)]:
    box('Spare parts crate base',(x,y,.1),(.76,.53,.15),black,props,.015)
    for xx in [-.37,.37]: box('Crate end wall',(x+xx,y,.30),(.035,.55,.4),iron,props,.01)
    for yy in [-.26,.26]:
        for z in [.14,.29,.44]: box('Crate side slat',(x,y+yy,z),(.75,.035,.07),iron,props)
    for j in range(6): cylinder('Spare metal part',(x+random.uniform(-.28,.28),y+random.uniform(-.15,.15),.36),.05,.40,silver,props)

# The secondary car is a sculpted drape with radial folds, a long bonnet and cabin.
cx,cy=8.55,7.07
vv=[]; ff=[]; nx,ny=100,64
for i in range(nx+1):
    x=-2.0+4.0*i/nx
    roof=1.3+1.0*math.exp(-((x+.25)/1.13)**6)
    halfw=.94*(1-.11*(abs(x)/2)**5)
    for j in range(ny+1):
        t=-1+2*j/ny; at=abs(t)
        yy=t*(halfw+.22)
        if at<.60: z=roof+.028*math.cos(t*5)
        else:
            q=(at-.60)/.40; z=roof*(1-q)+.28*q
        z+=.015*math.sin(17*x+at*4)+(.015+.035*at)*math.sin(37*t+7*x)*(at**2)
        z-=.37*(abs(x)/2)**12*(1-at*.4)
        vv.append((cx+x,cy+yy,max(.22,z)))
for i in range(nx):
    for j in range(ny):
        a=i*(ny+1)+j; ff.append((a,a+1,a+ny+2,a+ny+1))
ob=mesh('Covered car | folded fabric surface',vv,ff,cloth,cover)
for p in ob.data.polygons:p.use_smooth=True
sol=ob.modifiers.new('Fabric thickness','SOLIDIFY'); sol.thickness=.009
for xx in [-1.28,1.26]:
    for yy in [-.72,.72]: cylinder('Covered vehicle tire',(cx+xx,cy+yy,.35),.34,.19,rubber,cover,axis=(0,1,0),n=40)

# Four interlocking blue neon rings on the upper left.
for i in range(4): ring('Audi neon ring %d'%(i+1),(-8.98+i*.47,9.005,4.32),.36,.027,blue,signs)
light('Blue neon rings wall spill',(-7.94,8.82,4.32),(.006,.09,1),85,1.7,(-7.94,9.35,4.32))
light('Blue neon rings foreground spill',(-7.94,8.70,4.32),(.006,.10,1),65,1.7,(-7.94,4,2))

# A fabric banner with gently sagging edges and subtle surface waves.
banner=noise_material('Banner | black canvas',(.015,.014,.022),0,.87,85,.002)
vv=[]; ff=[]; bx,bz=3.7,4.10
for i in range(41):
    u=i/40
    for j in range(31):
        v=j/30; x=bx+(u-.5)*2.65; z=bz+(v-.5)*2.0-.12*math.sin(math.pi*u)
        y=8.96-.075*math.sin(u*math.pi)-.022*math.sin(u*24+v*9)
        vv.append((x,y,z))
for i in range(40):
    for j in range(30):
        a=i*31+j; ff.append((a,a+1,a+32,a+31))
ob=mesh('S6 hanging canvas banner',vv,ff,banner,signs)
for p in ob.data.polygons:p.use_smooth=True
for x in [bx-1.27,bx+1.27]:
    ring('Banner mounting eyelet',(x,8.91,bz+.98),.038,.010,brass,signs)
    line('Banner suspension',[(x,8.91,bz+.98),(x,9.0,5.38)],.009,rubber,signs)
badge=mesh('S6 red parallelogram',[(bx-.99,8.835,bz-.40),(bx-.15,8.835,bz-.40),(bx+.10,8.835,bz+.42),(bx-.74,8.835,bz+.42)],[(0,1,2,3)],red,signs)
t=label('S6 banner lettering','S6',(bx+.23,8.79,bz-.32),1.05,paper); t.data.shear=.16
fontpath=Path('C:/Windows/Fonts/arialbi.ttf')
if fontpath.exists(): t.data.font=bpy.data.fonts.load(str(fontpath))

# Reuse only the small poster artwork from the user's image as UV-mapped prints.
# The room, floor, car cover and props remain independently shaded 3D geometry.
source_image=bpy.data.images.load(str(ROOT/'ChatGPT Image Oct 4, 2026, 01_38_30 AM-1.png')); source_image.pack()
poster_crops=[(383,155,430,234),(483,172,542,243),(383,155,430,234),(1450,268,1497,319),(1570,246,1623,304)]
for i,(x,z) in enumerate([(-5.45,4.25),(-3.7,4.12),(-1.65,4.23),(9.5,3.66),(11.6,3.93)]):
    box('Motorsport poster frame',(x,9.10,z),(.97,.06,1.42),black,signs,.015)
    box('Motorsport print',(x,9.057,z),(.85,.014,1.29),paper,signs)
    pm=material('Reference motorsport print %d'%i,(.3,.3,.3),0,.72)
    it=pm.node_tree.nodes.new('ShaderNodeTexImage'); it.image=source_image
    pm.node_tree.links.new(it.outputs['Color'],pm.node_tree.nodes.get('Principled BSDF').inputs['Base Color'])
    ob=mesh('Motorsport poster artwork',[(x-.395,9.031,z-.595),(x+.395,9.031,z-.595),(x+.395,9.031,z+.595),(x-.395,9.031,z+.595)],[(0,1,2,3)],pm,signs)
    uv=ob.data.uv_layers.new(); x0,y0,x1,y1=poster_crops[i]
    coords=[(x0/1672,1-y1/941),(x1/1672,1-y1/941),(x1/1672,1-y0/941),(x0/1672,1-y0/941)]
    for idx,coord in enumerate(coords): uv.data[idx].uv=coord

def neon(name,a,b,m,color,power):
    rod(name+' black mounting rail',tuple(a[i]+(0,.055,0)[i] for i in range(3)),tuple(b[i]+(0,.055,0)[i] for i in range(3)),.054,iron,lights)
    rod(name+' luminous tube',a,b,.027,m,lights)
    for pt in [a,b]: cylinder(name+' end cap',pt,.038,.065,silver,lights,axis=Vector(b)-Vector(a))
    mid=(Vector(a)+Vector(b))/2
    # Small area emitters supply stable direct colored reflections.
    vertical=abs(a[2]-b[2])>.1
    ll=light(name+' front wash',mid+Vector((0,-.10,0)),color,power,(Vector(b)-Vector(a)).length,(mid.x,mid.y-5,1.4),'RECTANGLE',.12)
    if vertical: ll.rotation_euler.rotate_axis('Z',math.pi/2)
    light(name+' masonry wash',mid+Vector((0,.04,0)),color,power*.45,(Vector(b)-Vector(a)).length,(mid.x,9.4,mid.z),'RECTANGLE',.15)
for i,(x,z,length) in enumerate([(-8.22,5.68,2.35),(-.9,5.30,1.48),(9.75,4.82,1.86),(6.25,4.55,.92)]):
    neon('Blue upper wall %d'%i,(x-length/2,8.83,z),(x+length/2,8.83,z-.04),blue,(.008,.13,1),110)
for i,(x,y,z,m,col,pw) in enumerate([(-10.16,8.0,3.03,redlight,(1,.004,.015),75),(-6.0,7.1,2.72,blue,(.008,.13,1),95),(5.23,8.62,3.26,redlight,(1,.004,.016),110),(5.83,8.45,3.21,blue,(.008,.14,1),80),(8.05,8.5,3.1,blue,(.008,.14,1),70)]):
    neon('Vertical service tube %d'%i,(x,y,z-.69),(x,y,z+.69),m,col,pw)
neon('Red workbench strip',(-9.85,8.61,2.84),(-8.1,8.61,2.84),redlight,(1,.007,.018),90)
neon('Red middle bench strip',(-5.6,8.61,2.84),(-4.5,8.61,2.84),redlight,(1,.007,.018),65)

def hanging_strip(x,y,z,length,idx):
    box('Suspended fluorescent steel tray',(x,y,z+.06),(length+.13,.15,.10),iron,lights,.025)
    rod('Warm fluorescent tube',(x-length/2,y-.035,z),(x+length/2,y-.035,z),.031,warm if idx%3 else cool,lights)
    for dx in [-length*.40,length*.40]: rod('Fixture suspension',(x+dx,y,z+.1),(x+dx,y,7.03),.006,iron,lights)
    light('Fluorescent pool %d'%idx,(x,y,z-.06),(1,.67,.41) if idx%3 else (.7,.81,1),250,length,(x,y,0),'RECTANGLE',.2)
for idx,d in enumerate([(-9.5,7.7,5.95,1.8),(-5.5,7.6,6.1,1.0),(-3.6,7.7,5.85,1.1),(3.15,7.0,5.83,1.20),(5.5,7.4,5.7,.95),(11.4,6.5,5.55,1.1),(-3,0,6.4,1.6),(7,0,6.25,1.5)]): hanging_strip(*d,idx)
for idx,(x,y,z) in enumerate([(-11,7,4.5),(-2.8,8.5,3.08),(2.15,8.5,2.85),(2.48,8.6,2.55),(8.53,5.4,1.1),(-10.4,6.4,5.3)]):
    rod('Worklamp power cord',(x,y,z+.12),(x,y,6.8),.009,rubber,lights)
    cylinder('Worklamp black socket',(x,y,z+.11),.065,.17,iron,lights)
    bpy.ops.mesh.primitive_uv_sphere_add(segments=16,ring_count=8,radius=.065,location=(x,y,z))
    o=bpy.context.object; o.name='Glowing tungsten work bulb'
    for c in list(o.users_collection): c.objects.unlink(o)
    lights.objects.link(o); o.data.materials.append(bulbmat)
    light('Warm bare bulb %d'%idx,(x,y,z),(1,.49,.20),55,.09)
# Soft bounce lets architecture read while keeping practical lamps dominant.
light('Subtle cool ceiling bounce',(0,1.5,6.4),(.25,.39,.72),65,9,(0,4,0),'RECTANGLE',5)
light('Front soft reflection',(-1,-5,5.5),(.57,.68,1),15,6,(0,3,0),'RECTANGLE',3)
# Expose more of the layered trusses within the reference framing.
for o in steel.objects:
    if o.name.startswith(('Roof truss chord','Truss triangular web','Truss vertical web','Roof connection gusset')):
        o.location.z-=.50

# Camera framing follows the supplied 1672 x 941 reference: low eye height,
# nearly vertical columns, the same left sign and right-banner composition.
data=bpy.data.cameras.new('Reference composition | 35mm'); camera=bpy.data.objects.new('CAMERA | garage reference view',data); refs.objects.link(camera)
camera.location=(1.15,-13,2.45); target=Vector((0,9,.60)); camera.rotation_euler=(target-camera.location).to_track_quat('-Z','Y').to_euler()
data.lens=35; data.clip_end=150; scene.camera=camera
data.dof.use_dof=True; data.dof.focus_distance=21; data.dof.aperture_fstop=6.3
refpath=ROOT/'ChatGPT Image Oct 4, 2026, 01_38_30 AM-1.png'
im=bpy.data.images.load(str(refpath)); im.pack()
bg=data.background_images.new(); bg.image=im; bg.alpha=.35; data.show_background_images=False
scene['Reference image']=refpath.name
scene['Scope']='Garage environment first. Central Audi deferred. Source reference packed for camera overlay, never used as a backdrop.'
scene['Asset organization']='All architecture and workshop props are editable geometry in named collections.'

world=bpy.data.worlds.new('Night industrial interior'); world.use_nodes=True; scene.world=world
world.node_tree.nodes['Background'].inputs['Color'].default_value=(.025,.035,.06,1)
world.node_tree.nodes['Background'].inputs['Strength'].default_value=.10
scene.render.engine='CYCLES'; scene.cycles.samples=int(os.environ.get('GARAGE_SAMPLES','48')); scene.cycles.use_denoising=True
scene.cycles.max_bounces=8; scene.cycles.diffuse_bounces=3; scene.cycles.glossy_bounces=4
try:
    prefs=bpy.context.preferences.addons['cycles'].preferences; prefs.compute_device_type='CUDA'; prefs.get_devices()
    gpu=False
    for dev in prefs.devices:
        dev.use=dev.type=='CUDA'; gpu=gpu or dev.use
    scene.cycles.device='GPU' if gpu else 'CPU'
except Exception as e: print('Cycles device:',e)
scene.render.resolution_x=1672; scene.render.resolution_y=941
scene.render.resolution_percentage=int(os.environ.get('GARAGE_PERCENT','65'))
scene.render.image_settings.file_format='PNG'; scene.render.filepath=str(OUT/'garage_reference_preview.png')
scene.view_settings.view_transform='AgX'; scene.view_settings.look='AgX - Medium High Contrast'; scene.view_settings.exposure=-.05
scene.unit_settings.system='METRIC'
# Blender 5 compositor uses an explicit node-group assignment.
try:
    tree=bpy.data.node_groups.new('Garage bloom compositor','CompositorNodeTree')
    tree.interface.new_socket(name='Image',in_out='OUTPUT',socket_type='NodeSocketColor')
    rl=tree.nodes.new('CompositorNodeRLayers'); gl=tree.nodes.new('CompositorNodeGlare'); gl.inputs['Type'].default_value='Fog Glow'; gl.inputs['Quality'].default_value='High'
    gl.inputs['Threshold'].default_value=1.2; gl.inputs['Strength'].default_value=.5; gl.inputs['Saturation'].default_value=1.4
    out=tree.nodes.new('NodeGroupOutput'); tree.links.new(rl.outputs['Image'],gl.inputs['Image']); tree.links.new(gl.outputs['Image'],out.inputs['Image'])
    scene.compositing_node_group=tree
except Exception as e: print('Compositor setup:',e)
for screen in bpy.data.screens:
    for area in screen.areas:
        if area.type=='VIEW_3D':
            area.spaces.active.region_3d.view_perspective='CAMERA'; area.spaces.active.shading.type='MATERIAL'
            area.spaces.active.overlay.show_overlays=False
scene.render.film_transparent=False
bpy.ops.wm.save_as_mainfile(filepath=str(OUT/'garage_reference.blend'))
print('GARAGE_BUILD_COMPLETE',len(scene.objects),'objects',flush=True)
bpy.ops.render.render(write_still=True)
print('GARAGE_RENDER_COMPLETE',scene.render.filepath,flush=True)
