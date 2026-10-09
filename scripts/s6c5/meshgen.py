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
    du = (max(u_values) - min(u_values)) / max(nu - 1, 1)
    dv = (max(v_values) - min(v_values)) / max(nv - 1, 1)
    index = _FaceIndex(bm.faces, max(du * 4, 1e-6), max(dv * 4, 1e-6))
    for poly in outlines:
        cut_polygon(bm, poly, closed=True, index=index)
    for line in cut_lines:
        cut_polygon(bm, line, closed=False, index=index)

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
    # Exact surface normals from the mapping, one-sided towards each face so
    # real creases (window frames, cut edges) stay crisp. Applied by
    # apply_param_normals() once the object's final orientation is known.
    # (Adding a layer reallocates loop data: create it before collecting loops.)
    layer = bm.loops.layers.float_vector.new('param_normal')
    loops = [lp for f in bm.faces for lp in f.loops]
    if loops:
        centres = {f: f.calc_center_median() for f in bm.faces}
        P = np.array([(lp.vert.co.x, lp.vert.co.y) for lp in loops])
        C = np.array([(centres[lp.face].x, centres[lp.face].y) for lp in loops])
        nrm = param_normals(mapper, P, C, (0.5 * du, 0.5 * dv))
        for lp, n in zip(loops, nrm):
            lp[layer] = n
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


class _FaceIndex:
    """Uniform-grid bucket index of face bounding boxes in parameter space."""

    def __init__(self, faces, cell_u, cell_v):
        self.cu, self.cv = cell_u, cell_v
        self.cells = {}
        self.box = {}
        for f in faces:
            self.insert(f)

    def _range(self, lo_x, hi_x, lo_y, hi_y):
        return (range(int(math.floor(lo_x / self.cu)), int(math.floor(hi_x / self.cu)) + 1),
                range(int(math.floor(lo_y / self.cv)), int(math.floor(hi_y / self.cv)) + 1))

    def insert(self, f):
        xs = [v.co.x for v in f.verts]
        ys = [v.co.y for v in f.verts]
        bb = (min(xs), max(xs), min(ys), max(ys))
        self.box[f] = bb
        rx, ry = self._range(*bb)
        for i in rx:
            for j in ry:
                self.cells.setdefault((i, j), []).append(f)

    def query(self, lo_x, hi_x, lo_y, hi_y):
        rx, ry = self._range(lo_x, hi_x, lo_y, hi_y)
        seen, out = set(), []
        for i in rx:
            for j in ry:
                for f in self.cells.get((i, j), ()):
                    if f in seen or not f.is_valid:
                        continue
                    seen.add(f)
                    bb = self.box[f]
                    if bb[1] < lo_x or bb[0] > hi_x or bb[3] < lo_y or bb[2] > hi_y:
                        continue
                    out.append(f)
        return out


def param_normals(mapper, P, C, eps=(2e-3, 2e-3)):
    """Surface normals at parameter points P, differenced towards the face centres C.

    eps is half the grid spacing: wide enough to ride over the fine linear
    segments of the outline tables, one-sided so real creases stay sharp."""
    d = C - P
    su = np.where(d[:, 0] >= 0, 1.0, -1.0)
    sv = np.where(d[:, 1] >= 0, 1.0, -1.0)
    p0 = mapper(P[:, 0], P[:, 1])
    pu = mapper(P[:, 0] + su * eps[0], P[:, 1])
    pv = mapper(P[:, 0], P[:, 1] + sv * eps[1])
    n = np.cross(pu - p0, pv - p0) * (su * sv)[:, None]
    ln = np.linalg.norm(n, axis=1, keepdims=True)
    return np.where(ln > 1e-14, n / np.maximum(ln, 1e-30), 0.0)


