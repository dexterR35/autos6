"""Dimensions and design parameters of the 2003 Audi S6 C5 Avant (facelift).

Base dimensions are the factory figures (4.85 m long, 1.85 m wide over the S6
wings, 2.759 m wheelbase, 1.425 m high with rails). Heights and feature
positions were measured on the supplied reference photographs: side profile
(ref 14), front (ref 13), rear (ref 20) and the three-quarter views; the side
photograph's vertical scale was calibrated on the 0.66 m tyre diameter.
"""

LENGTH = 4.797                             # 2003 A6/S6 C5 Avant
X_FRONT = 2.425
X_REAR = -2.372
# The reference car sits on a slightly longer wheelbase with shorter
# overhangs than the factory 2.759 m; the axles follow the reference.
WHEELBASE = 2.845
X_AXLE_F = 1.50
X_AXLE_R = X_AXLE_F - WHEELBASE           # -1.345
TRACK = 1.57
TYRE_R = 0.34                              # 255/35 R20 on the reference car
TYRE_W = 0.25
WHEEL_Z = TYRE_R
WHEEL_FACE_Y = 0.875                       # spoke face of the wheel
ARCH_R_F = 0.376
ARCH_R_R = 0.382

# Equator (widest line of the lower body) in plan, left half, front centre to
# rear centre. Wheel flares are added on top of this as a displacement.
EQUATOR = [
    (2.425, 0.0), (2.421, 0.25), (2.406, 0.46), (2.380, 0.60), (2.334, 0.710),
    (2.252, 0.800), (2.125, 0.862), (1.960, 0.896), (1.800, 0.904), (1.500, 0.906),
    (1.000, 0.906), (0.300, 0.905), (-0.500, 0.905), (-1.345, 0.908),
    (-1.700, 0.901), (-1.960, 0.883), (-2.125, 0.850), (-2.240, 0.780),
    (-2.312, 0.655), (-2.350, 0.465), (-2.366, 0.250), (-2.372, 0.0),
]

# Section knots, bottom to top: (z, inset from the equator). Each station is
# located on the outline by ('front', y), ('side', x) or ('rear', y).
KNOTS = ['bottom', 'lip', 'lower', 'crease', 'equator', 'shoulder', 'upper', 'top']
STATIONS = [
    (('front', 0.00), [(0.140, .080), (0.170, .032), (0.260, .012), (0.360, .002), (0.440, 0), (0.565, .030), (0.680, .072), (0.775, .125)]),
    (('front', 0.45), [(0.145, .078), (0.175, .032), (0.265, .012), (0.360, .002), (0.440, 0), (0.565, .028), (0.685, .068), (0.780, .125)]),
    (('front', 0.72), [(0.150, .074), (0.180, .032), (0.270, .012), (0.365, .002), (0.445, 0), (0.575, .026), (0.690, .066), (0.788, .128)]),
    (('side', 2.05), [(0.165, .065), (0.195, .030), (0.285, .012), (0.380, .003), (0.470, 0), (0.610, .022), (0.720, .060), (0.800, .130)]),
    (('side', 1.80), [(0.180, .055), (0.215, .025), (0.300, .010), (0.420, .003), (0.540, 0), (0.700, .018), (0.780, .055), (0.835, .125)]),
    (('side', 1.50), [(0.190, .050), (0.225, .020), (0.310, .008), (0.440, .006), (0.600, 0), (0.760, .016), (0.820, .052), (0.865, .120)]),
    (('side', 1.00), [(0.175, .052), (0.215, .014), (0.290, .002), (0.420, .016), (0.640, 0), (0.860, .012), (0.900, .042), (0.928, .110)]),
    (('side', 0.40), [(0.175, .055), (0.215, .014), (0.290, .002), (0.420, .018), (0.640, 0), (0.870, .012), (0.915, .044), (0.950, .113)]),
    (('side', -0.40), [(0.175, .055), (0.215, .014), (0.290, .002), (0.420, .018), (0.640, 0), (0.878, .012), (0.935, .046), (0.980, .114)]),
    (('side', -1.00), [(0.180, .054), (0.220, .016), (0.300, .004), (0.430, .014), (0.640, 0), (0.885, .013), (0.950, .048), (1.003, .114)]),
    (('side', -1.345), [(0.195, .050), (0.240, .020), (0.330, .008), (0.450, .006), (0.640, 0), (0.890, .015), (0.960, .050), (1.015, .112)]),
    (('side', -1.75), [(0.200, .055), (0.245, .022), (0.330, .009), (0.440, .004), (0.600, 0), (0.860, .020), (0.950, .060), (1.020, .118)]),
    (('side', -2.05), [(0.205, .062), (0.250, .026), (0.330, .010), (0.420, .003), (0.520, 0), (0.700, .025), (0.880, .068), (1.000, .132)]),
    (('rear', 0.62), [(0.205, .072), (0.250, .032), (0.330, .012), (0.420, .003), (0.500, 0), (0.620, .030), (0.800, .085), (0.982, .158)]),
    (('rear', 0.30), [(0.200, .082), (0.245, .038), (0.330, .012), (0.420, .003), (0.490, 0), (0.608, .034), (0.800, .098), (0.978, .172)]),
    (('rear', 0.00), [(0.200, .085), (0.245, .040), (0.330, .012), (0.420, .003), (0.490, 0), (0.605, .035), (0.800, .100), (0.975, .176)]),
]

