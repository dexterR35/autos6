"""Publish verified Blender renders, projected hotspots and matching part crops.

Run after build_s6_c5.py has rendered every camera at 100% resolution.
The supplied reference photographs and their existing derivatives are preserved.
"""
import json
import shutil
from pathlib import Path
from PIL import Image

ROOT = Path(__file__).resolve().parents[1]
SOURCE = ROOT / 'output/s6'
DEST = ROOT / 'public/assets/car/s6'
MANIFEST = ROOT / 'src/data/s6RenderManifest.json'
report = json.loads((SOURCE / 'render-manifest.json').read_text())
required = {'exterior-a', 'exterior-b', 'front', 'rear', 'side-a', 'side-b', 'rear-quarter-a', 'rear-quarter-b'}
missing = required - set(report)
if missing:
    raise RuntimeError('Render all website angles before publishing: ' + ', '.join(sorted(missing)))

# Validate the entire batch before touching the website's current manifest.
for view, meta in report.items():
    with Image.open(SOURCE / (view + '.png')) as im:
        if im.size != (meta['width'], meta['height']):
            raise RuntimeError(f'{view}: expected full resolution, found {im.size}')
    for anchor in meta['hotspots']:
        if not (0 < anchor['x'] < 1 and 0 < anchor['y'] < 1):
            raise RuntimeError(f'{view}: hotspot outside image: {anchor}')

DEST.mkdir(parents=True, exist_ok=True)
(DEST / 'parts').mkdir(exist_ok=True)
manifest = {}
for view, meta in report.items():
    original = SOURCE / (view + '.png')
    shutil.copy2(original, DEST / original.name)
    with Image.open(original) as im:
        im = im.convert('RGB')
        im.save(DEST / (view + '.webp'), quality=93, method=6)
        im.resize((384, 216), Image.Resampling.LANCZOS).save(DEST / (view + '-thumb.webp'), quality=89, method=6)
    manifest[view] = {**meta, 'src': f'/assets/car/s6/{view}.webp', 'original': f'/assets/car/s6/{view}.png', 'thumb': f'/assets/car/s6/{view}-thumb.webp'}

# Crop around the actual projection from the renderer, not the old photo anchors.
crops = {
    'front-bumper': ('front', 700), 'hood': ('exterior-b', 470),
    'wheels': ('side-a', 255), 'side-skirts': ('side-a', 480),
    'rear-bumper': ('rear', 650), 'exhaust': ('rear', 210),
    'brake-kit': ('side-b', 250), 'roof-box': ('side-a', 600),
}
for part, (view, width) in crops.items():
    anchor = next(p for p in report[view]['hotspots'] if p['partId'] == part)
    with Image.open(SOURCE / (view + '.png')) as im:
        height = round(width * 2 / 3)
        x = max(0, min(im.width-width, round(anchor['x']*im.width-width/2)))
        y = max(0, min(im.height-height, round(anchor['y']*im.height-height/2)))
        im.convert('RGB').crop((x, y, x+width, y+height)).resize((240,160), Image.Resampling.LANCZOS).save(DEST/'parts'/(part+'.webp'), quality=92, method=6)
MANIFEST.write_text(json.dumps(manifest, indent=2) + '\n')
print(f'Published {len(manifest)} views, eight part crops and their projected hotspots.')
