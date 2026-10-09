"""Export the authored S6 and workshop as efficient, orbitable web assets.

Run with Blender in background mode. The .blend source is only read. Geometry
is evaluated, grouped by material/interactive part and simplified in memory.
The glTF coordinate contract is metres, Y up, vehicle nose +X, driver side +Z.
"""
from collections import defaultdict
import json
from pathlib import Path
import struct
import sys

import bmesh
import bpy
from mathutils import Matrix, Vector


ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT / 'scripts'))
from s6c5.meshgen import weld_mesh_normals  # noqa: E402

SOURCE = ROOT / 'output/s6/audi_s6_c5_2003.blend'
DEST = ROOT / 'public/models'
DEST.mkdir(parents=True, exist_ok=True)
bpy.ops.wm.open_mainfile(filepath=str(SOURCE))
scene = bpy.context.scene
car_collection = bpy.data.collections['10 | 2003 Audi S6 C5 Avant']
car_sources = [o for o in car_collection.all_objects if o.type in {'MESH', 'CURVE', 'FONT'}]
garage_sources = [o for c in scene.collection.children if c.name[:2] in {'01', '02', '03', '04', '05', '06', '07', '08'}
                  for o in c.all_objects if o.type in {'MESH', 'CURVE', 'FONT'}]
master = bpy.data.objects['S6 | vehicle master - rotate for angle']
master.location = (0, 0, 0)
master.rotation_euler = (0, 0, 0)
bpy.context.view_layer.update()

# The still-render scene put carts, drums and jacks in the foreground. Place
# those complete assemblies along the workshop walls for a clear 360° orbit.
# Its previous per-mesh placement split three crate slats from their crate;
# restore that assembly before relocating the workshop equipment together.
relocated_props = 0
for obj in garage_sources:
    if not any(c.name[:2] in {'04', '05'} for c in obj.users_collection):
        continue
    center = sum((obj.matrix_world @ Vector(v) for v in obj.bound_box), Vector()) / 8
    if center.y >= -1.8:
        continue
    if obj.name.startswith('Crate side slat') and center.x < 5 and center.y > -2.6:
        obj.location.x += 2.7
    obj.location.x += 4.0 if center.x > 0 else -5.6
    relocated_props += 1
bpy.context.view_layer.update()
print('RELOCATED_FOREGROUND_PROPS', relocated_props, flush=True)


def part_id(name):
    name = name.lower()
    if name.startswith('accessory'):
        return 'roof-box'
    if 'exhaust' in name:
        return 'exhaust'
    if any(term in name for term in ('brake', 'caliper', 'rotor')):
        return 'brake-kit'
    if ' wheel |' in name:
        return 'wheels'
    if 'bonnet' in name:
        return 'hood'
    if any(term in name for term in ('front bumper', 'lower grille', 'upper grille', 'bumper ', 'headlamp', 'front plate', 'grille badge', 'front audi')):
        return 'front-bumper'
    if any(term in name for term in ('rear bumper', 'rear plate', 'tail lamp', 'tailgate')):
        return 'rear-bumper'
    if any(term in name for term in ('lower door molding', 'underbody', 'side skirt')):
        return 'side-skirts'
    return 'body'


materials = {}
image_files = []


