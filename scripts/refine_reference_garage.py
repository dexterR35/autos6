"""Refine the existing editable garage using measured reference-image anchors."""
import bpy, math, os, ast, random, json
from pathlib import Path
from mathutils import Vector, Matrix
from bpy_extras.object_utils import world_to_camera_view

ROOT=Path(__file__).resolve().parents[1]; OUT=ROOT/'output'/'garage'
bpy.ops.wm.open_mainfile(filepath=str(OUT/'garage_reference_before_refinement.blend'))
scene=bpy.context.scene; camera=scene.camera
# Reuse the geometry helpers without executing the original scene builder.
tree=ast.parse((ROOT/'scripts'/'build_reference_garage.py').read_text())
cached={}
boxverts=[(-.5,-.5,-.5),(.5,-.5,-.5),(.5,.5,-.5),(-.5,.5,-.5),(-.5,-.5,.5),(.5,-.5,.5),(.5,.5,.5),(-.5,.5,.5)]
boxfaces=[(0,3,2,1),(4,5,6,7),(0,1,5,4),(1,2,6,5),(2,3,7,6),(3,0,4,7)]
arch,steel,lifts,furn,props,signs,lights,cover,refs=[bpy.data.collections.get(n) for n in [
'01 | Concrete shell and wet floor','02 | Structural steel and roof trusses','03 | Service lifts and hydraulics',
'04 | Red workshop cabinets and benches','05 | Tools bottles tires and foreground equipment',
'06 | Neon rings S6 banner and posters','07 | Practical lighting and cables','08 | Covered vehicle in right bay','09 | Cameras and packed reference']]
exec(compile(ast.Module(body=[n for n in tree.body if isinstance(n,ast.FunctionDef)],type_ignores=[]),'<garage helpers>','exec'))
iron=bpy.data.materials['Steel | aged charcoal enamel']; silver=bpy.data.materials['Machined steel and aluminum']
rubber=bpy.data.materials['Tires and grips | charcoal rubber']; brass=bpy.data.materials['Aged brass fittings']
black=bpy.data.materials['Black recess']; blue=bpy.data.materials['Cobalt blue neon phosphor']
redlight=bpy.data.materials['Crimson neon phosphor']; warm=bpy.data.materials['Warm fluorescent diffuser']
cloth=bpy.data.materials['Dusty grey woven cover']
camera.location=(1.15,-13,2.45)
camera.rotation_euler=(Vector((0,9,.10))-camera.location).to_track_quat('-Z','Y').to_euler()
camera.data.dof.aperture_fstop=5.6
bpy.context.view_layer.update()

def project(p):
    q=world_to_camera_view(scene,camera,Vector(p)); return Vector((q.x*1672,(1-q.y)*941))

def anchor(px,py,fixed=8.88,plane='wall'):
    """Inverse projection onto a physical wall (Y) or ground (Z) plane."""
    p=Vector((0,fixed,3)) if plane=='wall' else Vector((0,6,fixed))
    axes=(0,2) if plane=='wall' else (0,1)
    for _ in range(10):
        uv=project(p); cols=[]
        for ax in axes:
            pp=p.copy(); pp[ax]+=.001; cols.append((project(pp)-uv)/.001)
        jac=Matrix(((cols[0].x,cols[1].x),(cols[0].y,cols[1].y)))
        delta=jac.inverted()@(Vector((px,py))-uv)
        p[axes[0]]+=delta.x; p[axes[1]]+=delta.y
        if delta.length<1e-7: break
    return p

# Lift anchors measured at the foot of each reference pillar, not guessed spacing.
old=[(-10.6,5.1),(-5.6,6),(.95,6.5),(5.7,6.1),(6.7,7.1)]
marks=[(24,513),(353,501),(933,499),(1318,499),(1380,497)]
report={'pillars':[],'neon':[]}
for i,((ox,oy),(px,py)) in enumerate(zip(old,marks),1):
    dest=anchor(px,py,.12,'floor'); factor=.77 if i in (1,2,5) else .92
    for ob in list(lifts.objects):
        if ob.name.startswith('Lift %02d '%i):
            matrix=Matrix.Translation(dest)@Matrix.Diagonal((factor,factor,1,1))@Matrix.Translation(Vector((-ox,-oy,-.12)))
            ob.matrix_world=matrix@ob.matrix_world
    report['pillars'].append({'lift':i,'reference_px':[px,py],'world_foot':list(dest)})