def apply_param_normals(obj):
    """Turn the stored analytic normals into custom split normals facing like their faces."""
    me = obj.data
    attr = me.attributes.get('param_normal')
    if attr is None:
        return
    n = np.zeros(len(me.loops) * 3)
    attr.data.foreach_get('vector', n)
    n = n.reshape(-1, 3)
    me.attributes.remove(attr)
    if not len(n):
        return
    pn = np.zeros(len(me.polygons) * 3)
    me.polygons.foreach_get('normal', pn)
    pn = pn.reshape(-1, 3)
    start = np.zeros(len(me.polygons), dtype=np.int64)
    total = np.zeros(len(me.polygons), dtype=np.int64)
    me.polygons.foreach_get('loop_start', start)
    me.polygons.foreach_get('loop_total', total)
    fn = np.repeat(pn, total, axis=0)
    order = np.concatenate([np.arange(s, s + t) for s, t in zip(start, total)])
    face_n = np.zeros_like(n)
    face_n[order] = fn
    dot = np.einsum('ij,ij->i', n, face_n)
    n[dot < 0] *= -1
    bad = np.linalg.norm(n, axis=1) < 0.5
    n[bad] = face_n[bad]
    vi = np.zeros(len(me.loops), dtype=np.int64)
    me.loops.foreach_get('vertex_index', vi)
    me.normals_split_custom_set([tuple(v) for v in weld_normals(n, vi, len(me.vertices))])


def weld_normals(n, vi, n_verts, max_angle_deg=12.0):
    """One shared normal per vertex unless its corners really differ (a crease).

    Identical corner normals let exporters share the vertex instead of
    duplicating it for every face around it."""
    acc = np.zeros((n_verts, 3))
    np.add.at(acc, vi, n)
    mean = acc / (np.linalg.norm(acc, axis=1, keepdims=True) + 1e-12)
    dots = np.einsum('ij,ij->i', n, mean[vi])
    worst = np.ones(n_verts)
    np.minimum.at(worst, vi, dots)
    smooth = worst >= math.cos(math.radians(max_angle_deg))
    return np.where(smooth[vi][:, None], mean[vi], n)


def weld_mesh_normals(me, max_angle_deg=12.0):
    """weld_normals() for an existing mesh with custom normals (used by the web export)."""
    if not me.has_custom_normals or not len(me.loops):
        return
    n = np.zeros(len(me.loops) * 3)
    me.corner_normals.foreach_get('vector', n)
    vi = np.zeros(len(me.loops), dtype=np.int64)
    me.loops.foreach_get('vertex_index', vi)
    me.normals_split_custom_set([tuple(v) for v in weld_normals(n.reshape(-1, 3), vi, len(me.vertices), max_angle_deg)])


def cut_polygon(bm, poly, closed, index=None):
    pts = [Vector((p[0], p[1], 0.0)) for p in poly]
    count = len(pts) if closed else len(pts) - 1
    if index is None:
        index = _FaceIndex(bm.faces, 0.05, 0.05)
    for i in range(count):
        a, b = pts[i], pts[(i + 1) % len(pts)]
        d = b - a
        if d.length < 1e-9:
            continue
        normal = Vector((-d.y, d.x, 0.0)).normalized()
        lo_x, hi_x = min(a.x, b.x) - 1e-4, max(a.x, b.x) + 1e-4
        lo_y, hi_y = min(a.y, b.y) - 1e-4, max(a.y, b.y) + 1e-4
        faces = index.query(lo_x, hi_x, lo_y, hi_y)
        if not faces:
            continue
        verts = {v for f in faces for v in f.verts}
        edges = {e for f in faces for e in f.edges}
        res = bmesh.ops.bisect_plane(bm, geom=list(verts) + list(edges) + faces, dist=1e-7, plane_co=a, plane_no=normal)
        for g in res['geom']:
            if isinstance(g, bmesh.types.BMFace) and g not in index.box:
                index.insert(g)
            elif isinstance(g, bmesh.types.BMFace):
                # Existing faces keep their slot but may have shrunk; refresh their box.
                xs = [v.co.x for v in g.verts]
                ys = [v.co.y for v in g.verts]
                index.box[g] = (min(xs), max(xs), min(ys), max(ys))


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
