// Search and share metadata for each part page (/parts/<slug>). Slugs match the parts
// table and the hotspots in src/data/views.js. No prices here: money changes, and stale
// figures in search results or link previews would mislead.
// `photo` is the part crop used inside its share image (scripts/make-og-images.mjs).

export const SEO_PARTS = [
  { slug: 'front-bumper', name: 'Front Bumper', photo: '/assets/car/s6/parts/front-bumper.webp', summary: 'The scratched front bumper gets repaired, primed and painted to match.' },
  { slug: 'hood', name: 'Hood', photo: '/assets/car/s6/parts/hood.webp', summary: 'The hood has failing clear coat and needs stripping, prep and a respray.' },
  { slug: 'wheels', name: 'Wheels (OEM+)', photo: '/assets/car/s6/parts/wheels.webp', summary: 'An OEM-style wheel refresh or upgrade, once the essentials are done.' },
  { slug: 'side-skirts', name: 'Side Skirts', photo: '/assets/car/s6/parts/side-skirts.webp', summary: 'Missing side skirt trim to be sourced and fitted.' },
  { slug: 'rear-bumper', name: 'Rear Bumper', photo: '/assets/car/s6/parts/rear-bumper.webp', summary: 'The rear bumper cover needs repair and refinishing.' },
  { slug: 'exhaust', name: 'Exhaust System', photo: '/assets/car/s6/parts/exhaust.webp', summary: 'A replacement exhaust that keeps the original quad-tip layout.' },
  { slug: 'coilovers', name: 'Coilovers (Suspension)', photo: null, summary: 'Worn suspension replaced with a quality coilover kit.' },
  { slug: 'brake-kit', name: 'Brake Kit', photo: '/assets/car/s6/parts/brake-kit.webp', summary: 'An optional front brake upgrade.' },
  { slug: 'roof-box', name: 'Roof Box', photo: '/assets/car/s6/parts/roof-box.webp', summary: 'The touring roof box, already bought and fitted.' },
  { slug: 'interior', name: 'Interior Refresh', photo: null, summary: 'Seats, trim and carpets cleaned and repaired.' },
];

export const partSharePath = (slug) => `/og/parts/${slug}.jpg`;
