"""C5 facelift S6 front: headlamps, chrome-framed grille, intakes, fog lamps, plate."""
import math

import bpy
import numpy as np
from mathutils import Matrix

from .features import densify
from .meshgen import Region, mesh_from_arrays, param_mesh
from .util import disc_ring, frame_from_normal, inside, runs, torus


def horizontal(n):
    h = np.array([n[0], n[1], 0.0])
    return h / np.linalg.norm(h)


def boundary_runs(poly, s_min=0.0, step=0.004):
    """Closed (s, z) boundary split into runs with s >= s_min; ends land exactly on s_min."""
    P = densify(poly, step)
    P = np.vstack([P, P[:1]])
    keep = P[:, 0] >= s_min
    out = []
    for r in runs(keep):
        pts = [P[i] for i in r]
        i0, i1 = r[0], r[-1]
        if i0 > 0 and not keep[i0 - 1]:
            a, b = P[i0 - 1], P[i0]
            pts.insert(0, a + (b - a) * (s_min - a[0]) / (b[0] - a[0]))
        if i1 < len(P) - 1 and not keep[i1 + 1]:
            a, b = P[i1], P[i1 + 1]
            pts.append(a + (b - a) * (s_min - a[0]) / (b[0] - a[0]))
        out.append(np.array(pts))
    return out


def plate(B, name, centre, normal, material, holder_mat, width=0.52, height=0.11):
    """Flat registration plate with UVs, on a slightly larger black holder."""
    r, u, n = frame_from_normal(normal)
    if np.dot(r, [0, 1, 0]) * np.sign(normal[0]) < 0:
        r = -r
    hw, hh = width / 2, height / 2
    verts = [centre + r * a * hw + u * b * hh for a, b in [(-1, -1), (1, -1), (1, 1), (-1, 1)]]
    me = bpy.data.meshes.new(name)
    me.from_pydata([tuple(v) for v in verts], [], [(0, 1, 2, 3)])
    me.update()
    uv = me.uv_layers.new(name='UVMap')
    for loop, coord in zip(me.loops, [(0, 0), (1, 0), (1, 1), (0, 1)]):
        uv.data[loop.index].uv = coord
    me.materials.append(material)
    obj = bpy.data.objects.new(name, me)
    if np.dot(np.cross(r, u), n) < 0:
        me.flip_normals()
    B.link(obj)
    hold = []
    hw2, hh2, d = hw + 0.008, hh + 0.008, 0.008
    for c in (centre - n * 0.0006, centre - n * d):
        hold += [c + r * a * hw2 + u * b * hh2 for a, b in [(-1, -1), (1, -1), (1, 1), (-1, 1)]]
    faces = [(0, 1, 2, 3), (0, 4, 5, 1), (1, 5, 6, 2), (2, 6, 7, 3), (3, 7, 4, 0)]
    B.link(mesh_from_arrays(name + ' holder', hold, faces, holder_mat, smooth=False))
    return obj


def text_badge(B, name, body, centre, normal, size, material, font='C:/Windows/Fonts/ariblk.ttf', extrude=0.0012, flip=False):
    """Raised lettering facing along normal; text reads left to right for a viewer facing the car."""
    data = bpy.data.curves.new(name, 'FONT')
    data.body = body
    try:
        data.font = bpy.data.fonts.load(font, check_existing=True)
    except (RuntimeError, OSError):
        pass
    data.align_x = 'CENTER'
    data.align_y = 'CENTER'
    data.size = size
    data.extrude = extrude
    data.bevel_depth = 0.0
    data.resolution_u = 3
    data.materials.append(material)
    obj = bpy.data.objects.new(name, data)
    # frame_from_normal's r is the right-hand side of a viewer facing the badge.
    right, u, n = frame_from_normal(normal)
    if flip:
        right = -right
    m = Matrix(((right[0], u[0], n[0]), (right[1], u[1], n[1]), (right[2], u[2], n[2])))
    obj.matrix_world = m.to_4x4()
    obj.location = tuple(centre)
    B.collection.objects.link(obj)
    B.parts.append(obj)
    return obj


