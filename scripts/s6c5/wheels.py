"""Gunmetal concave five-spoke 21-inch wheels, low-profile tyres, drilled discs and red calipers.

Left wheels are built in vehicle coordinates and mirrored. Each wheel faces +Y
(outboard) at y = TRACK / 2. The rim follows the reference photographs: five
broad flat-faced spokes dished towards a solid hub, the lug bolts recessed in
the hub between the spokes, and a thin polished outer lip.
"""
import math

import numpy as np

from . import spec
from .features import round_corners
from .front import text_badge
from .meshgen import grid_faces, mesh_from_arrays, tube
from .util import box_bar, disc_ring, loft, merge, torus

AX = np.array([0.0, 1.0, 0.0])          # outboard axis
K = spec.RIM_R / 0.2413                 # radial scale of the rim drawing (19 in drawing -> 21 in)
R_AX = np.array([1.0, 0.0, 0.0])
U_AX = np.array([0.0, 0.0, 1.0])
FACE = 0.124                            # axial position of the rim lip / spoke tips
DISH = 0.042                            # spoke dish: hub face sits this far inboard of the lip
HUB = FACE - DISH                       # hub face
MOUNT = 0.050                           # hub mounting face (rotor hat face)
BRAKE_SHIFT = 0.030                     # brakes sit inboard so the face can be dished


def lathe(name, centre, profile, material, segments=96, smooth=True):
    """Revolve (radius, axial) around the wheel axis; axial > 0 is outboard."""
    return disc_ring(name, centre, R_AX, U_AX, AX, profile, material, segments, smooth)


def tyre(B, tag, c):
    R, hw = spec.TYRE_R, spec.TYRE_W / 2
    bead = spec.RIM_R + 0.004
    # Half profile from the bead to the tread edge: (radius, axial inset from the
    # sidewall plane; negative bulges outwards). Rim protector rib, a slightly
    # bulged low sidewall and a tight, squared shoulder.
    half = [(bead, 0.013), (bead + 0.004, 0.004), (bead + 0.010, -0.004), (bead + 0.016, -0.004),
            (bead + 0.022, -0.002), (0.305, -0.006), (0.322, -0.005), (0.334, -0.001), (0.342, 0.006),
            (R - 0.002, 0.015), (R, 0.026)]
    prof = [(r, -hw + a) for r, a in half]
    # Four circumferential grooves in the tread.
    for g in (-0.068, -0.024, 0.024, 0.068):
        prof += [(R, g - 0.007), (R - 0.008, g - 0.005), (R - 0.008, g + 0.005), (R, g + 0.007)]
    prof += [(r, hw - a) for r, a in half[::-1]]
    B.link(lathe('S6 | %s wheel | tyre 255/30 R21' % tag, c, prof, B.m['rubber'], 96), mirror=True)


def spoke_mesh(c, n_spokes=5, r0=0.070, r1=None):
    """Broad flat spokes, dished towards the hub, with chamfered edges and a fillet into the rim."""
    r1 = r1 or K * 0.234
    parts = []
    for k in range(n_spokes):
        a = math.tau * k / n_spokes + math.pi / 2
        radial = np.array([math.cos(a), 0, math.sin(a)])
        tang = np.array([-math.sin(a), 0, math.cos(a)])
        sections = []
        for r in np.linspace(r0, r1, 28):
            t = (r - r0) / (r1 - r0)
            # Nearly parallel sides, slightly wider at the rim, flaring into it.
            half = 0.034 + 0.007 * t + 0.016 * max(0.0, (t - 0.84) / 0.16) ** 2
            # Concave dish: steep near the rim, flat at the hub.
            face = FACE - 0.003 - DISH * (1 - t * t)
            back = max(face - 0.036, MOUNT if r < 0.1 else MOUNT - 0.004)
            ch = 0.003
            sec = [(-half - 0.004, back), (-half, face - ch), (-half + ch, face), (0.0, face + 0.0008),
                   (half - ch, face), (half, face - ch), (half + 0.004, back)]
            sections.append([c + radial * r + tang * w + AX * yy for w, yy in sec])
        S = np.array(sections)
        nsec = S.shape[0]
        # Separate strips (side, chamfer, flat face, chamfer, side) so the edges
        # stay crisp under smooth shading, as on a machined casting.
        for j0, j1 in [(0, 1), (1, 2), (2, 4), (4, 5), (5, 6)]:
            strip = S[:, j0:j1 + 1].reshape(-1, 3)
            w = j1 - j0 + 1
            faces = [(i * w + j, i * w + j + 1, (i + 1) * w + j + 1, (i + 1) * w + j)
                     for i in range(nsec - 1) for j in range(w - 1)]
            parts.append((list(strip), faces))
        tip = S[-1]
        parts.append((list(tip), [tuple(range(len(tip)))[::-1]]))
    return merge(parts)


