"""Generate optimized derivatives from the original car images.

Originals in public/assets/car/*.png are never modified. Outputs:
  public/assets/car/web/<view>.webp      full-size stage image (q90)
  public/assets/car/thumbs/<view>.webp   angle-strip thumbnail
  public/assets/car/parts/<part>.webp    purposeful crop for part thumbnails
Run: python3 scripts/make-derivatives.py
"""
from pathlib import Path
from PIL import Image

ROOT = Path(__file__).resolve().parent.parent / 'public/assets/car'
VIEWS = ['exterior-a', 'exterior-b', 'exterior-c', 'exterior-d', 'front', 'rear',
         'side-a', 'side-b', 'rear-quarter-a', 'rear-quarter-b']

# part id -> (source view, centre x, centre y (normalized), crop width in source px)
PART_CROPS = {
    'front-bumper': ('front', 0.49, 0.62, 640),
    'hood': ('exterior-b', 0.60, 0.46, 560),
    'wheels': ('side-a', 0.258, 0.59, 250),
    'side-skirts': ('side-a', 0.47, 0.60, 560),
    'rear-bumper': ('rear', 0.495, 0.60, 640),
    'exhaust': ('rear', 0.383, 0.66, 230),
    'brake-kit': ('side-b', 0.70, 0.592, 210),
    'roof-box': ('side-a', 0.40, 0.28, 560),
}

(ROOT / 'web').mkdir(exist_ok=True)
(ROOT / 'thumbs').mkdir(exist_ok=True)
(ROOT / 'parts').mkdir(exist_ok=True)

for view in VIEWS:
    im = Image.open(ROOT / f'{view}.png').convert('RGB')
    im.save(ROOT / 'web' / f'{view}.webp', quality=90, method=6)
    im.resize((384, 216), Image.LANCZOS).save(ROOT / 'thumbs' / f'{view}.webp', quality=86, method=6)

for part, (view, cx, cy, w) in PART_CROPS.items():
    im = Image.open(ROOT / f'{view}.png').convert('RGB')
    W, H = im.size
    h = round(w * 2 / 3)
    left = max(0, min(W - w, round(cx * W - w / 2)))
    top = max(0, min(H - h, round(cy * H - h / 2)))
    crop = im.crop((left, top, left + w, top + h)).resize((240, 160), Image.LANCZOS)
    crop.save(ROOT / 'parts' / f'{part}.webp', quality=88, method=6)
print('done')