# Replace only the explicitly requested lighting, flag and covered vehicle objects.
for ob in list(lights.objects):
    if ob.name.startswith(('Blue upper wall','Vertical service tube','Red workbench strip','Red middle bench strip','Blue neon rings','Suspended fluorescent','Warm fluorescent','Fixture suspension','Fluorescent pool')):
        bpy.data.objects.remove(ob,do_unlink=True)
for ob in list(signs.objects):
    if ob.name.startswith(('Audi neon ring','S6 ','Banner mounting','Banner suspension')):
        bpy.data.objects.remove(ob,do_unlink=True)
for ob in list(cover.objects): bpy.data.objects.remove(ob,do_unlink=True)

# Cylindrical sources with front-facing area emitters: localized vertical floor
# reflections instead of large down-aimed pools of colored diffuse illumination.
blue.node_tree.nodes['Principled BSDF'].inputs['Emission Strength'].default_value=12
redlight.node_tree.nodes['Principled BSDF'].inputs['Emission Strength'].default_value=11
def practical(name,pixels,mat,col,power,y=8.84,r=.029):
    a=anchor(*pixels[0],y); b=anchor(*pixels[1],y); middle=(a+b)/2; direction=(b-a).normalized()
    rod(name+' mounting rail',a+Vector((0,.06,0)),b+Vector((0,.06,0)),r*1.9,iron,lights)
    rod(name+' luminous tube',a,b,r,mat,lights)
    for pt in [a,b]: cylinder(name+' socket',pt,r*1.38,.065,silver,lights,axis=direction)
    for face,energy,offset in [('front',power,-.075),('wall',power*.27,.065)]:
        normal=Vector((0,1 if face=='front' else -1,0)); xx=direction
        yy=normal.cross(xx).normalized(); zz=xx.cross(yy).normalized()
        ll=light(name+' '+face,middle+Vector((0,offset,0)),col,energy,(b-a).length,(0,0,0),'RECTANGLE',.075)
        ll.rotation_euler=Matrix((xx,yy,zz)).transposed().to_euler()
    report['neon'].append({'name':name,'reference_px':pixels,'world_endpoints':[list(a),list(b)]})

for name,points in [
('NEON blue left high',[(145,96),(306,118)]),
('NEON blue center high',[(688,124),(787,137)]),
('NEON blue right high',[(1449,205),(1575,188)]),
('NEON blue behind right pillar',[(1268,218),(1297,210)]),
('NEON blue left upright',[(354,256),(354,346)]),
('NEON blue beside flag',[(1247,235),(1247,332)]),
('NEON blue far right upright',[(1418,245),(1418,319)])]:
    depth=4.85 if 'left upright' in name else (8.70 if 'upright' in name else 8.84)
    practical(name,points,blue,(.006,.085,1),115 if 'high' in name else 85,y=depth)
for name,points,power in [
('NEON red left upright',[(36,236),(36,335)],90),
('NEON red bench',[(84,288),(177,293)],110),
('NEON red small bench',[(394,284),(420,288)],35),
('NEON red beside flag',[(1205,225),(1205,326)],150)]:
    practical(name,points,redlight,(1,.003,.015),power,y=8.70)

# Audi sign: match ring centers, overall width and height in the photograph.
for i,px in enumerate([184,212,240,268]):
    pts=[anchor(px+23.5*math.cos(a*math.tau/96),204+23.5*math.sin(a*math.tau/96),8.98) for a in range(96)]
    line('Audi neon ring %d'%(i+1),pts,.026,blue,signs,True)