def web_material(original):
    if original.name in materials:
        return materials[original.name]
    name = original.name
    lower = name.lower()
    mat = bpy.data.materials.new(name + ' | web')
    mat.use_nodes = True
    bs = mat.node_tree.nodes.get('Principled BSDF')
    source_bs = next((n for n in original.node_tree.nodes if n.type == 'BSDF_PRINCIPLED'), None) if original.use_nodes else None
    if source_bs:
        for key in ['Base Color', 'Metallic', 'Roughness', 'Coat Weight', 'Coat Roughness', 'IOR', 'Emission Color', 'Emission Strength']:
            bs.inputs[key].default_value = source_bs.inputs[key].default_value
        base = source_bs.inputs['Base Color']
        if base.is_linked and base.links[0].from_node.type == 'TEX_IMAGE':
            source_image = base.links[0].from_node.image
            image = source_image.copy()
            if max(image.size) > 1024:
                scale = 1024 / max(image.size)
                image.scale(round(image.size[0] * scale), round(image.size[1] * scale))
            # Pre-encode to a regular workspace file and reload so glTF embeds
            # existing JPEG bytes. Blender's tempfile directory uses Windows
            # permissions that prevent sandboxed image writers accessing it.
            image_path = DEST / ('.export-texture-' + str(len(image_files)) + '.jpg')
            image.filepath_raw = str(image_path)
            image.file_format = 'JPEG'
            image.save(quality=82)
            image_files.append(image_path)
            image = bpy.data.images.load(str(image_path), check_existing=False)
            node = mat.node_tree.nodes.new('ShaderNodeTexImage')
            node.image = image
            mat.node_tree.links.new(node.outputs['Color'], bs.inputs['Base Color'])
    else:
        bs.inputs['Base Color'].default_value = original.diffuse_color
    if 'wet concrete' in lower:
        bs.inputs['Base Color'].default_value = (.010, .014, .021, 1)
        bs.inputs['Metallic'].default_value = .08
        bs.inputs['Roughness'].default_value = .39
        bs.inputs['Coat Weight'].default_value = .20
        bs.inputs['Coat Roughness'].default_value = .23
    if 'wall | aged concrete' in lower:
        bs.inputs['Base Color'].default_value = (.032, .038, .048, 1)
        bs.inputs['Roughness'].default_value = .92
    if 'ceiling | soot' in lower:
        bs.inputs['Base Color'].default_value = (.014, .019, .028, 1)
        bs.inputs['Metallic'].default_value = .12
        bs.inputs['Roughness'].default_value = .83
    if 'deep blue pearl' in lower:
        bs.inputs['Base Color'].default_value = (.010, .034, .118, 1)
        bs.inputs['Metallic'].default_value = .75
        bs.inputs['Roughness'].default_value = .18
        bs.inputs['Coat Weight'].default_value = 1
        bs.inputs['Coat Roughness'].default_value = .065
    if 'gloss black roof' in lower:
        bs.inputs['Coat Weight'].default_value = 1
        bs.inputs['Roughness'].default_value = .15
    # Alpha glazing avoids the expensive full-scene transmission pass while
    # retaining real seat/dashboard geometry and sharp environment reflections.
    if 'automotive glazing' in lower:
        bs.inputs['Base Color'].default_value = (.055, .10, .14, .48)
        bs.inputs['Alpha'].default_value = .48
        bs.inputs['Metallic'].default_value = .3
        bs.inputs['Roughness'].default_value = .095
        bs.inputs['Coat Weight'].default_value = 1
        mat.surface_render_method = 'BLENDED'
    if 'red lamp lens' in lower:
        bs.inputs['Base Color'].default_value = (.62, .015, .025, .55)
        bs.inputs['Alpha'].default_value = .55
        bs.inputs['Roughness'].default_value = .05
        bs.inputs['Coat Weight'].default_value = .6
        mat.surface_render_method = 'BLENDED'
    if 'clear lightly blue lens' in lower:
        bs.inputs['Base Color'].default_value = (.76, .86, .94, .08)
        bs.inputs['Alpha'].default_value = .08
        bs.inputs['Roughness'].default_value = .055
        bs.inputs['Coat Weight'].default_value = .6
        mat.surface_render_method = 'BLENDED'
    if 'phosphor' in lower:
        bs.inputs['Emission Strength'].default_value = 3.2
    if 'diffuser' in lower or 'worklamp glass' in lower:
        bs.inputs['Emission Strength'].default_value = 2.5
    mat.diffuse_color = bs.inputs['Base Color'].default_value
    mat.use_backface_culling = False
    materials[original.name] = mat
    return mat


