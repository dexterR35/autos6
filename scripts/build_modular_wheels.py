"""Build editable wheel/tyre/brake assemblies in Blender, then export their GLB.

Blender coordinates: +X nose, Z up; vehicle left is -Y. Components have local
origins at the axle and a +Y outboard axis, with a separate parent per corner.
The body is imported only as a fit reference; all running gear is authored here.
"""
import argparse
import json
import math
from pathlib import Path
import sys

import bmesh
import bpy
from mathutils import Matrix, Vector

ROOT = Path(__file__).resolve().parents[1]
parser = argparse.ArgumentParser()
parser.add_argument('--body', required=True)
parser.add_argument('--out-dir', required=True)
args = parser.parse_args(sys.argv[sys.argv.index('--') + 1:])
OUT = Path(args.out_dir)
OUT.mkdir(parents=True, exist_ok=True)
bpy.ops.wm.read_factory_settings(use_empty=True)
scene = bpy.context.scene
scene.unit_settings.system = 'METRIC'
scene.unit_settings.length_unit = 'METERS'
scene['workflow'] = 'Edit named parts or their material slots; road and track tyres are interchangeable.'


def collection(name, parent=None):
    result = bpy.data.collections.new(name)
    (parent or scene.collection).children.link(result)
    return result


PARTS = collection('10 | Modular wheels, tyres and brakes')
LIBRARY = collection('90 | Construction templates')
LIBRARY.hide_render = True
LIBRARY.hide_viewport = True


def material(name, color, metal=0, rough=.4, coat=0):
    mat = bpy.data.materials.new(name)
    mat.use_nodes = True
    bs = mat.node_tree.nodes.get('Principled BSDF')
    bs.inputs['Base Color'].default_value = (*color, 1)
    bs.inputs['Metallic'].default_value = metal
    bs.inputs['Roughness'].default_value = rough
    bs.inputs['Coat Weight'].default_value = coat
    bs.inputs['Coat Roughness'].default_value = .13
    mat.diffuse_color = (*color, 1)
    mat.use_backface_culling = True
    return mat


M = {
    'rim': material('S6.Modular.RimPaint | change wheel colour', (.13, .15, .18), .86, .26, .45),
    'lip': material('S6.Modular.MachinedLip', (.46, .49, .54), .96, .19),
    'rubber': material('S6.Modular.TyreRubber | tyre rubber', (.014, .016, .019), .01, .86),
    'disc': material('S6.Modular.RotorSteel', (.32, .34, .37), 1, .33),
    'hat': material('S6.Modular.RotorHat', (.055, .063, .075), .85, .4),
    'caliper': material('S6.Modular.CaliperPaint | change brake colour', (.58, .012, .018), .25, .3, .8),
    'pad': material('S6.Modular.BrakePad', (.022, .021, .020), .03, .88),
    'hardware': material('S6.Modular.Hardware', (.22, .24, .28), .9, .28),
    'black': material('S6.Modular.CapAndValve', (.006, .008, .011), .1, .42),
    'logo': material('S6.Modular.CaliperLettering', (.8, .83, .85), .25, .35),
}


def mesh_object(name, vertices, faces, mat, smooth=True):
    mesh = bpy.data.meshes.new(name)
    mesh.from_pydata(vertices, [], faces)
    mesh.validate()
    mesh.update()
    bm = bmesh.new()
    bm.from_mesh(mesh)
    bmesh.ops.remove_doubles(bm, verts=list(bm.verts), dist=1e-7)
    bmesh.ops.recalc_face_normals(bm, faces=list(bm.faces))
    bm.to_mesh(mesh)
    bm.free()
    for poly in mesh.polygons:
        poly.use_smooth = smooth
    mesh.materials.append(mat)
    obj = bpy.data.objects.new(name, mesh)
    LIBRARY.objects.link(obj)
    return obj