pos=anchor(226,204,8.78)
light('Blue neon rings wall glow',pos,(.003,.05,1),60,1.6,pos+Vector((0,1,0)))
light('Blue neon rings forward glow',pos,(.003,.05,1),30,1.6,pos+Vector((0,-1,0)))

for i,pts in enumerate([[(46,82),(136,95)],[(394,74),(449,84)],[(507,91),(575,105)],[(1066,110),(1139,126)],[(1240,120),(1286,107)],[(1604,113),(1665,134)],[(395,124),(440,133)],[(485,139),(547,145)]]):
    practical('WARM fluorescent %02d'%i,pts,warm,(1,.60,.32),55,8.54,.03)
    a=anchor(*pts[0],8.54); b=anchor(*pts[1],8.54)
    for p in [a,b]: rod('Fluorescent hanging wire',p+Vector((0,0,.08)),(p.x,p.y,6.9),.005,iron,lights)
    mid=(a+b)/2
    light('Warm fluorescent downward %02d'%i,mid+Vector((0,0,-.06)),(1,.55,.26),75,(b-a).length,(mid.x,mid.y,0),'RECTANGLE',.12)

# The flag is a dark, sagging cloth panel. Ink geometry lies on the same fabric
# surface, eliminating the raised, shadow-casting text of the initial version.
flagmat=noise_material('Flag | faded charcoal fabric',(.005,.004,.007),0,.95,120,.001)
ink=material('Flag | pale grey printed S6',(.52,.52,.56),0,.82)
redink=material('Flag | printed motorsport red',(.36,.007,.018),0,.88)
tl,tr,br,bl=[Vector(v) for v in [(1004,147),(1192,164),(1184,297),(1007,282)]]
def flagpos(u,v,offset=0):
    pixel=(1-v)*((1-u)*tl+u*tr)+v*((1-u)*bl+u*br)
    p=anchor(*pixel,8.91)
    p.y-=.10*math.sin(math.pi*u)*math.sin(math.pi*v)+.027*math.sin(u*19+v*4)*math.sin(math.pi*v)+offset
    p.z-=.047*math.sin(math.pi*u)
    return p
vv=[]; ff=[]; nu,nv=100,70
for i in range(nu+1):
    for j in range(nv+1): vv.append(flagpos(i/nu,j/nv))
for i in range(nu):
    for j in range(nv):
        q=i*(nv+1)+j; ff.append((q,q+nv+1,q+nv+2,q+1))
ob=mesh('S6 hanging canvas banner',vv,ff,flagmat,signs)
for p in ob.data.polygons: p.use_smooth=True
flag_object=ob
for u in [.035,.965]:
    pt=flagpos(u,.03,.008); ring('Banner eyelet',pt,.027,.007,brass,signs)
    rod('Banner suspension',pt,(pt.x,9.09,pt.z+.34),.007,rubber,signs)
def flagpatch(name,quad,mat):
    verts=[]; faces=[]; dim=35
    for i in range(dim+1):
        for j in range(dim+1):
            u,v=i/dim,j/dim
            a,b,c,d=[Vector(t) for t in quad]
            uv=(1-v)*((1-u)*a+u*b)+v*((1-u)*d+u*c)
            verts.append(flagpos(uv.x,uv.y,.003))
    for i in range(dim):
        for j in range(dim):
            q=i*(dim+1)+j; faces.append((q,q+dim+1,q+dim+2,q+1))
    return mesh(name,verts,faces,mat,signs)
