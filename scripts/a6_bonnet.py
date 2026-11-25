"""Fitted painted bonnet frame, moulded felt pad and telescoping gas support."""
import math
import random
from collections import Counter
import bpy
from mathutils import Vector
from mathutils.bvhtree import BVHTree


def build_bonnet(*, skin, body, empty, mesh, tube, cylinder, materials, paint):
    bpy.context.view_layer.update()
    hinge = skin.parent
    inverse = hinge.matrix_world.inverted()
    source = [skin.matrix_world@v.co for v in skin.data.vertices]
    tree = BVHTree.FromPolygons(source,[tuple(p.vertices) for p in skin.data.polygons])
    frame = empty('Bonnet | pressed painted inner frame',parent=hinge,category='car',partId='hood',
                  componentId='bonnet-inner-frame',bonnetStructure=True)
    pad_group = empty('Bonnet | moulded acoustic felt and retaining clips',parent=hinge,
                      category='car',partId='hood',componentId='bonnet-insulation')
    hardware = empty('Bonnet | hinges, apertures and safety catch',parent=hinge,
                     category='car',partId='hood',componentId='bonnet-hardware')
    collision = [skin]

    def surface(x,y,depth):
        hit = tree.ray_cast(Vector((x,y,3)),Vector((0,0,-1)),3)[0]
        if hit is None:
            raise RuntimeError('Bonnet detail outside imported skin: %.4f, %.4f' % (x,y))
        return Vector((x,y,hit.z-depth))

    def local(points):
        return [inverse@Vector(p) for p in points]

    def hmesh(name,points,faces,mat,parent,component,smooth=True):
        obj = mesh('Bonnet | '+name,local(points),faces,mat,parent,component)
        obj['partId'],obj['bonnetDetail'] = 'hood',True
        for face in obj.data.polygons:
            face.use_smooth = smooth
        uv = obj.data.uv_layers.new(name='Fitted bonnet UV')
        for loop in obj.data.loops:
            p = points[loop.vertex_index]
            uv.data[loop.index].uv = ((p[0]-1.05)/1.30,(p[1]+.73)/1.46)
        return obj

    def htube(name,points,radius,mat,parent=hardware,component='bonnet-hardware'):
        obj = tube(name,local(points),radius,mat,parent,component,sides=10,samples=0)
        obj['partId'],obj['bonnetDetail'],obj['enginePart'] = 'hood',True,False
        return obj

    def hcylinder(name,center,radius,depth,mat,parent=hardware,component='bonnet-hardware',segments=24):
        obj = cylinder(name,local([center])[0],radius,depth,mat,parent,component,axis=(0,0,1),segments=segments)
        obj['partId'],obj['bonnetDetail'],obj['enginePart'] = 'hood',True,False
        return obj

    # A second painted pressing reveals the body colour around the insulation.
    # It follows the original surface, including the folded grille nose.
    center = Vector((1.67,0,0))
    backing = [Vector((center.x+(p.x-center.x)*.992,p.y*.992,p.z-.006)) for p in source]
    inner = hmesh('painted underside pressing',backing,
                  [tuple(reversed(p.vertices)) for p in skin.data.polygons],paint,frame,'bonnet-inner-skin')
    collision.append(inner)

    # Roll the actual imported boundary instead of guessing a rectangular hood.
    edges = Counter(tuple(sorted(e)) for p in skin.data.polygons for e in p.edge_keys)
    border = [e for e,count in edges.items() if count==1]
    # Each edge is independent: this also handles the source's grille cutout.
    rim_vertices,rim_faces = [],[]
    for a,b in border:
        pa,pb = backing[a],backing[b]
        if (pa-pb).length<.002:
            continue
        direction = (pb-pa).normalized()
        u = direction.cross(Vector((0,0,1))).normalized()
        if u.length<.1:
            u = Vector((1,0,0))
        v = direction.cross(u).normalized()
        start = len(rim_vertices)
        for p in [pa,pb]:
            for i in range(8):
                angle = math.tau*i/8
                rim_vertices.append(p+.0035*(u*math.cos(angle)+v*math.sin(angle)))
        for i in range(8):
            rim_faces.append((start+i,start+(i+1)%8,start+(i+1)%8+8,start+i+8))
    hmesh('rolled and bonded perimeter hem',rim_vertices,rim_faces,paint,frame,'bonnet-hem')

    # Broad shallow channels have a stamped cross-section, not round tubes.
    def pressing(name,path,width=.052):
        points = []
        for a,b in zip(path,path[1:]):
            for j in range(10):
                t = j/10
                points.append(Vector(a).lerp(Vector(b),t))
        points.append(Vector(path[-1]))
        verts,faces = [],[]
        profile = [(-.5,.007),(-.36,.010),(-.25,.021),(.25,.021),(.36,.010),(.5,.007)]
        for i,p in enumerate(points):
            d = (points[min(len(points)-1,i+1)]-points[max(0,i-1)]).normalized()
            across = Vector((-d.y,d.x))
            for offset,depth in profile:
                q = p+across*(offset*width)
                verts.append(surface(q.x,q.y,depth))
        for i in range(len(points)-1):
            for j in range(5):
                faces.append((i*6+j,(i+1)*6+j,(i+1)*6+j+1,i*6+j+1))
        obj = hmesh(name,verts,faces,paint,frame,'bonnet-pressed-ribs')
        collision.append(obj)

    pressing('rear transverse stiffening channel',[(1.255,-.57),(1.29,-.28),(1.30,0),(1.29,.28),(1.255,.57)],.060)
    for sign in [-1,1]:
        pressing('side diagonal stiffening channel',[(1.31,sign*.61),(1.65,sign*.60),(1.94,sign*.52),(2.13,sign*.34)])
    pressing('front latch reinforcement channel',[(2.14,-.32),(2.20,-.15),(2.21,0),(2.20,.15),(2.14,.32)],.068)

    # The central sound pad has its own moulded outline, thickness and grain.
    felt = bpy.data.materials.new('Bonnet | charcoal moulded acoustic felt')
    felt.use_nodes = True
    shader = felt.node_tree.nodes.get('Principled BSDF')
    shader.inputs['Base Color'].default_value = (.006,.007,.009,1)
    shader.inputs['Roughness'].default_value = .97
    # Blender's exporter emits a full-white sheen colour even at low weight.
    # The felt's packed micro-normal supplies fibre detail without that washout.
    shader.inputs['Sheen Weight'].default_value = 0
    rng = random.Random(2706)
    size = 256
    values = [rng.random() for _ in range(size*size)]
    pixels = []
    for y in range(size):
        for x in range(size):
            dx = values[y*size+(x+1)%size]-values[y*size+(x-1)%size]
            dy = values[((y+1)%size)*size+x]-values[((y-1)%size)*size+x]
            normal = Vector((-dx*.25,-dy*.25,1)).normalized()
            pixels.extend((normal.x*.5+.5,normal.y*.5+.5,normal.z*.5+.5,1))
    image = bpy.data.images.new('Packed bonnet felt fibre normal',width=size,height=size,alpha=False)
    image.colorspace_settings.name = 'Non-Color'
    image.pixels.foreach_set(pixels)
    image.pack()
    texture = felt.node_tree.nodes.new('ShaderNodeTexImage')
    texture.image = image
    normal = felt.node_tree.nodes.new('ShaderNodeNormalMap')
    normal.inputs['Strength'].default_value = .18
    felt.node_tree.links.new(texture.outputs['Color'],normal.inputs['Color'])
    felt.node_tree.links.new(normal.outputs['Normal'],shader.inputs['Normal'])

    # Sections round the corners without shrinking the pad into an ellipse.
    outline = [(1.31,-.39),(1.35,-.51),(1.57,-.525),(1.85,-.46),(2.04,-.30),
               (2.08,0),(2.04,.30),(1.85,.46),(1.57,.525),(1.35,.51),(1.31,.39)]
    boundary = []
    for i,b in enumerate(outline):
        a,c,d = [Vector(outline[j%len(outline)]) for j in [i-1,i+1,i+2]]
        b = Vector(b)
        for j in range(6):
            t = j/6
            boundary.append(.5*((2*b)+(-a+c)*t+(2*a-5*b+4*c-d)*t*t+(-a+3*b-3*c+d)*t*t*t))
    center = Vector((1.66,0))
    count,rings = len(boundary),14
    points = [surface(center.x,center.y,.018)]
    for ring in range(1,rings+1):
        r = ring/rings
        for p in boundary:
            q = center.lerp(p,r)
            points.append(surface(q.x,q.y,.014+.004*(1-r**4)))
    faces = [(0,1+(i+1)%count,1+i) for i in range(count)]
    for ring in range(rings-1):
        a,b = 1+ring*count,1+(ring+1)*count
        for i in range(count):
            j = (i+1)%count
            faces.append((a+i,a+j,b+j,b+i))
    pad = hmesh('contoured acoustic insulation',points,faces,felt,pad_group,'bonnet-insulation')
    collision.append(pad)
    htube('bound acoustic pad edge',[surface(p.x,p.y,.014) for p in boundary+[boundary[0]]],.003,felt,pad_group,'bonnet-pad-binding')
    for index in [0,7,14,21,28,35,42,49,56,62]:
        p = center.lerp(boundary[index%count],.92)
        cap = hcylinder('acoustic pad retaining button',surface(p.x,p.y,.021),.010,.003,materials['plastic'],pad_group,'bonnet-pad-clips')
        collision.append(cap)

    # Dark recesses and their painted lips suggest access/drain apertures.
    for x,y in [(1.43,-.625),(1.77,-.575),(2.13,-.395),(1.43,.625),(1.77,.575),(2.13,.395)]:
        p = surface(x,y,.012)
        hcylinder('recessed frame access aperture',p,.020,.002,materials['plastic'])
        ring = [p+Vector((math.cos(i*math.tau/32)*.023,math.sin(i*math.tau/32)*.023,-.001)) for i in range(33)]
        htube('pressed access aperture lip',ring,.003,paint)
    for sign in [-1,1]:
        p = surface(1.25,sign*.59,.027)
        for x in [p.x-.021,p.x+.021]:
            hcylinder('bonnet hinge bolt',(x,p.y,p.z),.008,.007,materials['steel'],segments=6)
    latch = [surface(2.215,-.025,.018),surface(2.215,-.025,.059),
             surface(2.215,.025,.059),surface(2.215,.025,.018)]
    htube('bonnet safety catch loop',latch,.006,materials['steel'])

    # A real two-piece gas support: constraints keep it attached in Blender;
    # exported metadata lets the web rig reproduce the telescoping motion.
    base = Vector((1.16,.682,.748))
    anchor = surface(1.68,.635,.026)
    target = empty('Bonnet gas support | moving ball joint',position=local([anchor])[0],parent=hinge,
                   category='car',partId='hood',bonnetStrutTarget=True)
    strut = empty('Bonnet gas support | telescoping assembly',position=base,parent=body,
                  category='car',partId='body',componentId='bonnet-gas-support',bonnetStrut=True)
    barrel = empty('Bonnet gas support | cylinder barrel',parent=strut,category='car',partId='body')
    rod = empty('Bonnet gas support | polished piston',parent=strut,category='car',partId='body',bonnetStrutRod=True)
    cylinder('gas support black barrel',(0,0,.145),.012,.29,materials['plastic'],barrel,'bonnet-gas-barrel')
    cylinder('gas support polished piston',(0,0,.5),.005,1,materials['steel'],rod,'bonnet-gas-piston')
    track = strut.constraints.new('DAMPED_TRACK')
    track.target,track.track_axis = target,'TRACK_Z'
    driver = rod.driver_add('scale',2).driver
    var = driver.variables.new()
    var.name,var.type = 'length','LOC_DIFF'
    var.targets[0].id,var.targets[1].id = strut,target
    driver.expression = 'length'
    bpy.context.view_layer.update()
    return {'collision':collision,'report':{'innerFrame':'Painted pressing, rolled hem and shallow reinforcement channels',
            'insulation':'Contoured charcoal felt with packed fibre normal, bound edge and ten retaining buttons',
            'hardware':'Frame access recesses, hinge bolts, safety catch and telescoping gas support'}}