def lathe(name, profile, mat, segments=96, sipes=0):
    vertices, faces = [], []
    for i in range(segments):
        angle = i / segments * math.tau
        for radius, axial in profile:
            r = radius
            if sipes and radius > .317 and abs(axial) < .095:
                # Genuine shallow cuts in the tread, with a stagger across its width.
                phase = (i / segments * sipes + axial * 16) % 1
                r -= .0018 * max(0, 1 - abs(phase - .5) / .16)
            vertices.append((r * math.cos(angle), axial, r * math.sin(angle)))
    count = len(profile)
    for i in range(segments):
        for j in range(count):
            a, b = i * count + j, ((i + 1) % segments) * count + j
            c, d = ((i + 1) % segments) * count + (j + 1) % count, i * count + (j + 1) % count
            faces.append((a, b, c, d))
    return mesh_object(name, vertices, faces, mat)


def bevel_apply(obj, width=.002, segments=2):
    mod = obj.modifiers.new('Machined edge bevel', 'BEVEL')
    mod.width, mod.segments = width, segments
    mod.limit_method = 'ANGLE'
    bpy.context.view_layer.objects.active = obj
    # Templates are temporarily exposed only while evaluating native modifiers.
    LIBRARY.hide_viewport = False
    bpy.ops.object.modifier_apply(modifier=mod.name)
    LIBRARY.hide_viewport = True
    return obj


def block(name, center, size, mat, bevel=.002):
    vertices = [(center[0] + x * size[0] / 2, center[1] + y * size[1] / 2, center[2] + z * size[2] / 2)
                for x, y, z in [(-1, -1, -1), (1, -1, -1), (1, 1, -1), (-1, 1, -1),
                                (-1, -1, 1), (1, -1, 1), (1, 1, 1), (-1, 1, 1)]]
    faces = [(0, 3, 2, 1), (4, 5, 6, 7), (0, 1, 5, 4), (1, 2, 6, 5), (2, 3, 7, 6), (3, 0, 4, 7)]
    return bevel_apply(mesh_object(name, vertices, faces, mat, False), bevel)


templates = []


def template(obj, component, part='wheels', variant=None):
    obj['componentId'], obj['partId'], obj['category'] = component, part, 'car'
    obj['authoredIn'] = 'Blender'
    if variant:
        obj['tyreVariant'] = variant
    templates.append(obj)
    return obj


# Two closed tyre carcasses with the same bead, diameter and mounting position.
for variant, grooves, sipes in [('road', [-.055, 0, .055], 48), ('track', [-.047, .047], 0)]:
    profile = [(.2413, -.106), (.246, -.118), (.265, -.128), (.289, -.131), (.309, -.119), (.319, -.103), (.323, -.09)]
    for groove in grooves:
        half = .004 if variant == 'road' else .003
        profile += [(.323, groove - half), (.317 if variant == 'road' else .319, groove - half * .65),
                    (.317 if variant == 'road' else .319, groove + half * .65), (.323, groove + half)]
    profile += [(.323, .09), (.319, .103), (.309, .119), (.289, .131), (.265, .128), (.246, .118), (.2413, .106)]
    template(lathe('Tyre | ' + variant, profile, M['rubber'], 112, sipes), 'tyre', variant=variant)

# Closed barrel and a rounded, separately finished outer rim lip.
template(lathe('Rim | barrel', [(.231, -.105), (.2413, -.105), (.246, -.096), (.246, .111),
                                (.241, .119), (.232, .115), (.226, .096), (.226, -.094)], M['rim']), 'rim')
template(lathe('Rim | diamond-cut lip', [(.238, .113), (.246, .112), (.249, .117), (.248, .122),
                                         (.244, .124), (.238, .122)], M['lip'], 128), 'rim-lip')

# Five broad cast spokes; native bevelled solids, with a shallow concave face.
verts, faces = [], []
for spoke in range(5):
    angle = math.pi / 2 + spoke * math.tau / 5
    radial, tangent = Vector((math.cos(angle), 0, math.sin(angle))), Vector((-math.sin(angle), 0, math.cos(angle)))
    outline = [(.052, -.025), (.085, -.034), (.205, -.030), (.237, -.038),
               (.237, .038), (.205, .030), (.085, .034), (.052, .025)]
    start = len(verts)
    for back in (True, False):
        for radius, width in outline:
            front = .077 + .039 * ((radius - .052) / .185) ** 1.2
            point = radial * radius + tangent * width + Vector((0, front - (.029 if back else 0), 0))
            verts.append(tuple(point))
    count = len(outline)
    faces += [tuple(start + i for i in range(count))[::-1], tuple(start + count + i for i in range(count))]
    faces += [(start + i, start + (i + 1) % count, start + count + (i + 1) % count, start + count + i) for i in range(count)]