flagpatch('S6 printed red rhombus',[(.23,.22),(.57,.23),(.49,.75),(.13,.74)],redink)
font=bpy.data.curves.new('Wide technical S6 print','FONT'); font.body='S6'; font.size=1; font.shear=.16; font.extrude=0
font.font=bpy.data.fonts.load('C:/Windows/Fonts/bahnschrift.ttf')
fontob=bpy.data.objects.new('S6 print source',font); signs.objects.link(fontob)
bpy.context.view_layer.update(); ev=fontob.evaluated_get(bpy.context.evaluated_depsgraph_get())
fm=bpy.data.meshes.new_from_object(ev)
xs=[v.co.x for v in fm.vertices]; ys=[v.co.y for v in fm.vertices]
for vert in fm.vertices:
    u=(vert.co.x-min(xs))/(max(xs)-min(xs)); v=(vert.co.y-min(ys))/(max(ys)-min(ys))
    vert.co=flagpos(.35+u*.49,.38+(1-v)*.29,.006)
fo=bpy.data.objects.new('S6 flat printed lettering',fm); signs.objects.link(fo); fm.materials.append(ink)
bpy.data.objects.remove(fontob,do_unlink=True)
# Sample the unobstructed flag itself from the supplied reference. This keeps
# the original S6 emblem and fabric print rather than substituting a typeface.
art=bpy.data.images.load(str(ROOT/'ChatGPT Image Oct 4, 2026, 01_38_30 AM-1.png'),check_existing=True); art.pack()
it=flagmat.node_tree.nodes.new('ShaderNodeTexImage'); it.image=art; it.label='Exact reference flag artwork'
flagmat.node_tree.links.new(it.outputs['Color'],flagmat.node_tree.nodes['Principled BSDF'].inputs['Base Color'])
uv=flag_object.data.uv_layers.new(name='Reference flag artwork')
for poly in flag_object.data.polygons:
    for li in poly.loop_indices:
        vi=flag_object.data.loops[li].vertex_index; u=(vi//(nv+1))/nu; v=(vi%(nv+1))/nv
        pp=(1-v)*((1-u)*tl+u*tr)+v*((1-u)*bl+u*br)
        uv.data[li].uv=(pp.x/1672,1-pp.y/941)
for ob in signs.objects:
    if ob.name.startswith(('S6 printed red rhombus','S6 flat printed lettering')):
        ob.hide_render=True; ob.hide_viewport=True
# Keep wall furniture below the reference sign and flag; the earlier top shelf
# passed across the printed flag after its reference-correct repositioning.
for c in [furn,props]:
    for ob in list(c.objects):
        p=ob.location
        if 2.10<p.x<6.05 and 8.55<p.y<9.25 and 2.82<p.z<3.65:
            bpy.data.objects.remove(ob,do_unlink=True)
        elif 2.10<p.x<6.05 and 8.55<p.y<9.25 and 2.12<p.z<2.82:
            ob.location.z-=.28
        elif p.x<1.0 and 8.55<p.y<9.25 and 2.93<p.z<3.65:
            ob.location.z-=.40

# Sedan-shaped drape with an extended roof, sloping windscreen, low long bonnet,
# vertical side fall, diagonal tension folds, and an uneven weighted hem.
cx,cy=8.2,7.25; angle=math.radians(-18)
def placed(x,y,z): return Vector((cx+x*math.cos(angle)-y*math.sin(angle),cy+x*math.sin(angle)+y*math.cos(angle),z))
profile=[(-2.25,.29),(-2.13,1.12),(-1.8,1.48),(-1.35,2.20),(-1.12,2.30),(-.10,2.28),(.55,1.73),(1.77,1.42),(2.14,1.32),(2.27,.28)]
def roofheight(x):
    for (a,ha),(b,hb) in zip(profile,profile[1:]):
        if a<=x<=b:
            t=(x-a)/(b-a); t=t*t*(3-2*t)
            return ha*(1-t)+hb*t
    return .28
verts=[]; faces=[]; nx,ny=180,100
for i in range(nx+1):
    x=-2.25+4.52*i/nx; h=roofheight(x)
    for j in range(ny+1):
        t=-1+2*j/ny; at=abs(t); side=1 if t>=0 else -1
        if at<.58:
            y=t*1.18; z=h+.025*(1-(at/.58)**2)
            z+=.018*math.sin(11*x+t*7)+.008*math.sin(x*29-t*11)
        else:
            q=(at-.58)/.42
            y=side*(.684+.43*q); z=h*(1-q)+(.28+.034*math.sin(8*x))*q
            folds=0
            for k,a in enumerate([-1.83,-1.35,-.91,-.51,-.13,.32,.7,1.10,1.52,1.88]):
                center=a+(.75*math.sin(k*2.1))*q
                folds+=(.045+.037*(k%3)/2)*math.exp(-((x-center)/(.032+.027*q))**2)
                folds-=.027*math.exp(-((x-center-.06)/.058)**2)
            y+=side*folds*(.25+.75*math.sin(math.pi*q/2))
            z+=.025*math.sin(x*15+q*3)*math.sin(math.pi*q)
        verts.append(placed(x,y,z))
for i in range(nx):
    for j in range(ny):
        q=i*(ny+1)+j; faces.append((q,q+ny+1,q+ny+2,q+1))
ob=mesh('Covered car | fitted roof bonnet and gravity folds',verts,faces,cloth,cover)
for poly in ob.data.polygons: poly.use_smooth=True
mod=ob.modifiers.new('Sewn fabric thickness','SOLIDIFY'); mod.thickness=.006
# Reposition and size the drape to its observed silhouette in camera space.
bpy.context.view_layer.update()
pix=[project(v) for v in verts]
current=(min(p.x for p in pix),max(p.x for p in pix),min(p.y for p in pix),max(p.y for p in pix))
target_bounds=(1388,1665,312,483)
for vert in ob.data.vertices:
    pp=project(vert.co); tx=1388+(pp.x-current[0])/(current[1]-current[0])*277
    ty=312+(pp.y-current[2])/(current[3]-current[2])*171
    # Preserve depth, adjust X/Z only; the result stays a fully three-dimensional drape.
    vert.co=anchor(tx,ty,vert.co.y)
clothbs=cloth.node_tree.nodes['Principled BSDF']; clothbs.inputs['Roughness'].default_value=.68
clothbs.inputs['Sheen Weight'].default_value=.25
seam=[ob.data.vertices[i*(ny+1)+int(ny*.79)].co.copy()+Vector((0,-.002,0)) for i in range(nx+1)]
line('Covered car sewn seam',seam,.0025,cloth,cover)
for xx in [-1.35,1.37]:
    for yy in [-.78,.78]: cylinder('Covered vehicle tire',placed(xx,yy,.35),.35,.19,rubber,cover,axis=(-math.sin(angle),math.cos(angle),0),n=40)

# Remove the tall foreground cabinet's overlap with the background car.
# This is a group move, preserving its drawers, bottles and wheels.
for c in [furn,props]:
    for ob in list(c.objects):
        p=ob.location
        if 3.95<p.x<5.24 and -3.4<p.y<-2.6 and p.z>.48:
            ob.location.x+=1.28

# Wet concrete shader: water has low roughness and a real Fresnel response.
# Sparse rough islands and fine aggregate break reflected tubes into streaks.
floor=bpy.data.materials['Wet concrete | irregular puddles aggregate and cracks']
n=floor.node_tree.nodes; n.clear(); l=floor.node_tree.links
out=n.new('ShaderNodeOutputMaterial'); tex=n.new('ShaderNodeTexCoord')
wet=n.new('ShaderNodeBsdfPrincipled'); wet.label='Wet black concrete'; wet.inputs['Base Color'].default_value=(.011,.013,.017,1)
wet.inputs['Roughness'].default_value=.095; wet.inputs['IOR'].default_value=1.46
wet.inputs['Coat Weight'].default_value=.32; wet.inputs['Coat Roughness'].default_value=.075; wet.inputs['Coat IOR'].default_value=1.333
dry=n.new('ShaderNodeBsdfPrincipled'); dry.label='Exposed aggregate islands'; dry.inputs['Base Color'].default_value=(.045,.041,.032,1); dry.inputs['Roughness'].default_value=.77
def noise(scale,detail):
    nn=n.new('ShaderNodeTexNoise'); nn.inputs['Scale'].default_value=scale; nn.inputs['Detail'].default_value=detail
    l.new(tex.outputs['Object'],nn.inputs['Vector']); return nn
patch=noise(5.5,5); fine=noise(85,3); mid=noise(28,4)
mask=n.new('ShaderNodeValToRGB'); mask.color_ramp.elements[0].position=.44; mask.color_ramp.elements[0].color=(0,0,0,1)
mask.color_ramp.elements[1].position=.57; mask.color_ramp.elements[1].color=(1,1,1,1); l.new(patch.outputs['Fac'],mask.inputs[0])
mix=n.new('ShaderNodeMixShader'); l.new(mask.outputs[0],mix.inputs[0]); l.new(wet.outputs[0],mix.inputs[1]); l.new(dry.outputs[0],mix.inputs[2]); l.new(mix.outputs[0],out.inputs[0])
bump=n.new('ShaderNodeBump'); bump.inputs['Strength'].default_value=.28; bump.inputs['Distance'].default_value=.006
l.new(fine.outputs['Fac'],bump.inputs['Height'])
waterb=n.new('ShaderNodeBump'); waterb.inputs['Strength'].default_value=.22; waterb.inputs['Distance'].default_value=.005
l.new(mid.outputs['Fac'],waterb.inputs['Height']); l.new(bump.outputs[0],waterb.inputs['Normal'])
l.new(waterb.outputs[0],wet.inputs['Normal']); l.new(waterb.outputs[0],wet.inputs['Coat Normal'])
roughb=n.new('ShaderNodeBump'); roughb.inputs['Strength'].default_value=.5; roughb.inputs['Distance'].default_value=.025
l.new(mid.outputs['Fac'],roughb.inputs['Height']); l.new(bump.outputs[0],roughb.inputs['Normal']); l.new(roughb.outputs[0],dry.inputs['Normal'])
# A much subtler room fill retains black areas between the reflected practicals.
for ob in lights.objects:
    if ob.name.startswith(('Subtle cool ceiling bounce','Front soft reflection')): ob.data.energy=8
    if ob.name.startswith('Warm bare bulb'): ob.data.energy=85
for i,x in enumerate([-8.5,-4,3.25,9.0]):
    light('Warm workshop bounce %d'%i,(x,5.9,3.2),(.61,.73,1) if i==3 else (1,.62,.39),85 if i==3 else 145,2.3,(x,8.4,1.4),'RECTANGLE',1.0)

# Keep a fast, useful opening view; rendering is performed offline with CUDA.
for screen in bpy.data.screens:
    for area in screen.areas:
        if area.type=='VIEW_3D':
            area.spaces.active.region_3d.view_perspective='CAMERA'; area.spaces.active.region_3d.view_camera_zoom=10
            area.spaces.active.shading.type='SOLID'; area.spaces.active.shading.color_type='MATERIAL'
scene.cycles.samples=int(os.environ.get('GARAGE_SAMPLES','64')); scene.cycles.use_denoising=True
prefs=bpy.context.preferences.addons['cycles'].preferences; prefs.compute_device_type='CUDA'; prefs.get_devices()
for dev in prefs.devices: dev.use=dev.type=='CUDA'
scene.cycles.device='GPU'; scene.cycles.use_preview_denoising=True
scene.render.resolution_percentage=int(os.environ.get('GARAGE_PERCENT','65'))
scene.render.filepath=str(OUT/'garage_reference_preview.png')
scene['Refinement']='Reference anchored neon and pillars; fitted pleated car cover; flat printed S6 flag; Fresnel puddle reflections.'
scene['Reference anchor report']='reference_alignment.json'
(OUT/'reference_alignment.json').write_text(json.dumps(report,indent=2))
bpy.ops.wm.save_as_mainfile(filepath=str(OUT/'garage_reference.blend'))
print('REFINEMENT_SAVED',len(scene.objects),flush=True)
bpy.ops.render.render(write_still=True)
print('REFINEMENT_RENDERED',flush=True)
