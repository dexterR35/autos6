"""Import the supplied A6 Avant OBJ, preserving its panels and interior.

blender --background --python scripts/import_a6_c5.py -- --source PATH
The input is read only. The packed Blender project is the editable master.
"""
import argparse
import hashlib
import json
import math
import sys
from collections import defaultdict
from pathlib import Path

import bpy
import bmesh
from mathutils import Matrix, Vector

ROOT = Path(__file__).resolve().parents[1]
parser = argparse.ArgumentParser()
parser.add_argument('--source', required=True)
parser.add_argument('--render', action='store_true')
args = parser.parse_args(sys.argv[sys.argv.index('--') + 1:])
source = Path(args.source).resolve()
OUT = ROOT / 'output/car-refinement/a6-c5-v1'
OUT.mkdir(parents=True, exist_ok=True)
bpy.ops.wm.read_factory_settings(use_empty=True)
bpy.ops.wm.obj_import(filepath=str(source), forward_axis='Y', up_axis='Z')
imported = list(bpy.context.scene.objects)
scene = bpy.context.scene
scene.unit_settings.system = 'METRIC'
scene.render.film_transparent = False
car_collection = bpy.data.collections.new('Audi A6 C5 | articulated source model')
scene.collection.children.link(car_collection)


def empty(name, position=(0, 0, 0), parent=None, **extras):
    obj = bpy.data.objects.new(name, None)
    car_collection.objects.link(obj)
    obj.parent = parent
    obj.location = position
    obj.empty_display_type = 'PLAIN_AXES'
    obj.empty_display_size = .12
    for key, value in extras.items():
        obj[key] = value
    return obj


car = empty('Audi A6 C5 Avant | supplied 1998 model', sourceModel=source.name, category='car')
body = empty('Body | fixed shell and cabin', parent=car, partId='body')
# OBJ has nose at X=0, vertical Y, driver at Z<1. This is a rigid rotation
# and translation; the supplied 4.8 m body and 2.76 m wheelbase are unchanged.
transform = Matrix(((-1, 0, 0, 2.4), (0, 0, 1, -1), (0, 1, 0, 0), (0, 0, 0, 1)))
normal_transform = transform.to_3x3()


def native(point):
    return transform @ Vector(point)


panels = {}
panel_specs = {
    'door-fl': ('Front left door', (1.44, .78, .16), (0, 1, 0), 68),
    'door-fr': ('Front right door', (1.44, .78, 1.84), (0, -1, 0), 68),
    'door-rl': ('Rear left door', (2.56, .78, .16), (0, 1, 0), 66),
    'door-rr': ('Rear right door', (2.56, .78, 1.84), (0, -1, 0), 66),
    'hood': ('Bonnet', (1.32, .916, 1), (0, 0, 1), 62),
    'tailgate': ('Tailgate', (4.14, 1.40, 1), (0, 0, -1), 82),
}
for key, (label, pivot, axis, angle) in panel_specs.items():
    obj = empty('A6.Hinge.' + key, native(pivot), car, articulationId=key,
                label=label, hingeAxis=list(axis), openAngle=math.radians(angle),
                partId='hood' if key == 'hood' else 'body', category='car')
    obj.rotation_mode = 'XYZ'
    # The native joint axis is the inverse glTF Y-up conversion.
    native_axis = Vector((axis[0], -axis[2], axis[1]))
    index = max(range(3), key=lambda a: abs(native_axis[a]))
    limit = obj.constraints.new('LIMIT_ROTATION')
    limit.name = 'Physical hinge travel | closed to open'
    limit.owner_space = 'LOCAL'
    setattr(limit, 'use_limit_' + 'xyz'[index], True)
    travel = math.radians(angle) * native_axis[index]
    setattr(limit, 'min_' + 'xyz'[index], min(0, travel))
    setattr(limit, 'max_' + 'xyz'[index], max(0, travel))
    panels[key] = obj

wheels = {}
wheel_specs = [('FL', .9675, .227), ('FR', .9675, 1.778),
               ('RL', 3.7275, .222), ('RR', 3.7275, 1.783)]
for corner, x, z in wheel_specs:
    steering = empty('A6.Wheel.' + corner, native((x, .317, z)), car,
                     assemblyId='wheel-' + corner.lower(), wheelCorner=corner, category='car',
                     steeringAxis=[0, 1, 0], maxSteer=math.radians(30) if corner[0] == 'F' else 0)
    rolling = empty('A6.Roll.' + corner, parent=steering,
                    wheelCorner=corner, rollingId=corner, rollingAxis=[0, 0, 1])
    wheels[corner] = (steering, rolling)


