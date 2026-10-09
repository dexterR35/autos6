"""Interior seen through the glass: seats, dashboard, wheel, trim and load cover."""
import math

import numpy as np

from . import spec
from .meshgen import param_mesh, tube
from .util import disc_ring, frame_from_normal, rounded_box, torus


def seat(B, name, x, y, width, back_h=0.62, lean=0.22):
    m = B.m
    B.link(rounded_box(name + ' cushion', (x, y, 0.47), (0.50, width, 0.13), m['leather'], 3.2, (24, 10),
                       lambda a, b, c: (a, b, c + 0.03 * (a / 0.25) - 0.02 * (abs(b) / (width / 2)) ** 4)))

    def recline(a, b, c):
        h = c + back_h / 2
        return a - h * math.sin(lean), b * (1 - 0.12 * (h / back_h) ** 2), c

    back = rounded_box(name + ' backrest', (x - 0.24, y, 0.50 + back_h / 2), (0.12, width * 0.96, back_h), m['leather'], 3.2, (24, 12), recline)
    B.link(back)
    top_x = x - 0.24 - back_h * math.sin(lean) - 0.02
    B.link(rounded_box(name + ' headrest', (top_x, y, 0.50 + back_h + 0.10), (0.10, width * 0.52, 0.15), m['leather'], 3.0, (20, 8)))


def build(B):
    b, m = B.body, B.m
    for y in (0.375, -0.375):
        seat(B, 'S6 | front sport seat', 0.02, y, 0.50)
    seat(B, 'S6 | rear bench', -0.86, 0.0, 1.24, 0.56, 0.26)
    # Dashboard under the windscreen with the binnacle and centre console.
    B.link(rounded_box('S6 | dashboard', (0.78, 0.0, 0.86), (0.42, 1.50, 0.26), m['cabin'], 3.0, (40, 12),
                       lambda a, bb, c: (a - 0.25 * max(0.0, c), bb * (1 - 0.06 * (a / 0.21 + 1)), c)))
    B.link(rounded_box('S6 | instrument binnacle', (0.62, 0.375, 1.0), (0.16, 0.34, 0.09), m['cabin'], 3.0, (20, 8)))
    B.link(rounded_box('S6 | centre console', (0.18, 0.0, 0.52), (0.95, 0.20, 0.22), m['cabin'], 3.0, (24, 8)))
    # Steering wheel on the left (LHD), tilted towards the driver.
    c = np.array([0.50, 0.375, 0.93])
    n = np.array([-math.cos(math.radians(24)), 0, math.sin(math.radians(24))])
    r, u, nn = frame_from_normal(n, (1, 0, 0))
    B.link(torus('S6 | steering wheel rim', c, r, u, nn, 0.185, 0.017, m['leather'], 64, 10))
    B.link(disc_ring('S6 | steering wheel hub', c - nn * 0.03, r, u, nn,
                     [(0.0005, 0.045), (0.06, 0.04), (0.075, 0.02), (0.07, -0.02)], m['cabin'], 32))
    for a in (0, 120, 240):
        d = math.cos(math.radians(a - 90)) * r + math.sin(math.radians(a - 90)) * u
        B.link(tube('S6 | steering wheel spoke', [c + d * 0.06, c + d * 0.175], 0.012, m['cabin'], sides=8))
    B.link(tube('S6 | steering column', [c - nn * 0.04, c - nn * 0.25], 0.03, m['cabin'], sides=10))
    # Door cards and quarter trim: cover the inside of the painted shell.
    sx = b.s_of_side_x
    s = np.linspace(float(sx(0.92)), float(sx(-2.16)), 110)
    v = np.linspace(float(b.v_of(np.array([2.5]), np.array([0.40]))[0]), 0.995, 9)
    trim = param_mesh('S6 | door trim panels', s, v, lambda ss, vv: b.wall(ss, vv) + b.wall_out(ss, vv) * -0.05,
                      materials=[m['cabin']])
    B.add(trim, orient=False)
    # Headliner and pillar trim under the roof.
    x = np.linspace(spec.DLO_REAR_X - 0.25, 0.42, 80)
    t = np.linspace(1.0, 3.0, 16)
    head = param_mesh('S6 | headliner', x, t, lambda xx, tt: B.gh_offset(xx, tt, -0.022), materials=[m['cabin']])
    B.add(head, orient=False)
    for x0, x1 in [spec.B_PILLAR[0], spec.C_BAR[0]]:
        xs = np.linspace(min(x0, x1) - 0.06, max(x0, x1) + 0.10, 16)
        tt = np.linspace(0.0, 1.0, 10)
        pil = param_mesh('S6 | pillar trim', xs, tt, lambda xx, t2: B.gh_offset(xx, t2, -0.02), materials=[m['cabin']])
        B.add(pil, orient=False)
    # Carpet and the Avant load-space cover at the belt line.
    B.link(rounded_box('S6 | carpet', (-0.6, 0.0, 0.30), (3.2, 1.5, 0.04), m['cabin'], 4, (24, 6)))
    B.link(rounded_box('S6 | luggage cover', (-1.64, 0.0, 0.955), (1.0, 1.42, 0.02), m['cabin'], 5, (24, 6)))
