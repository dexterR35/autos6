# Dev helper: draw hotspot anchors + a 5% grid onto view images for visual calibration.
import json, sys
from PIL import Image, ImageDraw
spec = json.load(open(sys.argv[1]))
out = sys.argv[2]
for vid, pts in spec.items():
    im = Image.open(f'public/assets/car/{vid}.png').convert('RGB')
    W, H = im.size
    d = ImageDraw.Draw(im)
    for i in range(1, 20):
        x = W * i / 20; y = H * i / 20
        c = (255, 255, 0) if i % 2 == 0 else (90, 90, 0)
        d.line((x, 0, x, H), fill=c, width=1); d.line((0, y, W, y), fill=c, width=1)
        if i % 2 == 0:
            d.text((x + 2, 2), f'{i/20:.2f}', fill=(255, 255, 0)); d.text((2, y + 2), f'{i/20:.2f}', fill=(255, 255, 0))
    for name, (x, y) in pts.items():
        px, py = x * W, y * H
        d.ellipse((px - 10, py - 10, px + 10, py + 10), outline=(0, 255, 255), width=4)
        d.text((px + 12, py - 6), name, fill=(0, 255, 255))
    im.resize((W * 3 // 4, H * 3 // 4)).save(f'{out}/{vid}.jpg', quality=82)