def finish_material(mat):
    old = mat.name
    mat.use_nodes = True
    bs = mat.node_tree.nodes.get('Principled BSDF')
    bs.inputs['Roughness'].default_value = .48
    if old == 'body_color_1':
        mat.name = 'Audi A6 | deep blue pearl paint'
        bs.inputs['Base Color'].default_value = (.01, .036, .155, 1)
        bs.inputs['Metallic'].default_value = .74
        bs.inputs['Roughness'].default_value = .28
        bs.inputs['Coat Weight'].default_value = 1
        bs.inputs['Coat Roughness'].default_value = .03
    elif old == 'rims':
        mat.name = 'S6.Modular.RimPaint | original Audi alloy wheels'
        bs.inputs['Metallic'].default_value = .86
        bs.inputs['Roughness'].default_value = .26
    elif old == 'tyre':
        mat.name = 'Audi A6 | tyre rubber'
        bs.inputs['Base Color'].default_value = (.012, .014, .017, 1)
        bs.inputs['Roughness'].default_value = .9
    elif old == 'glass_window1':
        mat.name = 'Audi A6 | windscreen glass'
        # Retain the source MTL colour and IOR of every original pane. The
        # OBJ describes opaque glazing, so use alpha for the visible cabin.
        bs.inputs['Roughness'].default_value = .075
        bs.inputs['Alpha'].default_value = .48
        mat.surface_render_method = 'DITHERED'
        mat.use_backface_culling = False
    elif old.startswith('interior_') and old != 'interior_trim':
        # The source leather images contain beige pigment. Keep their grain as
        # a bump map, and give the upholstery its own blue/charcoal base coat.
        image = next((node for node in mat.node_tree.nodes if node.type == 'TEX_IMAGE'), None)
        for link in list(bs.inputs['Base Color'].links):
            mat.node_tree.links.remove(link)
        colors = {
            'interior_lower_1_seat': (.009, .030, .12, 1),
            'interior_lower_2': (.008, .016, .035, 1),
            'interior_upper_1': (.009, .030, .12, 1),
            'interior_upper_2': (.006, .010, .018, 1),
            'interior_roof': (.004, .005, .007, 1),
            'interior_carpet': (.006, .012, .025, 1),
        }
        bs.inputs['Base Color'].default_value = colors.get(old, (.008, .016, .035, 1))
        bs.inputs['Roughness'].default_value = .68 if old == 'interior_lower_1_seat' else .57
        mat.diffuse_color = bs.inputs['Base Color'].default_value
        mat.name = 'Audi A6 | blue Recaro upholstery' if old == 'interior_lower_1_seat' else 'Audi A6 | charcoal and blue cabin | ' + old
        if old == 'interior_roof':
            mat.name = 'Audi A6 | black Alcantara headlining'
            bs.inputs['Roughness'].default_value = .96
            bs.inputs['Sheen Weight'].default_value = .2
        if image:
            bump = mat.node_tree.nodes.new('ShaderNodeBump')
            bump.inputs['Strength'].default_value = .10
            bump.inputs['Distance'].default_value = .0006
            mat.node_tree.links.new(image.outputs['Color'], bump.inputs['Height'])
            mat.node_tree.links.new(bump.outputs['Normal'], bs.inputs['Normal'])
    elif old.startswith('chrome') or old in {'aluminium', 'steel1', 'steel2'}:
        mat.name = 'Audi A6 | polished chrome trim' if old == 'chrome' else 'Audi A6 | ' + old
        bs.inputs['Metallic'].default_value = .96 if old.startswith('chrome') else .85
        bs.inputs['Roughness'].default_value = .12 if old.startswith('chrome') else .32
    elif old.startswith('glass_lamp'):
        mat.name = 'Audi A6 | lamp lenses | ' + old
        # Source ribbed lens textures and reflectors stay in place. A clearcoat
        # gives them a lens finish without making their nested surfaces vanish.
        bs.inputs['Roughness'].default_value = .14
        bs.inputs['Coat Weight'].default_value = 1
        bs.inputs['Alpha'].default_value = .28
        mat.surface_render_method = 'DITHERED'
        if old in {'glass_lamp_red', 'glass_lamp_fog'}:
            mat.diffuse_color = (.36, .008, .012, 1)
            for link in list(bs.inputs['Base Color'].links):
                mat.node_tree.links.remove(link)
            bs.inputs['Base Color'].default_value = (.36, .008, .012, 1)
            bs.inputs['Alpha'].default_value = .65
    elif old.startswith('black'):
        bs.inputs['Roughness'].default_value = .22 if old == 'black_gloss' else .65
    # Source paths are resolved by Blender's OBJ importer, then packed below.
    return old


