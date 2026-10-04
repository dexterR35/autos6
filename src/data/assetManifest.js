// Part thumbnail manifest. To swap in real part photos later, drop an image in
// public/assets/car/parts/ and change the entry to { type: 'image', src, alt }.
// type 'crop'  — a purposeful crop of one of the supplied car photos (scripts/make-derivatives.py)
// type 'icon'  — the part is not visible in any supplied photo; an outlined icon is shown instead
export const partThumbnails = {
  'front-bumper': { type: 'crop', src: '/assets/car/parts/front-bumper.webp', sourceView: 'front' },
  hood: { type: 'crop', src: '/assets/car/parts/hood.webp', sourceView: 'exterior-b' },
  wheels: { type: 'crop', src: '/assets/car/parts/wheels.webp', sourceView: 'side-a' },
  'side-skirts': { type: 'crop', src: '/assets/car/parts/side-skirts.webp', sourceView: 'side-a' },
  'rear-bumper': { type: 'crop', src: '/assets/car/parts/rear-bumper.webp', sourceView: 'rear' },
  exhaust: { type: 'crop', src: '/assets/car/parts/exhaust.webp', sourceView: 'rear' },
  coilovers: { type: 'icon', icon: 'coilover' },
  'brake-kit': { type: 'crop', src: '/assets/car/parts/brake-kit.webp', sourceView: 'side-b' },
  'roof-box': { type: 'crop', src: '/assets/car/parts/roof-box.webp', sourceView: 'side-a' },
  interior: { type: 'icon', icon: 'seat' },
};

export function getPartThumbnail(part) {
  if (part?.thumbnailUrl) return { type: 'image', src: part.thumbnailUrl };
  return partThumbnails[part?.id] ?? { type: 'icon', icon: 'wrench' };
}
