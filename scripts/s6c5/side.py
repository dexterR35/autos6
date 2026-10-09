"""Side and roof details: mirrors, handles, mouldings, repeaters, fuel flap, rails,
roof spoiler and wipers."""
import math

import numpy as np

from . import spec
from .features import rrect
from .meshgen import mesh_from_arrays, param_mesh, tube
from .util import ellipse_ring, frame_from_normal, loft, rounded_box, superellipse


def to_right_side(obj):
    """Mirror a left-side-only object to the right side (y -> -y)."""
    for v in obj.data.vertices:
        v.co.y = -v.co.y
    obj.data.flip_normals()
    return obj


def gh_point(B, x, y, off=0.0):
    """Point on the roof/glass part of the greenhouse at plan position (x, y)."""
    b = B.body
    x = np.atleast_1d(np.asarray(x, dtype=float))
    y = np.atleast_1d(np.asarray(y, dtype=float))
    py = b.P_y(x)
    front = x >= b.A[0]
    if np.any(front):
        py = np.where(front, b.cowl(x)[0], py)
    t = 3.0 - np.clip(np.abs(y) / np.maximum(py, 1e-6), 0, 1)
    p = B.gh_offset(x, t, off)
    p[:, 1] *= np.where(y < 0, -1, 1)
    return p


def mirrors(B):
    m = B.m
    cx, cy, cz = 0.772, 0.958, 1.014
    ax, ay, az = 0.063, 0.112, 0.074

    def taper(x, y, z):
        # Flat glass face at the back, fuller towards the outer end.
        x = max(x, -ax * 0.42)
        grow = 0.75 + 0.25 * (y / ay + 1) / 2
        return x, y, z * grow

    B.link(rounded_box('S6 | door mirror housing', (cx, cy, cz), (2 * ax, 2 * ay, 2 * az), m['paint'], 3.2, (36, 20), taper), mirror=True)
    glass = superellipse(48, ay * 0.86, az * 0.82, 3.6)
    verts = [(cx - ax * 0.42 - 0.0015, cy + gy, cz + gz * (0.75 + 0.25 * (gy / ay + 1) / 2)) for gy, gz in glass]
    B.link(mesh_from_arrays('S6 | door mirror glass', verts + [(cx - ax * 0.42 - 0.0015, cy, cz)],
                            [(i, (i + 1) % 48, 48) for i in range(48)], m['chrome'], smooth=False), mirror=True)
    B.link(rounded_box('S6 | door mirror arm', (0.80, 0.83, 0.955), (0.075, 0.12, 0.04), m['black'], 3.0, (20, 10)), mirror=True)
    # Black sail at the front corner of the front door window.
    b = B.body
    poly = [(0.76, -0.01), (0.96, -0.01), (0.96, 1.01), (0.76, 0.40)]
    x = np.linspace(0.75, 0.97, 40)
    t = np.linspace(-0.01, 1.01, 20)
    sail = param_mesh('S6 | door mirror black sail', x, t, lambda xx, tt: B.gh_offset(xx, tt, 0.0025), keep=poly,
                      materials=[m['black']])
    B.add(sail)


def handles(B):
    b, lay, m = B.body, B.lay, B.m
    for i, h in enumerate(lay.handles):
        s = float(b.s_of_side_x(h['x']))
        p, n = B.frame_at(s, h['z'])
        r, u, nn = frame_from_normal(n)
        B.link(ellipse_ring('S6 | door handle recess %d' % i, p, r, u, nn,
                            [(0.078, 0.025, 0.0006), (0.074, 0.022, -0.004), (0.06, 0.016, -0.008), (0.0005, 0.0005, -0.009)],
                            m['seam'], 40), mirror=True)
        B.link(ellipse_ring('S6 | door pull handle %d' % i, p + nn * 0.002, r, u, nn,
                            [(0.084, 0.0085, -0.002), (0.086, 0.0105, 0.006), (0.083, 0.0105, 0.013), (0.074, 0.008, 0.017),
                             (0.0005, 0.0005, 0.0185)], m['paint'], 40), mirror=True)


