"""Body surfaces of the S6 Avant, built as smooth parametric patches.

* Lower body: one band wrapped around the car in plan (bumpers, wings, doors,
  sills, rear quarters). Parameters (s, v): s = arc length along the plan
  equator from the front centre to the rear centre (left half), v = 0 at the
  bottom edge to 1 at the top edge. Each station's section is a monotone cubic
  of inset against height through eight named knots.
* Hood: x-sections from the cowl to the leading edge with a crowned profile
  and the C5 power dome.
* Greenhouse: x-sections from the cowl to the tailgate: side window band
  (t 0..1), roof side or pillar (t 1..2), roof or glass across to the centre
  line (t 2..3).
The left half is generated; a mirror modifier makes the right half.
"""
import math

import numpy as np

from . import spec
from .curves import Pchip, Polyline, bump, catmull_rom, smoothstep, symmetric_half


def rowwise_pchip(X, Y, q):
    """Evaluate a monotone cubic per row: X, Y (N, K) knots, q (N,) queries."""
    h = np.diff(X, axis=1)
    delta = np.diff(Y, axis=1) / h
    N, K = X.shape
    d = np.zeros_like(Y)
    for k in range(1, K - 1):
        w1 = 2 * h[:, k] + h[:, k - 1]
        w2 = h[:, k] + 2 * h[:, k - 1]
        same = delta[:, k - 1] * delta[:, k] > 0
        with np.errstate(divide='ignore', invalid='ignore'):
            val = (w1 + w2) / (w1 / delta[:, k - 1] + w2 / delta[:, k])
        d[:, k] = np.where(same, val, 0.0)
    for end, (i0, i1, j) in {'start': (0, 1, 0), 'end': (-1, -2, -1)}.items():
        h0, h1 = h[:, i0], h[:, i1]
        m0, m1 = delta[:, i0], delta[:, i1]
        val = ((2 * h0 + h1) * m0 - h0 * m1) / (h0 + h1)
        val = np.where(np.sign(val) != np.sign(m0), 0.0, val)
        val = np.where((np.sign(m0) != np.sign(m1)) & (np.abs(val) > np.abs(3 * m0)), 3 * m0, val)
        d[:, j] = val
    q = np.clip(q, X[:, 0], X[:, -1])
    k = np.clip((X[:, 1:-1] <= q[:, None]).sum(axis=1), 0, K - 2)
    rows = np.arange(N)
    x0, x1 = X[rows, k], X[rows, k + 1]
    y0, y1 = Y[rows, k], Y[rows, k + 1]
    d0, d1 = d[rows, k], d[rows, k + 1]
    hh = x1 - x0
    t = (q - x0) / hh
    return ((1 + 2 * t) * (1 - t) ** 2 * y0 + t * (1 - t) ** 2 * hh * d0
            + t * t * (3 - 2 * t) * y1 + t * t * (t - 1) * hh * d1)


def smooth_mirrored(values, sigma):
    """Gaussian smoothing of samples whose ends lie on the mirror plane."""
    r = int(4 * sigma)
    k = np.exp(-0.5 * (np.arange(-r, r + 1) / sigma) ** 2)
    k /= k.sum()
    padded = np.concatenate([values[r:0:-1], values, values[-2:-r - 2:-1]])
    return np.convolve(padded, k, mode='valid')


