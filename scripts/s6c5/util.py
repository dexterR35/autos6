"""Geometry helpers shared by the S6 detail modules (vehicle coordinates)."""
import math

import numpy as np

from .meshgen import grid_faces, mesh_from_arrays


def inside(points, poly):
    """Vectorised even-odd test of (N, 2) points against a closed polygon."""
    p = np.asarray(points, dtype=float)
    q = np.asarray(poly, dtype=float)
    x, y = p[:, 0], p[:, 1]
    res = np.zeros(len(p), dtype=bool)
    x1, y1 = q[:, 0], q[:, 1]
    x2, y2 = np.roll(x1, -1), np.roll(y1, -1)
    for a, b, c, d in zip(x1, y1, x2, y2):
        cond = (b > y) != (d > y)
        with np.errstate(divide='ignore', invalid='ignore'):
            xi = a + (y - b) * (c - a) / (d - b)
        res ^= cond & (xi > x)
    return res


def runs(mask):
    """Index runs of consecutive True values."""
    out, cur = [], []
    for i, m in enumerate(mask):
        if m:
            cur.append(i)
        elif cur:
            out.append(cur)
            cur = []
    if cur:
        out.append(cur)
    return out


def frame_from_normal(n, up=(0, 0, 1)):
    """Orthonormal (right, up, normal) basis with the given outward normal."""
    n = np.asarray(n, dtype=float)
    n = n / np.linalg.norm(n)
    u = np.asarray(up, dtype=float)
    u = u - n * np.dot(u, n)
    if np.linalg.norm(u) < 1e-6:
        u = np.array([1.0, 0, 0]) - n * n[0]
    u /= np.linalg.norm(u)
    r = np.cross(u, n)
    return r, u, n


def place(local, origin, r, u, n):
    """Local (a, b, c) coordinates along (r, u, n) -> world."""
    L = np.asarray(local, dtype=float)
    return origin + L[..., 0:1] * r + L[..., 1:2] * u + L[..., 2:3] * n


def disc_ring(name, origin, r_axis, u_axis, n_axis, profile, material, segments=48, smooth=True, cap=False):
    """Lathe a (radius, height-along-normal) profile around the normal at origin."""
    verts = []
    for k in range(segments):
        a = math.tau * k / segments
        ca, sa = math.cos(a), math.sin(a)
        for rad, h in profile:
            verts.append(origin + rad * (ca * r_axis + sa * u_axis) + h * n_axis)
    faces = grid_faces(segments, len(profile), closed_u=True)
    if cap:
        faces.append(tuple(k * len(profile) + len(profile) - 1 for k in range(segments)))
    return mesh_from_arrays(name, verts, faces, material, smooth)


def ellipse_ring(name, origin, r_axis, u_axis, n_axis, profile, material, segments=48, smooth=True, cap=False):
    """Like disc_ring, but each profile entry is (radius_r, radius_u, height)."""
    verts = []
    for k in range(segments):
        a = math.tau * k / segments
        ca, sa = math.cos(a), math.sin(a)
        for rr, ru, h in profile:
            verts.append(origin + rr * ca * r_axis + ru * sa * u_axis + h * n_axis)
    faces = grid_faces(segments, len(profile), closed_u=True)
    if cap:
        faces.append(tuple(k * len(profile) + len(profile) - 1 for k in range(segments)))
    return mesh_from_arrays(name, verts, faces, material, smooth)


def torus(name, origin, r_axis, u_axis, n_axis, radius, tube, material, segments=64, sides=12, squash=1.0):
    verts = []
    for k in range(segments):
        a = math.tau * k / segments
        radial = math.cos(a) * r_axis + math.sin(a) * u_axis
        for j in range(sides):
            b = math.tau * j / sides
            verts.append(origin + radial * (radius + tube * math.cos(b)) + n_axis * tube * squash * math.sin(b))
    faces = grid_faces(segments, sides, closed_u=True, closed_v=True)
    return mesh_from_arrays(name, verts, faces, material)


def loft(name, sections, material, closed_section=True, cap_ends=True, smooth=True):
    """Skin a list of equal-length 3D sections (each (K, 3))."""
    S = [np.asarray(s, dtype=float) for s in sections]
    k = len(S[0])
    verts = np.concatenate(S)
    faces = []
    for i in range(len(S) - 1):
        for j in range(k if closed_section else k - 1):
            a = i * k + j
            b = i * k + (j + 1) % k
            faces.append((a, b, b + k, a + k))
    if cap_ends and closed_section:
        faces.append(tuple(range(k - 1, -1, -1)))
        faces.append(tuple(range((len(S) - 1) * k, len(S) * k)))
    return mesh_from_arrays(name, verts, faces, material, smooth)


def superellipse(n_pts, a, b, e=4.0):
    """Closed superellipse |x/a|^e + |y/b|^e = 1, as (n_pts, 2)."""
    t = np.linspace(0, math.tau, n_pts, endpoint=False)
    c, s = np.cos(t), np.sin(t)
    x = a * np.sign(c) * np.abs(c) ** (2 / e)
    y = b * np.sign(s) * np.abs(s) ** (2 / e)
    return np.stack([x, y], axis=1)


def rounded_box(name, centre, size, material, e=6.0, segments=(24, 16), taper=None):
    """Superellipsoid 'rounded box' with half sizes size/2 (x, y, z)."""
    cx, cy, cz = centre
    ax, ay, az = [s / 2 for s in size]
    nu, nv = segments
    verts = []
    for i in range(nv + 1):
        phi = -math.pi / 2 + math.pi * i / nv
        cp, sp = math.cos(phi), math.sin(phi)
        fz = math.copysign(abs(sp) ** (2 / e), sp)
        fr = abs(cp) ** (2 / e)
        for j in range(nu):
            th = math.tau * j / nu
            ct, st = math.cos(th), math.sin(th)
            fx = math.copysign(abs(ct) ** (2 / e), ct) * fr
            fy = math.copysign(abs(st) ** (2 / e), st) * fr
            x, y, z = ax * fx, ay * fy, az * fz
            if taper:
                x, y, z = taper(x, y, z)
            verts.append((cx + x, cy + y, cz + z))
    faces = []
    for i in range(nv):
        for j in range(nu):
            a = i * nu + j
            b = i * nu + (j + 1) % nu
            faces.append((a, b, b + nu, a + nu))
    return mesh_from_arrays(name, verts, faces, material)


def box_bar(p0, p1, half_w, half_h, n_dir):
    """Vertices/faces of a rectangular bar from p0 to p1, height along n_dir."""
    p0, p1 = np.asarray(p0, float), np.asarray(p1, float)
    t = p1 - p0
    t /= np.linalg.norm(t)
    n = np.asarray(n_dir, float)
    n = n - t * np.dot(n, t)
    n /= np.linalg.norm(n)
    w = np.cross(t, n)
    corners = [(-1, -1), (1, -1), (1, 1), (-1, 1)]
    verts = [p + w * a * half_w + n * b * half_h for p in (p0, p1) for a, b in corners]
    faces = [(0, 1, 5, 4), (1, 2, 6, 5), (2, 3, 7, 6), (3, 0, 4, 7), (3, 2, 1, 0), (4, 5, 6, 7)]
    return verts, faces


def merge(parts):
    verts, faces = [], []
    for v, f in parts:
        base = len(verts)
        verts.extend(v)
        faces.extend(tuple(i + base for i in face) for face in f)
    return verts, faces
