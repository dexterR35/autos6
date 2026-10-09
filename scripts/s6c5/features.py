"""Panel layout of the lower body: openings, panel splits and shut lines.

Everything is drawn on the left half in feature coordinates (s, z): s is the
arc length along the plan outline (Body.s_front / s_rear / s_of_side_x) and z
the height in metres. Positions follow the C5 facelift front and the Avant
rear as seen in the reference photographs (front: refs 7 and 9, rear: ref 2,
side: ref 3).
"""
import math

import numpy as np

from . import spec


def densify(poly, step=0.006, closed=True):
    """Insert points so no segment is longer than step (keeps edges straight in (s, z))."""
    p = [np.asarray(q, dtype=float) for q in poly]
    out = []
    n = len(p) if closed else len(p) - 1
    for i in range(n):
        a, b = p[i], p[(i + 1) % len(p)]
        k = max(1, int(math.ceil(np.linalg.norm(b - a) / step)))
        for j in range(k):
            out.append(a + (b - a) * j / k)
    if not closed:
        out.append(p[-1])
    return np.array(out)


def round_corners(poly, radius, n=6):
    """Replace each corner of a closed polygon with a circular arc of the given radius."""
    p = [np.asarray(q, dtype=float) for q in poly]
    r_list = radius if isinstance(radius, (list, tuple)) else [radius] * len(p)
    out = []
    for i, c in enumerate(p):
        r = r_list[i]
        if r <= 0:
            out.append(c)
            continue
        a, b = p[i - 1], p[(i + 1) % len(p)]
        da, db = (a - c), (b - c)
        la, lb = np.linalg.norm(da), np.linalg.norm(db)
        da, db = da / la, db / lb
        half = math.acos(float(np.clip(np.dot(da, db), -1, 1))) / 2
        if half < 1e-3 or abs(half - math.pi / 2) < 1e-6 and False:
            out.append(c)
            continue
        t = min(r / math.tan(half), la * 0.45, lb * 0.45)
        p0, p1 = c + da * t, c + db * t
        for j in range(n + 1):
            w = j / n
            # Quadratic Bezier through the corner: close to an arc, tangent at both ends.
            out.append((1 - w) ** 2 * p0 + 2 * (1 - w) * w * c + w * w * p1)
    return np.array(out)


def rrect(s0, s1, z0, z1, r, n=6):
    return round_corners([(s0, z0), (s1, z0), (s1, z1), (s0, z1)], r, n)


def arc(cx, cz, r, a0, a1, n=24):
    a = np.radians(np.linspace(a0, a1, n))
    return np.stack([cx + r * np.cos(a), cz + r * np.sin(a)], axis=1)