template(bevel_apply(mesh_object('Rim | five concave spokes', verts, faces, M['rim'], False), .003, 3), 'rim')
template(lathe('Rim | central hub', [(.027, .055), (.073, .055), (.078, .069), (.073, .086), (.027, .086)], M['rim'], 64), 'rim')
template(lathe('Rim | centre cap', [(0, .086), (.029, .086), (.030, .090), (.027, .096), (0, .097)], M['black'], 48), 'centre-cap')

for lug in range(5):
    angle = math.pi / 2 + (lug + .5) * math.tau / 5
    bolt = lathe('Rim | lug bolt %d' % (lug + 1), [(0, .086), (.007, .086), (.007, .095), (0, .097)], M['hardware'], 6)
    bolt.data.transform(Matrix.Translation((math.cos(angle) * .056, 0, math.sin(angle) * .056)))
    template(bolt, 'wheel-hardware')

# Separate chrome centre-cap rings, kept as a small replaceable badge.
vertices, faces = [], []
for ring in range(4):
    start = len(vertices)
    for i in range(20):
        theta = i / 20 * math.tau
        for j in range(6):
            phi = j / 6 * math.tau
            radius = .0053 + math.cos(phi) * .00065
            vertices.append(((ring - 1.5) * .0074 + math.cos(theta) * radius,
                             .098 + math.sin(phi) * .00065, math.sin(theta) * radius * .82))
    for i in range(20):
        for j in range(6):
            a, b = start + i * 6 + j, start + ((i + 1) % 20) * 6 + j
            faces.append((a, b, start + ((i + 1) % 20) * 6 + (j + 1) % 6, start + i * 6 + (j + 1) % 6))
template(mesh_object('Rim | Audi centre-cap rings', vertices, faces, M['lip']), 'centre-badge')

# A smooth, ventilated two-piece rotor, with real through holes cut in Blender.
rotor_templates = {}
for axle, radius in [('front', .172), ('rear', .158)]:
    ring = lathe('Brake | %s ventilated rotor' % axle,
                 [(.091, -.014), (radius - .002, -.014), (radius, -.012), (radius, .011),
                  (radius - .002, .014), (.091, .014)], M['disc'], 96)
    LIBRARY.hide_viewport = False
    cutters = []
    for row in range(16):
        for band in range(2):
            angle = math.tau * (row + band * .18) / 16
            r = .112 + band * (radius - .125)
            bpy.ops.mesh.primitive_cylinder_add(vertices=10, radius=.0031, depth=.06,
                location=(r * math.cos(angle), 0, r * math.sin(angle)), rotation=(math.pi / 2, 0, 0))
            cutters.append(bpy.context.object)
    bpy.ops.object.select_all(action='DESELECT')
    for obj in cutters:
        obj.select_set(True)
    bpy.context.view_layer.objects.active = cutters[0]
    bpy.ops.object.join()
    cutter = bpy.context.object
    bpy.context.view_layer.objects.active = ring
    mod = ring.modifiers.new('Drilled through the friction ring', 'BOOLEAN')
    mod.operation, mod.solver, mod.object = 'DIFFERENCE', 'EXACT', cutter
    bpy.ops.object.modifier_apply(modifier=mod.name)
    bpy.data.objects.remove(cutter, do_unlink=True)
    LIBRARY.hide_viewport = True
    rotor_templates[axle] = ring

template(lathe('Brake | rotor hat', [(0, -.035), (.098, -.035), (.098, -.014), (.087, -.009),
                                      (.062, .039), (0, .039)], M['hat'], 64), 'rotor-hat', 'brake-kit')
