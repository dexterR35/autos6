"""Parameter-space meshing: a (u, v) grid is cut exactly along feature outlines
with bmesh bisection, regions are removed or given materials, and only then is
each vertex mapped to its 3D position. Openings therefore have exact edges
(windows, lamps, wheel arches) instead of stair-stepped grid boundaries."""
import math

import bmesh
import bpy
import numpy as np
from mathutils import Vector


def point_in_polygon(u, v, poly):
    inside = False
    n = len(poly)
    for i in range(n):
        x1, y1 = poly[i]
        x2, y2 = poly[(i + 1) % n]
        if (y1 > v) != (y2 > v):
            x = x1 + (v - y1) * (x2 - x1) / (y2 - y1)
            if x > u:
                inside = not inside
    return inside


def circle_polygon(cu, cv, ru, rv, segments=72, start=0.0, end=math.tau):
    return [(cu + ru * math.cos(start + (end - start) * i / segments),
             cv + rv * math.sin(start + (end - start) * i / segments)) for i in range(segments)]


class Region:
    """A closed polygon in parameter space. action: 'hole' or a material index."""

    def __init__(self, polygon, action='hole', name=''):
        self.polygon = [tuple(map(float, p)) for p in polygon]
        self.action = action
        self.name = name


def param_mesh(name, u_values, v_values, mapper, regions=(), keep=None, materials=(), cut_lines=()):
    """Build a mesh object from a parameter grid.

    mapper(u: ndarray, v: ndarray) -> ndarray (N, 3) vehicle positions.
    regions: Region list; faces inside a 'hole' region are deleted, faces inside
    an int region get that material index. Later regions win.
    keep: optional polygon; faces outside it are deleted (clip to an outline).
    cut_lines: extra open polylines to cut along (panel gaps or creases).
    """
    bm = bmesh.new()
    nu, nv = len(u_values), len(v_values)
    grid = [[bm.verts.new((float(u), float(v), 0.0)) for v in v_values] for u in u_values]
    for i in range(nu - 1):
        for j in range(nv - 1):
            bm.faces.new((grid[i][j], grid[i + 1][j], grid[i + 1][j + 1], grid[i][j + 1]))
    outlines = [r.polygon for r in regions] + ([keep] if keep else [])
    for poly in outlines:
        cut_polygon(bm, poly, closed=True)
    for line in cut_lines:
        cut_polygon(bm, line, closed=False)

    remove = []
    for f in bm.faces:
        c = f.calc_center_median()
        if keep and not point_in_polygon(c.x, c.y, keep):
            remove.append(f)
            continue
        action = None
        for r in regions:
            if point_in_polygon(c.x, c.y, r.polygon):
                action = r.action
        if action == 'hole':
            remove.append(f)
        elif action is not None:
            f.material_index = int(action)
    bmesh.ops.delete(bm, geom=remove, context='FACES')
    loose = [v for v in bm.verts if not v.link_faces]
    bmesh.ops.delete(bm, geom=loose, context='VERTS')
    # Sliver faces from intersecting cut lines would shade badly once mapped.
    bmesh.ops.dissolve_degenerate(bm, dist=1e-6, edges=bm.edges)

    uv_layer = bm.loops.layers.uv.new('param')
    for f in bm.faces:
        for loop in f.loops:
            loop[uv_layer].uv = (loop.vert.co.x, loop.vert.co.y)
    verts = list(bm.verts)
    uv = np.array([(v.co.x, v.co.y) for v in verts]) if verts else np.zeros((0, 2))
    pos = mapper(uv[:, 0], uv[:, 1]) if len(uv) else []
    for v, p in zip(verts, pos):
        v.co = Vector(p)
    for f in bm.faces:
        f.smooth = True
    mesh = bpy.data.meshes.new(name)
    bm.to_mesh(mesh)
    bm.free()
    for m in materials:
        mesh.materials.append(m)
    return bpy.data.objects.new(name, mesh)


def cut_polygon(bm, poly, closed):
    pts = [Vector((p[0], p[1], 0.0)) for p in poly]
    count = len(pts) if closed else len(pts) - 1
    for i in range(count):
        a, b = pts[i], pts[(i + 1) % len(pts)]
        d = b - a
        if d.length < 1e-9:
            continue
        normal = Vector((-d.y, d.x, 0.0)).normalized()
        lo_x, hi_x = min(a.x, b.x) - 1e-4, max(a.x, b.x) + 1e-4
        lo_y, hi_y = min(a.y, b.y) - 1e-4, max(a.y, b.y) + 1e-4
        faces = []
        for f in bm.faces:
            xs = [v.co.x for v in f.verts]
            ys = [v.co.y for v in f.verts]
            if max(xs) < lo_x or min(xs) > hi_x or max(ys) < lo_y or min(ys) > hi_y:
                continue
            faces.append(f)
        if not faces:
            continue
        verts = {v for f in faces for v in f.verts}
        edges = {e for f in faces for e in f.edges}
        bmesh.ops.bisect_plane(bm, geom=list(verts) + list(edges) + faces, dist=1e-7, plane_co=a, plane_no=normal)