class Layout:
    """All lower-body features, resolved against a Body."""

    def __init__(self, body):
        b = self.b = body
        sf, sr, sx = b.s_front, b.s_rear, b.s_of_side_x
        top = lambda s, dz=0.0: float(b.z_of(np.array([s]), np.array([1.0]))[0]) + dz
        self.top = top
        L = b.L
        self.L = L

        # ---- front ---------------------------------------------------------
        # Headlamp: hood line on top, straight lower edge, wrapping round the
        # corner onto the wing where it tapers to a point.
        s_in = float(sf(0.452))
        lamp_bottom = [(s_in, 0.642), (float(sf(0.466)), 0.607), (float(sf(0.60)), 0.603),
                       (float(sf(0.70)), 0.608), (float(sf(0.78)), 0.620), (float(sx(2.20)), 0.644),
                       (float(sx(2.13)), 0.674), (float(sx(2.075)), 0.712), (float(sx(2.045)), 0.748)]
        s_end = float(sx(2.035))
        lamp_top = [(s, top(s, 0.03)) for s in np.linspace(s_end, s_in - 0.004, 24)]
        self.headlamp = np.array(lamp_bottom + [(s_end, top(s_end, 0.03))] + lamp_top)
        self.headlamp_lens = np.array(lamp_bottom + [(s_end, top(s_end, -0.0015))]
                                      + [(s, top(s, -0.0015)) for s in np.linspace(s_end, s_in - 0.004, 24)])
        self.headlamp_s = (s_in, s_end)

        # Upper grille: chrome-framed, just below the hood line, wider at the top.
        g_top = lambda s: top(s, -0.012)
        s_g = float(sf(0.405))
        s_gb = float(sf(0.392))
        gz = 0.583
        grille = [(-0.03, gz), (s_gb - 0.02, gz), (s_gb, gz + 0.02)]
        grille += [(s, g_top(s)) for s in np.linspace(s_g, -0.03, 16)]
        self.grille = round_corners(grille, [0, 0.025, 0.025] + [0.028] + [0] * 15, 6)
        self.grille_z = (gz, g_top(0.0))

        # Lower intakes. The centre one is a wide trapezoid, the outer ones
        # hold the round fog lamps and follow the bumper corner.
        self.intake_centre = round_corners([(-0.03, 0.208), (float(sf(0.350)), 0.208), (float(sf(0.374)), 0.360),
                                            (-0.03, 0.360)], [0, 0.03, 0.03, 0], 6)
        self.intake_side = round_corners([(float(sf(0.432)), 0.210), (float(sf(0.745)), 0.210), (float(sx(2.21)), 0.252),
                                          (float(sx(2.20)), 0.322), (float(sf(0.79)), 0.362), (float(sf(0.436)), 0.362)],
                                         [0.025, 0.03, 0.03, 0.03, 0.03, 0.025], 6)
        self.fog = dict(s=float(sf(0.685)), z=0.287, r=0.046)
        self.plate_front = dict(z0=0.420, z1=0.530, half=0.26)

        # Black splitter lip along the bottom of the front bumper.
        s_arch_f = float(sx(spec.X_AXLE_F + spec.ARCH_R_F + 0.005))
        self.front_lip = np.array([(-0.05, -0.2), (s_arch_f, -0.2), (s_arch_f, 0.168), (-0.05, 0.168)])

        # Front bumper / wing split: from the lamp's rear corner to the arch.
        x_seam = spec.X_AXLE_F + math.sqrt((spec.ARCH_R_F - 0.006) ** 2 - 0.20 ** 2)
        self.front_seam = np.array([(float(sx(2.05)), 0.738), (float(sx(1.95)), 0.63), (float(sx(x_seam)), spec.WHEEL_Z + 0.20)])
        self.front_bumper = np.array([(-0.06, -0.3), (float(sx(spec.X_AXLE_F)), -0.3), (float(sx(spec.X_AXLE_F)), 0.40),
                                      *self.front_seam[::-1], (float(sf(0.75)), 0.66), (s_in + 0.02, 0.66),
                                      (s_in + 0.02, 1.4), (-0.06, 1.4)])

        # ---- rear ----------------------------------------------------------
        self.tailgate_y = 0.600
        s_tg = float(sr(self.tailgate_y))
        self.s_tailgate = s_tg
        self.bumper_top = 0.636
        s_tl_in = float(sr(0.618))
        s_wrap = float(sx(-2.075))
        tl = [(s_tl_in, 0.716), (float(sr(0.76)), 0.716), (float(sr(0.83)), 0.724), (s_wrap + 0.03, 0.762), (s_wrap + 0.008, 0.812)]
        tl += [(s, top(s, -0.026)) for s in np.linspace(s_wrap, s_tl_in, 18)]
        self.taillamp = round_corners(tl, [0.012, 0.02, 0.03, 0.03, 0.0, 0.012] + [0.0] * 16 + [0.012], 5)
        self.taillamp_lens = self.taillamp
        self.taillamp_s = (s_wrap, s_tl_in)

        # Tailgate panel (between the lamps, above the bumper) and its plate recess.
        self.tailgate = np.array([(s_tg, self.bumper_top), (L + 0.06, self.bumper_top), (L + 0.06, 1.4), (s_tg, 1.4)])
        self.plate_recess = rrect(float(sr(0.322)), L + 0.05, 0.686, 0.872, 0.028)
        self.plate_rear = dict(z0=0.724, z1=0.834, half=0.26)

        # Rear bumper: under the tailgate and lamps, round the corner to the arch.
        x_seam_r = spec.X_AXLE_R - math.sqrt((spec.ARCH_R_R - 0.006) ** 2 - 0.19 ** 2)
        self.rear_seam = np.array([(float(sx(x_seam_r)), spec.WHEEL_Z + 0.19), (float(sx(-1.98)), 0.60),
                                   (float(sr(0.85)), self.bumper_top), (L + 0.06, self.bumper_top)])
        self.rear_bumper = np.array([(float(sx(spec.X_AXLE_R)), -0.3), (L + 0.06, -0.3), *self.rear_seam[::-1],
                                     (float(sx(spec.X_AXLE_R)), 0.40)])
        # Black diffuser across the bumper bottom with the two exhaust cut-outs.
        s_arch_r = float(sx(spec.X_AXLE_R - spec.ARCH_R_R - 0.005))
        self.diffuser = np.array([(s_arch_r, -0.2), (L + 0.06, -0.2), (L + 0.06, 0.332), (float(sr(0.80)), 0.332),
                                  (float(sr(0.86)), 0.285), (float(sx(-1.98)), 0.235), (s_arch_r, 0.235)])
        self.exhaust_cut = rrect(float(sr(0.648)), float(sr(0.402)), 0.214, 0.318, 0.05)
        self.exhaust_tips = [dict(y=0.462, z=0.262, r=0.043), dict(y=0.584, z=0.262, r=0.043)]

        # ---- side shut lines ---------------------------------------------
        ra = spec.ARCH_R_R + 0.055
        theta = math.degrees(math.acos((-1.0 - spec.X_AXLE_R) / ra))
        rear_door_tail = arc(spec.X_AXLE_R, spec.WHEEL_Z, ra, theta, 0, 16)
        side = lambda pts: [(float(sx(x)), z) for x, z in pts]
        self.sill_z = 0.262
        self.seams = {
            'front door front edge': side([(0.988, top(float(sx(0.988)), 0.02)), (0.988, 0.80), (0.998, 0.60), (1.018, 0.40), (1.024, self.sill_z)]),
            'door split': side([(-0.172, top(float(sx(-0.172)), 0.02)), (-0.170, self.sill_z)]),
            'rear door rear edge': side([(-0.996, top(float(sx(-0.996)), 0.02)), (-1.0, 0.80)] + [tuple(p) for p in rear_door_tail]
                                        + [(spec.X_AXLE_R + ra, self.sill_z)]),
            'door bottoms': side([(spec.X_AXLE_F - spec.ARCH_R_F + 0.03, self.sill_z), (spec.X_AXLE_R + spec.ARCH_R_R - 0.03, self.sill_z)]),
            'front bumper': [tuple(p) for p in self.front_seam],
            'rear bumper': [tuple(p) for p in self.rear_seam],
            'tailgate side': [(s_tg, top(s_tg, 0.02)), (s_tg, self.bumper_top)],
        }
        self.handles = [dict(x=-0.035, z=0.862), dict(x=-0.872, z=0.880)]
        # S6 sill extension between the wheel arches, below the door bottoms.
        self.side_skirt = np.array([(float(sx(spec.X_AXLE_F)), -0.3), (float(sx(spec.X_AXLE_F)), self.sill_z),
                                    (float(sx(spec.X_AXLE_R)), self.sill_z), (float(sx(spec.X_AXLE_R)), -0.3)])
