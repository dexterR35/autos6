// Builds the 1200×630 share image for every part page into public/og/parts/<slug>.jpg.
// Run after changing src/seo/parts.js:  node scripts/make-og-images.mjs
// Uses sharp, which is installed with the pinned glTF Transform CLI dev dependency.
import { mkdirSync } from 'node:fs';
import path from 'node:path';
import sharp from 'sharp';
import { SEO_PARTS, partSharePath } from '../src/seo/parts.js';

const W = 1200;
const H = 630;
const root = process.cwd();
const fromPublic = (p) => path.join(root, 'public', p.replace(/^\//, ''));
const xml = (s) => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
const FONT = "'Segoe UI', 'Inter', Arial, sans-serif";

// Long names wrap onto two lines at a smaller size so they never run into the photo.
function nameLines(name) {
  if (name.length <= 13) return { size: 66, lines: [name] };
  const words = name.split(' ');
  let best = [name];
  for (let i = 1; i < words.length; i++) {
    const a = words.slice(0, i).join(' ');
    const b = words.slice(i).join(' ');
    if (Math.max(a.length, b.length) < Math.max(...best.map((l) => l.length))) best = [a, b];
  }
  return { size: best.length > 1 ? 54 : 50, lines: best };
}

const CARD = { x: 650, y: 150, w: 480, h: 320, r: 22 };

function overlay(part) {
  const { size, lines } = nameLines(part.name);
  const nameY = 300 - (lines.length - 1) * size * 0.55;
  const name = lines.map((line, i) => `<tspan x="64" dy="${i === 0 ? 0 : size * 1.08}">${xml(line)}</tspan>`).join('');
  const subY = nameY + (lines.length - 1) * size * 1.08 + 58;
  return Buffer.from(`<svg xmlns="http://www.w3.org/2000/svg" width="${W}" height="${H}">
  <defs>
    <linearGradient id="shade" x1="0" x2="1" y1="0" y2="0">
      <stop offset="0" stop-color="#05090e" stop-opacity="0.96"/>
      <stop offset="0.55" stop-color="#05090e" stop-opacity="0.82"/>
      <stop offset="1" stop-color="#05090e" stop-opacity="0.5"/>
    </linearGradient>
  </defs>
  <rect width="${W}" height="${H}" fill="url(#shade)"/>
  <rect x="${CARD.x - 3}" y="${CARD.y - 3}" width="${CARD.w + 6}" height="${CARD.h + 6}" rx="${CARD.r + 3}" fill="none" stroke="#2a8dff" stroke-width="3"/>
  <text x="64" y="112" font-family="${FONT}" font-size="46" font-weight="900" font-style="italic" fill="#f4f7fb" letter-spacing="1">PROJECT <tspan fill="#ff123b">S6</tspan></text>
  <rect x="64" y="134" width="64" height="5" rx="2.5" fill="#ff123b"/>
  <text x="64" y="${nameY}" font-family="${FONT}" font-size="${size}" font-weight="800" fill="#ffffff">${name}</text>
  <text x="64" y="${subY}" font-family="${FONT}" font-size="28" fill="#b2bfce">Audi S6 C5 Avant restoration</text>
  <rect x="64" y="500" width="300" height="64" rx="12" fill="#e60f33"/>
  <text x="214" y="542" text-anchor="middle" font-family="${FONT}" font-size="26" font-weight="800" fill="#ffffff" letter-spacing="1">FUND THIS PART</text>
</svg>`);
}

async function card(part) {
  // Parts without their own photo use the whole car, so the card is never empty.
  const source = part.photo ? fromPublic(part.photo) : fromPublic('/assets/car/s6/exterior-a.webp');
  const mask = Buffer.from(`<svg xmlns="http://www.w3.org/2000/svg" width="${CARD.w}" height="${CARD.h}"><rect width="${CARD.w}" height="${CARD.h}" rx="${CARD.r}" fill="#fff"/></svg>`);
  return sharp(source)
    .resize(CARD.w, CARD.h, { fit: 'cover', kernel: 'lanczos3' })
    .composite([{ input: mask, blend: 'dest-in' }])
    .png()
    .toBuffer();
}

const background = await sharp(fromPublic('/assets/garage/studio-bg.webp')).resize(W, H, { fit: 'cover', position: 'centre' }).modulate({ brightness: 0.9 }).toBuffer();
mkdirSync(fromPublic('/og/parts'), { recursive: true });
for (const part of SEO_PARTS) {
  const out = fromPublic(partSharePath(part.slug));
  const info = await sharp(background)
    .composite([{ input: overlay(part) }, { input: await card(part), left: CARD.x, top: CARD.y }])
    .jpeg({ quality: 82, mozjpeg: true })
    .toFile(out);
  console.log(`${path.relative(root, out)}  ${info.width}×${info.height}  ${Math.round(info.size / 1024)} KB`);
}
