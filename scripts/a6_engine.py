"""Reference-built longitudinal 2.7 V6 biturbo and its fitted C5 engine bay.

Native car axes: +X front, Z up. This is an editable visual reconstruction,
using the supplied photographs, not a measured OEM CAD or service model.
"""
import math
import bpy
from mathutils import Matrix, Vector
from mathutils.bvhtree import BVHTree

REFERENCE_URL = 'https://audi.oempartsonline.com/v-2004-audi-a6-quattro--base--2-7l-v6-gas/engine--engine-parts'


def build_engine(*, body, empty, mesh, block, created):
    root = empty('Engine bay | Audi 2.7 V6 biturbo', parent=body, category='car', partId='body',
                 engineAssembly=True, componentId='v6-biturbo-assembly', referenceUrl=REFERENCE_URL)

    def material(name, color, metal=0, rough=.5, coat=0):
        mat = bpy.data.materials.new('V6 Biturbo | ' + name)
        mat.diffuse_color = (*color, 1)
        mat.use_nodes = True
        shader = mat.node_tree.nodes.get('Principled BSDF')
        shader.inputs['Base Color'].default_value = (*color, 1)
        shader.inputs['Metallic'].default_value = metal
        shader.inputs['Roughness'].default_value = rough
        shader.inputs['Coat Weight'].default_value = coat
        return mat

    M = {
        'cast': material('cast aluminium', (.28,.30,.32), .85, .42),
        'silver': material('satin silver Y intake', (.48,.52,.57), .84, .29),
        'steel': material('fasteners and hose clamps', (.35,.39,.44), .95, .22),
        'black': material('textured black engine cover', (.012,.015,.019), .05, .77),
        'plastic': material('black timing covers and air ducts', (.008,.011,.016), .02, .56),
        'rubber': material('rubber hoses and drive belt', (.009,.012,.016), 0, .84),
        'blue': material('blue silicone couplers', (.008,.035,.30), .02, .43, .22),
        'tank': material('coolant expansion bottle', (.62,.59,.48), 0, .48),
        'coolant': material('pink coolant lower bottle', (.43,.12,.13), .01, .38),
        'filter': material('pleated rose air filter', (.26,.075,.13), 0, .86),
        'orange': material('orange dipstick handle', (.9,.18,.012), .02, .4),
        'green': material('green hydraulic fluid cap', (.025,.25,.045), .02, .48),
        'yellow': material('yellow service cap', (.85,.64,.015), .02, .49),
        'red': material('BITURBO lettering', (.65,.015,.012), .25, .39),
        'foil': material('raised silver badges', (.62,.68,.73), .8, .25),
        'iron': material('turbo hot side casting', (.10,.075,.055), .72, .65),
    }
    paint = next(mat for mat in bpy.data.materials if 'deep blue pearl paint' in mat.name)
    bay_paint = paint.copy()
    bay_paint.name = 'V6 Biturbo | satin blue painted engine-bay metal'
    bay_shader = bay_paint.node_tree.nodes.get('Principled BSDF')
    bay_shader.inputs['Roughness'].default_value = .50
    bay_shader.inputs['Metallic'].default_value = .35
    bay_shader.inputs['Coat Weight'].default_value = .15
    bay_shader.inputs['Coat Roughness'].default_value = .30
    groups = {}

    def group(key, label):
        if key not in groups:
            groups[key] = empty(label, parent=root, category='car', partId='body',
                                componentId='engine-' + key, enginePart=True)
        return groups[key]

    def tag(obj, component):
        obj['enginePart'] = True
        obj['engineComponent'] = component
        return obj

    def shape(name, vertices, faces, mat, parent, component):
        return tag(mesh('V6 | '+name, vertices, faces, mat, parent, 'engine-'+component), component)

    def box(name, center, size, mat, parent, component, bevel=.012):
        return tag(block('V6 | '+name, center, size, mat, parent, 'engine-'+component, bevel), component)

    def basis(axis):
        axis = Vector(axis).normalized()
        ref = Vector((0,0,1)) if abs(axis.z) < .9 else Vector((0,1,0))
        u = axis.cross(ref).normalized()
        return axis, u, axis.cross(u).normalized()

    def cylinder(name, center, radius, depth, mat, parent, component, axis=(0,0,1), segments=32, end_radius=None, pleats=0):
        axis, u, v = basis(axis)
        center = Vector(center)
        vertices, faces = [], []
        for end, r in [(-1, radius), (1, radius if end_radius is None else end_radius)]:
            for i in range(segments):
                angle = i*math.tau/segments
                rr = r * (.91 if pleats and i%2 else 1)
                vertices.append(center + axis*depth*end/2 + rr*(u*math.cos(angle)+v*math.sin(angle)))
        for i in range(segments):
            faces.append((i,(i+1)%segments,(i+1)%segments+segments,i+segments))
        faces += [tuple(range(segments-1,-1,-1)),tuple(segments+i for i in range(segments))]
        obj = shape(name, vertices, faces, mat, parent, component)
        for face in obj.data.polygons[-2:]:
            face.use_smooth = False
        return obj

    def torus(name, center, radius, thickness, mat, parent, component, axis=(0,0,1), segments=32, minor=8):
        axis, u, v = basis(axis)
        center = Vector(center)
        vertices, faces = [], []
        for i in range(segments):
            angle = i*math.tau/segments
            radial = u*math.cos(angle)+v*math.sin(angle)
            for j in range(minor):
                phi = j*math.tau/minor
                vertices.append(center + radial*(radius+thickness*math.cos(phi)) + axis*thickness*math.sin(phi))
        for i in range(segments):
            for j in range(minor):
                faces.append((i*minor+j,((i+1)%segments)*minor+j,
                              ((i+1)%segments)*minor+(j+1)%minor,i*minor+(j+1)%minor))
        return shape(name, vertices, faces, mat, parent, component)

    def smooth_path(points, samples=7):
        points = [Vector(p) for p in points]
        result = []
        for i in range(len(points)-1):
            a,b,c,d = points[max(0,i-1)],points[i],points[i+1],points[min(len(points)-1,i+2)]
            for j in range(samples):
                t = j/samples
                result.append(.5*((2*b)+(-a+c)*t+(2*a-5*b+4*c-d)*t*t+(-a+3*b-3*c+d)*t*t*t))
        return result+[points[-1]]

    def tube(name, points, radius, mat, parent, component, sides=12, samples=5):
        points = smooth_path(points,samples) if len(points)>2 and samples else [Vector(p) for p in points]
        vertices, faces = [], []
        for i, point in enumerate(points):
            tangent = (points[min(len(points)-1,i+1)]-points[max(0,i-1)]).normalized()
            _, u, v = basis(tangent)
            for j in range(sides):
                angle = j*math.tau/sides
                vertices.append(point + radius*(u*math.cos(angle)+v*math.sin(angle)))
        for i in range(len(points)-1):
            for j in range(sides):
                faces.append((i*sides+j,i*sides+(j+1)%sides,(i+1)*sides+(j+1)%sides,(i+1)*sides+j))
        faces += [tuple(range(sides-1,-1,-1)),tuple((len(points)-1)*sides+j for j in range(sides))]
        obj = shape(name,vertices,faces,mat,parent,component)
        for face in obj.data.polygons[-2:]:
            face.use_smooth = False
        return obj

    def cover_height(x):
        return .80-.12*(x-1.30)

    def plate(name, outline, mat, parent, component, offset=0, depth=.018, bevel=.008):
        points = [(x,y,cover_height(x)+offset+z) for z in [-depth,0] for x,y in outline]
        n = len(outline)
        faces = [tuple(range(n-1,-1,-1)),tuple(n+i for i in range(n))]
        faces += [(i,(i+1)%n,(i+1)%n+n,i+n) for i in range(n)]
        obj = shape(name,points,faces,mat,parent,component)
        for face in obj.data.polygons:
            face.use_smooth = False
        bpy.context.view_layer.objects.active = obj
        mod = obj.modifiers.new('Rounded moulded edges','BEVEL')
        mod.width,mod.segments = bevel,3
        bpy.ops.object.modifier_apply(modifier=mod.name)
        mod = obj.modifiers.new('Panel normals','WEIGHTED_NORMAL')
        bpy.ops.object.modifier_apply(modifier=mod.name)
        return obj

    def text(name, content, center, size, mat, parent, component):
        curve = bpy.data.curves.new(name,'FONT')
        curve.body,curve.align_x,curve.size = content,'CENTER',size
        curve.extrude = .0005
        curve.materials.append(mat)
        obj = bpy.data.objects.new('V6 | '+name,curve)
        parent.users_collection[0].objects.link(obj)
        obj.parent = parent
        obj.location = center
        tilt = math.atan(.12)
        c,s = math.cos(tilt),math.sin(tilt)
        obj.rotation_euler = Matrix(((0,-c,s),(1,0,0),(0,s,c))).to_euler()
        bpy.ops.object.select_all(action='DESELECT')
        obj.select_set(True)
        bpy.context.view_layer.objects.active = obj
        bpy.ops.object.convert(target='MESH')
        for key,value in dict(category='car',partId='body',componentId='engine-'+component,authoredIn='Blender').items():
            obj[key] = value
        tag(obj,component)
        created.append(obj)
        return obj

    # A recessed blue engine compartment with real volume below the cover.
    bay = group('bay','Engine bay | inner wings, strut towers and subframe')
    box('lower bay splash tray',(1.65,0,.225),(1.20,1.26,.035),M['plastic'],bay,'bay')
    box('rear bulkhead',(1.105,0,.59),(.035,1.25,.43),M['plastic'],bay,'bay')
    for side in [-1,1]:
        cylinder('strut top mounting cup',(1.43,side*.573,.752),.075,.018,M['plastic'],bay,'strut-towers')
        cylinder('strut top centre nut',(1.43,side*.573,.767),.019,.018,M['steel'],bay,'strut-towers',segments=6)
        for i in range(3):
            a = i*math.tau/3
            cylinder('strut tower fastener',(1.43+math.cos(a)*.088,side*.573+math.sin(a)*.088,.756),.008,.012,M['steel'],bay,'strut-towers',segments=6)
    from a6_engine_bay import build_bay_panels
    bay_repairs = build_bay_panels(parent=group('bay-panels','Engine bay | fitted front carrier, lamp housings and wing gutters'),
        shape=shape,box=box,tube=tube,cylinder=cylinder,materials=M,paint=bay_paint)

    motor = group('long-block','V6 | crankcase, sump, cylinder heads and intake runners')
    box('cast crankcase',(1.60,0,.392),(.69,.36,.30),M['cast'],motor,'block',.025)
    box('ribbed oil sump',(1.62,0,.264),(.55,.37,.09),M['cast'],motor,'sump',.018)
    for i in range(9):
        box('oil sump cooling rib',(1.38+i*.056,0,.245),(.012,.375,.018),M['cast'],motor,'sump',.003)
    for side in [-1,1]:
        box('cylinder head',(1.57,side*.215,.545),(.68,.235,.14),M['cast'],motor,'heads',.025)
        box('black camshaft cover',(1.57,side*.25,.625),(.70,.24,.085),M['plastic'],motor,'cam-covers',.028)
        for i in range(3):
            x = 1.34+i*.205
            tube('curved aluminium intake runner',[(x,side*.25,.59),(x,side*.18,.67),(x,side*.065,.68)],.029,M['cast'],motor,'intake-runners')
            box('coil pack',(x,side*.32,.66),(.075,.055,.035),M['plastic'],motor,'ignition',.008)
            cylinder('cam cover fastener',(x,side*.36,.651),.007,.012,M['steel'],motor,'cam-covers',segments=6)
        tube('fuel rail',[(1.26,side*.18,.65),(1.93,side*.18,.65)],.012,M['steel'],motor,'fuel-rails')

    # The broad silver Y and triangular vent inserts are the signature visible
    # shapes in the supplied installed-engine and standalone-engine photos.
    cover = group('cover','V6 | silver Y intake, vent panels and embossed engine cover')
    y_outline = [(1.145,-.060),(1.49,-.060),(1.83,-.345),(1.945,-.39),(1.99,-.305),
                 (1.69,-.053),(1.605,0),(1.69,.053),(1.99,.305),(1.945,.39),
                 (1.83,.345),(1.49,.060),(1.145,.060)]
    plate('satin silver Y intake bridge',y_outline,M['silver'],cover,'y-intake',offset=.008,depth=.035,bevel=.018)
    badge_outline = [(1.64,0),(1.97,-.292),(2.035,-.22),(2.045,.22),(1.97,.292)]
    plate('triangular black V6 biturbo fascia',badge_outline,M['black'],cover,'badge-panel',offset=.004,depth=.022,bevel=.018)
    for side in [-1,1]:
        outline = [(1.175,side*.09),(1.24,side*.325),(1.56,side*.334),(1.49,side*.105)]
        plate('black vent insert',outline,M['black'],cover,'vent-panels',offset=.015,depth=.012,bevel=.012)
        for i in range(11):
            x = 1.225+i*.024
            width = .085+(.035 if i<7 else .015)
            center_y = side*(.20+i*.002)
            box('raised vent louvre',(x,center_y,cover_height(x)+.019),(.005,width,.004),M['plastic'],cover,'vent-louvres',.001)
        for x,y in [(1.23,side*.30),(1.48,side*.13)]:
            cylinder('vent insert Torx screw',(x,y,cover_height(x)+.022),.007,.006,M['steel'],cover,'cover-fasteners',segments=8)
    tilt = math.atan(.12)
    normal = Vector((math.sin(tilt),0,math.cos(tilt)))
    for i in range(4):
        # Elliptical, overlapping rings lie on the sloping top-cover plane.
        center = Vector((1.76,(i-1.5)*.056,cover_height(1.76)+.009))
        u,v = Vector((0,1,0)),Vector((-math.cos(tilt),0,math.sin(tilt)))
        vertices,faces = [],[]
        for j in range(32):
            a = j*math.tau/32
            radial = (u*math.cos(a)+v*math.sin(a)).normalized()
            for k in range(8):
                b = k*math.tau/8
                vertices.append(center + u*.037*math.cos(a)+v*.027*math.sin(a)+.0023*(radial*math.cos(b)+normal*math.sin(b)))
        for j in range(32):
            for k in range(8):
                faces.append((j*8+k,((j+1)%32)*8+k,((j+1)%32)*8+(k+1)%8,j*8+(k+1)%8))
        shape('four-ring raised badge',vertices,faces,M['foil'],cover,'audi-badge')
    text('V6 raised lettering','V6',(1.90,0,cover_height(1.90)+.010),.110,M['foil'],cover,'v6-lettering')
    text('BITURBO raised lettering','BITURBO',(1.957,0,cover_height(1.957)+.009),.025,M['red'],cover,'biturbo-lettering')
    for x,y in [(2.005,-.23),(2.005,.23),(1.64,0)]:
        cylinder('fascia mounting screw',(x,y,cover_height(x)+.009),.008,.006,M['steel'],cover,'cover-fasteners',segments=8)
    torus('orange oil dipstick loop',(1.94,.21,.766),.022,.005,M['orange'],cover,'dipstick',axis=(1,0,0),segments=28)
    tube('dipstick tube',[(1.94,.21,.75),(1.92,.20,.61),(1.84,.17,.36)],.006,M['plastic'],cover,'dipstick')

    induction = group('induction','V6 | ribbed intake, MAF, pleated cone filter and blue couplers')
    intake_points = [(1.18,-.08,.77),(1.22,-.31,.77),(1.39,-.43,.73),(1.58,-.48,.70)]
    tube('ribbed intake hose',intake_points,.047,M['rubber'],induction,'intake-hose',sides=16)
    path = smooth_path(intake_points,6)
    for i in range(2,len(path)-2,2):
        torus('intake hose corrugation',path[i],.048,.003,M['plastic'],induction,'intake-hose',axis=path[i+1]-path[i-1],segments=20,minor=6)
    filter_axis = Vector((.72,-.65,-.12)).normalized()
    neck = Vector((1.57,-.47,.70))
    cylinder('MAF sensor housing',neck,.054,.075,M['plastic'],induction,'maf',axis=filter_axis)
    box('MAF electrical plug',(1.54,-.45,.756),(.05,.032,.02),M['plastic'],induction,'maf',.004)
    for offset in [-.028,.028]:
        torus('MAF hose clamp',neck+filter_axis*offset,.056,.004,M['steel'],induction,'hose-clamps',axis=filter_axis,segments=28)
    filter_center = neck+filter_axis*.13
    cylinder('pleated cone air filter',filter_center,.050,.18,M['filter'],induction,'cone-filter',axis=filter_axis,segments=80,end_radius=.099,pleats=40)
    cylinder('cone filter end cap',filter_center+filter_axis*.096,.100,.013,M['plastic'],induction,'cone-filter',axis=filter_axis)
    for side in [-1,1]:
        points = [(1.96,side*.35,cover_height(1.96)),(2.015,side*.43,.69),(1.985,side*.49,.61)]
        tube('blue charge-hose elbow',points,.042,M['blue'],induction,'blue-couplers',sides=16,samples=7)
        for point,axis in [(points[0],Vector(points[1])-Vector(points[0])),(points[-1],Vector(points[-1])-Vector(points[-2]))]:
            torus('charge elbow stainless clamp',point,.044,.003,M['steel'],induction,'hose-clamps',axis=axis,segments=28)
        tube('lower intercooler charge pipe',[(1.985,side*.49,.61),(2.02,side*.53,.48),(1.93,side*.59,.37)],.034,M['plastic'],induction,'charge-pipes')

    turbos = group('turbos','V6 | twin turbochargers, manifolds and downpipes')
    for side in [-1,1]:
        center = Vector((1.245,side*.405,.43))
        # Expanding compressor volutes, each with a separate hot-side housing.
        points = []
        for i in range(33):
            a = i*math.tau/36
            r = .035+.030*i/32
            points.append(center+Vector((math.cos(a)*r,0,math.sin(a)*r)))
        tube('turbo compressor volute',points,.022,M['cast'],turbos,'turbo-'+str(side),samples=0)
        cylinder('compressor centre',center,.047,.055,M['cast'],turbos,'turbo-'+str(side),axis=(0,1,0))
        torus('turbine housing',center+Vector((0,-side*.075,0)),.048,.022,M['iron'],turbos,'turbo-'+str(side),axis=(0,1,0),segments=28)
        tube('turbo inlet branch',[(1.31,side*.40,.44),(1.34,side*.43,.57),(1.22,side*.40,.69)],.029,M['rubber'],turbos,'turbo-inlets')
        tube('exhaust downpipe',[(1.21,side*.35,.40),(1.14,side*.31,.29),(1.04,side*.30,.25)],.026,M['steel'],turbos,'downpipes')

    drive = group('accessories','V6 | front timing covers, alternator and serpentine drive')
    box('front timing cover',(1.982,0,.47),(.045,.55,.26),M['plastic'],drive,'timing-cover',.045)
    pulley_specs = [(0,.325,.091),(-.17,.485,.047),(.20,.427,.073),(.005,.535,.042)]
    for index,(y,z,r) in enumerate(pulley_specs):
        cylinder('drive pulley '+str(index),(2.022,y,z),r,.025,M['plastic'] if index!=2 else M['cast'],drive,'pulleys',axis=(1,0,0),segments=40)
        torus('pulley rim',(2.037,y,z),r*.89,.004,M['steel'],drive,'pulleys',axis=(1,0,0),segments=40)
        cylinder('pulley centre fastener',(2.046,y,z),.012,.009,M['steel'],drive,'pulleys',axis=(1,0,0),segments=6)
    belt_points = [(2.043,-.085,.29),(2.043,-.21,.47),(2.043,-.17,.535),(2.043,.01,.581),
                   (2.043,.24,.47),(2.043,.26,.40),(2.043,.06,.25),(2.043,-.085,.29)]
    tube('serpentine accessory belt',belt_points,.007,M['rubber'],drive,'drive-belt',sides=6,samples=3)
    cylinder('alternator ribbed body',(1.947,.23,.412),.073,.13,M['cast'],drive,'alternator',axis=(1,0,0))
    for i in range(12):
        a = i*math.tau/12
        box('alternator casing rib',(1.95,.23+math.cos(a)*.068,.412+math.sin(a)*.068),(.13,.010,.010),M['cast'],drive,'alternator',.002)

    cooling = group('cooling','Engine bay | radiator, fans, coolant and service reservoirs')
    # Keep the upper radiator behind the grille. The full-width lower row
    # sits below the optics of the original headlamps.
    box('radiator lower core',(2.125,0,.413),(.04,1.08,.246),M['plastic'],cooling,'radiator',.007)
    box('radiator upper core',(2.125,0,.579),(.04,.75,.102),M['plastic'],cooling,'radiator',.007)
    for i in range(32):
        y = -.52+i*.0335
        top = .615 if abs(y)<.375 else .527
        box('radiator cooling fin',(2.15,y,(top+.305)/2),(.008,.006,top-.305),M['cast'],cooling,'radiator-fins',.001)
    for side in [-1,1]:
        torus('radiator fan shroud',(2.087,side*.275,.46),.133,.012,M['plastic'],cooling,'fans',axis=(1,0,0),segments=36)
        cylinder('fan hub',(2.075,side*.275,.46),.036,.022,M['plastic'],cooling,'fans',axis=(1,0,0))
        for i in range(7):
            a = i*math.tau/7
            pts = [(2.07,side*.275+math.cos(a)*r,.46+math.sin(a)*r) for r in [.035,.12]]
            tube('fan blade',pts,.016,M['plastic'],cooling,'fans',sides=6)
    # Photo orientation: coolant bottle on image-right, filter on image-left.
    box('pink coolant in lower expansion bottle',(1.295,.525,.711),(.235,.205,.07),M['coolant'],cooling,'coolant-bottle',.033)
    box('off-white expansion bottle shell',(1.285,.52,.767),(.25,.215,.11),M['tank'],cooling,'coolant-bottle',.035)
    cylinder('coolant bottle black cap',(1.238,.51,.834),.031,.022,M['plastic'],cooling,'coolant-cap')
    cylinder('coolant cap pressure marking',(1.238,.51,.847),.012,.001,M['yellow'],cooling,'coolant-cap')
    tube('coolant return hose',[(1.35,.51,.71),(1.49,.53,.63),(1.83,.48,.55),(1.98,.35,.56)],.014,M['rubber'],cooling,'coolant-hoses')
    box('hydraulic fluid reservoir',(1.67,.565,.615),(.14,.12,.105),M['tank'],cooling,'hydraulic-reservoir',.018)
    cylinder('green power steering cap',(1.67,.565,.681),.031,.022,M['green'],cooling,'hydraulic-cap')
    box('ABS hydraulic block',(1.48,.56,.665),(.13,.105,.085),M['cast'],cooling,'abs-block',.006)
    for i in range(5):
        tube('formed ABS brake pipe',[(1.44+i*.018,.56,.716),(1.44+i*.018,.62,.735),(1.40+i*.018,.63,.57)],.003,M['steel'],cooling,'brake-lines',sides=8,samples=4)
    cylinder('washer filler neck',(1.88,.59,.646),.024,.08,M['plastic'],cooling,'washer-reservoir')
    cylinder('washer filler blue cap',(1.88,.59,.696),.031,.014,M['blue'],cooling,'washer-cap')
    cylinder('rear brake fluid service cap',(1.14,-.19,.854),.030,.014,M['yellow'],cooling,'brake-fluid-cap')
    tube('upper radiator hose',[(2.10,.45,.57),(1.98,.48,.60),(1.89,.31,.57)],.022,M['rubber'],cooling,'coolant-hoses')

    wiring = group('wiring','Engine bay | wiring looms, vacuum lines and service hardware')
    for side in [-1,1]:
        tube('cam cover wiring loom',[(1.19,side*.38,.66),(1.43,side*.38,.69),(1.79,side*.39,.64),(1.94,side*.30,.59)],.011,M['plastic'],wiring,'wiring-looms')
        tube('vacuum control line',[(1.20,side*.20,.72),(1.28,side*.39,.71),(1.55,side*.40,.67)],.005,M['rubber'],wiring,'vacuum-lines')
    box('ECU weather box',(1.16,-.52,.70),(.12,.18,.11),M['plastic'],wiring,'ecu-box',.008)

    bonnet_skin = next(obj for obj in bpy.context.scene.objects if obj.type=='MESH' and obj.get('sourceObject')=='G-Object.061')
    from a6_bonnet import build_bonnet
    bonnet_details = build_bonnet(skin=bonnet_skin,body=body,empty=empty,mesh=mesh,tube=tube,
                                  cylinder=cylinder,materials=M,paint=bay_paint)

    bpy.context.view_layer.update()
    # Check the visible top assembly against the original closed bonnet. The
    # measurements are derived from this imported model, not OEM dimensions.
    bonnet = bonnet_details['collision']
    trees = []
    for obj in bonnet:
        vertices = [obj.matrix_world@v.co for v in obj.data.vertices]
        trees.append((obj.name,BVHTree.FromPolygons(vertices,[tuple(p.vertices) for p in obj.data.polygons])))
    minimum, samples, witness = math.inf, 0, None
    for obj in created:
        if not obj.get('enginePart') or obj.type!='MESH' or obj.get('engineFitCheck') is False:
            continue
        for index in range(0,len(obj.data.vertices),5):
            vertex = obj.data.vertices[index]
            point = obj.matrix_world@vertex.co
            if point.z < .60:
                continue
            for hood_name,tree in trees:
                hit = tree.ray_cast(Vector((point.x,point.y,3)),Vector((0,0,-1)),3)
                if hit[0] is not None:
                    clearance = hit[0].z-point.z
                    if clearance < minimum:
                        minimum = clearance
                        witness = {'component':obj.name,'bonnetSurface':hood_name,'point':list(point)}
                    samples += 1
    if not samples or minimum < .004:
        raise RuntimeError('Engine/bonnet fit needs review: samples=%d minimum clearance=%.5f m witness=%s' % (samples,minimum,witness))
    root['closedBonnetClearance'] = minimum
    return {
        'name':'Reference-built Audi 2.7 V6 biturbo',
        'referenceUrl':REFERENCE_URL,
        'appearance':'Supplied installed-engine and standalone-engine photos: silver Y intake, black vent panels, V6/BITURBO badges, orange dipstick, blue couplers and rose cone filter',
        'components':list(groups),
        'bayRepairs':bay_repairs,
        'bonnetUnderside':bonnet_details['report'],
        'clearance':{'samples':samples,'minimumMetres':minimum,'method':'Engine vertices versus the closed bonnet, painted inner pressing, reinforcement channels, felt pad and retaining clips','minimumWitness':witness},
        'construction':'Editable separate meshes; reference-based visualization, not measured OEM CAD',
    }
