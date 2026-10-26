"""Removable accessory: aero crossbars and the long gloss-black roof box."""
import math

import numpy as np

from .front import audi_rings
from .meshgen import mesh_from_arrays, tube
from .side import gh_point
from .util import loft, rounded_box, superellipse

# The supplied side/front views have a full-width touring box: about 46% of
# the wagon length in profile, with a visibly deeper lid than the first model.
BOX = dict(cx=-0.48, cz=1.565, ax=1.13, ay=0.50, az=0.23, e=3.4)


def box_taper(x, y, z):
    """Lower, narrower nose; flatter base; slight crown toward the front third."""
    ax, ay, az = BOX['ax'], BOX['ay'], BOX['az']
    f = x / ax                       # -1 rear .. 1 nose
    front = max(0.0, f)
    y *= 1.0 - 0.20 * front ** 2
    if z > 0:
        z *= 1.0 - 0.42 * front ** 2.2 + 0.06 * math.exp(-((f - 0.15) / 0.5) ** 2)
    else:
        z *= 0.55
    z -= 0.03 * front ** 3
    return x, y, z


def crossbars(B):
    m = B.m
    y_rail = getattr(B, 'rail_y', 0.575)
    for x in (-1.20, 0.02):
        top = gh_point(B, [x], [y_rail])[0][2] + 0.054
        prof = superellipse(16, 0.032, 0.012, 2.6)
        ys = np.linspace(-y_rail - 0.02, y_rail + 0.02, 2)
        sections = [[(x + px, y, top + 0.026 + pz) for px, pz in prof] for y in ys]
        B.link(loft('Accessory | roof rack crossbar', sections, m['black']))
        for s in (-1, 1):
            B.link(rounded_box('Accessory | roof rack foot', (x, s * y_rail, top + 0.006), (0.075, 0.045, 0.05), m['black'], 3.0, (16, 8)))
    return top + 0.026 + 0.012


def roof_box(B):
    m = B.m
    cx, cz, ax, ay, az, e = BOX['cx'], BOX['cz'], BOX['ax'], BOX['ay'], BOX['az'], BOX['e']
    B.link(rounded_box('Accessory | roof box shell', (cx, 0.0, cz), (2 * ax, 2 * ay, 2 * az), m['box'], e, (96, 40), box_taper))
    # Lid/base parting line round the box.
    phi = -math.asin(0.3 ** (e / 2))
    fr = abs(math.cos(phi)) ** (2 / e)
    fz = -0.3
    pts = []
    for th in np.linspace(0, math.tau, 200):
        ct, st = math.cos(th), math.sin(th)
        x = ax * math.copysign(abs(ct) ** (2 / e), ct) * fr
        y = ay * math.copysign(abs(st) ** (2 / e), st) * fr
        x, y, z = box_taper(x, y * 1.004, az * fz)
        pts.append((cx + x * 1.003, y, cz + z))
    B.link(tube('Accessory | roof box parting line', pts, 0.005, m['seam'], sides=8))
    # The reference box is a molded lid on a distinct base, rather than a plain
    # ellipsoid. Two shallow stiffening ribs catch long ceiling reflections.
    for side in (-1, 1):
        rib = []
        y = side * ay * 0.42
        for x in np.linspace(-ax * 0.82, ax * 0.80, 70):
            surface = max(0.0, 1.0 - abs(x / ax) ** e - abs(y / ay) ** e)
            px, py, pz = box_taper(x, y, az * surface ** (1 / e))
            rib.append((cx + px, py, cz + pz))
        B.link(tube('Accessory | roof box molded lid rib', rib, 0.0026, m['box'], sides=6))
    # Compact metal latches and dark hinge pads follow the tapered side walls.
    for x in (-ax * .62, ax * .49):
        for side in (-1, 1):
            fz = -0.30
            side_y = ay * max(0.0, 1 - abs(x / ax) ** e - abs(fz) ** e) ** (1 / e)
            px, py, pz = box_taper(x, side * side_y, az * fz)
            B.link(rounded_box('Accessory | roof box latch mounting pad',
                               (cx + px, py + side * .003, cz + pz),
                               (.075, .012, .048), m['black'], 3, (12, 6)))
            B.link(rounded_box('Accessory | roof box metal latch',
                               (cx + px, py + side * .011, cz + pz + .002),
                               (.042, .011, .029), m['alloy'], 3, (12, 6)))
    # Lock barrel on the right-hand side and the rings on the tail.
    B.link(rounded_box('Accessory | roof box lock', (cx - 0.35, -ay * 0.985, cz - 0.03), (0.06, 0.012, 0.03), m['alloy'], 3, (12, 6)))
    audi_rings(B, 'Accessory | roof box audi rings ring', np.array([cx - ax - 0.004, 0.0, cz + 0.035]),
               np.array([-1.0, 0, 0]), 0.028, 0.0035, m['chrome'])


def build(B):
    bar_top = crossbars(B)
    # The box base (flattened lower half) rests on the bars.
    BOX['cz'] = bar_top + BOX['az'] * 0.55 + 0.004
    roof_box(B)