def s6_badge(B, name, centre, normal, height, metal, red, flip=False):
    """'S6' lettering with the red slash in front of it."""
    right, u, n = frame_from_normal(normal)
    if flip:
        right = -right
    text_badge(B, name + ' lettering', 'S6', centre + right * height * 0.18, normal, height * 1.25, metal, flip=flip)
    h = height * 0.5
    c = centre - right * height * 0.62
    quad = [c + right * (-0.35 * h) + u * -h, c + right * (0.05 * h) + u * -h, c + right * (0.45 * h) + u * h, c + right * (0.05 * h) + u * h]
    verts = [q + n * 0.0012 for q in quad] + [q for q in quad]
    faces = [(0, 1, 2, 3), (4, 0, 3, 7), (5, 6, 2, 1), (4, 5, 1, 0), (3, 2, 6, 7)]
    B.link(mesh_from_arrays(name + ' red slash', verts, faces, red, smooth=False))


def audi_rings(B, name, centre, normal, radius, tube_r, material, up=(0, 0, 1)):
    r, u, n = frame_from_normal(normal, up)
    spacing = radius * 1.37
    for i in range(4):
        c = centre + r * (i - 1.5) * spacing
        B.link(torus('%s %d' % (name, i + 1), c, r, u, n, radius, tube_r, material, 72, 10, squash=0.75))


def headlamps(B):
    b, lay, m = B.body, B.lay, B.m
    lamp = B.inset('S6 | headlamp', lay.headlamp_lens, 0.12, m['lamp_silver'], m['lamp_dark'], lens_mat=m['lens'],
                   lens_inset=0.0012, step=0.008)
    sf = b.s_front
    # Two main reflector/projector units inside a single silver C5 assembly.
    # The outer corner is a faceted indicator, rather than a third round lamp.
    units = [('inner high beam', 0.523, 0.691, 0.068, 0.060),
             ('centre projector', 0.681, 0.690, 0.065, 0.053)]
    outline = B.sv_poly(lay.headlamp_lens, 0.008)
    uv = np.asarray(outline)
    holes = []
    for _, y, z, bowl, _ in units:
        sc = float(sf(y))
        circle = [(sc + (bowl + .006) * math.cos(a), z + (bowl + .006) * math.sin(a))
                  for a in np.linspace(0, math.tau, 48, endpoint=False)]
        holes.append(Region(B.sv_poly(circle, .006), 'hole'))
    # Bring the shaped reflector carrier close to the cover. A deep, empty
    # recess made the previous exported lamps look like loose circles in paint.
    mapper = lambda s, v: b.wall(s, v) - b.wall_out(s, v) * .028
    carrier = param_mesh('S6 | headlamp sculpted silver reflector carrier',
                         np.linspace(uv[:, 0].min() - .001, uv[:, 0].max() + .001, 56),
                         np.linspace(uv[:, 1].min() - .001, uv[:, 1].max() + .001, 25),
                         mapper, regions=holes, keep=outline, materials=[m['lamp_silver']])
    B.link(carrier, mirror=True)
    B.wall_line('S6 | headlamp black perimeter gasket', lay.headlamp_lens, .0030, m['black'],
                offset=.0005, closed=True, clip_holes=False, flatten=.55)
    B.wall_line('S6 | headlamp polished perimeter trim', lay.headlamp_lens, .0013, m['chrome'],
                offset=.002, closed=True, clip_holes=False, flatten=.55)
    for label, y, z, bowl, lens_r in units:
        s = float(sf(y))
        p, n = B.frame_at(s, z)
        f = horizontal(n)
        rr, uu, nn = frame_from_normal(f)
        c = p - n * 0.030
        is_reflector = label == 'inner high beam'
        B.link(disc_ring('S6 | headlamp ' + label + ' chrome bowl', c - f * 0.023, rr, uu, nn,
                         [(0.006, -0.018), (bowl * 0.32, -0.015), (bowl * 0.64, -0.007),
                          (bowl * 0.88, 0.006), (bowl, 0.017), (bowl + 0.003, 0.018)],
                         m['reflector'], 32 if is_reflector else 56,
                         smooth=not is_reflector), mirror=True)
        B.link(disc_ring('S6 | headlamp ' + label + ' bezel', c, rr, uu, nn,
                         [(lens_r + 0.002, -0.003), (lens_r + 0.006, 0.0), (lens_r + 0.006, 0.004), (lens_r + 0.001, 0.006)],
                         m['chrome'], 48), mirror=True)
        B.link(disc_ring('S6 | headlamp ' + label + ' lens', c, rr, uu, nn,
                         [(0.0005, 0.006 + lens_r * 0.25), (lens_r * 0.5, 0.006 + lens_r * 0.20), (lens_r * 0.85, 0.006 + lens_r * 0.10), (lens_r, 0.004)],
                         m['lens'], 48), mirror=True)
        if is_reflector:
            # The high beam has a small bulb in a broad chrome bowl, not the
            # luminous radial spokes of a second projector assembly.
            B.link(disc_ring('S6 | headlamp high beam bulb', c - f * .021, rr, uu, nn,
                             [(0.0005, .002), (.0055, .002), (.0065, -.003)],
                             m['lamp_white'], 24), mirror=True)
        else:
            B.link(disc_ring('S6 | headlamp projector illuminated rim', c - f * 0.004, rr, uu, nn,
                             [(lens_r * .91, 0.0), (lens_r * .98, 0.0)], m['lamp_white'], 48), mirror=True)
    # Segmented reflector prism and amber strip in the outer lens corner.
    for k, y in enumerate(np.linspace(.754, .812, 10)):
        sc = float(sf(y))
        z0, z1 = .627 + k * .0015, .755 + k * .0005
        B.wall_line('S6 | headlamp indicator reflector prism %02d' % k,
                    [(sc, z0), (sc + .005, (z0 + z1) / 2), (sc, z1)], .0033,
                    m['reflector'], offset=-.018, mirror=True, clip_holes=False, step=.005)
    indicator = [(float(sf(.785)), .641), (float(sf(.798)), .645),
                 (float(sf(.798)), .744), (float(sf(.785)), .744)]
    B.wall_line('S6 | headlamp outer amber reflector', indicator, .0028, m['lamp_amber'],
                offset=-.017, closed=True, clip_holes=False, flatten=.6)
    # Polished divider and the amber indicator in the outer corner.
    pts = [(float(sf(y)), 0.625) for y in np.linspace(0.445, 0.79, 30)]
    pos = b.on_wall(np.array(pts), -0.03)
    from .meshgen import tube
    B.link(tube('S6 | headlamp chrome divider', pos, 0.004, m['reflector'], sides=8), mirror=True)
    p, n = B.frame_at(float(sf(.793)), 0.710)
    rr, uu, nn = frame_from_normal(horizontal(n))
    B.link(disc_ring('S6 | headlamp indicator bulb', p - n * 0.045, rr, uu, nn,
                     [(0.0005, 0.012), (0.012, 0.008), (0.014, -0.004), (0.004, -0.01)], m['lamp_amber'], 24), mirror=True)
    return lamp


