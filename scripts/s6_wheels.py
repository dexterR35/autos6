"""Editable factory-style C5 S6 Avus wheels for the vehicle builder.

Call ``build_wheels(collection, materials)`` in Blender.  The vehicle nose is
+X; the wheel axes are Y.  All vertices are in vehicle coordinates so callers
can parent the returned objects without applying transforms.  No scene reset,
file save, operator context, external assets, or rendering is required.
"""

import math

import bpy


def build_wheels(collection, materials):
    """Build four six-spoke 17-inch Avus alloys with 255/40 R17 tires.

    ``materials`` supplies ``rubber``, ``chrome``, ``alloy``, ``dark``, and
    ``brake`` Blender materials.  Other material keys are allowed.
    Returns the complete list of created objects, ready for car parenting.
    """
    objects = []
    tau = math.tau

    def mesh(name, vertices, faces, material, smooth=True):
        data = bpy.data.meshes.new(name)
        data.from_pydata(vertices, [], faces)
        data.update()
        data.materials.append(material)
        for face in data.polygons:
            face.use_smooth = smooth
        obj = bpy.data.objects.new(name, data)
        collection.objects.link(obj)
        objects.append(obj)
        return obj

    # Real tread grooves are part of the tire mesh. This restrained bump only
    # adds the fine grain that keeps rubber from looking like polished plastic.
    tire_material = materials['rubber'].copy()
    tire_material.name = 'S6 wheels | fine grained satin rubber'
    tire_material.use_nodes = True
    nodes = tire_material.node_tree.nodes
    links = tire_material.node_tree.links
    bsdf = nodes.get('Principled BSDF')
    if bsdf:
        bsdf.inputs['Roughness'].default_value = .47
        noise = nodes.new('ShaderNodeTexNoise')
        noise.name = 'Rubber microtexture'
        noise.inputs['Scale'].default_value = 220.0
        noise.inputs['Detail'].default_value = 2.0
        coord = nodes.new('ShaderNodeTexCoord')
        links.new(coord.outputs['Object'], noise.inputs['Vector'])
        bump = nodes.new('ShaderNodeBump')
        bump.inputs['Strength'].default_value = .16
        bump.inputs['Distance'].default_value = .00035
        links.new(noise.outputs['Fac'], bump.inputs['Height'])
        links.new(bump.outputs['Normal'], bsdf.inputs['Normal'])

    caliper_material = materials['dark'].copy()
    caliper_material.name = 'S6 wheels | original dark cast calipers'
    caliper_material.use_nodes = True
    caliper_bsdf = caliper_material.node_tree.nodes.get('Principled BSDF')
    if caliper_bsdf:
        caliper_bsdf.inputs['Base Color'].default_value = (.035, .041, .046, 1)
        caliper_bsdf.inputs['Metallic'].default_value = .72
        caliper_bsdf.inputs['Roughness'].default_value = .32

    for axle, axle_x, rotor_radius in [('Front', 1.365, .1605),
                                      ('Rear', -1.394, .1345)]:
        for side_name, side in [('Left', 1), ('Right', -1)]:
            name = 'S6 | %s %s wheel' % (axle, side_name)
            center = (axle_x, side * .805, .326)

            def world(vertex):
                x, q, z = vertex
                return (center[0] + x, center[1] + side * q,
                        center[2] + z)

            def part(suffix, vertices, faces, mat, smooth=True):
                # Reflect winding together with the outboard axial coordinate.
                if side < 0:
                    faces = [tuple(reversed(face)) for face in faces]
                return mesh(name + ' | ' + suffix,
                            [world(v) for v in vertices], faces, mat, smooth)

            def lathe(suffix, profile, mat, segments=128, closed=True,
                      offset=(0, 0, 0)):
                """Profile is (axial outboard distance, radius), around Y."""
                vertices = []
                for q, radius in profile:
                    vertices.extend((offset[0] + radius * math.cos(tau*i/segments),
                                     offset[1] + q,
                                     offset[2] + radius * math.sin(tau*i/segments))
                                    for i in range(segments))
                faces = []
                count = len(profile)
                for row in range(count if closed else count - 1):
                    next_row = (row + 1) % count
                    for i in range(segments):
                        j = (i + 1) % segments
                        faces.append((row*segments+i, next_row*segments+i,
                                      next_row*segments+j, row*segments+j))
                return part(suffix, vertices, faces, mat)

            def torus(suffix, radius, tube, q, mat, offset=(0, 0, 0),
                      segments=96, tube_segments=8):
                profile = [(q + tube*math.sin(tau*i/tube_segments),
                            radius + tube*math.cos(tau*i/tube_segments))
                           for i in range(tube_segments)]
                # The profile orientation must run inboard -> outboard at its
                # outermost radius, as for the main tire section.
                return lathe(suffix, profile, mat, segments, offset=offset)

            def disk(suffix, radius, q0, q1, mat, offset=(0, 0, 0),
                     segments=64):
                # Tiny central radius avoids coincident radial pole vertices.
                return lathe(suffix, [(q0, .0002), (q0, radius),
                                     (q1, radius), (q1, .0002)], mat,
                             segments, offset=offset)

            # 255 mm section width, 326 mm rolling radius. The rounded shoulder
            # transitions into a visibly taller sidewall appropriate to R17.
            profile = [(-.097, .214), (-.110, .221), (-.120, .248),
                       (-.1275, .277), (-.125, .296), (-.119, .310),
                       (-.111, .319), (-.097, .324), (-.084, .326)]
            for groove in [-.065, -.022, .022, .065]:
                profile.extend([(groove-.0050, .326),
                                (groove-.0030, .3205),
                                (groove+.0030, .3205),
                                (groove+.0050, .326)])
            profile.extend([(.084, .326), (.097, .324), (.111, .319),
                            (.119, .310), (.125, .296), (.1275, .277),
                            (.120, .248), (.110, .221), (.097, .214),
                            (.080, .211), (-.080, .211)])
            lathe('255 40 R17 tire with four circumferential grooves',
                  profile, tire_material, segments=192)

            # Fine shoulder sipes sit just beneath the tire surface and create
            # angled dark recesses without floating tread blocks.
            sipe_vertices, sipe_faces = [], []
            for i in range(72):
                theta = tau*i/72
                for sign in [-1, 1]:
                    start = len(sipe_vertices)
                    for q, angle, radius in [
                            (sign*.074, theta, .32612),
                            (sign*.101, theta+.025*sign, .3234),
                            (sign*.101, theta+.030*sign, .3234),
                            (sign*.074, theta+.005*sign, .32612)]:
                        sipe_vertices.append((radius*math.cos(angle), q,
                                              radius*math.sin(angle)))
                    sipe_faces.append(tuple(range(start, start+4)))
            part('subtle angled shoulder sipes', sipe_vertices, sipe_faces,
                 materials['dark'])
            for radius, q in [(.238, .117), (.301, .124), (.309, .120)]:
                torus('molded sidewall line %.3f' % radius, radius, .00065,
                      q, tire_material, segments=160)

            # The barrel remains open: rotors are genuinely visible through
            # the six openings, rather than represented on a flat wheel disk.
            lathe('cast alloy barrel', [(-.097, .2025), (-.097, .2159),
                                       (.108, .2159), (.113, .2115),
                                       (.103, .2045), (-.088, .2015)],
                  materials['alloy'])
            lathe('machined outer rim lip', [(.103, .2075), (.108, .2140),
                                            (.117, .2195), (.122, .2185),
                                            (.125, .2148), (.124, .2075),
                                            (.118, .2055), (.109, .2055)],
                  materials['chrome'])
            torus('inner rim bead', .204, .0016, .117, materials['alloy'])
            torus('inboard rim lip', .214, .003, -.098, materials['alloy'])

            # Six broad Avus spokes, with gently bowed faces, tapered sides,
            # rounded edge cross sections, and a center set below the rim lip.
            sections = [(.045, .0230, .093), (.067, .0245, .094),
                        (.092, .0255, .095), (.130, .0270, .101),
                        (.171, .0300, .112), (.198, .0315, .120),
                        (.211, .0320, .121)]
            for spoke in range(6):
                angle = tau*spoke/6 + math.pi/2
                ca, sa = math.cos(angle), math.sin(angle)
                vertices = []
                for radius, width, q in sections:
                    edge = .0030
                    section = [(-width+edge, q), (0, q+.0009),
                               (width-edge, q), (width, q-.003),
                               (width, q-.020), (width-edge, q-.023),
                               (-width+edge, q-.023), (-width, q-.020),
                               (-width, q-.003)]
                    for tangent, axial in section:
                        vertices.append((radius*ca-tangent*sa, axial,
                                         radius*sa+tangent*ca))
                faces = []
                ring = 9
                for row in range(len(sections)-1):
                    for j in range(ring):
                        k = (j+1) % ring
                        faces.append((row*ring+j, row*ring+k,
                                      (row+1)*ring+k, (row+1)*ring+j))
                faces.append(tuple(reversed(range(ring))))
                faces.append(tuple(range((len(sections)-1)*ring,
                                         len(sections)*ring)))
                part('Avus sculpted spoke %02d' % (spoke+1), vertices,
                     faces, materials['alloy'])

            lathe('recessed six spoke hub', [(.066, .0002), (.066, .071),
                                            (.085, .073), (.095, .068),
                                            (.098, .049), (.098, .0002)],
                  materials['alloy'])
            lathe('center cap dark seam', [(.096, .0002), (.096, .0433),
                                          (.100, .0433), (.100, .0002)],
                  materials['dark'], segments=96)
            lathe('concave alloy center cap', [(.098, .0002), (.098, .0420),
                                              (.104, .0420), (.105, .0380),
                                              (.102, .0002)],
                  materials['alloy'], segments=96)
            for ring_index in range(4):
                torus('center cap Audi ring %d' % (ring_index+1), .0072,
                      .00080, .1043, materials['chrome'],
                      offset=((ring_index-1.5)*.0108, 0, 0), segments=32)

            # Audi 5x112 bolt pattern is independent of the six spokes.
            for lug in range(5):
                angle = tau*lug/5 + math.pi/2
                offset = (.056*math.cos(angle), 0, .056*math.sin(angle))
                lathe('lug recess %d' % (lug+1),
                      [(.094, .0121), (.097, .0121), (.099, .0102),
                       (.094, .0091)], materials['dark'], segments=32,
                      offset=offset)
                disk('hexagonal wheel bolt %d' % (lug+1), .0076,
                     .095, .099, materials['chrome'], offset=offset,
                     segments=6)
                disk('wheel bolt center %d' % (lug+1), .0042,
                     .0991, .0995, materials['alloy'], offset=offset,
                     segments=6)

            valve_angle = math.pi/6
            valve_offset = (.193*math.cos(valve_angle), 0,
                            .193*math.sin(valve_angle))
            disk('rubber valve stem', .004, .111, .132, tire_material,
                 offset=valve_offset, segments=20)
            disk('valve cap', .0045, .128, .136, materials['dark'],
                 offset=valve_offset, segments=20)

            # Factory S6 brakes: undrilled vented front discs and dark cast
            # calipers. No aftermarket drilled rotor or red racing caliper.
            lathe('vented brake disc', [(.017, .075), (.017, rotor_radius),
                                      (.022, rotor_radius), (.025, rotor_radius-.001),
                                      (.033, rotor_radius-.001), (.036, rotor_radius),
                                      (.043, rotor_radius), (.043, .075)],
                  materials['brake'], segments=128)
            lathe('dark disc ventilation channel',
                  [(.0235, rotor_radius-.0015), (.0245, rotor_radius+.0002),
                   (.0320, rotor_radius+.0002), (.033, rotor_radius-.0015)],
                  materials['dark'], segments=128)
            for radius in [rotor_radius-.009, rotor_radius-.018,
                           rotor_radius-.043]:
                torus('subtle rotor machining %.3f' % radius, radius,
                      .00022, .04325, materials['chrome'], segments=128,
                      tube_segments=6)
            disk('brake disc bell', .078, .019, .049,
                 materials['brake'], segments=64)

            # Broad cast caliper at the rear of each axle, with chamfered
            # rectangular body and separate bridge following the disc edge.
            caliper_angle = math.pi-.16
            c_radius = rotor_radius-.016
            radial = (math.cos(caliper_angle), math.sin(caliper_angle))
            tangent = (-radial[1], radial[0])
            outline = [(-.033,-.042), (.024,-.042), (.035,-.031),
                       (.035,.031), (.023,.044), (-.029,.044),
                       (-.039,.029), (-.039,-.030)]
            vertices = []
            for q in [-.002, .065]:
                for r, t in outline:
                    vertices.append(((c_radius+r)*radial[0]+t*tangent[0],
                                     q,
                                     (c_radius+r)*radial[1]+t*tangent[1]))
            n = len(outline)
            faces = [tuple(reversed(range(n))), tuple(range(n, n*2))]
            faces.extend((i, (i+1)%n, (i+1)%n+n, i+n) for i in range(n))
            caliper = part('OEM dark cast brake caliper', vertices, faces,
                           caliper_material, smooth=False)
            bevel = caliper.modifiers.new('Cast edge radii', 'BEVEL')
            bevel.width = .007
            bevel.segments = 3
            caliper.modifiers.new('Weighted cast normals', 'WEIGHTED_NORMAL')

    return objects