class Body:
    def __init__(self):
        pts = symmetric_half(spec.EQUATOR, samples_per_segment=200)
        self.outline = Polyline(pts)
        self.L = self.outline.length
        dense_s = np.linspace(0, self.L, 4000)
        self._ds = dense_s
        self._dp = self.outline.at(dense_s)
        # Station positions along the outline.
        s_st = []
        for (where, value), _ in spec.STATIONS:
            s_st.append(self._station_s(where, value))
        order = np.argsort(s_st)
        s_st = np.array(s_st)[order]
        knots = np.array([spec.STATIONS[i][1] for i in order])   # (M, 8, 2)
        self.station_s = s_st
        self.knot_z = [Pchip(s_st, knots[:, k, 0]) for k in range(knots.shape[1])]
        self.knot_d = [Pchip(s_st, knots[:, k, 1]) for k in range(knots.shape[1])]
        self.shoulder = Pchip(spec.SHOULDER_LINE['xs'][::-1], spec.SHOULDER_LINE['zs'][::-1])
        self._top_from_edge()
        self._top_curve()
        self._greenhouse_curves()

    # ---- plan outline helpers -------------------------------------------
    def _station_s(self, where, value):
        x, y = self._dp[:, 0], self._dp[:, 1]
        if where == 'front':
            mask = (x > 1.9)
            key = y
        elif where == 'rear':
            mask = (x < -1.9)
            key = y
        else:
            mask = (y > 0.6)
            key = x
        idx = np.where(mask)[0]
        best = idx[np.argmin(np.abs(key[idx] - value))]
        return float(self._ds[best])

    def s_of_side_x(self, x):
        """Arc length of the side outline point with the given x (side region)."""
        x = np.asarray(x, dtype=float)
        side = np.where(self._dp[:, 1] > 0.5)[0]
        xs = self._dp[side, 0][::-1]
        ss = self._ds[side][::-1]
        return np.interp(x, xs, ss)

    def frame(self, s):
        e = self.outline.at(s)
        t = self.outline.tangent(s)
        n = np.stack([t[..., 1], -t[..., 0]], axis=-1)
        return e, n

    # ---- lower body --------------------------------------------------------
    def _top_from_edge(self):
        """Top knot of every section: where the inward normal meets TOP_EDGE in plan."""
        edge = symmetric_half(spec.TOP_EDGE, samples_per_segment=120)
        q0, q1 = edge[:-1, :2], edge[1:, :2]
        s = np.linspace(0, self.L, 5000)
        e, n = self.frame(s)
        d_top = np.empty(len(s))
        z_top = np.empty(len(s))
        seg = q1 - q0
        for i in range(len(s)):
            # Solve e + n*tau = q0 + seg*mu for every segment; keep inward hits.
            det = n[i, 0] * (-seg[:, 1]) - n[i, 1] * (-seg[:, 0])
            rhs = q0 - e[i]
            with np.errstate(divide='ignore', invalid='ignore'):
                tau = (rhs[:, 0] * (-seg[:, 1]) - rhs[:, 1] * (-seg[:, 0])) / det
                mu = (n[i, 0] * rhs[:, 1] - n[i, 1] * rhs[:, 0]) / det
            ok = (mu >= -0.05) & (mu <= 1.05) & (tau <= 0) & np.isfinite(tau)
            if not np.any(ok):
                raise RuntimeError(f'TOP_EDGE not reached from outline s={s[i]:.3f}')
            k = np.where(ok)[0][np.argmax(tau[ok])]
            d_top[i] = -tau[k]
            z_top[i] = edge[k, 2] + (edge[k + 1, 2] - edge[k, 2]) * min(max(mu[k], 0.0), 1.0)
        # The polyline intersection has tiny kinks every segment; a ~1 cm
        # Gaussian (mirrored at both centre-line ends) keeps the panels fair.
        self._tt = (s, smooth_mirrored(d_top, 9.0), smooth_mirrored(z_top, 9.0))

    def knots_at(self, s):
        s = np.atleast_1d(s)
        Z = np.stack([k(s) for k in self.knot_z], axis=1)
        D = np.stack([k(s) for k in self.knot_d], axis=1)
        ts, td, tz = self._tt
        Z[:, -1] = np.interp(s, ts, tz)
        D[:, -1] = np.interp(s, ts, td)
        Z[:, -2] = np.minimum(Z[:, -2], Z[:, -1] - 0.015)
        Z[:, -3] = np.minimum(Z[:, -3], Z[:, -2] - 0.015)
        return Z, D

    def z_of(self, s, v):
        Z, _ = self.knots_at(s)
        return Z[:, 0] + np.asarray(v) * (Z[:, -1] - Z[:, 0])

    def v_of(self, s, z):
        Z, _ = self.knots_at(s)
        return (np.asarray(z) - Z[:, 0]) / (Z[:, -1] - Z[:, 0])

    def displacement(self, ex, z, side_weight):
        out = np.zeros_like(z)
        for f in (spec.FLARE_F, spec.FLARE_R):
            r = np.hypot(ex - f['x'], z - f['z']) - f['r']
            t = np.clip(r / f['width'], 0, 1)
            prof = np.where(r >= -0.02, (1 - t) ** 2 * (1 + 2 * t), 0.0)
            out += f['amp'] * prof
        sh = spec.SHOULDER_LINE
        zs = self.shoulder(np.clip(ex, sh['xs'][-1], sh['xs'][0]))
        out += sh['amp'] * np.exp(-((z - zs) / sh['width']) ** 2)
        cr = spec.LOWER_CREASE
        along = smoothstep(cr['x0'], cr['x0'] + 0.15, ex) * (1 - smoothstep(cr['x1'] - 0.15, cr['x1'], ex))
        # A crisp step: slightly fuller above the crease than below it.
        out += cr['amp'] * along * (smoothstep(cr['z'] - cr['width'], cr['z'] + 0.004, z) - 0.5)
        return out * side_weight

    def wall(self, s, v, offset=0.0):
        s = np.asarray(s, dtype=float)
        v = np.asarray(v, dtype=float)
        e, n = self.frame(s)
        Z, D = self.knots_at(s)
        z = Z[:, 0] + v * (Z[:, -1] - Z[:, 0])
        d = rowwise_pchip(Z, D, z)
        side_weight = np.clip((np.abs(n[:, 1]) - 0.55) / 0.35, 0, 1)
        d = d - self.displacement(e[:, 0], z, side_weight)
        pos = np.stack([e[:, 0] - n[:, 0] * d, e[:, 1] - n[:, 1] * d, z], axis=1)
        if np.any(offset):
            pos = pos + self.normal(self.wall, s, v) * np.asarray(offset)[..., None]
        return pos

    @staticmethod
    def normal(fn, u, v, du=1e-4, dv=1e-4):
        pu = (fn(u + du, v) - fn(u - du, v))
        pv = (fn(u, v + dv) - fn(u, v - dv))
        nrm = np.cross(pu, pv)
        nrm /= np.linalg.norm(nrm, axis=1, keepdims=True) + 1e-12
        return nrm

    def wall_normal(self, s, v):
        nrm = self.normal(self.wall, s, v)
        # Parameter order (s along the outline, v up) gives inward normals on the left half.
        return -nrm

    def wall_out(self, s, v):
        """Unit outward normal of the lower body."""
        return -self.wall_normal(np.asarray(s, dtype=float), np.asarray(v, dtype=float))

    # ---- feature coordinates on the lower body -----------------------------
    # Features are drawn in (s, z): s from s_front(y), s_rear(y) or
    # s_of_side_x(x), z the height. sv() converts them to wall parameters.
    def s_front(self, y):
        idx = np.where((self._dp[:, 0] > 1.2) & (self._ds < self.L / 2))[0]
        return np.interp(np.asarray(y, dtype=float), self._dp[idx, 1], self._ds[idx])

    def s_rear(self, y):
        idx = np.where((self._dp[:, 0] < -1.2) & (self._ds > self.L / 2))[0][::-1]
        return np.interp(np.asarray(y, dtype=float), self._dp[idx, 1], self._ds[idx])

    def sv(self, pts):
        """(s, z) points -> (s, v) wall parameters."""
        p = np.asarray(pts, dtype=float)
        return np.stack([p[:, 0], self.v_of(p[:, 0], p[:, 1])], axis=1)

    def on_wall(self, pts, offset=0.0):
        """(s, z) points -> 3D points on the lower body, pushed out by offset."""
        q = self.sv(pts)
        pos = self.wall(q[:, 0], q[:, 1])
        if offset:
            pos = pos + self.wall_out(q[:, 0], q[:, 1]) * offset
        return pos

    # ---- top edge of the lower body ---------------------------------------
    def _top_curve(self):
        # The designed top edge itself (the wall's top row lies on it).
        top = symmetric_half(spec.TOP_EDGE, samples_per_segment=200)
        self.top = top
        side = np.where(top[:, 1] > 0.5)[0]
        k = side[np.argmin(np.abs(top[side, 0] - spec.A_PILLAR_BASE_X))]
        self.A = top[k].copy()
        front = top[:k + 1]
        rear = top[k:]
        rear = rear[rear[:, 0] >= spec.GREENHOUSE_END_X - 1e-9]
        # Strictly decreasing x along each part, so x -> point is well defined.
        for part in (front, rear):
            for i in range(1, len(part)):
                part[i, 0] = min(part[i, 0], part[i - 1, 0] - 1e-7)
        self.top_front = (front[::-1, 0], front[::-1])
        self.top_rear = (rear[::-1, 0], rear[::-1])
        self.x_nose_top = float(top[0, 0])
        self.x_tail_top = float(top[-1, 0])

    def top_at_x(self, x, part):
        xs, pts = self.top_front if part == 'front' else self.top_rear
        x = np.asarray(x, dtype=float)
        return np.stack([np.interp(x, xs, pts[:, i]) for i in range(3)], axis=-1)

    # ---- hood --------------------------------------------------------------
    def cowl(self, x):
        """Windscreen base between the cowl centre and the A-pillar base."""
        yA, zA = self.A[1], self.A[2]
        xc = spec.COWL_X_CENTRE
        t = np.clip((xc - np.asarray(x, dtype=float)) / (xc - self.A[0]), 0, 1)
        y = yA * np.sqrt(t)
        zc = dict(spec.HOOD_CENTRE)[spec.COWL_X_CENTRE]
        z = zc + (zA - zc) * (y / yA) ** 2
        return y, z

    def hood(self, x, w, offset=0.0):
        x = np.asarray(x, dtype=float)
        w = np.asarray(w, dtype=float)
        out = self.top_at_x(x, 'front')
        y_out, z_out = out[:, 1], out[:, 2]
        hx = [p[0] for p in spec.HOOD_CENTRE][::-1]
        hz = [p[1] for p in spec.HOOD_CENTRE][::-1]
        zc = Pchip(hx, hz)(np.clip(x, hx[0], hx[-1]))
        y = w * y_out
        crown = 1 - w ** 2.6
        z = z_out + (zc - z_out) * crown
        dome = spec.HOOD_DOME
        t = np.clip((x - spec.COWL_X_CENTRE) / (self.x_nose_top - spec.COWL_X_CENTRE), 0, 1)
        y_ridge = dome['y_rear'] + (dome['y_front'] - dome['y_rear']) * t
        # Raised centre section with soft flanks, fading out well before the nose.
        z = z + dome['amp'] * (1 - smoothstep(y_ridge - dome['soft'], y_ridge + dome['soft'], y)) * (1 - smoothstep(0.45, 1.0, t))
        pos = np.stack([x, y, z], axis=1)
        if np.any(offset):
            pos = pos + self.normal(self.hood, x, w) * np.asarray(offset)[..., None]
        return pos

    # ---- greenhouse --------------------------------------------------------
    def _greenhouse_curves(self):
        dlx = [p[0] for p in spec.DLO_TOP][::-1]
        dlz = [p[1] for p in spec.DLO_TOP][::-1]
        self.dlo_z = Pchip(dlx, dlz)
        pts = [(float(self.A[0]), float(self.A[1]), float(self.A[2]))] + list(spec.PILLAR_EDGE)
        pts.sort(key=lambda p: p[0])
        self.P_y = Pchip([p[0] for p in pts], [p[1] for p in pts])
        self.P_z = Pchip([p[0] for p in pts], [p[2] for p in pts])
        cx = [p[0] for p in spec.CENTRE_TOP][::-1]
        cz = [p[1] for p in spec.CENTRE_TOP][::-1]
        self.C_z = Pchip(cx, cz)
        self.x_green_end = spec.GREENHOUSE_END_X

    def base(self, x):
        x = np.asarray(x, dtype=float)
        side = self.top_at_x(np.minimum(x, self.A[0]), 'rear')
        cy, cz = self.cowl(x)
        front = x > self.A[0]
        out = side.copy()
        out[front, 0] = x[front]
        out[front, 1] = cy[front]
        out[front, 2] = cz[front]
        return out

    def _raw_R(self, x, B):
        x = np.asarray(x, dtype=float)
        inside = (x > spec.DLO_REAR_X) & (x < spec.DLO_FRONT_X)
        zr = np.where(inside, self.dlo_z(np.clip(x, spec.DLO_REAR_X, spec.DLO_FRONT_X)), B[:, 2])
        zr = np.maximum(zr, B[:, 2])
        yr = B[:, 1] - (zr - B[:, 2]) * spec.TUMBLEHOME
        return np.stack([x, yr, zr], axis=1)

    def greenhouse(self, x, t, offset=0.0):
        x = np.asarray(x, dtype=float)
        t = np.asarray(t, dtype=float)
        B = self.base(x)
        R = self._raw_R(x, B)
        P = np.stack([x, self.P_y(x), self.P_z(x)], axis=1)
        # Ahead of the A-pillar base and behind the tailgate glass the bands close.
        front = x >= self.A[0]
        P[front] = B[front]
        P[:, 1] = np.minimum(P[:, 1], R[:, 1])
        P[:, 2] = np.maximum(P[:, 2], R[:, 2])
        zc = self.C_z(np.clip(x, spec.CENTRE_TOP[-1][0], spec.CENTRE_TOP[0][0]))
        out = np.empty((len(x), 3))
        out[:, 0] = x
        a = t <= 1
        b = (t > 1) & (t <= 2)
        c = t > 2
        ta = np.clip(t, 0, 1)
        band = R - B
        out[a, 1:] = (B + band * ta[:, None])[a, 1:]
        out[a, 1] += spec.GLASS_BOW * np.sin(math.pi * ta[a]) * np.clip(band[a, 2] / 0.06, 0, 1)
        tb = np.clip(t - 1, 0, 1)
        frame = (R + (P - R) * tb[:, None])
        bulge = 0.009 * np.sin(math.pi * tb)
        out[b, 1:] = frame[b, 1:]
        out[b, 1] += bulge[b]
        tc = np.clip(t - 2, 0, 1)
        out[c, 1] = P[c, 1] * (1 - tc[c])
        out[c, 2] = P[c, 2] + (zc[c] - P[c, 2]) * (1 - (1 - tc[c]) ** 2)
        pos = out
        if np.any(offset):
            pos = pos + self.normal(self.greenhouse, x, t, du=1e-4, dv=1e-3) * np.asarray(offset)[..., None]
        return pos
