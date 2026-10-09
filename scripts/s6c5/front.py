"""C5 facelift S6 front: headlamps, chrome-framed grille, intakes, fog lamps, plate."""
import math

import bpy
import numpy as np
from mathutils import Matrix

from .features import densify
from .meshgen import mesh_from_arrays
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
    lamp = B.inset('S6 | headlamp', lay.headlamp_lens, 0.12, m['reflector'], m['lamp_dark'], lens_mat=m['lens'],
                   lens_inset=0.0012, step=0.008)
    sf = b.s_front
    # Inner projector (low beam), outer reflector (high beam), indicator in the corner.
    for label, y, z, bowl, lens_r, glow in [('inner projector', 0.540, 0.689, 0.062, 0.040, True),
                                           ('outer reflector', 0.712, 0.693, 0.056, 0.020, True)]:
        s = float(sf(y))
        p, n = B.frame_at(s, z)
        f = horizontal(n)
        rr, uu, nn = frame_from_normal(f)
        c = p - n * 0.05
        B.link(disc_ring('S6 | headlamp ' + label + ' chrome bowl', c - f * 0.035, rr, uu, nn,
                         [(0.008, -0.025), (bowl * 0.45, -0.018), (bowl * 0.8, -0.006), (bowl, 0.012), (bowl + 0.004, 0.014)],
                         m['reflector'], 56), mirror=True)
        B.link(disc_ring('S6 | headlamp ' + label + ' bezel', c, rr, uu, nn,
                         [(lens_r + 0.002, -0.004), (lens_r + 0.007, 0.0), (lens_r + 0.007, 0.004), (lens_r + 0.001, 0.006)],
                         m['lamp_dark'], 48), mirror=True)
        B.link(disc_ring('S6 | headlamp ' + label + ' lens', c, rr, uu, nn,
                         [(0.0005, 0.006 + lens_r * 0.45), (lens_r * 0.5, 0.006 + lens_r * 0.36), (lens_r * 0.85, 0.006 + lens_r * 0.16), (lens_r, 0.004)],
                         m['lens'], 48), mirror=True)
        if glow:
            B.link(disc_ring('S6 | headlamp ' + label + ' glow', c - f * 0.004, rr, uu, nn,
                             [(0.0005, 0.0), (lens_r * 0.9, 0.0)], m['lamp_white'], 32), mirror=True)
    # Polished divider and the amber indicator in the outer corner.
    pts = [(float(sf(y)), 0.629) for y in np.linspace(0.47, 0.80, 30)]
    pos = b.on_wall(np.array(pts), -0.03)
    from .meshgen import tube
    B.link(tube('S6 | headlamp chrome divider', pos, 0.004, m['reflector'], sides=8), mirror=True)
    p, n = B.frame_at(float(b.s_of_side_x(2.14)), 0.70)
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
    audi_rings(B, 'S6 | front audi rings ring', p, n, 0.041, 0.0052, m['chrome'])
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


def build(B):
    headlamps(B)
    grille(B)
    intakes(B)
    front_plate(B)