original_materials = {mat: finish_material(mat) for mat in list(bpy.data.materials)}
caliper_mat = bpy.data.materials.new('S6.Modular.CaliperPaint | separate brake calipers')
caliper_mat.use_nodes = True
caliper_bs = caliper_mat.node_tree.nodes.get('Principled BSDF')
caliper_bs.inputs['Base Color'].default_value = (.58, .012, .018, 1)
caliper_bs.inputs['Metallic'].default_value = .25
caliper_bs.inputs['Roughness'].default_value = .3
caliper_bs.inputs['Coat Weight'].default_value = 1


def components(mesh):
    """Retain each authored loose piece; never cut the exterior by a box."""
    parent = list(range(len(mesh.vertices)))

    def root(i):
        while parent[i] != i:
            parent[i] = parent[parent[i]]
            i = parent[i]
        return i

    for face in mesh.polygons:
        for i in face.vertices[1:]:
            parent[root(i)] = root(face.vertices[0])
    groups = defaultdict(list)
    for face in mesh.polygons:
        groups[root(face.vertices[0])].append(face)
    return list(groups.values())


def bounds(mesh, faces):
    points = [mesh.vertices[i].co for i in {i for f in faces for i in f.vertices}]
    return [min(p[a] for p in points) for a in range(3)], [max(p[a] for p in points) for a in range(3)]


def door_key(x, z):
    return 'door-' + ('f' if x < 2.575 else 'r') + ('l' if z < 1 else 'r')


def classify(number, lo, hi):
    mid = [(a + b) / 2 for a, b in zip(lo, hi)]
    x, y, z = mid
    if number in {61, 73, 74, 77, 79, 98, 99} or (number == 75 and lo[1] > .50):
        return 'hood'
    if number in {65, 91, 94, 102, 105, 106, 113, 116, 129, 135}:
        return 'tailgate'
    if number in {64, 66, 68, 69, 70, 86, 92, 103, 112, 136, 137}:
        return door_key(x, z)
    # Individual wood trim, handles, speakers and upholstery on door cards.
    if number in {38, 48, 50, 52, 53, 55} and (hi[2] < .42 or lo[2] > 1.58) and 1.84 < x < 3.55:
        return door_key(x, z)
    if number == 87 and lo[0] > 4:
        return 'tailgate'
    if number in {60, 72, 74, 75, 77, 79, 97, 98, 99, 109, 115, 125}:
        return 'front-bumper'
    if number == 67:
        return 'rear-bumper'
    if number in {76, 88}:
        return 'front-bumper' if hi[0] < .7 else 'rear-bumper' if lo[0] > 4 else 'side-skirts'
    if number in {89, 90}:
        return 'side-skirts'
    if number == 58:
        return 'exhaust'
    return 'body'


fixed = {key: empty(label, parent=car, partId=key, category='car') for key, label in
         [('front-bumper', 'Front bumper | grille and fog lamps'),
          ('rear-bumper', 'Rear bumper'), ('side-skirts', 'Side skirts'), ('exhaust', 'Underbody | exhaust')]}
destinations = {'body': body, **panels, **fixed}
made = []
source_counts = {}


def copy_faces(source_obj, faces, parent, label, **extras):
    mesh = source_obj.data
    ids = sorted({i for f in faces for i in f.vertices})
    remap = {old: new for new, old in enumerate(ids)}
    # Keep the pivot at the actual joint, while keeping all geometry assembled.
    scene.view_layers[0].update()
    origin = parent.matrix_world.translation
    vertices = [native(mesh.vertices[i].co) - origin for i in ids]
    target = bpy.data.meshes.new(label)
    target.from_pydata(vertices, [], [tuple(remap[i] for i in f.vertices) for f in faces])
    target.update()
    for material in mesh.materials:
        target.materials.append(material)
    uv = target.uv_layers.new(name='Source UV') if mesh.uv_layers else None
    normals = []
    for old, new in zip(faces, target.polygons):
        new.material_index = old.material_index
        new.use_smooth = old.use_smooth
        for old_loop, new_loop in zip(old.loop_indices, new.loop_indices):
            if uv:
                uv.data[new_loop].uv = mesh.uv_layers.active.data[old_loop].uv
            normals.append(normal_transform @ mesh.corner_normals[old_loop].vector)
    target.normals_split_custom_set(normals)
    obj = bpy.data.objects.new(label, target)
    car_collection.objects.link(obj)
    obj.parent = parent
    obj['category'] = 'car'
    obj['sourceObject'] = source_obj.name
    obj['authoredIn'] = 'Blender'
    obj['partId'] = parent.get('partId', 'body')
    for key, value in extras.items():
        obj[key] = value
    made.append(obj)
    return obj