def grille(B):
    b, lay, m = B.body, B.lay, B.m
    B.inset('S6 | upper grille opening', lay.grille, 0.06, m['grille'], m['grille'], step=0.01)
    B.opening_bars('S6 | upper grille mesh horizontal', lay.grille, m['grille'], 0.014, 0.0195, None, 0.0022, 0.008)
    B.opening_bars('S6 | upper grille mesh vertical', lay.grille, m['grille'], 0.016, None, 0.0195, 0.0018, 0.008)
    from .meshgen import tube
    for k, run in enumerate(boundary_runs(lay.grille)):
        pos = b.on_wall(run, 0.0015)
        B.link(tube('S6 | upper grille chrome surround %d' % k, pos, 0.0075, m['chrome'], sides=10), mirror=True)
    z0, z1 = lay.grille_z
    zc = (z0 + z1) / 2 + 0.004
    p, n = B.frame_at(0.0, zc, -0.002)
    audi_rings(B, 'S6 | front audi rings ring', p, n, 0.045, 0.0045, m['chrome'])
    # S6 badge at the lower left of the grille (the car's right-hand side).
    y = 0.215
    p, n = B.frame_at(float(b.s_front(y)), z0 + 0.03, 0.002)
    p[1], n[1] = -p[1], -n[1]
    plaque = []
    right, uu, nn = frame_from_normal(n)
    for d in (0.0, -0.004):
        plaque += [p + nn * d + right * a * 0.045 + uu * c * 0.014 for a, c in [(-1, -1), (1, -1), (1, 1), (-1, 1)]]
    faces = [(0, 1, 2, 3), (4, 0, 3, 7), (5, 6, 2, 1), (4, 5, 1, 0), (3, 2, 6, 7)]
    B.link(mesh_from_arrays('S6 | grille badge black plaque', plaque, faces, m['grille'], smooth=False))
    s6_badge(B, 'S6 | grille badge S6', p + nn * 0.0005, n, 0.019, m['chrome'], m['badge_red'])


