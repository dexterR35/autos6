"""Materials of the S6 model.

Names matter: scripts/export_s6_web.py recognises some of them ('deep blue
pearl', 'automotive glazing', 'clear lightly blue lens', 'red lamp lens',
'gloss black roof box') and swaps in browser-friendly settings.
"""
from pathlib import Path

import bpy

TEXTURES = Path(__file__).resolve().parent / 'textures'


def principled(name, color, metal=0.0, rough=0.4, coat=0.0, coat_rough=0.05, alpha=1.0,
               emission=None, strength=0.0, transmission=0.0, ior=1.45):
    m = bpy.data.materials.new(name)
    m.use_nodes = True
    bs = m.node_tree.nodes['Principled BSDF']
    bs.inputs['Base Color'].default_value = (*color, 1)
    bs.inputs['Metallic'].default_value = metal
    bs.inputs['Roughness'].default_value = rough
    bs.inputs['Coat Weight'].default_value = coat
    bs.inputs['Coat Roughness'].default_value = coat_rough
    bs.inputs['IOR'].default_value = ior
    if transmission:
        bs.inputs['Transmission Weight'].default_value = transmission
    if alpha < 1:
        bs.inputs['Alpha'].default_value = alpha
        m.surface_render_method = 'BLENDED'
    if emission:
        bs.inputs['Emission Color'].default_value = (*emission, 1)
        bs.inputs['Emission Strength'].default_value = strength
    m.diffuse_color = (*color, alpha)
    m.metallic = metal
    m.roughness = rough
    return m


def textured(name, image_path, rough=0.35, metal=0.0, coat=0.0):
    m = principled(name, (1, 1, 1), metal, rough, coat)
    nodes, links = m.node_tree.nodes, m.node_tree.links
    tex = nodes.new('ShaderNodeTexImage')
    tex.image = bpy.data.images.load(str(image_path), check_existing=True)
    tex.interpolation = 'Cubic'
    uv = nodes.new('ShaderNodeUVMap')
    uv.uv_map = 'UVMap'
    links.new(uv.outputs['UV'], tex.inputs['Vector'])
    links.new(tex.outputs['Color'], nodes['Principled BSDF'].inputs['Base Color'])
    m.diffuse_color = (0.9, 0.9, 0.9, 1)
    return m


