// Saves full-resolution renders of the garage lab page: node scripts/garage-lab-shot.mjs [shot,...] [query]
// Needs `npm run dev:web` running. Writes output/garage/web-<shot>.png.
import { mkdirSync } from 'node:fs';
import { resolve } from 'node:path';
import { chromium } from 'playwright';

const shots = (process.argv[2] || 'reference').split(',');
const query = process.argv[3] || '';
const base = process.env.LAB_BASE || 'http://localhost:5173';
const output = resolve('output/garage');
mkdirSync(output, { recursive: true });
const browser = await chromium.launch({
  channel: process.env.PLAYWRIGHT_CHANNEL || 'msedge',
  args: ['--enable-gpu', '--ignore-gpu-blocklist', '--use-angle=d3d11', '--enable-unsafe-swiftshader'],
});
const page = await browser.newPage({ viewport: { width: 1672, height: 941 } });
page.on('console', (message) => { if (message.type() === 'error' || message.type() === 'warning') console.log(`[${message.type()}]`, message.text()); });
page.on('pageerror', (error) => console.log('[pageerror]', error.message));
for (const shot of shots) {
  await page.goto(`${base}/scripts/garage-lab.html?shot=${shot}${query ? `&${query}` : ''}`);
  await page.waitForFunction(() => window.__lab?.ready, null, { timeout: 180000 });
  const info = await page.evaluate(() => {
    const gl = window.__lab.renderer.getContext();
    const debug = gl.getExtension('WEBGL_debug_renderer_info');
    return { gpu: debug ? gl.getParameter(debug.UNMASKED_RENDERER_WEBGL) : 'unknown', hud: document.getElementById('hud').textContent };
  });
  const suffix = query ? `-${query.replace(/[^a-z0-9]+/gi, '-')}` : '';
  const path = resolve(output, `web-${shot}${suffix}.png`);
  await page.locator('canvas').screenshot({ path });
  console.log(shot, info.gpu, info.hud, path);
}
await browser.close();