def intakes(B):
    b, lay, m = B.body, B.lay, B.m
    B.inset('S6 | lower grille centre', lay.intake_centre, 0.07, m['plastic'], m['plastic'], step=0.012)
    B.opening_bars('S6 | lower grille centre slats', lay.intake_centre, m['grille'], 0.016, 0.026, None, 0.0045, 0.01)
    B.opening_bars('S6 | lower grille centre uprights', lay.intake_centre, m['grille'], 0.022, None, 0.045, 0.002, 0.012)
    B.inset('S6 | lower grille side', lay.intake_side, 0.07, m['plastic'], m['plastic'], step=0.012)
    fog = lay.fog
    ring = np.array([(fog['s'] + (fog['r'] + 0.012) * math.cos(a), fog['z'] + (fog['r'] + 0.012) * math.sin(a))
                     for a in np.linspace(0, math.tau, 40, endpoint=False)])
    B.opening_bars('S6 | lower grille side mesh', lay.intake_side, m['grille'], 0.016, 0.019, 0.019, 0.0018, 0.008,
                   exclude=[ring], mirror=True)
    p, n = B.frame_at(fog['s'], fog['z'])
    f = horizontal(n)
    rr, uu, nn = frame_from_normal(f)
    c = p - n * 0.012
    r = fog['r']
    B.link(disc_ring('S6 | front bumper fog lamp bezel', c, rr, uu, nn,
                     [(r * 0.9, -0.02), (r + 0.004, -0.004), (r + 0.011, 0.006), (r + 0.006, 0.010), (r * 0.98, 0.003)],
                     m['plastic'], 48), mirror=True)
    B.link(disc_ring('S6 | front bumper fog lamp reflector', c - f * 0.025, rr, uu, nn,
                     [(0.006, -0.012), (r * 0.5, -0.006), (r * 0.95, 0.018)], m['reflector'], 48), mirror=True)
    B.link(disc_ring('S6 | front bumper fog lamp lens', c, rr, uu, nn,
                     [(0.0005, 0.010), (r * 0.6, 0.008), (r * 0.98, 0.002)], m['lens'], 48), mirror=True)


def front_plate(B):
    lay, m = B.lay, B.m
    pl = lay.plate_front
    zc = (pl['z0'] + pl['z1']) / 2
    p, n = B.frame_at(0.0, zc, 0.011)
    n = np.array([n[0], 0.0, n[2] * 0.4])
    n /= np.linalg.norm(n)
    plate(B, 'S6 | front plate B 08046', p, n, m['plate'], m['plastic'])


def bumper_details(B):
    """Flush washer covers and the subtle upper bumper split in the references."""
    b, m = B.body, B.m
    centre_s = float(b.s_front(.545))
    from .features import rrect
    cover = rrect(centre_s - .044, centre_s + .044, .443, .491, .010)
    B.wall_line('S6 | front bumper headlamp washer cover', cover, .0013, m['seam'],
                offset=.0012, closed=True, clip_holes=False, flatten=.45)
    seam = [(float(b.s_front(y)), .553) for y in np.linspace(0, .805, 72)]
    B.wall_line('S6 | front bumper upper molding split', seam, .0011, m['seam'],
                offset=.001, clip_holes=True, flatten=.4)
    # Flush tow-eye cover, on one side only (the washer covers above are paired).
    tow_s = float(b.s_front(.355))
    tow = [(tow_s + .014 * math.cos(a), .466 + .014 * math.sin(a))
           for a in np.linspace(0, math.tau, 40, endpoint=False)]
    B.wall_line('S6 | front bumper tow eye cover', tow, .0009, m['seam'],
                offset=.001, closed=True, mirror=False, clip_holes=False, flatten=.35)


def build(B):
    headlamps(B)
    grille(B)
    intakes(B)
    bumper_details(B)
    # The supplied reference car has a clean blue front bumper. Its B 08046
    # registration is fitted at the rear only; retain front_plate for variants.
