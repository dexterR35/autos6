// Capture review screenshots at the required viewports.
// Usage: npm run dev:web (in another terminal), then: node scripts/screenshots.js [baseUrl] [outDir]
import { chromium } from 'playwright';
import { mkdirSync } from 'node:fs';

const base = process.argv[2] || 'http://localhost:5173';
const out = process.argv[3] || 'docs/screenshots';
mkdirSync(out, { recursive: true });

const sizes = [
  [1983, 793],
  [1440, 900],
  [1024, 768],
  [390, 844],
];
const shots = (process.env.SHOTS || 'garage,front,selected,parts,donate').split(',');

const browser = await chromium.launch();
const errors = [];
for (const [w, h] of sizes) {
  const page = await browser.newPage({ viewport: { width: w, height: h }, deviceScaleFactor: 1 });
  page.on('console', (m) => m.type() === 'error' && errors.push(`${w}x${h}: ${m.text()}`));
  page.on('pageerror', (e) => errors.push(`${w}x${h}: ${e.message}`));
  await page.goto(base + '/', { waitUntil: 'networkidle' });
  await page.waitForSelector('.hotspot');
  await page.waitForTimeout(400);
  if (shots.includes('garage')) await page.screenshot({ path: `${out}/garage-${w}x${h}.png`, fullPage: w < 1100 });
  if (shots.includes('front')) {
    await page.click('[data-angle="front"]');
    await page.waitForSelector('.hotspot-layer[data-view="front"]');
    await page.waitForTimeout(500);
    await page.screenshot({ path: `${out}/front-${w}x${h}.png`, fullPage: w < 1100 });
    await page.click('[data-angle="exterior-a"]');
    await page.waitForSelector('.hotspot-layer[data-view="exterior-a"]');
    await page.waitForTimeout(400);
  }
  if (shots.includes('selected')) {
    await page.click('[data-part-row="hood"]');
    await page.waitForTimeout(500);
    await page.screenshot({ path: `${out}/selected-${w}x${h}.png`, fullPage: false });
    await page.keyboard.press('Escape');
  }
  if (shots.includes('donate')) {
    await page.goto(base + '/', { waitUntil: 'networkidle' });
    await page.click('.funding-panel .btn--donate');
    await page.waitForTimeout(300);
    await page.screenshot({ path: `${out}/donate-${w}x${h}.png` });
  }
  if (shots.includes('parts')) {
    await page.goto(base + '/parts', { waitUntil: 'networkidle' });
    await page.waitForTimeout(300);
    await page.screenshot({ path: `${out}/parts-${w}x${h}.png` });
  }
  await page.close();
}
await browser.close();
if (errors.length) {
  console.error('Console errors:\n' + errors.join('\n'));
  process.exitCode = 1;
} else console.log('Screenshots written to', out, '— no console errors.');
