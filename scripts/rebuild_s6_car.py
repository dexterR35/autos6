"""Build and export only the editable S6, leaving the authored garage untouched.

blender -b --factory-startup --python scripts/rebuild_s6_car.py -- --out-dir PATH
The existing exporter is reused as functions, never executed as a full script.
"""
import argparse
import ast
from collections import defaultdict
import json
from pathlib import Path
import struct
import sys
import time

import bmesh
import bpy
from mathutils import Matrix, Vector

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT / 'scripts'))
from s6c5.build import Builder  # noqa: E402
from s6c5.materials import make_materials  # noqa: E402
from s6c5.meshgen import weld_mesh_normals  # noqa: E402

args = sys.argv[sys.argv.index('--') + 1:] if '--' in sys.argv else []
parser = argparse.ArgumentParser(description=__doc__)
parser.add_argument('--out-dir', type=Path, default=ROOT / 'output' / 'car-refinement' / 'reference-v2')
options = parser.parse_args(args)
DEST = options.out_dir.resolve()
DEST.mkdir(parents=True, exist_ok=True)

started = time.time()
bpy.ops.wm.read_factory_settings(use_empty=True)
scene = bpy.context.scene
scene.unit_settings.system = 'METRIC'
collection = bpy.data.collections.new('10 | 2003 Audi S6 C5 Avant')
scene.collection.children.link(collection)
builder = Builder(collection, make_materials())
car_sources = builder.build()
root = bpy.data.objects.new('S6 | vehicle master - rotate for angle', None)
collection.objects.link(root)
for obj in car_sources:
    obj.parent = root
root['Vehicle'] = '2003 Audi S6 C5 Avant, visual reconstruction from supplied references'
root['Fidelity'] = 'Procedural reconstruction, not an OEM CAD model or a dimensional scan'
bpy.context.view_layer.update()
blend_path = DEST / 'audi_s6_c5_reference_refined.blend'
bpy.ops.wm.save_as_mainfile(filepath=str(blend_path))

# Share naming, PBR conversion, UV preservation, part IDs and decimation with
# the established web exporter. Its top-level garage operations are not run.
tree = ast.parse((ROOT / 'scripts' / 'export_s6_web.py').read_text(encoding='utf-8'))
functions = [node for node in tree.body if isinstance(node, ast.FunctionDef)
             and node.name in {'part_id', 'web_material', 'build_export'}]
assert len(functions) == 3, 'The established car export functions changed; review the helper.'
materials = {}
image_files = []
exec(compile(ast.Module(body=functions, type_ignores=[]), '<shared car exporter>', 'exec'))

for original in list(bpy.data.materials):
    material = web_material(original)
    if 'automotive glazing' in original.name.lower():
        bs = material.node_tree.nodes['Principled BSDF']
        bs.inputs['Base Color'].default_value = (.010, .018, .026, .70)
        bs.inputs['Alpha'].default_value = .70
        bs.inputs['Metallic'].default_value = .08
        bs.inputs['Roughness'].default_value = .07
for obj in car_sources:
    for modifier in obj.modifiers:
        if modifier.type == 'BEVEL':
            modifier.segments = min(modifier.segments, 2)
    if obj.type == 'CURVE':
        obj.data.bevel_resolution = min(obj.data.bevel_resolution, 1)
    if obj.type == 'FONT':
        obj.data.resolution_u = min(obj.data.resolution_u, 4)
bpy.context.view_layer.update()
depsgraph = bpy.context.evaluated_depsgraph_get()
car = build_export(car_sources, 'car')
report = {
    'source': str(blend_path.relative_to(ROOT)) if blend_path.is_relative_to(ROOT) else str(blend_path),
    'coordinates': {'unit': 'metres', 'up': '+Y', 'vehicleNose': '+X', 'driverSide': '+Z', 'ground': 0},
    'car': car,
    'buildSeconds': round(time.time() - started, 2),
    'notes': ['Car-only rebuild; existing garage GLB and original Blender scenes are unchanged.',
              'Original references guide geometry and finish; this is not a photogrammetry scan.'],
}
(DEST / 'car-source-info.json').write_text(json.dumps(report, indent=2) + '\n', encoding='utf-8')
for image_path in image_files:
    image_path.unlink(missing_ok=True)
print('CAR_ONLY_EXPORT_COMPLETE', json.dumps(report), flush=True)