template(lathe('Brake | backing shield', [(.042, -.039), (.179, -.039), (.18, -.037), (.042, -.036)], M['hat'], 64), 'backing-plate', 'brake-kit')
template(block('Brake | red caliper outer body', (-.137, .034, .015), (.069, .049, .115), M['caliper'], .009), 'caliper', 'brake-kit')
template(block('Brake | red caliper inner body', (-.137, -.037, .015), (.069, .035, .115), M['caliper'], .007), 'caliper', 'brake-kit')
for height in (-.027, .057):
    template(block('Brake | caliper bridge', (-.155, -.002, height), (.034, .086, .025), M['caliper'], .005), 'caliper', 'brake-kit')
for axial in (-.021, .021):
    template(block('Brake | separate friction pad', (-.132, axial, .015), (.047, .010, .085), M['pad'], .003), 'brake-pad', 'brake-kit')
    template(block('Brake | pad backing panel', (-.132, axial * 1.35, .015), (.051, .004, .09), M['hardware'], .001), 'pad-backing-plate', 'brake-kit')

made, track_objects, assemblies = [], [], []
mirrored_brake_meshes = {}
for corner, x, side, axle in [('FL', 1.400, 1, 'front'), ('FR', 1.400, -1, 'front'),
                              ('RL', -1.359, 1, 'rear'), ('RR', -1.359, -1, 'rear')]:
    group = collection('Wheel ' + corner + ' | rim, tyre, brake assembly', PARTS)
    parent = bpy.data.objects.new('S6.Wheel.' + corner, None)
    group.objects.link(parent)
    parent.location = (x, -side * .818, .323)
    parent.rotation_euler.z = math.pi if side > 0 else 0
    parent['wheelCorner'], parent['category'] = corner, 'car'
    parent['assemblyId'] = 'wheel-' + corner.lower()
    assemblies.append(parent)
    for source in templates + [rotor_templates[axle]]:
        obj = source.copy()
        obj.data = source.data  # Linked machining geometry; distinct editable objects.
        if side > 0 and source.get('componentId') in {'caliper', 'brake-pad', 'pad-backing-plate'}:
            # Mirrored outboard axes must not put one side's caliper ahead of
            # its axle and the other behind it. Bake the radial mirror locally.
            if source.data not in mirrored_brake_meshes:
                mirrored = source.data.copy()
                mirrored.transform(Matrix.Diagonal((-1, 1, 1, 1)))
                bm = bmesh.new()
                bm.from_mesh(mirrored)
                bmesh.ops.recalc_face_normals(bm, faces=list(bm.faces))
                bm.to_mesh(mirrored)
                bm.free()
                mirrored_brake_meshes[source.data] = mirrored
            obj.data = mirrored_brake_meshes[source.data]
        group.objects.link(obj)
        obj.parent = parent
        obj.name = 'S6.%s.%s' % (corner, source.name)
        obj['wheelCorner'] = corner
        if source in rotor_templates.values():
            obj['componentId'], obj['partId'], obj['category'], obj['authoredIn'] = 'brake-disc', 'brake-kit', 'car', 'Blender'
        made.append(obj)
        if obj.get('tyreVariant') == 'track':
            track_objects.append(obj)

# Export only the authored assemblies, including both tyre alternatives.
LIBRARY.hide_viewport = False
bpy.ops.object.select_all(action='DESELECT')
for obj in made + assemblies:
    obj.select_set(True)
bpy.context.view_layer.objects.active = assemblies[0]
parts_file = OUT / 'modular-wheels.glb'
bpy.ops.export_scene.gltf(filepath=str(parts_file), export_format='GLB', use_selection=True,
    export_extras=True, export_yup=True, export_cameras=False, export_lights=False,
    export_animations=False, export_tangents=False)
LIBRARY.hide_viewport = True

# The native project contains the current car and individually selectable parts.
before = set(bpy.data.objects)
bpy.ops.import_scene.gltf(filepath=str(Path(args.body).resolve()))
body_collection = collection('00 | Audi body and cabin | imported fit reference')
for obj in set(bpy.data.objects) - before:
    for owner in list(obj.users_collection):
        owner.objects.unlink(obj)
    body_collection.objects.link(obj)
for obj in track_objects:
    obj.hide_set(True)
    obj.hide_render = True