def mirror_y(obj, merge=0.0015):
    mod = obj.modifiers.new('Mirror to right side', 'MIRROR')
    mod.use_axis = (False, True, False)
    mod.use_mirror_merge = True
    mod.merge_threshold = merge
    return obj


def solidify(obj, thickness, offset=-1.0):
    mod = obj.modifiers.new('Panel thickness', 'SOLIDIFY')
    mod.thickness = thickness
    mod.offset = offset
    mod.use_even_offset = True
    return obj


def flip_normals(obj):
    bm = bmesh.new()
    bm.from_mesh(obj.data)
    bmesh.ops.reverse_faces(bm, faces=bm.faces)
    bm.to_mesh(obj.data)
    bm.free()


def orient_outward(obj, inside_point):
    """Flip the whole mesh if most of its area faces toward a point inside the car."""
    score = 0.0
    q = Vector(inside_point)
    for p in obj.data.polygons:
        score += (p.center - q).dot(p.normal) * p.area
    if score < 0:
        flip_normals(obj)
    return obj


def mesh_from_arrays(name, verts, faces, material=None, smooth=True):
    me = bpy.data.meshes.new(name)
    me.from_pydata([tuple(map(float, v)) for v in verts], [], [tuple(int(i) for i in f) for f in faces])
    me.update()
    if material is not None:
        me.materials.append(material)
    for p in me.polygons:
        p.use_smooth = smooth
    return bpy.data.objects.new(name, me)


def grid_faces(nu, nv, closed_u=False, closed_v=False):
    faces = []
    for i in range(nu if closed_u else nu - 1):
        for j in range(nv if closed_v else nv - 1):
            a = i * nv + j
            b = ((i + 1) % nu) * nv + j
            c = ((i + 1) % nu) * nv + (j + 1) % nv
            d = i * nv + (j + 1) % nv
            faces.append((a, b, c, d))
    return faces


def tube(name, points, radius, material, sides=10, closed=False, caps=True):
    """Swept circular tube along a 3D polyline (parallel-transport frames)."""
    p = np.asarray(points, dtype=float)
    n = len(p)
    if closed:
        tang = np.roll(p, -1, axis=0) - np.roll(p, 1, axis=0)
    else:
        tang = np.gradient(p, axis=0)
    tang /= np.linalg.norm(tang, axis=1, keepdims=True) + 1e-12
    ref = np.array([0, 0, 1.0]) if abs(tang[0][2]) < 0.9 else np.array([1.0, 0, 0])
    normal = np.cross(tang[0], ref)
    normal /= np.linalg.norm(normal)
    verts = []
    for i in range(n):
        normal = normal - tang[i] * np.dot(normal, tang[i])
        normal /= np.linalg.norm(normal) + 1e-12
        binormal = np.cross(tang[i], normal)
        for k in range(sides):
            a = math.tau * k / sides
            verts.append(p[i] + radius * (math.cos(a) * normal + math.sin(a) * binormal))
    faces = grid_faces(n, sides, closed_u=closed, closed_v=True)
    if caps and not closed:
        faces.append(tuple(range(sides - 1, -1, -1)))
        faces.append(tuple(range((n - 1) * sides, n * sides)))
    obj = mesh_from_arrays(name, verts, faces, material)
    return obj


def lathe(name, profile, material, segments=48, axis='y', centre=(0, 0, 0), smooth=True, closed_profile=False):
    """Revolve an (r, h) profile around an axis through centre."""
    cx, cy, cz = centre
    verts = []
    for k in range(segments):
        a = math.tau * k / segments
        ca, sa = math.cos(a), math.sin(a)
        for r, h in profile:
            if axis == 'y':
                verts.append((cx + r * ca, cy + h, cz + r * sa))
            elif axis == 'x':
                verts.append((cx + h, cy + r * ca, cz + r * sa))
            else:
                verts.append((cx + r * ca, cy + r * sa, cz + h))
    faces = grid_faces(segments, len(profile), closed_u=True, closed_v=closed_profile)
    return mesh_from_arrays(name, verts, faces, material, smooth)
