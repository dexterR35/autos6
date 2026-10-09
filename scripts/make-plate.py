"""Draw the Romanian registration plate texture used on the S6 model.

python scripts/make-plate.py  (Python 3 + Pillow, Windows fonts)
Writes scripts/s6c5/textures/plate-ro-b08046.png: a 520 x 110 mm EU plate at
4 px/mm with red lettering and border, as in the reference photographs.
"""
import math
from pathlib import Path

from PIL import Image, ImageDraw, ImageFont

ROOT = Path(__file__).resolve().parents[1]
OUT = ROOT / 'scripts' / 's6c5' / 'textures' / 'plate-ro-b08046.png'
OUT.parent.mkdir(parents=True, exist_ok=True)

PX = 4
W, H = 520 * PX, 110 * PX
RED = (200, 16, 30)
img = Image.new('RGB', (W, H), (246, 246, 242))
d = ImageDraw.Draw(img)
d.rounded_rectangle([3 * PX, 3 * PX, W - 3 * PX, H - 3 * PX], radius=6 * PX, outline=RED, width=int(3.2 * PX))

# EU band: blue, ring of twelve yellow stars, country code.
band = [6 * PX, 6 * PX, 46 * PX, H - 6 * PX]
d.rectangle(band, fill=(0, 56, 160))
cx, cy, ring = (band[0] + band[2]) / 2, 30 * PX, 10 * PX
for i in range(12):
    a = math.tau * i / 12
    x, y = cx + ring * math.cos(a), cy + ring * math.sin(a)
    r = 1.9 * PX
    pts = [(x + (r if k % 2 == 0 else r * 0.42) * math.cos(-math.pi / 2 + k * math.pi / 5),
            y + (r if k % 2 == 0 else r * 0.42) * math.sin(-math.pi / 2 + k * math.pi / 5)) for k in range(10)]
    d.polygon(pts, fill=(255, 214, 0))
code = ImageFont.truetype('C:/Windows/Fonts/bahnschrift.ttf', int(24 * PX))
code.set_variation_by_name('Bold')
d.text((cx, 80 * PX), 'RO', font=code, fill=(255, 255, 255), anchor='mm')

text = ImageFont.truetype('C:/Windows/Fonts/bahnschrift.ttf', int(86 * PX))
text.set_variation_by_name('SemiBold SemiCondensed')
d.text(((band[2] + W - 6 * PX) / 2, H / 2 + 2 * PX), 'B 08046', font=text, fill=RED, anchor='mm')
img.save(OUT)
print('wrote', OUT)