def mouldings(B):
    b, m = B.body, B.m
    sx = lambda x: float(b.s_of_side_x(x))
    z = 0.558
    for x0, x1 in [(0.978, -0.160), (-0.184, -0.902)]:
        pts = [(s, z) for s in np.linspace(sx(x0), sx(x1), 120)]
        B.wall_line('S6 | lower door molding', pts, 0.016, m['paint'], offset=0.0, sides=8, step=0.02, flatten=0.42)
    # Side repeater on the front wing.
    p, n = B.frame_at(sx(1.105), 0.748)
    r, u, nn = frame_from_normal(n)
    B.link(ellipse_ring('S6 | side repeater', p, r, u, nn,
                        [(0.031, 0.0125, -0.001), (0.031, 0.0125, 0.0015), (0.027, 0.010, 0.004), (0.0005, 0.0005, 0.0048)],
                        m['lamp_amber'], 32), mirror=True)
    B.link(ellipse_ring('S6 | side repeater chrome rim', p, r, u, nn,
                        [(0.031, 0.0125, -0.001), (0.0335, 0.0145, 0.0012), (0.031, 0.0125, 0.0028)], m['chrome'], 32), mirror=True)
    # Fuel filler flap on the right rear quarter.
    poly = rrect(sx(-1.535), sx(-1.705), 0.822, 0.936, 0.02)
    for obj in B.wall_line('S6 | fuel flap shut line', poly, 0.0022, m['seam'], offset=0.0002, mirror=False, closed=True):
        to_right_side(obj)


def roof_rails(B):
    b, m = B.body, B.m
    xs = np.linspace(0.24, -1.66, 70)
    y_rail = 0.575
    base = gh_point(B, xs, np.full_like(xs, y_rail))
    lift = np.interp(xs, [-1.66, -1.56, 0.14, 0.24], [0.006, 0.042, 0.042, 0.006])
    sections = []
    prof = superellipse(16, 0.017, 0.013, 3.0)
    for i, x in enumerate(xs):
        c = base[i] + np.array([0, 0, lift[i] + 0.012])
        sc = 0.6 + 0.4 * min(1.0, (lift[i] - 0.006) / 0.02)
        sections.append([c + np.array([0, py * sc, pz * sc]) for py, pz in prof])
    B.link(loft('S6 | roof rail', sections, m['black']), mirror=True)
    for x in (0.02, -0.72, -1.44):
        p = gh_point(B, [x], [y_rail])[0]
        B.link(rounded_box('S6 | roof rail foot', (x, y_rail, p[2] + 0.024), (0.07, 0.03, 0.05), m['black'], 3.0, (16, 8)), mirror=True)
    return y_rail


def roof_spoiler(B):
    b, m = B.body, B.m
    x0 = -1.665
    ys = np.linspace(0.0, 0.545, 16)
    prof = [(0.07, -0.002), (0.0, 0.014), (-0.09, 0.012), (-0.150, -0.004), (-0.148, -0.020), (-0.09, -0.028), (0.0, -0.016)]
    sections = []
    for y in ys:
        z0 = gh_point(B, [x0], [y])[0][2]
        k = 1.0 - 0.45 * (y / ys[-1]) ** 6
        sections.append([(x0 + dx * k, y, z0 + dz * k) for dx, dz in prof])
    B.link(loft('S6 | roof spoiler', sections, m['paint']), mirror=True)
    z0 = gh_point(B, [x0], [0.0])[0][2]
    B.link(rounded_box('S6 | high level brake light', (x0 - 0.146, 0.0, z0 - 0.013), (0.008, 0.36, 0.012), m['lamp_red'], 4.0, (16, 6)))


def wipers(B):
    b, m = B.body, B.m
    cowl_x = lambda y: spec.COWL_X_CENTRE - (spec.COWL_X_CENTRE - b.A[0]) * (np.abs(y) / b.A[1]) ** 2
    for name, y0, y1, pivot in [('driver', 0.60, -0.04, 0.36), ('passenger', 0.02, -0.56, -0.18)]:
        ys = np.linspace(y0, y1, 40)
        xs = cowl_x(ys) - 0.065
        pts = gh_point(B, xs, ys, 0.012)
        B.link(tube('S6 | front wiper blade ' + name, pts, 0.0065, m['black'], sides=6))
        xp = cowl_x(pivot) + 0.01
        arm = gh_point(B, np.linspace(xp, xs[len(xs) // 2], 12), np.linspace(pivot, ys[len(ys) // 2], 12), 0.022)
        B.link(tube('S6 | front wiper arm ' + name, arm, 0.0055, m['black'], sides=6))
    xs = np.linspace(-2.16, -2.10, 20)
    ys = np.linspace(0.0, 0.40, 20)
    B.link(tube('S6 | rear wiper', gh_point(B, xs, ys, 0.012), 0.006, m['black'], sides=6))


def build(B):
    mirrors(B)
    handles(B)
    mouldings(B)
    B.rail_y = roof_rails(B)
    roof_spoiler(B)
    wipers(B)