def make_materials():
    # Deep navy pearl sampled from the reference photographs (midtones around
    # sRGB 6/21/46): metallic flakes under a separate, mirror-smooth clearcoat.
    paint = principled('S6 | deep blue pearl with polished clearcoat', (0.0032, 0.0115, 0.056), 0.78, 0.34, 1.0, 0.018)
    n = paint.node_tree.nodes
    links = paint.node_tree.links
    bs = n['Principled BSDF']
    coord = n.new('ShaderNodeTexCoord')
    flakes = n.new('ShaderNodeTexVoronoi')
    flakes.inputs['Scale'].default_value = 2600
    links.new(coord.outputs['Object'], flakes.inputs['Vector'])
    centre = n.new('ShaderNodeVectorMath')
    centre.operation = 'SUBTRACT'
    centre.inputs[1].default_value = (0.5, 0.5, 0.5)
    links.new(flakes.outputs['Color'], centre.inputs[0])
    tilt = n.new('ShaderNodeVectorMath')
    tilt.operation = 'SCALE'
    tilt.inputs['Scale'].default_value = 0.28
    links.new(centre.outputs['Vector'], tilt.inputs[0])
    geo = n.new('ShaderNodeNewGeometry')
    add = n.new('ShaderNodeVectorMath')
    add.operation = 'ADD'
    links.new(geo.outputs['Normal'], add.inputs[0])
    links.new(tilt.outputs['Vector'], add.inputs[1])
    norm = n.new('ShaderNodeVectorMath')
    norm.operation = 'NORMALIZE'
    links.new(add.outputs['Vector'], norm.inputs[0])
    # Flakes tilt only the base layer; the clearcoat keeps the true surface normal.
    links.new(norm.outputs['Vector'], bs.inputs['Normal'])
    links.new(geo.outputs['Normal'], bs.inputs['Coat Normal'])
    bs.inputs['Coat Tint'].default_value = (0.92, 0.95, 1.0, 1)
    paint.diffuse_color = (0.02, 0.06, 0.2, 1)

    glass = principled('S6 | lightly tinted automotive glazing', (0.40, 0.46, 0.50), 0, 0.02, 0.0, transmission=1.0, ior=1.52)
    glass.diffuse_color = (0.02, 0.03, 0.045, 1)
    lens = principled('S6 | clear lightly blue lens', (0.86, 0.92, 0.98), 0, 0.02, 0.4, transmission=1.0, ior=1.49)
    lens.diffuse_color = (0.55, 0.6, 0.65, 0.35)
    red_lens = principled('S6 | red lamp lens', (0.75, 0.02, 0.03), 0, 0.03, 0.4, transmission=0.92, ior=1.49)
    red_lens.diffuse_color = (0.45, 0.01, 0.02, 1)
    plate = textured('S6 | registration plate B 08046', TEXTURES / 'plate-ro-b08046.png', 0.32)
    return {
        'paint': paint,
        'glass': glass,
        'lens': lens,
        'red_lens': red_lens,
        'plate': plate,
        'frit': principled('S6 | black ceramic glass frit', (0.004, 0.004, 0.005), 0.0, 0.06, 0.6, 0.03),
        'black': principled('S6 | black window trim and seals', (0.008, 0.009, 0.011), 0.1, 0.35),
        'seam': principled('S6 | recessed panel gaps', (0.002, 0.003, 0.005), 0.0, 0.6),
        'plastic': principled('S6 | textured black bumper plastic', (0.012, 0.013, 0.015), 0.0, 0.55),
        'grille': principled('S6 | gloss black grille mesh', (0.006, 0.007, 0.009), 0.2, 0.22),
        'liner': principled('S6 | wheel arch liner', (0.015, 0.015, 0.016), 0, 0.85),
        'chrome': principled('S6 | polished chrome', (0.86, 0.88, 0.9), 1.0, 0.06),
        'alloy': principled('S6 | satin aluminium trim', (0.6, 0.62, 0.65), 0.9, 0.25),
        'reflector': principled('S6 | lamp chrome reflector', (0.8, 0.82, 0.85), 1.0, 0.12),
        'lamp_dark': principled('S6 | lamp housing dark grey', (0.035, 0.037, 0.042), 0.3, 0.4),
        'lamp_white': principled('S6 | headlamp phosphor white', (0.9, 0.95, 1.0), 0, 0.3, emission=(0.86, 0.93, 1.0), strength=6.0),
        'lamp_red': principled('S6 | tail lamp red glow', (0.6, 0.0, 0.01), 0, 0.4, emission=(1.0, 0.02, 0.03), strength=5.0),
        'lamp_amber': principled('S6 | indicator amber', (0.9, 0.35, 0.02), 0.2, 0.3),
        'lamp_reverse': principled('S6 | reverse lamp white glow', (0.9, 0.9, 0.9), 0, 0.3, emission=(1.0, 0.92, 0.85), strength=3.0),
        'badge_red': principled('S6 | badge red enamel', (0.55, 0.006, 0.016), 0.1, 0.2, 0.6),
        'rubber': principled('S6 | satin tyre rubber', (0.016, 0.017, 0.019), 0, 0.62),
        'wheel': principled('S6 | graphite satin wheel finish', (0.07, 0.075, 0.08), 0.85, 0.32, 0.5, 0.12),
        'wheel_lip': principled('S6 | machined wheel lip', (0.36, 0.37, 0.39), 1.0, 0.18),
        'disc': principled('S6 | machined brake steel', (0.40, 0.40, 0.41), 1.0, 0.26),
        'caliper': principled('S6 | red brake caliper', (0.56, 0.010, 0.014), 0.0, 0.32, 1.0, 0.06),
        'caliper_logo': principled('S6 | caliper lettering white', (0.85, 0.85, 0.84), 0.0, 0.35),
        'pad': principled('S6 | brake pad friction compound', (0.035, 0.034, 0.033), 0.0, 0.85),
        'backing': principled('S6 | brake pad backing plate', (0.10, 0.10, 0.11), 0.7, 0.45),
        'hat': principled('S6 | rotor hat dark zinc', (0.08, 0.085, 0.09), 0.8, 0.45),
        'leather': principled('S6 | anthracite leather upholstery', (0.024, 0.026, 0.03), 0, 0.55),
        'cabin': principled('S6 | dark cabin trim', (0.012, 0.013, 0.015), 0, 0.7),
        'box': principled('S6 | gloss black roof box', (0.004, 0.005, 0.007), 0.5, 0.12, 1.0, 0.04),
    }
