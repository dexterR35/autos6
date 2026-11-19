// Social share card for one part (1200×630 PNG): cover photo, name, progress, what's left.
// Rendered with resvg from an SVG template; fonts are bundled (Inter, SIL OFL 1.1).
import { Resvg } from '@resvg/resvg-js';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { formatCents, percentOf } from '../src/lib/money.js';

const FONT_DIR = path.join(path.dirname(fileURLToPath(import.meta.url)), 'assets/fonts');
const FONTS = ['Inter_400Regular.ttf', 'Inter_800ExtraBold.ttf', 'Inter_900Black.ttf'].map((f) => path.join(FONT_DIR, f));
const IMAGE_TYPES = { 'image/jpeg': 'jpeg', 'image/png': 'png', 'image/webp': 'webp' };
const MAX_IMAGE_BYTES = 4 * 1024 * 1024;

const esc = (s) => String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&apos;' }[c]));

/** Greedy word wrap for the big title (no text measuring available in SVG). */
export function wrapTitle(text, maxChars = 16, maxLines = 3) {
  const words = String(text).trim().split(/\s+/);
  const lines = [];
  let line = '';
  for (const word of words) {
    const next = line ? `${line} ${word}` : word;
    if (next.length > maxChars && line) { lines.push(line); line = word; } else line = next;
  }
  if (line) lines.push(line);
  if (lines.length > maxLines) {
    const kept = lines.slice(0, maxLines);
    kept[maxLines - 1] = `${kept[maxLines - 1].slice(0, maxChars - 1)}…`;
    return kept;
  }
  return lines;
}

const STAGE = {
  needed: ['NEEDS FUNDING', '#ff3b55'], upgrade: ['UPGRADE · FUNDING', '#2a8dff'], funded: ['FULLY FUNDED', '#ffb43a'],
  ordered: ['ORDERED', '#9a7bff'], bought: ['BOUGHT', '#18e08a'], installed: ['INSTALLED', '#21e0c8'],
};

/**
 * Fetch a cover image only from origins this site already trusts (its own storage),
 * with a size cap and timeout. Returns a data: URI or null.
 */
export async function fetchCover(url, allowedOrigins, fetchImpl = fetch) {
  let parsed;
  try { parsed = new URL(url); } catch { return null; }
  if (parsed.protocol !== 'https:' && parsed.protocol !== 'http:') return null;
  if (!allowedOrigins.includes(parsed.origin)) return null;
  try {
    const res = await fetchImpl(parsed.href, { signal: AbortSignal.timeout(4000), redirect: 'error' });
    const type = (res.headers.get('content-type') || '').split(';')[0].trim();
    if (!res.ok || !IMAGE_TYPES[type]) return null;
    if (Number(res.headers.get('content-length')) > MAX_IMAGE_BYTES) return null;
    const buf = Buffer.from(await res.arrayBuffer());
    if (buf.length > MAX_IMAGE_BYTES) return null;
    return `data:${type};base64,${buf.toString('base64')}`;
  } catch {
    return null;
  }
}

export function partCardSvg(card, coverDataUri = null) {
  const pct = percentOf(card.raisedCents, card.goalCents);
  const left = Math.max(0, card.goalCents - card.raisedCents);
  const [stageLabel, stageColor] = STAGE[card.status] ?? STAGE.needed;
  const open = card.status === 'needed' || card.status === 'upgrade';
  const textX = coverDataUri ? 600 : 80;
  const width = coverDataUri ? 520 : 1040;
  const title = wrapTitle(card.name, coverDataUri ? 16 : 28);
  const titleSize = title.length > 2 ? 56 : 68;
  const titleTop = 220;
  const barY = titleTop + title.length * (titleSize + 8) + 40;
  const money = `${formatCents(card.raisedCents, card.currency)} of ${formatCents(card.goalCents, card.currency)}`;
  const footer = open ? (left > 0 ? `${formatCents(left, card.currency)} to go · help fund it` : 'Goal reached') : card.status === 'funded' ? 'Fully funded — thank you!' : 'Thanks to every supporter';
  return `<svg xmlns="http://www.w3.org/2000/svg" width="1200" height="630" viewBox="0 0 1200 630">
  <defs>
    <linearGradient id="bg" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="#0b1a2a"/><stop offset="0.55" stop-color="#060b11"/><stop offset="1" stop-color="#1c0710"/></linearGradient>
    <linearGradient id="bar" x1="0" x2="1"><stop offset="0" stop-color="#00c46a"/><stop offset="1" stop-color="#18e08a"/></linearGradient>
    <clipPath id="cover"><rect x="40" y="40" width="520" height="550" rx="28"/></clipPath>
  </defs>
  <rect width="1200" height="630" fill="url(#bg)"/>
  ${coverDataUri ? `<rect x="40" y="40" width="520" height="550" rx="28" fill="#0d1824"/>
  <image href="${coverDataUri}" x="40" y="40" width="520" height="550" preserveAspectRatio="xMidYMid slice" clip-path="url(#cover)"/>
  <rect x="40" y="40" width="520" height="550" rx="28" fill="none" stroke="#2c4a66" stroke-width="2"/>` : ''}
  <text x="${textX}" y="96" font-family="Inter" font-weight="900" font-size="30" fill="#ffffff" letter-spacing="1">${esc(card.projectTitle.toUpperCase())}</text>
  <rect x="${textX}" y="128" width="${stageLabel.length * 13 + 36}" height="44" rx="22" fill="${stageColor}" fill-opacity="0.18" stroke="${stageColor}" stroke-width="2"/>
  <text x="${textX + 18}" y="157" font-family="Inter" font-weight="800" font-size="20" fill="${stageColor}" letter-spacing="1.5">${esc(stageLabel)}</text>
  ${title.map((line, i) => `<text x="${textX}" y="${titleTop + 40 + i * (titleSize + 8)}" font-family="Inter" font-weight="900" font-size="${titleSize}" fill="#ffffff">${esc(line)}</text>`).join('\n  ')}
  <text x="${textX}" y="${barY}" font-family="Inter" font-weight="800" font-size="34" fill="#ffffff">${esc(money)}</text>
  <text x="${textX + width}" y="${barY}" text-anchor="end" font-family="Inter" font-weight="900" font-size="34" fill="#18e08a">${pct}%</text>
  <rect x="${textX}" y="${barY + 22}" width="${width}" height="18" rx="9" fill="#1d2a38"/>
  <rect x="${textX}" y="${barY + 22}" width="${Math.max(pct > 0 ? 18 : 0, Math.round(width * pct / 100))}" height="18" rx="9" fill="url(#bar)"/>
  <text x="${textX}" y="${barY + 92}" font-family="Inter" font-weight="400" font-size="28" fill="#a8b8c8">${esc(footer)}${card.supporters ? ` · ${card.supporters} supporter${card.supporters === 1 ? '' : 's'}` : ''}</text>
</svg>`;
}

export function renderPartCard(card, coverDataUri = null) {
  const resvg = new Resvg(partCardSvg(card, coverDataUri), {
    font: { fontFiles: FONTS, loadSystemFonts: false, defaultFontFamily: 'Inter' },
    fitTo: { mode: 'width', value: 1200 },
  });
  return resvg.render().asPng();
}