for original in list(bpy.data.materials):
    web_material(original)

# Small round cables and fabricated bevels need fewer segments in the browser.
# The source file keeps all its original subdivisions and modifiers.
for obj in car_sources + garage_sources:
    for modifier in obj.modifiers:
        if modifier.type == 'BEVEL':
            modifier.segments = min(modifier.segments, 2)
    if obj.type == 'CURVE':
        obj.data.bevel_resolution = min(obj.data.bevel_resolution, 1)
    if obj.type == 'FONT':
        obj.data.resolution_u = min(obj.data.resolution_u, 4)
bpy.context.view_layer.update()
depsgraph = bpy.context.evaluated_depsgraph_get()


def build_export(sources, category):
    collection = bpy.data.collections.new('Web export | ' + category)
    scene.collection.children.link(collection)
    groups = defaultdict(list)
    offset = Matrix.Translation((0, 5.5, 0)) if category == 'garage' else Matrix.Identity(4)
    for index, source in enumerate(sources):
        evaluated = source.evaluated_get(depsgraph)
        mesh = bpy.data.meshes.new_from_object(evaluated, preserve_all_data_layers=True, depsgraph=depsgraph)
        if not mesh.polygons:
            bpy.data.meshes.remove(mesh)
            continue
        mesh.transform(offset @ source.matrix_world)
        # Exact surface normals that agree around a vertex become one normal,
        # so the glTF exporter can share the vertex.
        weld_mesh_normals(mesh)
        if category == 'car':
            # Parameter-space UVs are a modelling aid; only the plates are textured.
            for layer in [l for l in mesh.uv_layers if l.name != 'UVMap']:
                mesh.uv_layers.remove(layer)
        # Preserve the native UVs of the flags, posters and plates when
        # evaluating and joining their geometry. Meshes with several material
        # slots (bumpers with black lips, lamp lenses with clear bands) are
        # split into one mesh per material first.
        slots = [m for m in mesh.materials] or [None]
        used = sorted({p.material_index for p in mesh.polygons})
        for index in used:
            original = slots[index] if index < len(slots) and slots[index] is not None else None
            if original is None:
                original = bpy.data.materials['Black recess']
            if len(used) > 1:
                piece = mesh.copy()
                bm = bmesh.new()
                bm.from_mesh(piece)
                bmesh.ops.delete(bm, geom=[f for f in bm.faces if f.material_index != index], context='FACES')
                bm.to_mesh(piece)
                bm.free()
            else:
                piece = mesh
            piece.materials.clear()
            piece.materials.append(web_material(original))
            for poly in piece.polygons:
                poly.material_index = 0
            part = part_id(source.name) if category == 'car' else ('floor' if 'wet concrete' in original.name.lower() else 'room')
            obj = bpy.data.objects.new(source.name + ' | evaluated', piece)
            collection.objects.link(obj)
            groups[(original.name, part)].append(obj)
        if index % 750 == 0:
            print('EVALUATED', category, index, '/', len(sources), flush=True)

    merged = []
    for (material_name, part), objects in groups.items():
        bpy.ops.object.select_all(action='DESELECT')
        for obj in objects:
            obj.select_set(True)
        bpy.context.view_layer.objects.active = objects[0]
        if len(objects) > 1:
            bpy.ops.object.join()
        obj = bpy.context.view_layer.objects.active
        obj.name = ('S6' if category == 'car' else 'Garage') + ' | ' + part + ' | ' + material_name
        obj['category'] = category
        if category == 'car':
            obj['partId'] = part
        elif part == 'floor':
            obj['surface'] = 'floor'
        # Collapse redundant curved surface tessellation, preserving all major
        # car silhouettes, roof-box geometry, lettering and printed artwork.
        triangles = sum(len(p.vertices) - 2 for p in obj.data.polygons)
        textured = any(n.type == 'TEX_IMAGE' for n in obj.data.materials[0].node_tree.nodes)
        ratio = 1.0
        # Thin trims, seams, badges and lettering keep every face; only large
        # smooth surfaces of the car are simplified.
        if category == 'car' and triangles > 12000:
            ratio = .5
        elif category == 'garage' and triangles > 4000:
            ratio = .22 if not textured else .35
        if ratio < 1:
            modifier = obj.modifiers.new('Web surface simplification', 'DECIMATE')
            modifier.ratio = ratio
            modifier.use_collapse_triangulate = True
            bpy.ops.object.modifier_apply(modifier=modifier.name)
        # Decimation can collapse very small label faces. Clean those before
        # export; glTF's exporter performs the same validation internally.
        obj.data.validate()
        obj.data.update()
        merged.append(obj)
    bpy.ops.object.select_all(action='DESELECT')
    for obj in merged:
        obj.select_set(True)
    bpy.context.view_layer.objects.active = merged[0]
    filename = 's6-c5.glb' if category == 'car' else 'garage.glb'
    path = DEST / filename
    print('EXPORTING', category, len(merged), 'material/part groups', flush=True)
    bpy.ops.export_scene.gltf(
        filepath=str(path), export_format='GLB', use_selection=True,
        export_yup=True, export_apply=True, export_texcoords=True,
        export_normals=True, export_tangents=False, export_cameras=False,
        export_lights=False, export_extras=True, export_animations=False,
        export_materials='EXPORT', export_image_format='JPEG',
        export_jpeg_quality=82, export_attributes=False,
    )
    # Read back the actual GLB, including accessor bounds after glTF conversion.
    data = path.read_bytes()
    magic, version, length = struct.unpack_from('<III', data, 0)
    assert magic == 0x46546C67 and version == 2 and length == len(data)
    json_length, json_type = struct.unpack_from('<II', data, 12)
    assert json_type == 0x4E4F534A
    gltf = json.loads(data[20:20 + json_length])
    primitives = [p for mesh in gltf['meshes'] for p in mesh['primitives']]
    minimum, maximum = [float('inf')] * 3, [float('-inf')] * 3
    for primitive in primitives:
        accessor = gltf['accessors'][primitive['attributes']['POSITION']]
        for axis in range(3):
            minimum[axis] = min(minimum[axis], accessor['min'][axis])
            maximum[axis] = max(maximum[axis], accessor['max'][axis])
    report = {
        'file': '/models/' + filename,
        'bytes': len(data),
        'meshes': len(gltf['meshes']),
        'drawCalls': len(primitives),
        'triangles': sum(gltf['accessors'][p['indices']]['count'] // 3 for p in primitives),
        'bounds': {'min': minimum, 'max': maximum},
        'materials': len(gltf.get('materials', [])),
        'parts': sorted({n['extras']['partId'] for n in gltf['nodes'] if n.get('extras', {}).get('partId')}),
        'extensions': gltf.get('extensionsUsed', []),
    }
    print('EXPORTED', json.dumps(report), flush=True)
    # Keep completed assets hidden while gathering/exporting the other scene.
    for obj in merged:
        obj.hide_set(True)
    return report


report = {
    'source': 'output/s6/audi_s6_c5_2003.blend',
    'coordinates': {'unit': 'metres', 'up': '+Y', 'vehicleNose': '+X', 'driverSide': '+Z', 'ground': 0},
    'foregroundPropsRelocated': relocated_props,
    'car': build_export(car_sources, 'car'),
    'garage': build_export(garage_sources, 'garage'),
    'notes': ['Procedural visual reconstruction, not OEM CAD.', 'Original authored Blender file preserved.', 'No exported lights or cameras; web scene supplies lighting.', 'PBR approximations replace unsupported procedural Blender shaders.'],
}
(DEST / 'scene-info.json').write_text(json.dumps(report, indent=2), encoding='utf-8')
for image_path in image_files:
    image_path.unlink()
print('WEB_EXPORT_COMPLETE', flush=True)
