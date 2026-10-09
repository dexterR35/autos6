"""Graphite five-spoke 20-inch wheels, 255/35 R20 tyres, drilled discs and red calipers.

Left wheels are built in vehicle coordinates and mirrored. Each wheel faces +Y
(outboard) at y = TRACK / 2.
"""
import math

import numpy as np

from . import spec
from .features import round_corners
from .front import text_badge
from .meshgen import grid_faces, mesh_from_arrays, tube
from .util import box_bar, disc_ring, loft, merge, torus

AX = np.array([0.0, 1.0, 0.0])          # outboard axis
K = 0.254 / 0.2413                      # radial scale of the rim drawing (19 in -> 20 in)
R_AX = np.array([1.0, 0.0, 0.0])
U_AX = np.array([0.0, 0.0, 1.0])


def lathe(name, centre, profile, material, segments=96, smooth=True):
    """Revolve (radius, axial) around the wheel axis; axial > 0 is outboard."""
    return disc_ring(name, centre, R_AX, U_AX, AX, profile, material, segments, smooth)


def tyre(B, tag, c):
    R, W = spec.TYRE_R, 0.255
    hw = W / 2
    bead = 0.2465 * K
    prof = [(bead, -hw + 0.012), (bead + 0.011, -hw + 0.004), (0.282, -hw - 0.002), (0.309, -hw + 0.001),
            (0.328, -hw + 0.010), (R - 0.002, -hw + 0.026), (R, -hw + 0.045)]
    # Four circumferential grooves in the tread.
    for g in (-0.068, -0.024, 0.024, 0.068):
        prof += [(R, g - 0.007), (R - 0.008, g - 0.005), (R - 0.008, g + 0.005), (R, g + 0.007)]
    prof += [(R, hw - 0.045), (R - 0.002, hw - 0.026), (0.328, hw - 0.010), (0.309, hw - 0.001),
             (0.282, hw + 0.002), (bead + 0.011, hw - 0.004), (bead, hw - 0.012)]
    B.link(lathe('S6 | %s wheel | tyre 255/35 R20' % tag, c, prof, B.m['rubber'], 72), mirror=True)


def spoke_mesh(c, face_y, n_spokes=5, r0=0.062, r1=0.226 * K):
    """Flat, slightly concave spokes that taper towards the rim."""
    parts = []
    for k in range(n_spokes):
        a = math.tau * k / n_spokes + math.pi / 2
        radial = np.array([math.cos(a), 0, math.sin(a)])
        tang = np.array([-math.sin(a), 0, math.cos(a)])
        sections = []
        rs = np.linspace(r0, r1, 12)
        for r in rs:
            t = (r - r0) / (r1 - r0)
            half = 0.040 - 0.012 * t + 0.010 * max(0.0, (t - 0.86) / 0.14) ** 2
            face = face_y - 0.028 * (1 - t) ** 1.4 + 0.002 * t
            # Never inboard of the hub mounting face: clears the caliper.
            back = max(face - 0.042, 0.081)
            ch = 0.006
            sec = [(-half - 0.006, back), (-half, face - ch), (-half + ch, face), (half - ch, face), (half, face - ch), (half + 0.006, back)]
            sections.append([c + radial * r + tang * w + AX * yy for w, yy in sec])
        S = np.array(sections)
        nsec, k_ = S.shape[0], S.shape[1]
        verts = S.reshape(-1, 3)
        faces = []
        for i in range(nsec - 1):
            for j in range(k_ - 1):
                q = i * k_ + j
                faces.append((q, q + 1, q + k_ + 1, q + k_))
        parts.append((list(verts), faces))
    return merge(parts)


def rim(B, tag, c):
    m = B.m
    fy = 0.122                       # spoke face plane (axial, outboard of the wheel centre)
    # Barrel and inner well.
    B.link(lathe('S6 | %s wheel | rim barrel' % tag, c,
                 [(K * 0.238, -0.105), (K * 0.232, -0.09), (K * 0.226, -0.03), (K * 0.226, 0.06), (K * 0.233, 0.09), (K * 0.236, 0.10)],
                 m['grille'], 48), mirror=True)
    # Machined outer lip and the graphite face ring.
    B.link(lathe('S6 | %s wheel | machined lip' % tag, c,
                 [(K * 0.236, 0.100), (K * 0.2425, fy - 0.008), (K * 0.2455, fy - 0.002), (K * 0.2445, fy + 0.002), (K * 0.240, fy + 0.003)],
                 m['wheel_lip'], 72), mirror=True)
    B.link(lathe('S6 | %s wheel | rim face ring' % tag, c,
                 [(K * 0.240, fy + 0.003), (K * 0.232, fy + 0.002), (K * 0.225, fy - 0.004), (K * 0.222, fy - 0.03)],
                 m['wheel'], 72), mirror=True)
    v, f = spoke_mesh(c, fy)
    B.link(mesh_from_arrays('S6 | %s wheel | graphite five spokes' % tag, v, f, m['wheel']), mirror=True)
    # Hub, lug bolts and the centre cap.
    B.link(lathe('S6 | %s wheel | hub' % tag, c,
                 [(0.07, fy - 0.045), (0.072, fy - 0.03), (0.068, fy - 0.026), (0.045, fy - 0.024), (0.032, fy - 0.022)],
                 m['wheel'], 48), mirror=True)
    bolts = []
    for k in range(5):
        a = math.tau * k / 5 + math.pi / 2 + math.pi / 5
        bc = c + 0.0525 * (math.cos(a) * R_AX + math.sin(a) * U_AX)
        prof = [(0.011, fy - 0.03), (0.011, fy - 0.022), (0.0095, fy - 0.014), (0.006, fy - 0.011), (0.0005, fy - 0.011)]
        o = disc_ring('S6 | %s wheel | lug bolt' % tag, bc, R_AX, U_AX, AX, prof, m['hat'], 12)
        bolts.append(o)
    for o in bolts:
        B.link(o, mirror=True)
    B.link(lathe('S6 | %s wheel | centre cap' % tag, c,
                 [(0.031, fy - 0.03), (0.031, fy - 0.019), (0.028, fy - 0.016), (0.0005, fy - 0.015)], m['grille'], 40), mirror=True)
    B.link(lathe('S6 | %s wheel | centre cap badge' % tag, c + AX * 0.0005,
                 [(0.017, fy - 0.0158), (0.0005, fy - 0.0152)], m['badge_red'], 32), mirror=True)


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
    for tag, x, disc_r, front in [('front', spec.X_AXLE_F, 0.172, True), ('rear', spec.X_AXLE_R, 0.160, False)]:
        c = np.array([x, y, spec.WHEEL_Z])
        tyre(B, tag, c)
        rim(B, tag, c)
        brakes(B, tag, c, disc_r, front, 1)
