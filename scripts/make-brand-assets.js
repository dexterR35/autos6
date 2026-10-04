// Generate social-share image, app icons and favicon.ico from HTML (Playwright).
// Usage: node scripts/make-brand-assets.js   (outputs into public/)
import { chromium } from 'playwright';
import { readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';

const ROOT = path.resolve(import.meta.dirname, '..');
const pub = (p) => path.join(ROOT, 'public', p);
const car = `data:image/webp;base64,${readFileSync(pub('assets/car/web/exterior-a.webp')).toString('base64')}`;
const font = `<link href="https://fonts.googleapis.com/css2?family=Inter:ital,wght@0,500;0,700;1,900&display=block" rel="stylesheet">`;

const ogHtml = `<!doctype html><html><head>${font}<style>
  *{margin:0;box-sizing:border-box} body{width:1200px;height:630px;font-family:Inter,sans-serif;color:#f4f7fb;background:#060b10;overflow:hidden;position:relative}
  .bg{position:absolute;inset:0;background:url(${car}) right -190px top 42%/auto 112% no-repeat}
  .shade{position:absolute;inset:0;background:linear-gradient(90deg,rgba(4,8,13,.95) 0%,rgba(4,8,13,.8) 38%,rgba(4,8,13,0) 64%),linear-gradient(0deg,rgba(4,8,13,.85) 0%,rgba(4,8,13,0) 35%)}
  .txt{position:absolute;left:64px;top:84px;width:640px}
  h1{white-space:nowrap;font-size:84px;font-weight:900;font-style:italic;letter-spacing:-.01em;line-height:1;text-shadow:0 4px 18px rgba(0,0,0,.6)} h1 span{color:#ff123b}
  .sub{margin-top:14px;font-size:26px;font-weight:500;color:#dfe6ee}
  .tag{margin-top:46px;font-size:34px;font-weight:700;line-height:1.15}
  .cta{position:absolute;left:64px;bottom:64px;display:flex;gap:14px;align-items:center}
  .btn{background:linear-gradient(180deg,#ff2a4e,#e10b31);border-radius:10px;padding:16px 28px;font-size:26px;font-weight:700;letter-spacing:.03em;box-shadow:0 0 30px rgba(255,18,59,.45)}
  .pill{border:2px solid #087cff;border-radius:10px;padding:14px 22px;font-size:22px;font-weight:500;color:#bfe0ff;box-shadow:0 0 18px rgba(8,124,255,.45)}
</style></head><body><div class="bg"></div><div class="shade"></div>
  <div class="txt"><h1>PROJECT <span>S6</span></h1><p class="sub">Audi S6 C5 Avant restoration</p><p class="tag">Help bring it back,<br>one part at a time.</p></div>
  <div class="cta"><span class="btn">♥ DONATE</span><span class="pill">Explore the garage</span></div>
</body></html>`;

const iconHtml = (size, pad) => `<!doctype html><html><head>${font}<style>*{margin:0}body{width:${size}px;height:${size}px;background:#060b10;display:grid;place-items:center;overflow:hidden}
  .i{width:${size - pad * 2}px;height:${size - pad * 2}px;border-radius:${Math.round(size * 0.18)}px;background:radial-gradient(circle at 50% 35%,#13202e,#060b10);display:grid;place-items:center;box-shadow:inset 0 0 0 ${Math.max(1, Math.round(size / 64))}px #087cff}
  b{font-family:Inter,sans-serif;font-weight:900;font-style:italic;font-size:${Math.round((size - pad * 2) * 0.5)}px;color:#ff123b;letter-spacing:-.02em}</style></head><body><div class="i"><b>S6</b></div></body></html>`;

/** Wrap a PNG in a single-image .ico container (PNG-in-ICO is supported by all modern browsers). */
function pngToIco(png, size) {
  const header = Buffer.alloc(22);
  header.writeUInt16LE(0, 0); header.writeUInt16LE(1, 2); header.writeUInt16LE(1, 4);
  header.writeUInt8(size >= 256 ? 0 : size, 6); header.writeUInt8(size >= 256 ? 0 : size, 7);
  header.writeUInt8(0, 8); header.writeUInt8(0, 9); header.writeUInt16LE(1, 10); header.writeUInt16LE(32, 12);
  header.writeUInt32LE(png.length, 14); header.writeUInt32LE(22, 18);
  return Buffer.concat([header, png]);
}

const browser = await chromium.launch();
async function shot(html, w, h, file, type = 'png') {
  const page = await browser.newPage({ viewport: { width: w, height: h } });
  await page.setContent(html, { waitUntil: 'networkidle' });
  await page.evaluate(() => document.fonts.ready);
  const buf = await page.screenshot({ type, quality: type === 'jpeg' ? 86 : undefined });
  await page.close();
  if (file) writeFileSync(pub(file), buf);
  return buf;
}
await shot(ogHtml, 1200, 630, 'og-image.jpg', 'jpeg');
await shot(iconHtml(180, 0), 180, 180, 'apple-touch-icon.png');
await shot(iconHtml(192, 0), 192, 192, 'icon-192.png');
await shot(iconHtml(512, 0), 512, 512, 'icon-512.png');
await shot(iconHtml(512, 56), 512, 512, 'icon-maskable-512.png'); // safe-zone padding
writeFileSync(pub('favicon.ico'), pngToIco(await shot(iconHtml(32, 0), 32, 32, null), 32));
await browser.close();
console.log('Brand assets written to public/');