text = bpy.data.texts.new('START HERE | editing the modular Audi')
text.write('''MODULAR AUDI RUNNING GEAR\n\nThe body is the supplied imported model. The wheel, tyre and brake parts were constructed in Blender.\n\nExpand collection 10 and choose FL / FR / RL / RR. Each assembly has its own axle origin.\nRim: edit S6.Modular.RimPaint. Caliper: edit S6.Modular.CaliperPaint.\nTyres: hide the road object and unhide the track object in the same wheel collection.\nBoth tyre variants use the same bead diameter and axle location.\nPads, backing panels, drilled rotors, rotor hats, calipers, lips and lug bolts remain separate objects.\nSome repeated machining meshes are linked; Object > Relations > Make Single User > Object & Data makes one independent.\n\nTo export changes back into the website, select the four wheel assembly parents and their mesh children, temporarily show both tyre variants, then export GLB with Custom Properties enabled. Replace modular-wheels.glb and run the car build with --reuse-wheels --publish.\n''')

# Studio helpers are kept in their own collection and are not exported.
studio = collection('80 | Studio lights and cameras')


def move_to(obj, target):
    for owner in list(obj.users_collection):
        owner.objects.unlink(obj)
    target.objects.link(obj)


for name, location, power, size in [('Key softbox', (3, -4, 6), 1100, 5), ('Rim softbox', (-3, 2, 4), 850, 4), ('Front fill', (5, 3, 2), 650, 3)]:
    data = bpy.data.lights.new(name, 'AREA')
    data.energy, data.shape, data.size = power, 'DISK', size
    obj = bpy.data.objects.new(name, data)
    studio.objects.link(obj)
    obj.location = location
    obj.rotation_euler = (Vector((0, 0, .7)) - obj.location).to_track_quat('-Z', 'Y').to_euler()
bpy.ops.object.camera_add(location=(6, -6.5, 3.0))
camera = bpy.context.object
camera.name = 'Camera | assembled Audi'
camera.rotation_euler = (Vector((0, 0, .85)) - camera.location).to_track_quat('-Z', 'Y').to_euler()
camera.data.lens = 48
scene.camera = camera
move_to(camera, studio)
scene.world = bpy.data.worlds.new('Neutral studio')
scene.world.use_nodes = True
scene.world.node_tree.nodes['Background'].inputs[0].default_value = (.11, .14, .20, 1)
scene.world.node_tree.nodes['Background'].inputs[1].default_value = .35
scene.render.engine = 'CYCLES'
scene.cycles.samples = 24
scene.render.resolution_x, scene.render.resolution_y, scene.render.resolution_percentage = 1440, 900, 100
scene.view_settings.view_transform = 'AgX'
for screen in bpy.data.screens:
    for area in screen.areas:
        if area.type == 'VIEW_3D':
            area.spaces.active.region_3d.view_distance = 6.5
            area.spaces.active.region_3d.view_location = (0, 0, .8)
            area.spaces.active.region_3d.view_rotation = camera.rotation_euler.to_quaternion()
            area.spaces.active.clip_end = 100
            area.spaces.active.shading.type = 'MATERIAL'
bpy.ops.object.select_all(action='DESELECT')
assemblies[0].select_set(True)
bpy.context.view_layer.objects.active = assemblies[0]
bpy.ops.file.pack_all()
blend = OUT / 'audi_s6_modular.blend'
bpy.ops.wm.save_as_mainfile(filepath=str(blend))
report = {'blend': str(blend.relative_to(ROOT)), 'partsGlb': str(parts_file.relative_to(ROOT)),
          'corners': [obj['wheelCorner'] for obj in assemblies], 'objects': len(made),
          'components': sorted({obj['componentId'] for obj in made}), 'tyreVariants': ['road', 'track'],
          'axles': {'front': 1.4, 'rear': -1.359}, 'tyreRadius': .323, 'tyreWidth': .262,
          'colourMaterials': {'rim': M['rim'].name, 'caliper': M['caliper'].name},
          'source': 'Constructed in Blender from lathed profiles, bevelled solids and boolean-drilled rotors'}
(OUT / 'modular-wheels.json').write_text(json.dumps(report, indent=2) + '\n', encoding='utf-8')
print('MODULAR_WHEELS_COMPLETE', json.dumps(report), flush=True)