def rim(B, tag, c):
    m = B.m
    fy = FACE
    # Barrel and inner well, dark behind the spokes.
    B.link(lathe('S6 | %s wheel | rim barrel' % tag, c,
                 [(K * 0.238, -0.105), (K * 0.232, -0.09), (K * 0.226, -0.03), (K * 0.226, 0.06), (K * 0.233, 0.09), (K * 0.236, 0.10)],
                 m['grille'], 64), mirror=True)
    # Thin polished outer lip, then a short gunmetal step down to the spokes.
    B.link(lathe('S6 | %s wheel | polished lip' % tag, c,
                 [(K * 0.236, 0.100), (K * 0.2425, fy - 0.008), (K * 0.2458, fy - 0.003), (K * 0.2452, fy + 0.0015),
                  (K * 0.2415, fy + 0.0025)],
                 m['wheel_lip'], 96), mirror=True)
    B.link(lathe('S6 | %s wheel | rim face ring' % tag, c,
                 [(K * 0.2415, fy + 0.0025), (K * 0.236, fy + 0.002), (K * 0.231, fy - 0.003), (K * 0.228, fy - 0.012),
                  (K * 0.226, fy - 0.03)],
                 m['wheel'], 96), mirror=True)
    v, f = spoke_mesh(c)
    B.link(mesh_from_arrays('S6 | %s wheel | gunmetal five spokes' % tag, v, f, m['wheel']), mirror=True)
    # Solid hub the spokes grow out of, down to the mounting face.
    B.link(lathe('S6 | %s wheel | hub' % tag, c,
                 [(0.030, HUB + 0.006), (0.071, HUB + 0.006), (0.078, HUB + 0.0045), (0.083, HUB - 0.001),
                  (0.086, HUB - 0.014), (0.088, MOUNT)],
                 m['wheel'], 80), mirror=True)
    # Lug bolts in dark pockets between the spokes (112 mm PCD).
    for k in range(5):
        a = math.tau * k / 5 + math.pi / 2 + math.pi / 5
        bc = c + 0.056 * (math.cos(a) * R_AX + math.sin(a) * U_AX)
        B.link(disc_ring('S6 | %s wheel | lug bolt pocket' % tag, bc, R_AX, U_AX, AX,
                         [(0.0005, HUB + 0.0062), (0.0108, HUB + 0.0062), (0.0118, HUB + 0.0058)], m['grille'], 20), mirror=True)
        B.link(disc_ring('S6 | %s wheel | lug bolt' % tag, bc, R_AX, U_AX, AX,
                         [(0.0078, HUB + 0.0063), (0.0078, HUB + 0.0085), (0.0062, HUB + 0.0098), (0.0005, HUB + 0.0101)],
                         m['alloy'], 6, smooth=False), mirror=True)
    # Domed black centre cap with a polished ring and red emblem.
    B.link(lathe('S6 | %s wheel | centre cap' % tag, c,
                 [(0.031, HUB + 0.006), (0.031, HUB + 0.012), (0.028, HUB + 0.0155), (0.018, HUB + 0.017), (0.0005, HUB + 0.0175)],
                 m['grille'], 48), mirror=True)
    B.link(torus('S6 | %s wheel | centre cap ring' % tag, c + AX * (HUB + 0.0158), R_AX, U_AX, AX, 0.0215, 0.0016, m['chrome'], 48, 8),
           mirror=True)
    B.link(lathe('S6 | %s wheel | centre cap badge' % tag, c,
                 [(0.0155, HUB + 0.0172), (0.0005, HUB + 0.0179)], m['badge_red'], 32), mirror=True)


