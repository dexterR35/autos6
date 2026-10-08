"""Separate, editable period-correct exterior details for the C5 S6 Avant.

The car faces +X, its center line is Y=0, and Z=0 is the ground.  This
module deliberately leaves scene setup, paint and body construction to its
caller.  All dimensions are in meters.
"""
import math

import bpy
from mathutils import Matrix


def build_details(collection, materials):
    """Create the lamps, two-part grille, badges and dual exhaust; return objects."""
    made = []
    chrome = materials['chrome']
    dark = materials['dark']
    paint = materials['paint']

    def material(name, color, metal=0.0, rough=0.22, emission=0.0,
                 transmission=0.0):
        m = bpy.data.materials.get(name) or bpy.data.materials.new(name)
        m.use_nodes = True
        m.diffuse_color = (*color, 1)
        bs = m.node_tree.nodes.get('Principled BSDF')
        bs.inputs['Base Color'].default_value = (*color, 1)
        bs.inputs['Metallic'].default_value = metal
        bs.inputs['Roughness'].default_value = rough
        if 'Coat Weight' in bs.inputs:
            bs.inputs['Coat Weight'].default_value = .6
            bs.inputs['Coat Roughness'].default_value = .07
        if 'Transmission Weight' in bs.inputs:
            bs.inputs['Transmission Weight'].default_value = transmission
        if 'Emission Color' in bs.inputs:
            bs.inputs['Emission Color'].default_value = (*color, 1)
            bs.inputs['Emission Strength'].default_value = emission
        return m

    lamp_black = material('C5 lamp | satin graphite housing', (.009, .013, .020), .12, .24)
    reflector = material('C5 lamp | polished reflector silver', (.82, .85, .88), .90, .16)
    clear = material('C5 lamp | clear lightly blue lens', (.96, .985, 1.0), .0, .018,
                     transmission=1.0)
    # A thin protective cover must transmit the optical assembly, rather than
    # behave like a thick blue dielectric slab.  A small real glass component
    # retains highlights while the transparent part preserves the interior.
    nodes, links = clear.node_tree.nodes, clear.node_tree.links
    out = nodes.get('Material Output')
    transparent = nodes.new('ShaderNodeBsdfTransparent')
    transparent.inputs['Color'].default_value = (1, 1, 1, 1)
    glass_bsdf = nodes.new('ShaderNodeBsdfGlass')
    glass_bsdf.inputs['Color'].default_value = (.96, .985, 1, 1)
    glass_bsdf.inputs['Roughness'].default_value = .015
    glass_bsdf.inputs['IOR'].default_value = 1.46
    mix = nodes.new('ShaderNodeMixShader')
    mix.inputs[0].default_value = .055
    links.new(transparent.outputs[0], mix.inputs[1])
    links.new(glass_bsdf.outputs[0], mix.inputs[2])
    links.new(mix.outputs[0], out.inputs['Surface'])
    projector = material('C5 lamp | blue xenon projector glass', (.006, .024, .045), .20, .028,
                         emission=0, transmission=.12)
    warm_lens = material('C5 lamp | halogen high-beam lens', (.58, .55, .43), .36, .1,
                        emission=.10, transmission=.14)
    red_lens = material('C5 lamp | red prismatic acrylic', (.32, .007, .012), .08, .105,
                       emission=.10, transmission=.11)
    amber_lens = material('C5 lamp | amber indicator acrylic', (.73, .18, .008), .1, .14,
                         emission=.04, transmission=.12)
    white_lens = material('C5 lamp | clear reverse-lamp acrylic', (.40, .45, .46), .14, .13,
                         transmission=.28)
    badge_red = material('C5 badge | Audi sport red enamel', (.55, .008, .015), .24, .16)
    plate_mat = material('C5 plate | warm white enamel', (.75, .77, .73), .12, .24)
    plate_ink = material('C5 plate | charcoal lettering', (.016, .020, .024), .1, .32)
    outlet_inside = material('C5 exhaust | soot interior', (.002, .003, .004), .0, .92)

    def mesh(name, verts, faces, mat, smooth=False):
        data = bpy.data.meshes.new(name)
        data.from_pydata(verts, [], faces)
        data.update()
        data.materials.append(mat)
        obj = bpy.data.objects.new(name, data)
        collection.objects.link(obj)
        if smooth:
            for poly in data.polygons:
                poly.use_smooth = True
        made.append(obj)
        return obj

    def line(name, points, radius, mat, cyclic=False):
        data = bpy.data.curves.new(name, 'CURVE')
        data.dimensions = '3D'
        data.resolution_u = 1
        data.bevel_depth = radius
        data.bevel_resolution = 3
        sp = data.splines.new('POLY')
        sp.points.add(len(points) - 1)
        for point, co in zip(sp.points, points):
            point.co = (*co, 1)
        sp.use_cyclic_u = cyclic
        data.materials.append(mat)
        obj = bpy.data.objects.new(name, data)
        collection.objects.link(obj)
        made.append(obj)
        return obj

    def rounded(cy, cz, width, height, radius, n=7):
        r = min(radius, width / 2, height / 2)
        points = []
        for yy, zz, start in ((cy + width / 2 - r, cz + height / 2 - r, 0),
                              (cy - width / 2 + r, cz + height / 2 - r, 90),
                              (cy - width / 2 + r, cz - height / 2 + r, 180),
                              (cy + width / 2 - r, cz - height / 2 + r, 270)):
            for j in range(n + 1):
                a = math.radians(start + j * 90 / n)
                points.append((yy + r * math.cos(a), zz + r * math.sin(a)))
        return points

    def panel(name, profile, x, depth, mat, bevel=0):
        """Extrude a Y/Z polygon; x may be a function following bumper curvature."""
        x_at = x if callable(x) else lambda y, z: x
        verts = [(x_at(y, z), y, z) for y, z in profile]
        verts += [(x_at(y, z) - depth, y, z) for y, z in profile]
        n = len(profile)
        faces = [tuple(range(n)), tuple(reversed(range(n, 2*n)))]
        faces += [(j, (j+1) % n, (j+1) % n+n, j+n) for j in range(n)]
        obj = mesh(name, verts, faces, mat)
        if bevel:
            mod = obj.modifiers.new('Small manufactured edge radius', 'BEVEL')
            mod.width = bevel
            mod.segments = 3
            obj.modifiers.new('Balanced face normals', 'WEIGHTED_NORMAL')
        return obj

    def outline(name, profile, x, r, mat):
        x_at = x if callable(x) else lambda y, z: x
        return line(name, [(x_at(y, z), y, z) for y, z in profile], r, mat, True)

    def ellipse(name, x, y, z, ry, rz, tube, mat):
        return line(name, [(x, y + ry*math.cos(a*math.tau/64),
                            z + rz*math.sin(a*math.tau/64)) for a in range(64)],
                    tube, mat, True)

    def lens(name, x, y, z, radius, mat, direction=1, bulge=.01):
        n, rings = 48, 7
        verts = [(x + direction*bulge, y, z)]
        for j in range(1, rings+1):
            rr = radius*j/rings
            xx = x + direction*bulge*math.sqrt(max(0, 1-(j/rings)**2))
            for i in range(n):
                a = i*math.tau/n
                verts.append((xx, y+rr*math.cos(a), z+rr*math.sin(a)))
        faces = [(0, 1+i, 1+(i+1) % n) for i in range(n)]
        for j in range(rings-1):
            a = 1+j*n
            b = a+n
            faces += [(a+i, b+i, b+(i+1) % n, a+(i+1) % n) for i in range(n)]
        return mesh(name, verts, faces, mat, True)

    def reflector_bowl(name, center_y, center_z, ry, rz, front_x):
        """Open parabolic silver bowl with optical facets and a central socket."""
        n, rings = 40, 7
        verts = []
        for j in range(rings):
            radius = .17 + .83*j/(rings-1)
            depth = -.034 + .046*radius**2
            for i in range(n):
                a = i*math.tau/n
                y = center_y + ry*radius*math.cos(a)
                z = center_z + rz*radius*math.sin(a)
                verts.append((front_x(y,z)+depth,y,z))
        faces = []
        for j in range(rings-1):
            faces += [(j*n+i,j*n+(i+1)%n,(j+1)*n+(i+1)%n,(j+1)*n+i)
                      for i in range(n)]
        # Flat optical facets make the silver interior read as a reflector,
        # with several distinct highlights rather than a filled white disc.
        return mesh(name,verts,faces,reflector,False)

    def text(name, body, x, y, z, size, mat, rear=False):
        data = bpy.data.curves.new(name, 'FONT')
        data.body = body
        data.align_x = 'CENTER'
        data.align_y = 'CENTER'
        data.size = size
        data.extrude = .00055
        data.bevel_depth = .00015
        data.materials.append(mat)
        obj = bpy.data.objects.new(name, data)
        collection.objects.link(obj)
        # Font local X is the viewer's right, local Y is vehicle up.
        if rear:
            basis = Matrix(((0, 0, -1), (-1, 0, 0), (0, 1, 0)))
        else:
            basis = Matrix(((0, 0, 1), (1, 0, 0), (0, 1, 0)))
        obj.rotation_euler = basis.to_euler()
        obj.location = (x, y, z)
        made.append(obj)
        return obj

    # C5 upper radiator grille and the independently framed lower grille.
    upper = rounded(0, .828, .855, .215, .035)
    panel('Upper grille | recessed black backing', upper, 2.425, .036, lamp_black)
    outline('Upper grille | rounded polished aluminum surround', upper, 2.434, .0065, chrome)
    for i in range(-12, 13):
        y = i*.0305
        line('Upper grille | narrow upright %02d' % (i+12),
             [(2.436, y, .733), (2.436, y, .922)], .0026, materials['alloy'])
    for i, z in enumerate((.756, .792, .830, .868, .902)):
        line('Upper grille | dark horizontal bar %02d' % i,
             [(2.433, -.409, z), (2.433, .409, z)], .003, dark)
    for i in range(4):
        ellipse('Front emblem | intertwined Audi ring %d' % (i+1),
                2.450, (i-1.5)*.060, .843, .0385, .0365, .0040, chrome)
    panel('Front S6 emblem | black mounting tab', rounded(-.298, .841, .114, .050, .005),
          2.449, .007, lamp_black)
    panel('Front S6 emblem | red sport slash',
          [(-.351, .819), (-.327, .819), (-.312, .863), (-.337, .863)],
          2.457, .002, badge_red)
    text('Front S6 emblem | raised lettering', 'S6', 2.459, -.282, .841, .039, chrome)

    lower = rounded(0, .412, .883, .207, .036)
    panel('Lower grille | separate black radiator inlet', lower, 2.430, .040, lamp_black)
    outline('Lower grille | aluminum perimeter', lower, 2.438, .0040, chrome)
    for i in range(-12, 13):
        y = i*.0318
        line('Lower grille | fine upright %02d' % (i+12),
             [(2.440, y, .324), (2.440, y, .500)], .0025, materials['alloy'])
    for i, z in enumerate((.349, .390, .433, .477)):
        line('Lower grille | horizontal bar %02d' % i,
             [(2.436, -.424, z), (2.436, .424, z)], .0032, dark)

    # A restrained neutral plate on the painted bumper bar between the grilles.
    plate = rounded(0, .645, .519, .096, .009)
    panel('Front registration plate | black holder', rounded(0, .645, .539, .111, .012),
          2.449, .025, dark)
    panel('Front registration plate | enamel face', plate, 2.456, .004, plate_mat)
    text('Front registration plate | S6 C5', 'S6 C5', 2.460, 0, .645, .062, plate_ink)

    for side in (-1, 1):
        suffix = 'left' if side < 0 else 'right'
        # The long headlamps retreat with the rounded front corners.  Their
        # individual reflectors remain visible through subtle clear outer glass.
        points = [(.460, .775), (.462, .906), (.470, .925), (.551, .940),
                  (.765, .934), (.826, .922), (.870, .899), (.877, .862),
                  (.872, .813), (.852, .789), (.802, .769), (.547, .755),
                  (.474, .759)]
        profile = [(side*y, z) for y, z in points]
        if side < 0:
            profile.reverse()
        front_x = lambda y, z: 2.422 - max(0.0, abs(y)-.465)*.267
        panel('Headlamp %s | deeply recessed graphite housing' % suffix,
              profile, lambda y,z: front_x(y,z)-.057, .028, lamp_black, .002)
        # The side walls are open at the front; no opaque face can bury optics.
        vv = [(front_x(y,z)+offset,y,z) for offset in (-.056,.010) for y,z in profile]
        count = len(profile)
        ff = [(j,(j+1)%count,(j+1)%count+count,j+count) for j in range(count)]
        mesh('Headlamp %s | open housing sidewalls' % suffix,vv,ff,lamp_black)
        tray = [(side*(.659+(abs(y)-.659)*.965),.847+(z-.847)*.93) for y,z in profile]
        panel('Headlamp %s | silver reflector tray' % suffix,tray,
              lambda y,z: front_x(y,z)-.047,.003,reflector)
        outline('Headlamp %s | perimeter chrome bezel' % suffix, profile,
                lambda y, z: front_x(y, z)+.011, .0028, chrome)
        for label, yy in (('xenon projector', .551),('high beam', .713)):
            y = side*yy
            x = front_x(y, .846)
            reflector_bowl('Headlamp %s | deep faceted %s reflector' % (suffix,label),
                           y,.846,.078,.073,front_x)
            if label == 'xenon projector':
                ellipse('Headlamp %s | xenon dark optical sleeve' % suffix,
                        x+.011,y,.846,.046,.046,.0065,lamp_black)
                ellipse('Headlamp %s | xenon precision silver optic rim' % suffix,
                        x+.018,y,.846,.039,.039,.0027,chrome)
                lens('Headlamp %s | dark curved xenon projector optic' % suffix,
                     x+.011,y,.846,.0365,projector,bulge=.013)
            else:
                # The high beam exposes its reflector and small bulb; it has
                # no opaque circular lens covering the entire reflector bowl.
                ellipse('Headlamp %s | high-beam central bulb socket' % suffix,
                        x-.027,y,.846,.013,.014,.003,lamp_black)
                lens('Headlamp %s | small halogen capsule' % suffix,
                     x-.019,y,.846,.008,warm_lens,bulge=.010)
                line('Headlamp %s | halogen reflector support' % suffix,
                     [(x-.020,y,.829),(x-.013,y,.846)],.002,chrome)
        divider_y=side*.633
        line('Headlamp %s | inner reflector partition' % suffix,
             [(front_x(divider_y,z)-.014,divider_y,z) for z in (.780,.846,.915)],
             .0025,lamp_black)
        turn = [(side*y, z) for y, z in ((.801,.793),(.846,.805),(.848,.896),(.801,.918))]
        if side < 0:
            turn.reverse()
        panel('Headlamp %s | amber corner indicator' % suffix, turn,
              lambda y, z: front_x(y, z)+.014, .009, amber_lens, .002)
        for j in range(5):
            y = side*(.807+j*.008)
            line('Headlamp %s | indicator prism %d' % (suffix,j),
                 [(front_x(y,.815)+.019,y,.815), (front_x(y,.889)+.019,y,.889)],
                 .0015, clear)
        # A continuous, nearly transparent curved cover with true corner wrap.
        cover = mesh('Headlamp %s | continuous clear front glazing' % suffix,
                     [(front_x(y,z)+.028,y,z) for y,z in profile],
                     [tuple(range(len(profile)))], clear)
        outline('Headlamp %s | thin clear lens perimeter highlight' % suffix,profile,
                lambda y,z: front_x(y,z)+.029,.0018,clear)

        washer = rounded(side*.650, .691, .137, .035, .013)
        panel('Headlamp %s | flush body-color washer cover' % suffix, washer,
              lambda y,z: front_x(y,z)-.002, .008, paint, .002)
        fog_x = 2.414 - (.70-.465)*.267
        fogprofile = rounded(side*.698, .455, .258, .145, .032)
        panel('Bumper %s | lower foglight recess' % suffix, fogprofile,
              lambda y,z: front_x(y,z)+.003, .045, lamp_black)
        for j,z in enumerate((.410,.447,.490)):
            line('Bumper %s | fog inlet horizontal rib %d' % (suffix,j),
                 [(front_x(y,z)+.010,y,z) for y in (side*.580,side*.816)], .003, dark)
        ellipse('Foglight %s | polished circular bezel' % suffix,
                fog_x+.014,side*.700,.455,.047,.045,.0045,chrome)
        lens('Foglight %s | clear glass lens' % suffix,
             fog_x+.013,side*.700,.455,.042,warm_lens,bulge=.007)

        # Small fender repeaters: amber bulb under a clear period lens.
        yy = side*.927
        verts = [(1.012,yy,.853),(1.077,yy,.853),(1.077,yy,.882),(1.012,yy,.882)]
        mesh('Fender %s | clear turn repeater lens' % suffix, verts, [(0,1,2,3)], white_lens)
        line('Fender %s | repeater amber bulb' % suffix,
             [(1.030,yy+side*.002,.868),(1.058,yy+side*.002,.868)], .006, amber_lens)

    # Tailgate details.  Rear normals face -X.
    rear_x = lambda y,z: -2.412 + max(0,abs(y)-.60)*.225
    for side in (-1,1):
        suffix = 'left' if side < 0 else 'right'
        lamp_profile = rounded(side*.764,.987,.221,.296,.025)
        panel('Tail lamp %s | dark sealing gasket' % suffix, lamp_profile,
              rear_x, -.045, lamp_black, .003)
        for label, z, h, mat in (('red brake and marker',1.084,.091,red_lens),
                                 ('amber turn signal',1.009,.049,amber_lens),
                                 ('clear reversing segment',.958,.045,white_lens),
                                 ('red lower reflector',.886,.089,red_lens)):
            profile = rounded(side*.764,z,.205,h,.008)
            panel('Tail lamp %s | %s lens' % (suffix,label), profile,
                  lambda y,z: rear_x(y,z)-.009, -.013, mat, .0015)
            # Period vertical optical ribs, deliberately subtle at web scale.
            for j in range(1,12):
                y = side*(.664+j*.0165)
                line('Tail lamp %s | %s prism %d' % (suffix,label,j),
                     [(rear_x(y,z)-.012,y,z-h*.35),(rear_x(y,z)-.012,y,z+h*.35)],
                     .0008, mat)
            # Narrow red/amber/clear returns follow the rear quarter around
            # the corner, giving a genuine lamp volume in a three-quarter view.
            verts = [(-2.346,side*.874,z-h/2),(-2.260,side*.898,z-h/2),
                     (-2.260,side*.898,z+h/2),(-2.346,side*.874,z+h/2)]
            mesh('Tail lamp %s | %s outer wrap' % (suffix,label),verts,[(0,1,2,3)],mat)

    rearplate = rounded(0,.868,.465,.118,.009)
    panel('Rear registration plate | recessed holder', rounded(0,.868,.491,.142,.014),
          -2.423,-.018,dark)
    panel('Rear registration plate | enamel face',rearplate,-2.427,-.003,plate_mat)
    text('Rear registration plate | S6 C5','S6 C5',-2.431,0,.869,.066,plate_ink,True)
    for i in range(4):
        ellipse('Rear emblem | intertwined Audi ring %d' % (i+1),
                -2.427,(i-1.5)*.057,1.075,.036,.034,.0038,chrome)
    panel('Rear S6 emblem | red sport slash',
          [(.576,1.050),(.554,1.050),(.540,1.090),(.563,1.090)],
          -2.427,-.002,badge_red)
    text('Rear S6 emblem | raised aluminum lettering','S6',-2.432,.521,1.070,.043,chrome,True)
    line('Tailgate | slim aluminum garnish',
         [(-2.429,-.54,.773),(-2.435,0,.773),(-2.429,.54,.773)],.0045,chrome)

    # Two oval outlets total, with modeled hollow tubes and recessed soot discs.
    # Their front rims sit below the bumper rather than cutting a solid block.
    for side in (-1,1):
        suffix = 'left' if side < 0 else 'right'
        y,z = side*.650,.285
        n = 64
        verts = []
        for x,ry,rz in ((-2.285,.063,.046),(-2.495,.064,.047),
                        (-2.495,.055,.038),(-2.325,.055,.038)):
            for i in range(n):
                a = i*math.tau/n
                verts.append((x,y+ry*math.cos(a),z+rz*math.sin(a)))
        faces=[]
        for j in range(3):
            faces += [(j*n+i,j*n+(i+1)%n,(j+1)*n+(i+1)%n,(j+1)*n+i)
                      for i in range(n)]
        obj=mesh('Exhaust %s | hollow oval polished stainless outlet' % suffix,
                 verts,faces,chrome,True)
        obj.data.materials.append(outlet_inside)
        for poly in obj.data.polygons[2*n:]:
            poly.material_index=1
        ellipse('Exhaust %s | rounded stainless lip' % suffix,
                -2.495,y,z,.0595,.0425,.0045,chrome)
        disc=[(-2.332,y+.054*math.cos(i*math.tau/n),z+.037*math.sin(i*math.tau/n))
              for i in range(n)]
        mesh('Exhaust %s | deeply recessed dark opening' % suffix,disc,[tuple(range(n))],outlet_inside)

    return made