for obj in imported:
    if obj.type != 'MESH' or obj.name == 'G-Object':
        bpy.data.objects.remove(obj, do_unlink=True)
        continue
    try:
        number = int(obj.name.split('.')[-1].split('_')[0])
    except ValueError:
        number = 0
    if number == 78:
        # The bonnet liner replaces the original under-bonnet placeholder.
        # Keep the separate source headlamp trim, including G-Object.084.
        bpy.data.objects.remove(obj, do_unlink=True)
        continue
    if 3 <= number <= 34:
        corner = ['FL', 'RL', 'FR', 'RR'][(number - 3) // 8]
        component = ['rim', 'wheel-hardware', 'brake-disc', 'rotor-hat', 'caliper',
                     'centre-badge', 'backing-plate', 'tyre'][(number - 3) % 8]
        steering, rolling = wheels[corner]
        parent = steering if component in {'caliper', 'backing-plate'} else rolling
        extras = dict(componentId=component, wheelCorner=corner,
                      partId='brake-kit' if component in {'brake-disc', 'rotor-hat', 'caliper', 'backing-plate'} else 'wheels')
        if component == 'tyre':
            extras['tyreVariant'] = 'road'
        result = copy_faces(obj, list(obj.data.polygons), parent, 'A6.%s.%s' % (corner, component), **extras)
        if component == 'caliper':
            result.data.materials.clear()
            result.data.materials.append(caliper_mat)
    else:
        if number in {45, 55}:
            # The source welds the dashboard to its door cards. Split the
            # crossing polygons at the card limits before assigning them,
            # so no dashboard triangles stick out of an open door's edge.
            bm = bmesh.new()
            bm.from_mesh(obj.data)
            for axis, value in [(0, 1.84), (0, 2.575), (0, 3.53), (2, .43), (2, 1.57)]:
                point = [0, 0, 0]
                normal = [0, 0, 0]
                point[axis], normal[axis] = value, 1
                bmesh.ops.bisect_plane(bm, geom=list(bm.verts) + list(bm.edges) + list(bm.faces),
                    dist=1e-6, plane_co=point, plane_no=normal, clear_inner=False, clear_outer=False)
            bm.to_mesh(obj.data)
            bm.free()
            obj.data.update()
        grouped = defaultdict(list)
        if 133 <= number <= 137:
            # Keep each physical pane separate for depth sorting as the camera
            # moves around the car. All faces and normals come from the OBJ.
            panes = defaultdict(list)
            for faces in components(obj.data):
                lo, hi = bounds(obj.data, faces)
                key = classify(number, lo, hi)
                side = ('left' if lo[2]+hi[2]<2 else 'right') if number in {133,136,137} else 'centre'
                panes[key,side].extend(faces)
            for (key,side),faces in panes.items():
                pane = f'{obj.name}-{side}'
                copy_faces(obj,faces,destinations[key],'A6.Window | '+pane,componentId=key,windowPane=pane)
            source_counts[obj.name] = {f'{key}-{side}':len(faces) for (key,side),faces in panes.items()}
            bpy.data.objects.remove(obj,do_unlink=True)
            continue
        for faces in components(obj.data):
            lo, hi = bounds(obj.data, faces)
            # Replace both standard front chairs and their headrests with
            # separately editable sport seats; retain the rear bench.
            if number == 49 and lo[0] < 2.80:
                continue
            # The uploaded cargo carpet has an upright rear closing wall. It
            # blocks the hatch opening; replace this entire cargo piece below.
            if number == 39 and hi[0] > 4.5:
                continue
            # Some source strips/dashboard/door cards span several panels.
            # Split only those authored trim surfaces at the existing door seam.
            if number in {45, 55, 81, 85, 108}:
                for face in faces:
                    points = [obj.data.vertices[i].co for i in face.vertices]
                    x, y, z = [sum(p[a] for p in points) / len(points) for a in range(3)]
                    is_side = z < .43 or z > 1.57
                    if is_side and 1.84 < x < 3.53:
                        key = door_key(x, z)
                    else:
                        key = 'body'
                    if number not in {45, 55} or not key.startswith('door-'):
                        grouped[key].append(face)
            else:
                key = classify(number, lo, hi)
                if number not in {45, 55} or not key.startswith('door-'):
                    grouped[key].extend(faces)
        for key, faces in grouped.items():
            material_label = original_materials.get(obj.data.materials[0], 'surface') if obj.data.materials else 'surface'
            copy_faces(obj, faces, destinations[key], 'A6.%s | %s | %s' % (key, material_label, obj.name), componentId=key)
        source_counts[obj.name] = {key: len(faces) for key, faces in grouped.items()}
    bpy.data.objects.remove(obj, do_unlink=True)


def seat_material(name, color, roughness):
    mat = bpy.data.materials.new(name)
    mat.diffuse_color = (*color, 1)
    mat.use_nodes = True
    shader = mat.node_tree.nodes.get('Principled BSDF')
    shader.inputs['Base Color'].default_value = (*color, 1)
    shader.inputs['Roughness'].default_value = roughness
    noise = mat.node_tree.nodes.new('ShaderNodeTexNoise')
    noise.inputs['Scale'].default_value = 650
    bump = mat.node_tree.nodes.new('ShaderNodeBump')
    bump.inputs['Strength'].default_value = .12
    bump.inputs['Distance'].default_value = .0005
    mat.node_tree.links.new(noise.outputs['Fac'], bump.inputs['Height'])
    mat.node_tree.links.new(bump.outputs['Normal'], shader.inputs['Normal'])
    return mat


seat_blue = seat_material('Recaro | dark blue Alcantara inserts', (.009, .030, .12), .75)
seat_black = seat_material('Recaro | matching dark blue leather bolsters', (.009, .030, .12), .48)
seat_frame = seat_material('Recaro | satin black seat rails', (.009, .012, .018), .42)
seat_logo = seat_material('Recaro | silver embroidered lettering', (.65, .72, .82), .7)


def seat_mesh(name, vertices, faces, material, parent, component):
    mesh = bpy.data.meshes.new(name)
    mesh.from_pydata(vertices, [], faces)
    mesh.materials.append(material)
    mesh.update()
    for face in mesh.polygons:
        face.use_smooth = True
    obj = bpy.data.objects.new(name, mesh)
    car_collection.objects.link(obj)
    obj.parent = parent
    for key, value in dict(category='car', partId='body', componentId=component, authoredIn='Blender').items():
        obj[key] = value
    made.append(obj)
    return obj


def seat_block(name, center, size, material, parent, component, bevel=.025):
    vertices = [(center[0] + x*size[0]/2, center[1] + y*size[1]/2, center[2] + z*size[2]/2)
                for x, y, z in [(-1,-1,-1),(1,-1,-1),(1,1,-1),(-1,1,-1),(-1,-1,1),(1,-1,1),(1,1,1),(-1,1,1)]]
    obj = seat_mesh(name, vertices, [(0,3,2,1),(4,5,6,7),(0,1,5,4),(1,2,6,5),(2,3,7,6),(3,0,4,7)], material, parent, component)
    bpy.context.view_layer.objects.active = obj
    mod = obj.modifiers.new('Soft upholstery edges', 'BEVEL')
    mod.width, mod.segments = bevel, 4
    bpy.ops.object.modifier_apply(modifier=mod.name)
    mod = obj.modifiers.new('Upholstery normals', 'WEIGHTED_NORMAL')
    bpy.ops.object.modifier_apply(modifier=mod.name)
    return obj


def seat_loft(name, sections, material, parent, component):
    # z, fore/aft centre, lateral centre, half width, half depth.
    vertices, faces, count = [], [], 32
    for z, x, y, width, depth in sections:
        for i in range(count):
            angle = i * math.tau / count
            c, s = math.cos(angle), math.sin(angle)
            vertices.append((x + depth * math.copysign(abs(c)**.5, c), y + width * math.copysign(abs(s)**.5, s), z))
    for row in range(len(sections)-1):
        for i in range(count):
            faces.append((row*count+i, row*count+(i+1)%count, (row+1)*count+(i+1)%count, (row+1)*count+i))
    faces += [tuple(range(count-1,-1,-1)), tuple((len(sections)-1)*count+i for i in range(count))]
    return seat_mesh(name, vertices, faces, material, parent, component)


for side, lateral in [('left', -.3865), ('right', .406)]:
    component = 'recaro-seat-' + side
    parent = empty('Recaro sport seat | ' + side, parent=body, componentId=component, partId='body', category='car')
    for offset in [-.17, .17]:
        seat_block('Recaro.%s | adjustable rail' % side, (.045, lateral+offset, .34), (.67,.035,.04), seat_frame, parent, component, .007)
    seat_block('Recaro.%s | seat base' % side, (.045,lateral,.47), (.66,.50,.13), seat_black, parent, component, .05)
    seat_block('Recaro.%s | blue cushion insert' % side, (.08,lateral,.545), (.52,.31,.065), seat_blue, parent, component, .03)
    for offset in [-.217, .217]:
        seat_block('Recaro.%s | thigh bolster' % side, (.04,lateral+offset,.535), (.62,.105,.10), seat_black, parent, component, .04)
    seat_loft('Recaro.%s | sculpted shoulder shell' % side,
        [(.53,-.17,lateral,.20,.065),(.65,-.20,lateral,.235,.065),(.88,-.26,lateral,.235,.06),
         (1.015,-.29,lateral,.22,.056),(1.085,-.31,lateral,.165,.05)], seat_black, parent, component)
    seat_loft('Recaro.%s | blue backrest insert' % side,
        [(.59,-.095,lateral,.14,.018),(.8,-.165,lateral,.155,.02),(.97,-.205,lateral,.16,.018),
         (1.035,-.228,lateral,.14,.016)], seat_blue, parent, component)
    for sign in [-1,1]:
        seat_loft('Recaro.%s | torso support' % side,
            [(.58,-.11,lateral+sign*.18,.045,.045),(.76,-.16,lateral+sign*.20,.045,.05),
             (.95,-.235,lateral+sign*.20,.045,.045),(1.045,-.28,lateral+sign*.17,.035,.03)], seat_black, parent, component)
    for offset in [-.075,.075]:
        seat_block('Recaro.%s | headrest post' % side, (-.335,lateral+offset,1.105), (.018,.018,.13), seat_frame, parent, component, .005)
    seat_block('Recaro.%s | adjustable headrest' % side, (-.34,lateral,1.19), (.12,.35,.19), seat_black, parent, component, .045)
    seat_block('Recaro.%s | blue headrest pad' % side, (-.274,lateral,1.19), (.027,.275,.13), seat_blue, parent, component, .018)
    lettering = bpy.data.curves.new('RECARO embroidery | ' + side, 'FONT')
    lettering.body, lettering.align_x, lettering.size = 'RECARO', 'CENTER', .034
    lettering.extrude = .00025
    lettering.materials.append(seat_logo)
    obj = bpy.data.objects.new('Recaro.%s | embroidered RECARO' % side, lettering)
    car_collection.objects.link(obj)
    obj.parent = parent
    obj.location = (-.18,lateral,.987)
    obj.rotation_euler = Matrix(((0,0,1),(1,0,0),(0,1,0))).to_euler()
    bpy.ops.object.select_all(action='DESELECT')
    obj.select_set(True)
    bpy.context.view_layer.objects.active = obj
    bpy.ops.object.convert(target='MESH')
    for key, value in dict(category='car', partId='body', componentId=component, authoredIn='Blender').items():
        obj[key] = value
    made.append(obj)

sys.path.insert(0, str(ROOT / 'scripts'))
from a6_cabin import build_cabin
build_cabin(body=body, panels=panels, empty=empty, mesh=seat_mesh, block=seat_block,
            blue=seat_black, frame=seat_frame)
from a6_engine import build_engine
engine_report = build_engine(body=body, empty=empty, mesh=seat_mesh, block=seat_block, created=made)

# A separate track carcass with the original wheel's bead/axle placement.
rubber = next(mat for mat in bpy.data.materials if 'tyre rubber' in mat.name)
profile = [(.224, -.104), (.235, -.115), (.275, -.116), (.309, -.102), (.317, -.086),
           (.317, -.05), (.314, -.047), (.317, -.044), (.317, .044), (.314, .047),
           (.317, .05), (.317, .086), (.309, .102), (.275, .116), (.235, .115), (.224, .104)]
for corner, (steering, rolling) in wheels.items():
    vertices, faces = [], []
    for i in range(96):
        angle = i * math.tau / 96
        vertices.extend((r * math.cos(angle), axial, r * math.sin(angle)) for r, axial in profile)
    n = len(profile)
    for i in range(96):
        for j in range(n):
            faces.append((i*n+j, ((i+1)%96)*n+j, ((i+1)%96)*n+(j+1)%n, i*n+(j+1)%n))
    mesh = bpy.data.meshes.new('Track tyre | same Audi bead and axle')
    mesh.from_pydata(vertices, [], faces)
    mesh.materials.append(rubber)
    for face in mesh.polygons:
        face.use_smooth = True
    obj = bpy.data.objects.new('A6.%s.tyre-track' % corner, mesh)
    car_collection.objects.link(obj)
    obj.parent = rolling
    for key, value in dict(componentId='tyre', wheelCorner=corner, tyreVariant='track',
                           partId='wheels', authoredIn='Blender', category='car').items():
        obj[key] = value
    made.append(obj)

# Separate, named animation clips, also editable as NLA strips in Blender.
animated = [(key, obj, Vector((spec[2][0], -spec[2][2], spec[2][1])), math.radians(spec[3]))
            for key, obj in panels.items() for spec in [panel_specs[key]]]
animated += [('wheel-spin-' + c, pair[1], Vector((0, -1, 0)), math.tau) for c, pair in wheels.items()]
animated += [('steer-' + c, pair[0], Vector((0, 0, 1)), math.radians(30)) for c, pair in wheels.items() if c[0] == 'F']
for key, obj, axis, angle in animated:
    obj.rotation_euler = (0, 0, 0)
    obj.keyframe_insert(data_path='rotation_euler', frame=1)
    obj.rotation_euler = axis * angle
    obj.keyframe_insert(data_path='rotation_euler', frame=31)
    action = obj.animation_data.action
    action.name = 'A6 | ' + key
    track = obj.animation_data.nla_tracks.new()
    track.name = action.name
    strip = track.strips.new(action.name, 1, action)
    # Clips are available but the editable file and export start assembled.
    track.mute = True
    obj.animation_data.action = None
    obj.rotation_euler = (0, 0, 0)
scene.frame_set(1)
scene.view_layers[0].update()

readme = bpy.data.texts.new('START HERE | Audi A6 C5 rig')
readme.write('''SUPPLIED AUDI A6 C5 AVANT\n\nPacked editable master. The supplied OBJ geometry and interior textures are retained.\nThe original colour-chart reference plane was excluded. Body paint matches the previous website release: linear RGB 0.01 / 0.036 / 0.155.\n\nExpand Audi A6 C5 and choose A6.Hinge.door-fl/fr/rl/rr, hood or tailgate.\nRotate each hinge locally within its Limit Rotation constraint. Door skins, cards, handles, mirrors and glass follow their hinge.\n\nA6.Wheel.FL/FR/RL/RR are axle-centred assemblies. Steer the front parents around local Z.\nA6.Roll.* rotates the rims, tyres, hubs and brake discs around local Y. Calipers and backing plates stay on the steering parent.\nRoad and track tyres are separate alternatives; show one per corner.\nNamed NLA clips are muted initially; unmute the desired clip to preview it.\n\nThe website reads hingeAxis/openAngle and rolling/steering metadata exported as Custom Properties.\nExport the car hierarchy only, Y Up, Custom Properties on. The studio collection is excluded.\n''')

readme.write('\nBLUE RECARO SPORT INTERIOR\nFront seats use reference-inspired sport-seat shells, matching dark-blue inserts and lateral bolsters, separate headrests/rails and embroidered RECARO lettering. The retained rear bench and door cards match; dashboard is navy and headlining is black Alcantara. Dashboard end caps, footwell liners and inner sills stay fixed; complete door cards move with the doors. The open cargo bay has a horizontal floor and the hatch liner follows the tailgate.\n')
readme.write('\n2.7 V6 BITURBO ENGINE\nExpand Engine bay | Audi 2.7 V6 biturbo for separate long block, silver Y intake/cover, badges, twin turbochargers, intake/filter, blue couplers, drive belt/alternator, radiator/fans, reservoirs, hoses and wiring groups. The reference photos are under docs/reference/v6-biturbo; the supplied parts catalogue URL is stored on the assembly. This is a reference-built visual model. Bonnet underside and edge lining move with the hood. Closed-bonnet clearance is measured during the build. The site Engine camera opens the bonnet automatically.\n')
bpy.ops.object.select_all(action='DESELECT')
for obj in car_collection.objects:
    obj.select_set(True)
bpy.context.view_layer.objects.active = car
raw = OUT / 'a6-c5-uncompressed.glb'
bpy.ops.export_scene.gltf(filepath=str(raw), export_format='GLB', use_selection=True,
    export_extras=True, export_yup=True, export_cameras=False, export_lights=False,
    export_animations=True, export_animation_mode='NLA_TRACKS', export_nla_strips_merged_animation_name='A6 clips')

# Clip sampling can leave a front rolling joint rotated in the native file.
# Restore the assembled pose before saving the editable Blender scene.
for _, joint, _, _ in animated:
    joint.rotation_mode = 'XYZ'
    joint.rotation_euler = (0, 0, 0)
scene.frame_set(1)
bpy.context.view_layer.update()

# Studio helpers are deliberately added after exporting the car.
studio = bpy.data.collections.new('Studio | excluded from web export')
scene.collection.children.link(studio)
def move_studio(obj):
    for owner in list(obj.users_collection):
        owner.objects.unlink(obj)
    studio.objects.link(obj)
for location, energy, size in [((3, -4, 6), 1500, 5), ((-4, 3, 5), 1900, 4), ((5, 2, 3), 900, 3)]:
    bpy.ops.object.light_add(type='AREA', location=location)
    lamp = bpy.context.object
    lamp.data.energy, lamp.data.shape, lamp.data.size = energy, 'DISK', size
    lamp.rotation_euler = (Vector((0, 0, .7)) - lamp.location).to_track_quat('-Z', 'Y').to_euler()
    move_studio(lamp)
bpy.ops.object.camera_add(location=(6.6, -7.2, 3.5))
camera = bpy.context.object
camera.rotation_euler = (Vector((0, 0, .72)) - camera.location).to_track_quat('-Z', 'Y').to_euler()
camera.data.lens = 51
scene.camera = camera
move_studio(camera)
scene.world = bpy.data.worlds.new('Neutral showroom')
scene.world.use_nodes = True
scene.world.node_tree.nodes['Background'].inputs[0].default_value = (.15, .18, .24, 1)
scene.world.node_tree.nodes['Background'].inputs[1].default_value = .45
scene.render.engine = 'CYCLES'
scene.cycles.samples = 24
scene.render.resolution_x, scene.render.resolution_y, scene.render.resolution_percentage = 1440, 900, 100
scene.view_settings.view_transform = 'AgX'
for obj in made:
    if obj.get('tyreVariant') == 'track':
        obj.hide_set(True)
        obj.hide_render = True
for screen in bpy.data.screens:
    for area in screen.areas:
        if area.type == 'VIEW_3D':
            area.spaces.active.region_3d.view_distance = 6.5
            area.spaces.active.region_3d.view_location = (0, 0, .75)
            area.spaces.active.region_3d.view_rotation = camera.rotation_euler.to_quaternion()
bpy.ops.object.select_all(action='DESELECT')
panels['door-fl'].select_set(True)
bpy.context.view_layer.objects.active = panels['door-fl']
bpy.ops.file.pack_all()
blend = OUT / 'audi_a6_c5_rigged.blend'
bpy.ops.wm.save_as_mainfile(filepath=str(blend))
report = dict(source=source.name, sha256=hashlib.sha256(source.read_bytes()).hexdigest(),
              blend=str(blend.relative_to(ROOT)).replace('\\', '/'),
              panels=list(panels), wheelCorners=list(wheels), objects=len(made), partition=source_counts,
              paint=dict(color=[.01, .036, .155, 1], metalness=.74, roughness=.28, coatRoughness=.03))
report['interior'] = dict(style='Blue Recaro-style sport interior', frontSeats='Reference-inspired sport seats with matching dark blue inserts and bolsters, adjustable headrests and RECARO embroidery', upholstery='Matching dark blue front seats, rear bench and door cards; black Alcantara headlining', repairs=['Fixed dashboard end caps and footwell liners on both sides', 'Moving door-card shells and inner sills below the original window frames', 'Clear cargo opening with horizontal floor, quarter linings and tailgate-mounted inner trim'])
report['engine'] = engine_report
(OUT / 'import-report.json').write_text(json.dumps(report, indent=2) + '\n')
if args.render:
    scene.render.filepath = str(OUT / 'assembled.png')
    bpy.ops.render.render(write_still=True)
    for key, obj, axis, angle in animated[:6]:
        obj.rotation_euler = axis * angle
    scene.render.filepath = str(OUT / 'open-panels.png')
    bpy.ops.render.render(write_still=True)
print('A6_IMPORT_COMPLETE', json.dumps({k: v for k, v in report.items() if k != 'partition'}), flush=True)
