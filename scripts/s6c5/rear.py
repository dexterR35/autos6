"""Avant rear: tail lamps, tailgate plate recess and badges, bumper and quad exhaust."""
import numpy as np

from .features import rrect
from .front import audi_rings, horizontal, plate, s6_badge, text_badge
from .materials import principled
from .meshgen import mesh_from_arrays, tube
from .util import disc_ring, frame_from_normal, inside


def tail_lamps(B):
    lay, m = B.lay, B.m
    s0, s1 = lay.taillamp_s
    # A red reflector stays red under the clearcoat. The old five-strength
    # emission flattened every cell into a pale pink stripe in the web view.
    red_optic = principled('S6 | tail lamp ruby reflector', (.24, .0025, .006),
                           .45, .21, .65, .08,
                           emission=(.65, .002, .005), strength=.55)
    # Reverse/indicator band across the lamp, clear lens over a white glow.
    band = np.array([(s0 - 0.1, 0.781), (s1 + 0.1, 0.781), (s1 + 0.1, 0.829), (s0 - 0.1, 0.829)])
    B.inset('S6 | tail lamp', lay.taillamp_lens, 0.075, red_optic, m['lamp_dark'], lens_mat=m['red_lens'],
            lens_inset=0.0012, step=0.008, back_regions=[(band, 1)], back_mats=[m['lamp_reverse']],
            lens_regions=[(band, 1)], lens_mats=[m['lens']])
    b = B.body
    # The C5 lenses contain small faceted reflector cells. A smooth red back
    # plate alone reads like painted horizontal stripes in the web export.
    # Keep these shallow reflector facets behind the existing tinted lens, clipped
    # to the same outline so the body opening and lamp silhouette stay intact.
    for label, rows, material in (
            ('ruby', (.734, .756, .850, .872, .894, .916, .938), red_optic),
            ('clear', (.794, .816), m['reflector'])):
        vertices, faces = [], []
        for s in np.arange(s0 + 0.033, s1 - 0.014, 0.034):
            for z in rows:
                corners = np.array([(s - .013, z - .007), (s + .013, z - .007),
                                    (s + .013, z + .007), (s - .013, z + .007)])
                if not inside(corners, lay.taillamp_lens).all():
                    continue
                base = len(vertices)
                vertices.extend(b.on_wall(corners, -0.030))
                vertices.extend(b.on_wall(np.array([(s, z)]), -0.026))
                faces.extend((base + i, base + (i + 1) % 4, base + 4) for i in range(4))
        if vertices:
            B.add(mesh_from_arrays('S6 | tail lamp %s faceted reflector cells' % label,
                                   vertices, faces, material, smooth=False), mirror=True)
    B.wall_line('S6 | tail lamp perimeter seal', lay.taillamp_lens, 0.0022, m['black'],
                offset=0.0008, clip_holes=False, closed=True, flatten=0.55)
    for z in (0.779, 0.831):
        pts = np.array([(s, z) for s in np.linspace(s0 + 0.02, s1 - 0.01, 60)])
        pos = b.on_wall(pts, -0.012)
        B.link(tube('S6 | tail lamp chrome divider', pos, 0.0025, m['reflector'], sides=6), mirror=True)
    # Fine horizontal optic ribs in the red sections.
    for z in (0.738, 0.756, 0.852, 0.872, 0.892, 0.912):
        pts = np.array([(s, z) for s in np.linspace(s0 + 0.03, s1 - 0.012, 40)])
        pts = pts[pts[:, 1] < np.array([b.z_of(np.array([s]), np.array([1.0]))[0] - 0.035 for s in pts[:, 0]])]
        if len(pts) > 1:
            B.link(tube('S6 | tail lamp optic rib', b.on_wall(pts, -0.022), 0.0014, m['lamp_dark'], sides=5), mirror=True)
    # Reflector cups: reverse lamp in the clear band, brake lamp in the lower red.
    for label, y, z, glow in [('reverse lamp', 0.70, 0.805, m['lamp_reverse']), ('brake lamp', 0.70, 0.748, red_optic)]:
        p, n = B.frame_at(float(b.s_rear(y)), z)
        f = horizontal(n)
        rr, uu, nn = frame_from_normal(f)
        c = p - n * 0.03
        B.link(disc_ring('S6 | tail lamp %s reflector' % label, c - f * 0.02, rr, uu, nn,
                         [(0.004, -0.012), (0.012, -0.008), (0.020, 0.008)], m['reflector'], 32), mirror=True)
        B.link(disc_ring('S6 | tail lamp %s bulb' % label, c - f * 0.012, rr, uu, nn,
                         [(0.0005, 0.006), (0.006, 0.004), (0.007, -0.002)], glow, 16), mirror=True)


