"""Assemble the S6 Avant in the current Blender scene."""
import math

import bpy
import numpy as np

from . import spec
from .body import Body
from .meshgen import Region, circle_polygon, mirror_y, param_mesh, solidify, tube, orient_outward


def graded(n, a=0.0, b=1.0, ends=0.35):
    """n samples on [a, b], denser towards both ends (ends: 0 uniform .. 1 strong)."""
    t = np.linspace(0, 1, n)
    t = (1 - ends) * t + ends * (0.5 - 0.5 * np.cos(math.pi * t))
    return a + (b - a) * t


class Builder:
    def __init__(self, collection, materials):
        self.collection = collection
        self.m = materials
        self.parts = []
        self.body = Body()

    def add(self, obj, mirror=True, thickness=0.0, inside=(0, 0, 0.7)):
        self.collection.objects.link(obj)
        orient_outward(obj, inside)
        if mirror:
            mirror_y(obj)
        if thickness:
            solidify(obj, thickness)
        self.parts.append(obj)
        return obj

    # ------------------------------------------------------------------
    def outward_offset(self, fn, u, v, off, centre_z=0.6):
        pos = fn(u, v)
        n = Body.normal(fn, u, v, 1e-4, 1e-4)
        ref = pos - np.stack([pos[:, 0] * 0.6, np.zeros(len(pos)), np.full(len(pos), centre_z)], axis=1)
        sign = np.sign(np.einsum('ij,ij->i', n, ref))
        sign[sign == 0] = 1
        return pos + n * sign[:, None] * off

    # ------------------------------------------------------------------
    def arch_polygon(self, axle_x, radius, grow=0.0, segments=96):
        b = self.body
        a = np.linspace(0, math.tau, segments, endpoint=False)
        x = axle_x + (radius + grow) * np.cos(a)
        z = spec.WHEEL_Z + (radius + grow) * np.sin(a)
        s = b.s_of_side_x(x)
        v = b.v_of(s, z)
        return list(zip(s, v))

    def lower_body(self):
        b = self.body
        regions = [Region(self.arch_polygon(spec.X_AXLE_F, spec.ARCH_R_F), 'hole', 'front arch'),
                   Region(self.arch_polygon(spec.X_AXLE_R, spec.ARCH_R_R), 'hole', 'rear arch')]
        u = np.linspace(0, b.L, 330)
        v = graded(40, 0, 1, 0.5)
        obj = param_mesh('S6 | lower body shell', u, v, lambda s, vv: b.wall(s, vv), regions=regions,
                         materials=[self.m['paint']])
        self.add(obj, thickness=0.004)
        return obj

    def hood(self):
        b = self.body
        x = graded(90, b.A[0], b.x_nose_top - 1e-4, 0.3)
        w = graded(44, 0, 1, 0.4)
        # Keep the hood in front of the curved windscreen base.
        ys = np.linspace(0, b.A[1], 40)
        cx = spec.COWL_X_CENTRE - (spec.COWL_X_CENTRE - b.A[0]) * (ys / b.A[1]) ** 2
        y_out = b.top_at_x(cx, 'front')[:, 1]
        poly = [(float(xx), float(min(1.0, yy / max(yo, 1e-6)))) for xx, yy, yo in zip(cx, ys, y_out)]
        poly += [(b.A[0] - 0.01, 1.01), (b.x_nose_top + 0.01, 1.01), (b.x_nose_top + 0.01, -0.01), (spec.COWL_X_CENTRE, -0.01)]
        poly = [poly[0]] + poly[1:]
        obj = param_mesh('S6 | bonnet panel', x, w, lambda xx, ww: b.hood(xx, ww), keep=poly,
                         materials=[self.m['paint']])
        self.add(obj, thickness=0.004)
        return obj

    def greenhouse(self):
        b = self.body
        x = graded(300, b.x_green_end, spec.COWL_X_CENTRE - 1e-4, 0.15)
        t = np.concatenate([graded(16, 0, 1, 0.5)[:-1], graded(8, 1, 2, 0.5)[:-1], graded(26, 2, 3, 0.3)])
        bp, cb = spec.B_PILLAR, spec.C_BAR
        win_front = [(bp[1][0], 0), (spec.DLO_FRONT_X + 0.05, 0), (spec.DLO_FRONT_X + 0.05, 1), (bp[1][1], 1)]
        win_rear = [(cb[1][0], 0), (bp[0][0], 0), (bp[0][1], 1), (cb[1][1], 1)]
        win_quarter = [(spec.DLO_REAR_X - 0.05, 0), (cb[0][0], 0), (cb[0][1], 1), (spec.DLO_REAR_X - 0.05, 1)]
        b_pillar = [(bp[0][0], 0), (bp[1][0], 0), (bp[1][1], 1), (bp[0][1], 1)]
        c_bar = [(cb[0][0], 0), (cb[1][0], 0), (cb[1][1], 1), (cb[0][1], 1)]
        windscreen = [(spec.WINDSCREEN_TOP_X[0], 2.0), (spec.COWL_X_CENTRE + 0.1, 2.0), (spec.COWL_X_CENTRE + 0.1, 3.01), (spec.WINDSCREEN_TOP_X[1], 3.01)]
        rear_glass = [(b.x_green_end - 0.1, 2.0), (spec.REAR_GLASS_TOP_X[0], 2.0), (spec.REAR_GLASS_TOP_X[1], 3.01), (b.x_green_end - 0.1, 3.01)]
        # Closed (zero-height) bands ahead of the A-pillar and behind the side glass.
        empty_band_front = [(spec.DLO_FRONT_X, -0.01), (2.0, -0.01), (2.0, 1.0), (spec.DLO_FRONT_X, 1.0)]
        empty_band_rear = [(-3.0, -0.01), (spec.DLO_REAR_X, -0.01), (spec.DLO_REAR_X, 1.0), (-3.0, 1.0)]
        empty_frame_front = [(b.A[0], 0.99), (2.0, 0.99), (2.0, 2.0), (b.A[0], 2.0)]
        holes = [win_front, win_rear, win_quarter, b_pillar, c_bar, windscreen, rear_glass,
                 empty_band_front, empty_band_rear, empty_frame_front]
        fn = lambda xx, tt: b.greenhouse(xx, tt)
        obj = param_mesh('S6 | roof pillars and tailgate', x, t, fn, regions=[Region(p) for p in holes],
                         materials=[self.m['paint']])
        self.add(obj, thickness=0.004)
        glass_inset = -0.006
        for name, poly, mat in [('front door glass', win_front, 'glass'), ('rear door glass', win_rear, 'glass'),
                                ('quarter glass', win_quarter, 'glass'), ('windscreen', windscreen, 'glass'),
                                ('tailgate glass', rear_glass, 'glass'),
                                ('B pillar black trim', b_pillar, 'black'), ('rear door window bar', c_bar, 'black')]:
            off = glass_inset if mat == 'glass' else 0.0015
            g = param_mesh('S6 | ' + name, x, t, lambda xx, tt, o=off: self.outward_offset(b.greenhouse, xx, tt, o),
                           keep=poly, materials=[self.m[mat]])
            self.add(g)
        return obj

    def arch_liners(self):
        b = self.body
        for axle, radius, tag in [(spec.X_AXLE_F, spec.ARCH_R_F, 'front'), (spec.X_AXLE_R, spec.ARCH_R_R, 'rear')]:
            a = np.linspace(math.radians(-25), math.radians(205), 80)
            x = axle + radius * np.cos(a)
            z = spec.WHEEL_Z + radius * np.sin(a)
            s = b.s_of_side_x(x)
            v = np.clip(b.v_of(s, z), 0, 1)
            edge = b.wall(s, v)
            verts, faces = [], []
            depths = [0.0, 0.012, 0.03, 0.06, 0.35]
            for i, p in enumerate(edge):
                radial = np.array([math.cos(a[i]), 0, math.sin(a[i])])
                for k, dpt in enumerate(depths):
                    roll = 0.012 * math.sin(min(dpt / 0.03, 1) * math.pi / 2) if k < 3 else 0.012
                    verts.append(p + np.array([0, -dpt, 0]) + radial * roll * (1 if k < 3 else 1.0))
            nd = len(depths)
            for i in range(len(edge) - 1):
                for k in range(nd - 1):
                    q = i * nd + k
                    faces.append((q, q + nd, q + nd + 1, q + 1))
            from .meshgen import mesh_from_arrays
            lip = mesh_from_arrays('S6 | ' + tag + ' wheel arch rolled lip and liner', verts, faces, self.m['liner'])
            self.collection.objects.link(lip)
            mirror_y(lip)
            self.parts.append(lip)

    def build(self):
        self.lower_body()
        self.hood()
        self.greenhouse()
        self.arch_liners()
        return self.parts
