"""Closed cabin linings in native car coordinates (+X nose, Z up)."""
import math
import random
import bpy
from mathutils import Vector


def build_cabin(*, body, panels, empty, mesh, block, blue, frame):
    def group(label, component, parent=body):
        return empty(label, parent=parent, componentId=component, partId='body', category='car')

    def local_points(parent, points):
        bpy.context.view_layer.update()
        inverse = parent.matrix_world.inverted()
        return [inverse @ Vector(point) for point in points]

    def slab(name, outline, lateral, thickness, material, parent, component):
        points = [(x, lateral + offset, z) for offset in [-thickness/2, thickness/2] for x, z in outline]
        count = len(outline)
        faces = [tuple(range(count-1, -1, -1)), tuple(count+i for i in range(count))]
        faces += [(i, (i+1)%count, (i+1)%count+count, i+count) for i in range(count)]
        obj = mesh(name, local_points(parent, points), faces, material, parent, component)
        for face in obj.data.polygons:
            face.use_smooth = False
        return obj

    def box(name, center, size, material, parent, component, bevel=.012):
        return block(name, local_points(parent, [center])[0], size, material, parent, component, bevel)

    def tube(name, points, radius, material, parent, component):
        vertices, faces, segments = [], [], 8
        points = [Vector(point) for point in points]
        for i, point in enumerate(points):
            tangent = (points[min(i+1, len(points)-1)] - points[max(0, i-1)]).normalized()
            reference = Vector((0, 0, 1)) if abs(tangent.z) < .9 else Vector((1, 0, 0))
            u = tangent.cross(reference).normalized()
            v = tangent.cross(u).normalized()
            for j in range(segments):
                angle = j * math.tau / segments
                vertices.append(point + radius*(math.cos(angle)*u + math.sin(angle)*v))
        for i in range(len(points)-1):
            for j in range(segments):
                faces.append((i*segments+j, i*segments+(j+1)%segments,
                              (i+1)*segments+(j+1)%segments, (i+1)*segments+j))
        faces += [tuple(range(segments-1,-1,-1)), tuple((len(points)-1)*segments+j for j in range(segments))]
        return mesh(name, local_points(parent, vertices), faces, material, parent, component)

    # Closed side caps keep the air vents, dash fascia and glovebox on the body.
    # None of these objects is parented to a door hinge.
    dash_outline = [(.54,.46),(.74,.46),(.89,.67),(.87,.92),(.76,1.01),(.60,.99),(.49,.84)]
    kick_outline = [(.50,.27),(.88,.27),(1.00,.55),(.86,.70),(.61,.65)]
    for sign, side in [(-1,'left'), (1,'right')]:
        component = 'dashboard-cap-' + side
        parent = group('Cabin | fixed dashboard end and kick panel | '+side, component)
        slab('A6.Cabin | closed dashboard end | '+side, dash_outline, sign*.724, .032, blue, parent, component)
        slab('A6.Cabin | footwell kick panel | '+side, kick_outline, sign*.685, .028, blue, parent, component)
        # Deep backing behind the dash prevents seeing into the exterior shell.
        box('A6.Cabin | inner firewall closure | '+side, (.99,sign*.40,.54), (.07,.68,.56), frame, parent, component)

    # Four complete door-card backing shells. Original armrests, handles,
    # speakers and decorative trim remain attached to the same hinges.
    front = [(.90,.35),(.91,.84),(.73,.925),(-.10,.946),(-.145,.84),(-.14,.34)]
    rear = [(-.19,.35),(-.19,.97),(-1.035,.976),(-1.10,.77),(-.88,.35)]
    for key in ['door-fl','door-fr','door-rl','door-rr']:
        sign = -1 if key.endswith('l') else 1
        component = 'door-card-shell-' + key
        parent = panels[key]
        slab('A6.Cabin | complete blue inner door card | '+key, front if key[5] == 'f' else rear,
             sign*.762, .046, blue, parent, component)

    # Source door frames, window seals and pillars already fit the glazing.
    # Keep the added sill and card backing below the original window openings.
    for sign, side in [(-1,'left'),(1,'right')]:
        component = 'door-jambs-' + side
        parent = group('Cabin | sealed door apertures | '+side, component)
        box('A6.Cabin | continuous inner sill | '+side, (-.08,sign*.795,.30), (2.16,.11,.075), blue, parent, component)

    # Replace the source's vertical carpet slab across the hatch with a real
    # load bay: horizontal floor, quarter linings and a low threshold.
    cargo = group('Cabin | open cargo bay and wheel housings', 'cargo-bay-lining')
    box('A6.Cargo | horizontal carpeted load floor', (-1.75,0,.565), (1.10,1.28,.035), frame, cargo, 'cargo-floor')
    box('A6.Cargo | rear seat back lining', (-1.20,0,.78), (.045,1.27,.41), blue, cargo, 'cargo-seatback')
    cargo_side = [(-2.30,.58),(-2.30,.88),(-2.05,1.015),(-1.21,1.015),(-1.20,.58)]
    for sign, side in [(-1,'left'),(1,'right')]:
        slab('A6.Cargo | lined rear quarter | '+side, cargo_side, sign*.666, .055, blue, cargo, 'cargo-side-'+side)
        box('A6.Cargo | wheel housing cover | '+side, (-1.39,sign*.56,.62), (.61,.20,.15), frame, cargo, 'cargo-wheelhouse-'+side, .06)
    box('A6.Cargo | low loading sill', (-2.285,0,.603), (.10,1.31,.055), frame, cargo, 'cargo-threshold')
    hatch_seal = [(-2.29,-.64,.625),(-2.29,.64,.625),(-2.22,.67,.98),(-1.78,.56,1.395),
                  (-1.78,-.56,1.395),(-2.22,-.67,.98),(-2.29,-.64,.625)]
    tube('A6.Cargo | continuous hatch aperture seal', hatch_seal, .009, frame, cargo, 'cargo-weather-seal')
    hatch = panels['tailgate']
    box('A6.Cargo | tailgate inner trim', (-2.257,0,.815), (.035,1.20,.29), blue, hatch, 'tailgate-inner-trim', .025)
    box('A6.Cargo | recessed tailgate pull', (-2.233,.38,.785), (.022,.14,.045), frame, hatch, 'tailgate-pull', .015)

    # A tiny embedded tangent-space fibre normal survives glTF export, unlike
    # Blender-only procedural bump nodes. The headlining stays black.
    roof = bpy.data.materials.get('Audi A6 | black Alcantara headlining')
    if roof:
        rng = random.Random(2003)
        pixels = []
        for _ in range(128*128):
            x, y = rng.uniform(-.11,.11), rng.uniform(-.08,.08)
            normal = Vector((x,y,1)).normalized()
            pixels.extend((normal.x*.5+.5,normal.y*.5+.5,normal.z*.5+.5,1))
        texture = bpy.data.images.new('Black Alcantara | microfibre normal', width=128, height=128, alpha=False)
        texture.colorspace_settings.name = 'Non-Color'
        texture.pixels = pixels
        texture.pack()
        nodes = roof.node_tree.nodes
        image = nodes.new('ShaderNodeTexImage')
        image.image = texture
        normal = nodes.new('ShaderNodeNormalMap')
        normal.inputs['Strength'].default_value = .45
        roof.node_tree.links.new(image.outputs['Color'], normal.inputs['Color'])
        roof.node_tree.links.new(normal.outputs['Normal'], nodes.get('Principled BSDF').inputs['Normal'])