# Wheel-arch flares (S6 widened wings): outward bulge around each opening.
FLARE_F = dict(x=X_AXLE_F, z=WHEEL_Z, r=ARCH_R_F, amp=0.019, width=0.17)
FLARE_R = dict(x=X_AXLE_R, z=WHEEL_Z, r=ARCH_R_R, amp=0.024, width=0.20)

# Character lines on the body side: (z at x samples) and strength (m).
SHOULDER_LINE = dict(xs=[2.10, 1.80, 1.47, 1.00, 0.00, -1.00, -1.75, -2.05],
                     zs=[0.790, 0.810, 0.835, 0.860, 0.873, 0.884, 0.880, 0.860], amp=0.0035, width=0.035)
LOWER_CREASE = dict(x0=-0.95, x1=1.05, z=0.556, amp=0.0028, width=0.030)

# Top edge of the lower body, front centre to rear centre (x, y, z): bonnet
# leading edge, wing tops (bonnet shut line), window line (glass base), then
# across the tailgate at the bottom of the rear glass.
TOP_EDGE = [
    (2.300, 0.000, 0.766), (2.297, 0.200, 0.766), (2.276, 0.400, 0.768), (2.234, 0.550, 0.7745),
    (2.168, 0.660, 0.7793), (2.078, 0.735, 0.784), (1.912, 0.776, 0.795), (1.700, 0.787, 0.812),
    (1.470, 0.791, 0.835), (1.200, 0.793, 0.868), (1.000, 0.793, 0.896), (0.930, 0.793, 0.905),
    (0.500, 0.792, 0.925), (0.000, 0.791, 0.942), (-0.500, 0.791, 0.958), (-1.000, 0.791, 0.973),
    (-1.400, 0.790, 0.984), (-1.735, 0.786, 0.990), (-1.900, 0.774, 0.987), (-2.020, 0.752, 0.982),
    (-2.110, 0.718, 0.976), (-2.170, 0.676, 0.971), (-2.205, 0.630, 0.967), (-2.222, 0.560, 0.964),
    (-2.229, 0.400, 0.962), (-2.231, 0.000, 0.961),
]
GREENHOUSE_END_X = -2.229

# Windscreen base (cowl): centre and where it meets the wing top at the A-pillar.
COWL_X_CENTRE = 1.13
A_PILLAR_BASE_X = 1.00

# Hood centreline height (x, z): leading edge to cowl.
# Continues past the cowl centre so the hood behind it (towards the A-pillars) has no crease.
HOOD_CENTRE = [(2.300, 0.766), (2.200, 0.786), (2.000, 0.818), (1.700, 0.862), (1.400, 0.898), (1.130, 0.928), (0.950, 0.946)]
HOOD_DOME = dict(y_front=0.38, y_rear=0.33, amp=0.0065, soft=0.13)

# Greenhouse. DLO top (window frame top) side profile, measured on ref 14.
DLO_TOP = [(0.930, 0.912), (0.760, 1.0412), (0.577, 1.1794), (0.370, 1.2753), (0.000, 1.327),
           (-0.400, 1.347), (-0.770, 1.355), (-1.150, 1.361), (-1.400, 1.363), (-1.560, 1.1794), (-1.735, 0.995)]
DLO_FRONT_X = 0.930
DLO_REAR_X = -1.735
TUMBLEHOME = 0.40            # glass lean inward per metre of height
GLASS_BOW = 0.010
# Centreline: windscreen, roof and the raked tailgate glass.
CENTRE_TOP = [(1.130, 0.93), (1., 1.), (0.800, 1.1266), (0.600, 1.2624), (0.500, 1.325),
              (0.420, 1.36), (0.300, 1.383), (0.000, 1.401), (-0.600, 1.408), (-1.200, 1.403),
              (-1.560, 1.391), (-1.700, 1.379), (-1.760, 1.347), (-1.880, 1.2624), (-2.020, 1.1378),
              (-2.150, 1.0255), (-2.229, 0.961)]
WINDSCREEN_TOP_X = (0.360, 0.480)      # header at the A-pillar and at the centre line
REAR_GLASS_TOP_X = (-1.760, -1.760)
# Inner edge of the pillars / roof side (x, y, z): A-pillar (windscreen edge),
# roof edge above the side windows, D-pillar (tailgate glass edge).
PILLAR_EDGE = [
    (0.900, 0.735, 1.0203), (0.750, 0.690, 1.1288), (0.600, 0.648, 1.2494), (0.500, 0.624, 1.3129),
    (0.380, 0.604, 1.359), (0.200, 0.594, 1.377), (-0.200, 0.592, 1.387), (-0.800, 0.591, 1.391),
    (-1.300, 0.588, 1.385), (-1.560, 0.582, 1.375), (-1.680, 0.576, 1.365), (-1.760, 0.570, 1.337),
    (-1.880, 0.576, 1.2537), (-2.020, 0.588, 1.1288), (-2.150, 0.596, 1.0203), (-2.229, 0.600, 0.961),
]

# Pillars on the side window band, as (x at beltline, x at DLO top).
B_PILLAR = ((-0.172, -0.170), (-0.095, -0.100))
C_BAR = ((-0.995, -0.805), (-0.965, -0.775))
