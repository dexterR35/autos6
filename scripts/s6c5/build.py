"""Assemble the S6 Avant in the current Blender scene.

Builder(collection, materials).build() returns every created object. Object
names carry the part words that scripts/export_s6_web.py maps to the
website's part ids (bonnet, front bumper, headlamp, tailgate, wheel, ...).
"""
import math

import bpy
import numpy as np

from . import spec
from .body import Body
from .features import Layout, densify
from .meshgen import Region, apply_param_normals, grid_faces, mesh_from_arrays, mirror_y, orient_outward, param_mesh, solidify, tube
from .util import inside, runs


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
        self.lay = Layout(self.body)
        self.holes = []

    def add(self, obj, mirror=True, thickness=0.0, inside_point=(0, 0, 0.7), orient=True):
        self.collection.objects.link(obj)
        if orient:
            orient_outward(obj, inside_point)
        if obj.type == 'MESH':
            apply_param_normals(obj)
        if mirror:
            mirror_y(obj)
        if thickness:
            solidify(obj, thickness)
        self.parts.append(obj)
        return obj

    def link(self, obj, mirror=False):
        return self.add(obj, mirror=mirror, orient=False)

    # ------------------------------------------------------------------
    # Lower-body surface tools. Feature polygons are in (s, z).
    def sv_poly(self, poly, step=0.015):
        return [tuple(p) for p in self.body.sv(densify(poly, step))]

    def wall_line(self, name, pts, radius, material, offset=0.0, step=0.012, sides=6, mirror=True,
                  clip_holes=True, clip_centre=True, closed=False, flatten=1.0):
        """Tube lying on the lower body along an (s, z) polyline, clipped to the panels."""
        b = self.body
        P = densify(pts, step, closed=closed)
        if closed:
            P = np.vstack([P, P[:1]])
        v = b.v_of(P[:, 0], P[:, 1])
        keep = (v >= -0.001) & (v <= 1.001)
        if clip_centre:
            keep &= (P[:, 0] >= 0) & (P[:, 0] <= b.L)
        if clip_holes:
            for hole in self.holes:
                keep &= ~inside(P, hole)
        made = []
        for run in runs(keep):
            if len(run) < 2:
                continue
            pos = b.on_wall(P[run], offset)
            obj = tube(name, pos, radius, material, sides=sides)
            if flatten != 1.0:
                out = b.wall_out(*b.sv(P[run]).T)
                self._flatten(obj, pos, out, flatten, sides)
            made.append(self.add(obj, mirror=mirror, orient=False))
        return made

    @staticmethod
    def _flatten(obj, centres, normals, factor, sides):
        for i, (c, n) in enumerate(zip(centres, normals)):
            for k in range(sides):
                v = obj.data.vertices[i * sides + k]
                d = np.array(v.co) - c
                v.co = c + d + n * np.dot(d, n) * (factor - 1)

    def inset(self, name, poly, depth, back_mat, wall_mat, lens_mat=None, lens_inset=0.0015, step=0.005,
              mirror=True, back_regions=(), back_mats=(), lens_regions=(), lens_mats=()):
        """Recessed opening: optional lens flush with the body, side walls and a back."""
        b = self.body
        P = densify(poly, step)
        Q = b.sv(P)
        poly_sv = [tuple(p) for p in Q]
        s0, s1 = Q[:, 0].min(), Q[:, 0].max()
        v0, v1 = Q[:, 1].min(), Q[:, 1].max()
        mid = np.array([(s0 + s1) / 2])
        zspan = float(b.z_of(mid, np.array([1.0]))[0] - b.z_of(mid, np.array([0.0]))[0])
        uu = np.linspace(s0 - 1e-3, s1 + 1e-3, max(6, int((s1 - s0) / step) + 2))
        vv = np.linspace(v0 - 1e-3, v1 + 1e-3, max(6, int((v1 - v0) * zspan / step) + 2))
        off = lambda d: (lambda s, v: b.wall(s, v) + b.wall_out(s, v) * d)
        made = {}
        if lens_mat is not None:
            regions = [Region(self.sv_poly(p), i) for p, i in lens_regions]
            lens = param_mesh(name + ' lens', uu, vv, off(-lens_inset), regions=regions, keep=poly_sv,
                              materials=[lens_mat, *lens_mats])
            made['lens'] = self.link(lens, mirror)
        regions = [Region(self.sv_poly(p), i) for p, i in back_regions]
        back = param_mesh(name + ' housing', uu, vv, off(-depth), regions=regions, keep=poly_sv,
                          materials=[back_mat, *back_mats])
        made['back'] = self.link(back, mirror)
        ring = np.vstack([P, P[:1]])
        rq = b.sv(ring)
        top = b.wall(rq[:, 0], rq[:, 1])
        out = b.wall_out(rq[:, 0], rq[:, 1])
        verts = np.concatenate([top - out * 0.0005, top - out * depth])
        n = len(ring)
        # Openings that cross the centre line get no wall along it (the mirror closes them).
        inside_car = (ring[:, 0] >= -1e-6) & (ring[:, 0] <= b.L + 1e-6)
        faces = [(i, i + 1, n + i + 1, n + i) for i in range(n - 1) if inside_car[i] or inside_car[i + 1]]
        made['wall'] = self.link(mesh_from_arrays(name + ' recess wall', verts, faces, wall_mat), mirror)
        return made

    def ribbon(self, centres, normals, half_w, half_d):
        """Rectangular bar along a polyline: width across (in the surface), depth along the normal."""
        c = np.asarray(centres, float)
        n = np.asarray(normals, float)
        t = np.gradient(c, axis=0)
        t /= np.linalg.norm(t, axis=1, keepdims=True) + 1e-12
        w = np.cross(t, n)
        w /= np.linalg.norm(w, axis=1, keepdims=True) + 1e-12
        verts = []
        corners = [(-1, -1), (1, -1), (1, 1), (-1, 1)]
        for i in range(len(c)):
            for a, d in corners:
                verts.append(c[i] + w[i] * a * half_w + n[i] * d * half_d)
        faces = grid_faces(len(c), 4, closed_v=True)
        faces.append((3, 2, 1, 0))
        m = len(c) - 1
        faces.append((m * 4, m * 4 + 1, m * 4 + 2, m * 4 + 3))
        return verts, faces

    def opening_bars(self, name, poly, material, depth, pitch_z, pitch_s, half_w=0.002, half_d=0.006,
                     exclude=(), mirror=True, margin=0.004, step=0.02):
        """Grid of bars across an opening, set back from the body surface by depth."""
        b = self.body
        P = densify(poly, 0.004)
        s0, s1 = P[:, 0].min(), P[:, 0].max()
        z0, z1 = P[:, 1].min(), P[:, 1].max()
        lo = max(s0, 0.0) if mirror else s0
        verts, faces = [], []

        def ok(pts):
            m = inside(pts, P)
            # Keep a margin from the opening edge.
            for dx, dz in [(margin, 0), (-margin, 0), (0, margin), (0, -margin)]:
                m &= inside(pts + np.array([dx, dz]), P)
            for e in exclude:
                m &= ~inside(pts, e)
            return m

        lines = []
        if pitch_z:
            for z in np.arange(z0 + pitch_z / 2, z1, pitch_z):
                s = np.arange(lo, s1 + step, step)
                pts = np.stack([s, np.full_like(s, z)], axis=1)
                lines += [pts[r] for r in runs(ok(pts)) if len(r) > 1]
        if pitch_s:
            for s in np.arange(lo + (pitch_s / 2 if mirror else 0), s1, pitch_s):
                z = np.arange(z0, z1 + step, step)
                pts = np.stack([np.full_like(z, s), z], axis=1)
                lines += [pts[r] for r in runs(ok(pts)) if len(r) > 1]
        for pts in lines:
            q = b.sv(pts)
            pos = b.wall(q[:, 0], q[:, 1])
            nrm = b.wall_out(q[:, 0], q[:, 1])
            v, f = self.ribbon(pos - nrm * depth, nrm, half_w, half_d)
            base = len(verts)
            verts.extend(v)
            faces.extend(tuple(i + base for i in face) for face in f)
        if not verts:
            return None
        obj = mesh_from_arrays(name, verts, faces, material, smooth=True)
        return self.link(obj, mirror)

    def frame_at(self, s, z, offset=0.0):
        """Point and outward normal on the lower body at (s, z)."""
        b = self.body
        q = b.sv(np.array([[s, z]]))
        p = b.wall(q[:, 0], q[:, 1])[0]
        n = b.wall_out(q[:, 0], q[:, 1])[0]
        return p + n * offset, n

    # ------------------------------------------------------------------
    def arch_polygon(self, axle_x, radius, grow=0.0, segments=96):
        b = self.body
        a = np.linspace(0, math.tau, segments, endpoint=False)
        x = axle_x + (radius + grow) * np.cos(a)
        z = spec.WHEEL_Z + (radius + grow) * np.sin(a)
        s = b.s_of_side_x(x)
        return np.stack([s, z], axis=1)

    def lower_body(self):
        b, lay, m = self.body, self.lay, self.m
        arches = [self.arch_polygon(spec.X_AXLE_F, spec.ARCH_R_F), self.arch_polygon(spec.X_AXLE_R, spec.ARCH_R_R)]
        openings = [lay.headlamp, lay.grille, lay.intake_centre, lay.intake_side, lay.plate_recess,
                    lay.exhaust_cut, lay.taillamp]
        self.holes = [np.asarray(p) for p in arches + openings]
        holes = [Region(self.sv_poly(p), 'hole') for p in arches + openings]
        black = [Region(self.sv_poly(p), 1) for p in (lay.front_lip, lay.diffuser)]
        u = np.linspace(0, b.L, 540)
        v = graded(44, 0, 1, 0.45)
        mats = [m['paint'], m['plastic']]
        panels = [('front bumper cover', lay.front_bumper, (0, 2.2)),
                  ('rear bumper cover', lay.rear_bumper, (4.3, b.L)),
                  ('tailgate lower panel', lay.tailgate, (5.45, b.L)),
                  ('side skirt sill panel', lay.side_skirt, (float(b.s_of_side_x(spec.X_AXLE_F)), float(b.s_of_side_x(spec.X_AXLE_R))))]
        for name, poly, (s0, s1) in panels:
            uu = u[(u >= s0 - 0.02) & (u <= s1 + 0.02)]
            obj = param_mesh('S6 | ' + name, uu, v, lambda s, vv: b.wall(s, vv),
                             regions=black + holes, keep=self.sv_poly(poly), materials=mats)
            self.add(obj)
        cut = [Region(self.sv_poly(p), 'hole') for _, p, _ in panels]
        obj = param_mesh('S6 | wings doors and quarter panels', u, v, lambda s, vv: b.wall(s, vv),
                         regions=black + cut + holes, materials=mats)
        self.add(obj)

    def hood(self):
        b = self.body
        x = graded(80, b.A[0], b.x_nose_top - 1e-4, 0.3)
        w = graded(38, 0, 1, 0.4)
        # Keep the hood in front of the curved windscreen base.
        ys = np.linspace(0, b.A[1], 40)
        cx = spec.COWL_X_CENTRE - (spec.COWL_X_CENTRE - b.A[0]) * (ys / b.A[1]) ** 2
        y_out = b.top_at_x(cx, 'front')[:, 1]
        poly = [(float(xx), float(min(1.0, yy / max(yo, 1e-6)))) for xx, yy, yo in zip(cx, ys, y_out)]
        poly += [(b.A[0] - 0.01, 1.01), (b.x_nose_top + 0.01, 1.01), (b.x_nose_top + 0.01, -0.01), (spec.COWL_X_CENTRE, -0.01)]
        obj = param_mesh('S6 | bonnet panel', x, w, lambda xx, ww: b.hood(xx, ww), keep=poly,
                         materials=[self.m['paint']])
        self.add(obj)
        # Shut line round the bonnet: along the wing tops and across the nose.
        top = b.top
        k = top[:, 0] >= b.A[0] - 0.005
        pts = top[k][::5]
        self.add(tube('S6 | bonnet shut line', pts + np.array([0, 0, 0.0005]), 0.0028, self.m['seam'], sides=6),
                 orient=False)
        rear = np.stack([cx, ys, b.cowl(cx)[1]], axis=1)
        self.add(tube('S6 | bonnet rear shut line', rear + np.array([0, 0, 0.001]), 0.004, self.m['seam'], sides=6),
                 orient=False)
        return obj

    def greenhouse(self):
        b = self.body
        x = graded(240, b.x_green_end, spec.COWL_X_CENTRE - 1e-4, 0.15)
        t = np.concatenate([graded(12, 0, 1, 0.5)[:-1], graded(7, 1, 2, 0.5)[:-1], graded(22, 2, 3, 0.3)])
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
        self.add(obj)
        glass_inset = -0.006
        for name, poly, mat in [('front door glass', win_front, 'glass'), ('rear door glass', win_rear, 'glass'),
                                ('quarter glass', win_quarter, 'glass'), ('windscreen', windscreen, 'glass'),
                                ('tailgate glass', rear_glass, 'glass'),
                                ('B pillar black trim', b_pillar, 'black'), ('rear door window bar', c_bar, 'black')]:
            off = glass_inset if mat == 'glass' else 0.0015
            g = param_mesh('S6 | ' + name, x, t, lambda xx, tt, o=off: self.gh_offset(xx, tt, o),
                           keep=poly, materials=[self.m[mat]])
            self.add(g)
        # Polished surround of the side glass: along the belt and the frame top.
        for tt, r, label in [(0.0, 0.0042, 'belt'), (1.0, 0.0035, 'frame top')]:
            xs = np.linspace(spec.DLO_REAR_X + 0.004, spec.DLO_FRONT_X - 0.004, 130)
            pts = self.gh_offset(xs, np.full_like(xs, tt), 0.0025)
            self.add(tube('S6 | side window chrome ' + label, pts, r, self.m['chrome'], sides=6), orient=False)
        # Black ceramic frit round the bonded glass, as on the real screens.
        wt0, wt1 = spec.WINDSCREEN_TOP_X
        ts = np.linspace(3.0, 2.0, 40)
        header = np.stack([wt1 + (wt0 - wt1) * (3.0 - ts), ts], axis=1)
        xs = np.linspace(wt0, spec.COWL_X_CENTRE - 0.002, 120)
        sides = np.stack([xs, np.full_like(xs, 2.0)], axis=1)
        self.glass_frit('S6 | windscreen ceramic frit', np.vstack([header, sides[1:]]), (0.75, 2.6),
                        [0.075] * len(header) + [0.055] * (len(sides) - 1))
        rg = spec.REAR_GLASS_TOP_X[0]
        ts = np.linspace(3.0, 2.0, 30)
        bottom = np.stack([np.full_like(ts, b.x_green_end + 0.001), ts], axis=1)
        xs = np.linspace(b.x_green_end + 0.001, rg, 60)
        dpil = np.stack([xs, np.full_like(xs, 2.0)], axis=1)
        top = np.stack([np.full_like(ts, rg), ts[::-1]], axis=1)
        self.glass_frit('S6 | tailgate glass ceramic frit', np.vstack([bottom, dpil[1:], top[1:]]), (-2.0, 2.6),
                        [0.05] * (len(bottom) + len(dpil) + len(top) - 2))
        return obj

    def glass_frit(self, name, path, inside_xt, widths, glass_off=-0.0048):
        """Strip lying on the glass along its edge, `widths` metres wide towards the inside."""
        b = self.body
        P = self.gh_offset(path[:, 0], path[:, 1], glass_off)
        n = Body.normal(b.greenhouse, path[:, 0], path[:, 1], 1e-4, 1e-3)
        T = np.gradient(P, axis=0)
        d = np.cross(n, T)
        d /= np.linalg.norm(d, axis=1, keepdims=True) + 1e-12
        centre = self.gh_offset(np.array([inside_xt[0]]), np.array([inside_xt[1]]), glass_off)[0]
        flip = np.einsum('ij,ij->i', d, centre - P) < 0
        d[flip] *= -1
        w = np.asarray(widths)[:, None]
        verts = np.concatenate([P, P + d * w])
        k = len(P)
        faces = [(i, i + 1, k + i + 1, k + i) for i in range(k - 1)]
        self.link(mesh_from_arrays(name, verts, faces, self.m['frit']), mirror=True)

    def gh_offset(self, x, t, off, centre_z=0.6):
        b = self.body
        pos = b.greenhouse(x, t)
        n = Body.normal(b.greenhouse, x, t, 1e-4, 1e-3)
        ref = pos - np.stack([pos[:, 0] * 0.6, np.zeros(len(pos)), np.full(len(pos), centre_z)], axis=1)
        sign = np.sign(np.einsum('ij,ij->i', n, ref))
        sign[sign == 0] = 1
        return pos + n * sign[:, None] * off

    def arch_liners(self):
        b = self.body
        for axle, radius, tag in [(spec.X_AXLE_F, spec.ARCH_R_F, 'front'), (spec.X_AXLE_R, spec.ARCH_R_R, 'rear')]:
            a = np.linspace(math.radians(-25), math.radians(205), 90)
            x = axle + radius * np.cos(a)
            z = spec.WHEEL_Z + radius * np.sin(a)
            s = b.s_of_side_x(x)
            v = np.clip(b.v_of(s, z), 0, 1)
            edge = b.wall(s, v)
            verts, faces = [], []
            depths = [0.0, 0.012, 0.03, 0.06, 0.38]
            for i, p in enumerate(edge):
                radial = np.array([math.cos(a[i]), 0, math.sin(a[i])])
                for k, dpt in enumerate(depths):
                    roll = 0.012 * math.sin(min(dpt / 0.03, 1) * math.pi / 2) if k < 3 else 0.012
                    verts.append(p + np.array([0, -dpt, 0]) + radial * roll)
            nd = len(depths)
            for i in range(len(edge) - 1):
                for k in range(nd - 1):
                    q = i * nd + k
                    faces.append((q, q + nd, q + nd + 1, q + 1))
            lip = mesh_from_arrays('S6 | ' + tag + ' wheel arch rolled lip and liner', verts, faces, self.m['liner'])
            self.link(lip, mirror=True)

    def shut_lines(self):
        for name, pts in self.lay.seams.items():
            self.wall_line('S6 | shut line ' + name, pts, 0.0024, self.m['seam'], offset=0.0002)

    def underbody(self):
        b = self.body
        s = np.linspace(0, b.L, 200)
        e = b.outline.at(s)
        z = b.z_of(s, np.zeros_like(s)) + 0.02
        inner = e * np.array([0.97, 0.94])
        verts = [(p[0], p[1], zz) for p, zz in zip(inner, z)] + [(p[0], 0.0, zz) for p, zz in zip(inner, z)]
        n = len(s)
        faces = [(i, i + 1, n + i + 1, n + i) for i in range(n - 1)]
        self.link(mesh_from_arrays('S6 | underbody tray', verts, faces, self.m['plastic'], smooth=False), mirror=True)

    def build(self):
        import time
        from . import cabin, front, rear, roof, side, wheels
        steps = [('lower body', self.lower_body), ('hood', self.hood), ('greenhouse', self.greenhouse),
                 ('arch liners', self.arch_liners), ('shut lines', self.shut_lines), ('underbody', self.underbody),
                 ('front', lambda: front.build(self)), ('rear', lambda: rear.build(self)),
                 ('side', lambda: side.build(self)), ('roof', lambda: roof.build(self)),
                 ('cabin', lambda: cabin.build(self)), ('wheels', lambda: wheels.build(self))]
        for label, fn in steps:
            t0 = time.time()
            fn()
            print('S6C5 built %s in %.1fs (%d objects)' % (label, time.time() - t0, len(self.parts)), flush=True)
        return self.parts