def tailgate(B):
    b, lay, m = B.body, B.lay, B.m
    B.inset('S6 | rear plate recess', lay.plate_recess, 0.034, m['paint'], m['paint'], step=0.012)
    pl = lay.plate_rear
    zc = (pl['z0'] + pl['z1']) / 2
    p, n = B.frame_at(b.L, zc, -0.034 + 0.009)
    n = horizontal(n) * 0.97 + np.array([0, 0, 0.24])
    n /= np.linalg.norm(n)
    plate(B, 'S6 | rear plate B 08046', p, n, m['plate'], m['plastic'])
    # Plate lamps in the top of the recess.
    for y in (-0.17, 0.17):
        q, nn = B.frame_at(float(b.s_rear(abs(y))), 0.866, -0.02)
        q[1] = y
        B.link(disc_ring('S6 | rear plate lamp', q, *frame_from_normal(np.array([0, 0, -1.0]), (1, 0, 0)),
                         [(0.0005, 0.0), (0.02, 0.0)], m['lamp_reverse'], 16))
    # Chrome strip along the bottom edge of the tailgate.
    pts = [(s, lay.bumper_top + 0.013) for s in np.linspace(lay.s_tailgate + 0.012, b.L + 0.01, 80)]
    B.wall_line('S6 | tailgate chrome strip', pts, 0.0045, m['chrome'], offset=0.0, sides=8, flatten=0.45)
    p, n = B.frame_at(b.L, 0.918, 0.003)
    audi_rings(B, 'S6 | tailgate audi rings ring', p, n, 0.034, 0.0045, m['chrome'])
    # S6 on the left of the tailgate, quattro on the right (as seen from behind).
    p, n = B.frame_at(float(b.s_rear(0.505)), 0.742, 0.001)
    s6_badge(B, 'S6 | tailgate S6 badge', p, n, 0.034, m['chrome'], m['badge_red'])
    p, n = B.frame_at(float(b.s_rear(0.49)), 0.742, 0.001)
    p[1], n[1] = -p[1], -n[1]
    text_badge(B, 'S6 | tailgate quattro badge', 'quattro', p, n, 0.034, m['chrome'],
               font='C:/Windows/Fonts/arialbi.ttf', extrude=0.0008)


def exhaust(B):
    b, lay, m = B.body, B.lay, B.m
    B.inset('S6 | exhaust cut-out in rear bumper', lay.exhaust_cut, 0.11, m['grille'], m['plastic'], step=0.01)
    # A shallow horizontal insert separates the sculpted bumper from the tips.
    # It sits just proud of the existing black valance, without a new body hole.
    centre_insert = rrect(float(b.s_rear(0.39)), b.L + 0.025, 0.264, 0.323, 0.012)
    B.opening_bars('S6 | rear bumper lower valance horizontal ribs', centre_insert,
                   m['grille'], -0.003, 0.020, None, 0.0025, 0.004, margin=0.003)
    B.opening_bars('S6 | rear bumper lower valance vertical ribs', centre_insert,
                   m['grille'], -0.002, None, 0.055, 0.0013, 0.003, margin=0.003)
    f = np.array([-1.0, 0, 0])
    r, u, n = frame_from_normal(f)
    for i, tip in enumerate(lay.exhaust_tips):
        p, _ = B.frame_at(float(b.s_rear(tip['y'])), tip['z'])
        c = p + f * 0.004
        R = tip['r'] * 1.08
        B.link(disc_ring('S6 | exhaust tip %d' % i, c, r, u, n,
                         [(R * 0.93, -0.16), (R, -0.02), (R + 0.0018, -0.004), (R * 0.985, 0.0015),
                          (R * 0.92, 0.001), (R * 0.86, -0.006), (R * 0.85, -0.12)], m['chrome'], 48), mirror=True)
        B.link(disc_ring('S6 | exhaust tip soot %d' % i, c - f * 0.05, r, u, n,
                         [(0.0005, 0.0), (R * 0.87, 0.0)], m['grille'], 24), mirror=True)


def build(B):
    tail_lamps(B)
    tailgate(B)
    exhaust(B)
