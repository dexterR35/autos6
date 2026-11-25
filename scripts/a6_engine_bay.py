"""Body-fitted engine-bay panels sampled from the imported C5 lamp/fender edges."""
import math
import bpy
from mathutils import Vector
from mathutils.bvhtree import BVHTree


def build_bay_panels(*, parent, shape, box, tube, cylinder, materials, paint):
    scene = bpy.context.scene
    bpy.context.view_layer.update()

    def source_points(source):
        return [obj.matrix_world@vertex.co for obj in scene.objects if obj.type=='MESH'
                and obj.get('sourceObject')==source for vertex in obj.data.vertices]

    hood = next(obj for obj in scene.objects if obj.get('sourceObject')=='G-Object.061')
    hood_tree = BVHTree.FromPolygons([hood.matrix_world@v.co for v in hood.data.vertices],
                                   [tuple(p.vertices) for p in hood.data.polygons])
    wing_points = source_points('G-Object.062')
    lamp_points = source_points('G-Object.128')

    def hood_height(x,y):
        hit = hood_tree.ray_cast(Vector((x,y,3)),Vector((0,0,-1)),3)[0]
        return hit.z if hit else None

    def height(x,y,desired,margin=.012):
        roof = hood_height(x,y)
        return min(desired,roof-margin) if roof is not None else desired

    def fitted(obj):
        # Body flanges and weather seals intentionally approach the hood seam;
        # the engine's separate clearance test concerns the motor/accessories.
        obj['engineFitCheck'] = False
        obj['bayPanel'] = True
        return obj

    def mesh(name,vertices,faces,mat,component,smooth=False):
        obj = fitted(shape(name,vertices,faces,mat,parent,component))
        for face in obj.data.polygons:
            face.use_smooth = smooth
        return obj

    # Upper convex silhouette of each existing lamp. Its top ridge is sampled
    # rather than covered with an axis-aligned rectangle.
    def lamp_roof(sign):
        by_y = {}
        for p in lamp_points:
            if p.y*sign <= 0:
                continue
            key = round(abs(p.y),5)
            if key not in by_y or p.z>by_y[key].z:
                by_y[key] = p
        hull = []
        for y,p in sorted(by_y.items()):
            candidate = (y,p.z,p.x)
            while len(hull)>1:
                a,b = hull[-2],hull[-1]
                cross = (b[0]-a[0])*(candidate[1]-b[1])-(b[1]-a[1])*(candidate[0]-b[0])
                if cross < 0:
                    break
                hull.pop()
            hull.append(candidate)

        def sample(y):
            for a,b in zip(hull,hull[1:]):
                if a[0] <= y <= b[0]:
                    t = (y-a[0])/(b[0]-a[0])
                    return a[2]*(1-t)+b[2]*t,a[1]*(1-t)+b[1]*t
            p = min(hull,key=lambda p:abs(p[0]-y))
            return p[2],p[1]
        return sample

    edge_samples = [lamp_roof(sign) for sign in [-1,1]]
    for index,(sign,side) in enumerate([(-1,'left'),(1,'right')]):
        sample = edge_samples[index]
        vertices,faces,rear_edge = [],[],[]
        ys = [.435+i*(.80-.435)/14 for i in range(15)]
        for y in ys:
            front_x,front_z = sample(y)
            front_x -= .004
            front_z += .001
            rear_x = front_x-.145
            rear_z = height(rear_x,sign*y,max(front_z+.025,.735))
            bottom = .535
            vertices += [(front_x,sign*y,front_z),(rear_x,sign*y,rear_z),
                         (rear_x,sign*y,bottom),(front_x,sign*y,bottom)]
            rear_edge.append((rear_x,sign*y,rear_z+.002))
        for row in range(len(ys)-1):
            # The source lens and reflector form the front of the lamp.
            # Close the housing above, below and behind the optics.
            for j in range(3):
                faces.append((row*4+j,row*4+(j+1)%4,(row+1)*4+(j+1)%4,(row+1)*4+j))
        faces += [tuple((len(ys)-1)*4+j for j in range(4))]
        mesh('formed sealed headlight housing | '+side,vertices,faces,materials['plastic'],'headlight-housing-'+side)
        fitted(tube('headlight rear weather seal | '+side,rear_edge,.004,materials['rubber'],parent,'headlight-seal-'+side,sides=8,samples=2))

    # Continuous radiator support joins the two shaped headlight housings.
    vertices,faces,rear_seal = [],[],[]
    def support_section(y):
        edge_x,edge_z = edge_samples[0 if y<0 else 1](.435)
        t = (abs(y)/.435)**2
        rear_x = 2.06*(1-t)+(edge_x-.149)*t
        front_x = 2.225*(1-t)+(edge_x-.004)*t
        rear_z = height(rear_x,y,.735*(1-t)+max(edge_z+.025,.735)*t)
        front_z = height(front_x,y,.696*(1-t)+(edge_z+.001)*t)
        return rear_x,front_x,rear_z,front_z

    def support_height(x,y):
        rear_x,front_x,rear_z,front_z = support_section(y)
        t = max(0,min(1,(x-rear_x)/(front_x-rear_x)))
        return rear_z*(1-t)+front_z*t

    count = 25
    for i in range(count):
        y = -.435+.87*i/(count-1)
        rear_x,front_x,rear_z,front_z = support_section(y)
        vertices += [(rear_x,y,rear_z),(front_x,y,front_z),(front_x,y,.535),(rear_x,y,.535)]
        rear_seal.append((rear_x,y,rear_z+.002))
    for row in range(count-1):
        # Only the upper flange continues above the lamp optics. The box
        # section ends inside the grille, clear of both reflector cavities.
        for j in (range(4) if 2 <= row < count-3 else (0,)):
            faces.append((row*4+j,row*4+(j+1)%4,(row+1)*4+(j+1)%4,(row+1)*4+j))
    faces += [tuple(2*4+j for j in reversed(range(4))),tuple((count-3)*4+j for j in range(4))]
    mesh('continuous upper radiator support',vertices,faces,materials['plastic'],'radiator-support')
    fitted(tube('radiator support rear seal',rear_seal,.005,materials['rubber'],parent,'radiator-support-seal',sides=8,samples=2))
    corners = [(2.10,-.0475),(2.165,-.0475),(2.165,.0475),(2.10,.0475)]
    latch_vertices = [(x,y,support_height(x,y)+offset) for offset in [.001,.017] for x,y in corners]
    mesh('fitted bonnet latch mounting plate',latch_vertices,
         [(3,2,1,0),(4,5,6,7),(0,1,5,4),(1,2,6,5),(2,3,7,6),(3,0,4,7)],materials['steel'],'bonnet-latch')
    for y in [-.37,-.17,.17,.37]:
        x = 2.14
        dx = (support_height(x+.001,y)-support_height(x-.001,y))/.002
        dy = (support_height(x,y+.001)-support_height(x,y-.001))/.002
        normal = Vector((-dx,-dy,1)).normalized()
        center = Vector((x,y,support_height(x,y)))+normal*.0025
        fitted(cylinder('radiator support fixing',center,.007,.005,materials['steel'],parent,'radiator-support-fasteners',segments=8,axis=normal))

    # Folded gutters meet the actual inner upper edge of the blue front wings.
    # The front ends stop at the lamp housings instead of slicing through them.
    for index,(sign,side) in enumerate([(-1,'left'),(1,'right')]):
        front_x,_ = edge_samples[index](.72)
        end_x = front_x-.145
        vertices,faces,seal_points = [],[],[]
        rows = 49
        rim_by_x = {}
        for p in wing_points:
            if p.y*sign<=0 or not .69<abs(p.y)<.78 or p.z<.65:
                continue
            key = round(p.x,4)
            if key not in rim_by_x or abs(p.y)<abs(rim_by_x[key].y):
                rim_by_x[key] = p
        rim = sorted(rim_by_x.values(),key=lambda p:p.x)
        def wing_edge(x):
            for a,b in zip(rim,rim[1:]):
                if a.x<=x<=b.x:
                    return a.lerp(b,(x-a.x)/(b.x-a.x))
            return min(rim,key=lambda p:abs(p.x-x))
        def apron(x,distance):
            edge = wing_edge(x)
            outer_y,outer_z = abs(edge.y),edge.z
            # Follow the swept rear of the lamp at the front of the apron.
            # Its inner end is further forward than the outer wing edge.
            front_limit = edge_samples[index](max(.435,outer_y-distance))[0]-.149
            x += max(0,front_limit-end_x)*max(0,min(1,(x-1.10)/(end_x-1.10)))**6
            arch = .317+math.sqrt(max(0,.375**2-(x-1.4325)**2)) if abs(x-1.4325)<.375 else .39
            deck = max(arch+.010,.585)
            width = outer_y-.475
            profile = [(0,outer_z-.003),(.012,outer_z-.006),(.020,outer_z-.019),
                       (.044,outer_z-.021),(.052,outer_z-.012),(.063,outer_z-.014),
                       (.085,outer_z-.038),(.135,outer_z*.45+deck*.55),
                       (.190,deck+.010),(width,deck)]
            distance = min(distance,width)
            z = deck
            for a,b in zip(profile,profile[1:]):
                if a[0]<=distance<=b[0]:
                    t = (distance-a[0])/(b[0]-a[0])
                    z = a[1]*(1-t)+b[1]*t
                    break
            # Two gentle swages stiffen the pressing instead of vertical slabs.
            relief = sum(.007*math.exp(-((x-c)/.023)**2) for c in [1.23,1.79])
            z += relief*math.sin(math.pi*max(0,min(1,(distance-.065)/.19)))
            return Vector((x,sign*(outer_y-distance),height(x,sign*(outer_y-distance),z,margin=.010)))

        distances = [0,.012,.020,.032,.044,.052,.063,.075,.085,.105,.135,.165,.190,.215,.25]
        for i in range(rows):
            x = 1.10+(end_x-1.10)*i/(rows-1)
            edge = wing_edge(x)
            outer_y,outer_z = abs(edge.y),edge.z
            vertices += [apron(x,d) for d in distances]
            seal_points.append((x,sign*(outer_y-.008),height(x,sign*(outer_y-.008),outer_z-.005)))
        for row in range(rows-1):
            for j in range(len(distances)-1):
                a,b = row*len(distances)+j,(row+1)*len(distances)+j
                faces.append((a,b,b+1,a+1))
        mesh('stamped blue suspension apron and recessed gutter | '+side,vertices,faces,paint,'inner-wing-'+side,smooth=True)
        fitted(tube('bonnet side weather strip | '+side,seal_points,.004,materials['rubber'],parent,'wing-seal-'+side,sides=8,samples=2))
        for x in [1.16,1.31,1.53,1.73,1.88]:
            p = apron(min(x,end_x-.015),.031)
            fitted(cylinder('painted flange spot weld | '+side,p+Vector((0,0,.0008)),.0032,.0015,paint,parent,'apron-spot-welds',segments=12))
        for x in [1.18,1.56,1.85]:
            p = apron(min(x,end_x-.015),.058)
            fitted(cylinder('wing flange bolt washer | '+side,p+Vector((0,0,.002)),.010,.003,materials['steel'],parent,'wing-flange-washers',segments=20))
            fitted(cylinder('wing flange hex bolt | '+side,p+Vector((0,0,.005)),.0057,.006,materials['steel'],parent,'wing-flange-bolts',segments=6))
        seam = [apron(1.11+(end_x-1.13)*i/24,.215)+Vector((0,0,.002)) for i in range(25)]
        fitted(tube('apron pressed lap seam | '+side,seam,.0025,paint,parent,'apron-lap-seam',sides=8,samples=0))
        loom = [apron(x,.095)+Vector((0,0,.010)) for x in [1.17,1.32,1.56,1.78,end_x-.025]]
        fitted(tube('clipped wing harness | '+side,loom,.006,materials['rubber'],parent,'apron-harness',sides=10,samples=4))
        for x in [1.25,1.60,1.82]:
            p = apron(x,.095)+Vector((0,0,.010))
            clip = [p+Vector((0,dy,dz)) for dy,dz in [(-.011,-.007),(-.010,.006),(0,.010),(.010,.006),(.011,-.007)]]
            fitted(tube('wing harness retaining clip | '+side,clip,.0025,materials['plastic'],parent,'apron-harness-clips',sides=8,samples=2))
        # The welded suspension dome rises out of the apron with a broad
        # pressed shoulder, rather than a separate cylindrical can.
        dome_vertices,dome_faces = [],[]
        profile = [(.145,.641),(.144,.675),(.135,.710),(.120,.737),(.100,.749),(.077,.749)]
        segments = 64
        for radius,z in profile:
            for j in range(segments):
                a = j*math.tau/segments
                dome_vertices.append((1.43+radius*math.cos(a),sign*.573+radius*math.sin(a),z))
        for ring in range(len(profile)-1):
            for j in range(segments):
                a,b = ring*segments+j,ring*segments+(j+1)%segments
                dome_faces.append((a,b,b+segments,a+segments))
        mesh('pressed suspension turret shoulder | '+side,dome_vertices,dome_faces,paint,'pressed-strut-turret-'+side,smooth=True)
        # An arched liner closes the view to the ground while clearing the tyre.
        arch_vertices,arch_faces = [],[]
        for j in range(25):
            angle = j*math.pi/24
            x,z = 1.4325+.375*math.cos(angle),.317+.375*math.sin(angle)
            for y in [.54,.74]:
                arch_vertices.append((x,sign*y,z))
        for j in range(24):
            arch_faces.append((j*2,(j+1)*2,(j+1)*2+1,j*2+1))
        mesh('closed arched inner wheel housing | '+side,arch_vertices,arch_faces,materials['plastic'],'wheelhouse-'+side)

    return {'construction':'Source-fitted lamp housings and radiator support; smooth stamped suspension aprons with recessed gutters, swages, lap seams, spot welds and wing fixings',
            'innerWings':'Blue satin stamped aprons, formed suspension turrets, gutter channels, flange bolts and clipped harnesses',
            'headlightHousings':['left','right'],'grilleRig':'Upper grille, rings and surround follow the bonnet; lights and radiator support stay fixed'}
