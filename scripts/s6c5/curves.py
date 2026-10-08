"""Interpolation helpers: monotone cubic profiles and smooth polylines."""
import math

import numpy as np


class Pchip:
    """Monotone piecewise-cubic Hermite interpolation (Fritsch-Carlson).

    Never overshoots its knots, so measured profiles stay where they were put.
    Values outside the knot range are clamped to the end values.
    """

    def __init__(self, xs, ys):
        xs = np.asarray(xs, dtype=float)
        ys = np.asarray(ys, dtype=float)
        if np.any(np.diff(xs) <= 0):
            raise ValueError(f'Pchip knots must increase: {xs}')
        self.x, self.y = xs, ys
        h = np.diff(xs)
        delta = np.diff(ys) / h
        d = np.zeros_like(ys)
        if len(xs) == 2:
            d[:] = delta[0]
        else:
            for k in range(1, len(xs) - 1):
                if delta[k - 1] * delta[k] <= 0:
                    d[k] = 0.0
                else:
                    w1 = 2 * h[k] + h[k - 1]
                    w2 = h[k] + 2 * h[k - 1]
                    d[k] = (w1 + w2) / (w1 / delta[k - 1] + w2 / delta[k])
            d[0] = self._end(h[0], h[1], delta[0], delta[1])
            d[-1] = self._end(h[-1], h[-2], delta[-1], delta[-2])
        self.d = d

    @staticmethod
    def _end(h0, h1, m0, m1):
        d = ((2 * h0 + h1) * m0 - h0 * m1) / (h0 + h1)
        if np.sign(d) != np.sign(m0):
            return 0.0
        if np.sign(m0) != np.sign(m1) and abs(d) > abs(3 * m0):
            return 3 * m0
        return d

    def __call__(self, x):
        scalar = np.isscalar(x)
        x = np.clip(np.asarray(x, dtype=float), self.x[0], self.x[-1])
        k = np.clip(np.searchsorted(self.x, x) - 1, 0, len(self.x) - 2)
        h = self.x[k + 1] - self.x[k]
        t = (x - self.x[k]) / h
        h00 = (1 + 2 * t) * (1 - t) ** 2
        h10 = t * (1 - t) ** 2
        h01 = t * t * (3 - 2 * t)
        h11 = t * t * (t - 1)
        out = h00 * self.y[k] + h10 * h * self.d[k] + h01 * self.y[k + 1] + h11 * h * self.d[k + 1]
        return float(out) if scalar else out


def catmull_rom(points, samples_per_segment=24, closed=False, alpha=0.5):
    """Centripetal Catmull-Rom through points (any dimension); returns an array."""
    p = [np.asarray(q, dtype=float) for q in points]
    if closed:
        p = [p[-1]] + p + [p[0], p[1]]
    else:
        p = [2 * p[0] - p[1]] + p + [2 * p[-1] - p[-2]]
    out = []
    for i in range(1, len(p) - 2):
        p0, p1, p2, p3 = p[i - 1], p[i], p[i + 1], p[i + 2]
        t0 = 0.0
        t1 = t0 + max(np.linalg.norm(p1 - p0), 1e-9) ** alpha
        t2 = t1 + max(np.linalg.norm(p2 - p1), 1e-9) ** alpha
        t3 = t2 + max(np.linalg.norm(p3 - p2), 1e-9) ** alpha
        last = i == len(p) - 3 and not closed
        for j in range(samples_per_segment + (1 if last else 0)):
            t = t1 + (t2 - t1) * j / samples_per_segment
            a1 = (t1 - t) / (t1 - t0) * p0 + (t - t0) / (t1 - t0) * p1
            a2 = (t2 - t) / (t2 - t1) * p1 + (t - t1) / (t2 - t1) * p2
            a3 = (t3 - t) / (t3 - t2) * p2 + (t - t2) / (t3 - t2) * p3
            b1 = (t2 - t) / (t2 - t0) * a1 + (t - t0) / (t2 - t0) * a2
            b2 = (t3 - t) / (t3 - t1) * a2 + (t - t1) / (t3 - t1) * a3
            out.append((t2 - t) / (t2 - t1) * b1 + (t - t1) / (t2 - t1) * b2)
    return np.array(out)


def symmetric_half(points, samples_per_segment=40):
    """Catmull-Rom through a left-half curve that starts and ends on y = 0.

    Mirrored neighbours are added beyond both ends so the curve meets the centre
    line at right angles and joins its mirror image smoothly."""
    pts = [tuple(p) for p in points]
    mirror = lambda p: (p[0], -p[1]) + tuple(p[2:])
    ext = [mirror(p) for p in reversed(pts[1:3])] + pts + [mirror(p) for p in reversed(pts[-3:-1])]
    dense = catmull_rom(ext, samples_per_segment)
    first = 2 * samples_per_segment
    last = (2 + len(pts) - 1) * samples_per_segment
    out = dense[first:last + 1].copy()
    out[0, 1] = 0.0
    out[-1, 1] = 0.0
    return out


class Polyline:
    """Dense polyline with arc-length lookup (positions and unit tangents)."""

    def __init__(self, pts):
        self.p = np.asarray(pts, dtype=float)
        seg = np.linalg.norm(np.diff(self.p, axis=0), axis=1)
        self.s = np.concatenate([[0.0], np.cumsum(seg)])
        self.length = float(self.s[-1])

    def at(self, s):
        s = np.clip(np.asarray(s, dtype=float), 0, self.length)
        out = np.empty(np.shape(s) + (self.p.shape[1],))
        for axis in range(self.p.shape[1]):
            out[..., axis] = np.interp(s, self.s, self.p[:, axis])
        return out

    def tangent(self, s, ds=1e-3):
        a = self.at(np.asarray(s) - ds)
        b = self.at(np.asarray(s) + ds)
        t = b - a
        return t / np.linalg.norm(t, axis=-1, keepdims=True)

    def nearest_s(self, q):
        q = np.asarray(q, dtype=float)
        a, b = self.p[:-1], self.p[1:]
        ab = b - a
        t = np.clip(np.einsum('ij,ij->i', q - a, ab) / np.maximum(np.einsum('ij,ij->i', ab, ab), 1e-12), 0, 1)
        proj = a + ab * t[:, None]
        k = int(np.argmin(np.linalg.norm(proj - q, axis=1)))
        return float(self.s[k] + t[k] * np.linalg.norm(ab[k]))


def smoothstep(e0, e1, x):
    t = np.clip((np.asarray(x, dtype=float) - e0) / (e1 - e0), 0, 1)
    return t * t * (3 - 2 * t)


def bump(x, centre, half_width):
    """Smooth compact bump: 1 at centre, 0 beyond half_width (C1 continuous)."""
    t = np.clip(np.abs(np.asarray(x, dtype=float) - centre) / half_width, 0, 1)
    return (1 - t * t) ** 2


def lerp(a, b, t):
    return a + (b - a) * t


def angle_deg(v):
    return math.degrees(math.atan2(v[1], v[0]))