def arc_sections(c, th0, th1, n, section):
    """Sections of a solid swept round the wheel axis: section(u) -> [(radius, axial), ...]."""
    out = []
    for i in range(n + 1):
        u = i / n
        th = th0 + (th1 - th0) * u
        rad = math.cos(th) * R_AX + math.sin(th) * U_AX
        out.append([c + rad * r + AX * a for r, a in section(u)])
    return out


def rrect_ra(r0, r1, a0, a1, rc, n=3):
    """Rounded rectangle in (radius, axial)."""
    rc = min(rc, (r1 - r0) * 0.45, (a1 - a0) * 0.45)
    return [tuple(p) for p in round_corners([(r0, a0), (r1, a0), (r1, a1), (r0, a1)], rc, n)]


def brakes(B, tag, c, disc_r, front, side):
    """Cross-drilled vented disc with a separate hat, pads, and a two-piece caliper."""
    m = B.m
    ri, ro = 0.112, disc_r
    # Friction rings with the cooling vanes between them.
    for label, a0, a1 in [('outboard', 0.019, 0.028), ('inboard', -0.002, 0.007)]:
        prof = [(ri, a0), (ro - 0.002, a0), (ro, a0 + 0.0015), (ro, a1 - 0.0015), (ro - 0.002, a1), (ri, a1), (ri, a0)]
        B.link(lathe('S6 | %s brake | rotor %s friction ring' % (tag, label), c, prof, m['disc'], 72), mirror=True)
    vanes = []
    for k in range(40):
        th = math.tau * k / 40
        rad = math.cos(th) * R_AX + math.sin(th) * U_AX
        p0 = c + rad * (ri + 0.004) + AX * 0.013
        p1 = c + rad * (ro - 0.003) + AX * 0.013
        vanes.append(box_bar(p0, p1, 0.0018, 0.0062, AX))
    v, f = merge(vanes)
    B.link(mesh_from_arrays('S6 | %s brake | rotor cooling vanes' % tag, v, f, m['hat'], smooth=True), mirror=True)
    B.link(lathe('S6 | %s brake | rotor hat' % tag, c,
                 [(ri + 0.002, 0.0275), (ri - 0.006, 0.031), (0.100, 0.040), (0.095, 0.072), (0.088, 0.078), (0.034, 0.078)],
                 m['hat'], 64), mirror=True)
    # Cross-drilled holes in curved rows of three.
    verts, faces = [], []
    for row in range(24):
        for k, rr in enumerate(np.linspace(ri + 0.014, ro - 0.014, 3)):
            th = math.tau * row / 24 + k * 0.075
            cc = c + AX * 0.0283 + rr * (math.cos(th) * R_AX + math.sin(th) * U_AX)
            base = len(verts)
            verts.append(cc - AX * 0.002)
            for j in range(8):
                b = math.tau * j / 8
                verts.append(cc + 0.0036 * (math.cos(b) * R_AX + math.sin(b) * U_AX))
            faces += [(base, base + 1 + j, base + 1 + (j + 1) % 8) for j in range(8)]
    B.link(mesh_from_arrays('S6 | %s brake | rotor drillings' % tag, verts, faces, m['grille'], smooth=True), mirror=True)

    # Caliper behind the axle, bridging the disc edge at both ends with an open
    # window in the middle where the pads and their retaining pin show.
    span = math.radians(76 if front else 64)
    centre = math.radians(178 if front else 182)
    th0, th1 = centre - span / 2, centre + span / 2
    r_in, r_out = ro - 0.062, ro + 0.024
    kidney = lambda u: 0.030 * abs(2 * u - 1) ** 3
    cap = lambda u: 0.004 * abs(2 * u - 1) ** 6
    outer = lambda u: rrect_ra(r_in + kidney(u), r_out - cap(u) * 2, 0.040, 0.064 + 0.006 * (1 - abs(2 * u - 1) ** 2), 0.009)
    inner = lambda u: rrect_ra(r_in + kidney(u), r_out - cap(u) * 2, -0.046, -0.014, 0.008)
    for label, fn in [('outboard half', outer), ('inboard half', inner)]:
        B.link(loft('S6 | %s brake caliper %s' % (tag, label), arc_sections(c, th0, th1, 28, fn), m['caliper']), mirror=True)
    for label, u0, u1 in [('bridge', 0.03, 0.27), ('bridge', 0.73, 0.97)]:
        th_a, th_b = th0 + (th1 - th0) * u0, th0 + (th1 - th0) * u1
        fn = lambda u: rrect_ra(ro + 0.006, r_out - 0.002, -0.044, 0.062, 0.008)
        B.link(loft('S6 | %s brake caliper %s' % (tag, label), arc_sections(c, th_a, th_b, 8, fn), m['caliper']), mirror=True)
    # Pads: friction material on steel backing plates, both sides of the disc.
    pad_t0, pad_t1 = th0 + span * 0.10, th1 - span * 0.10
    for label, fa, ba in [('outboard', (0.028, 0.036), (0.036, 0.040)), ('inboard', (-0.010, -0.002), (-0.014, -0.010))]:
        fn = lambda u, fa=fa: rrect_ra(ro - 0.056, ro - 0.004, fa[0], fa[1], 0.003, 2)
        B.link(loft('S6 | %s brake pad %s friction' % (tag, label), arc_sections(c, pad_t0, pad_t1, 14, fn), m['pad']), mirror=True)
        fn = lambda u, ba=ba: rrect_ra(ro - 0.058, ro + 0.003, ba[0], ba[1], 0.0015, 2)
        B.link(loft('S6 | %s brake pad %s backing plate' % (tag, label), arc_sections(c, pad_t0 - span * 0.04, pad_t1 + span * 0.04, 14, fn), m['backing']), mirror=True)
    # Retaining pin across the pad window and two bridge bolts.
    for th in (centre - span * 0.08, centre + span * 0.08):
        rad = math.cos(th) * R_AX + math.sin(th) * U_AX
        p = c + rad * (ro + 0.012)
        B.link(tube('S6 | %s brake caliper pad pin' % tag, [p - AX * 0.040, p + AX * 0.060], 0.0028, m['chrome'], sides=8), mirror=True)
    for u in (0.13, 0.87):
        th = th0 + (th1 - th0) * u
        rad = math.cos(th) * R_AX + math.sin(th) * U_AX
        p = c + rad * (r_in + kidney(u) + 0.022) + AX * 0.0655
        B.link(disc_ring('S6 | %s brake caliper bolt' % tag, p, R_AX, U_AX, AX,
                         [(0.0062, -0.004), (0.0062, 0.0015), (0.005, 0.003), (0.0005, 0.0032)], m['chrome'], 6, smooth=False), mirror=True)
    # White S6 lettering on the outboard face, one readable copy per side.
    rad = math.cos(centre) * R_AX + math.sin(centre) * U_AX
    for s in (1, -1):
        p = c + rad * (r_in + 0.046) + AX * 0.0705
        n = AX.copy()
        if s < 0:
            p = p * np.array([1, -1, 1])
            n = -n
        text_badge(B, 'S6 | %s brake caliper logo' % tag, 'S6', p, n, 0.024, m['caliper_logo'], extrude=0.0006)
    # Dust shield / hub carrier behind the disc.
    B.link(lathe('S6 | %s brake | dust shield' % tag, c,
                 [(0.04, -0.05), (disc_r + 0.01, -0.045), (disc_r + 0.012, -0.03)], m['liner'], 48), mirror=True)


def build(B):
    y = spec.TRACK / 2
    for tag, x, disc_r, front in [('front', spec.X_AXLE_F, 0.182, True), ('rear', spec.X_AXLE_R, 0.168, False)]:
        c = np.array([x, y, spec.WHEEL_Z])
        tyre(B, tag, c)
        rim(B, tag, c)
        brakes(B, tag, c - AX * BRAKE_SHIFT, disc_r, front, 1)
