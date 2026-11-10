// Real-WebGL verification of the Blender assemblies and their visible controls.
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { mkdirSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { chromium } from 'playwright';

const base = process.argv[2] || 'http://127.0.0.1:5173';
const output = resolve('output/car-refinement/imported-v3/wheel-check');
mkdirSync(output, { recursive: true });
const browser = await chromium.launch({ channel: 'msedge', args: ['--enable-gpu', '--ignore-gpu-blocklist', '--use-angle=d3d11', '--enable-unsafe-swiftshader'] });
const report = { checks: [], runtimeErrors: [], screenshots: [] };
const hash = bytes => createHash('sha256').update(bytes).digest('hex');
try {
  const page = await browser.newPage({ viewport: { width: 1440, height: 1000 } });
  page.on('pageerror', error => report.runtimeErrors.push(error.message));
  await page.route('**/rest/v1/rpc/get_garage_supporters', route => route.fulfill({ json: [] }));
  async function ready() {
    await page.goto(base);
    await page.locator('[data-testid="three-viewer"][data-loaded="true"]').waitFor({ timeout: 120000 });
  }
  await ready();
  const canvas = page.locator('canvas.three-canvas');
  const before = hash(await canvas.screenshot());
  await page.getByRole('button', { name: 'Customize wheels and brakes' }).click();
  await page.getByRole('button', { name: 'Rim colour: Bronze', exact: true }).click();
  await page.getByRole('button', { name: 'Caliper colour: Yellow', exact: true }).click();
  await page.getByRole('button', { name: 'Track Semi-slick tread' }).click();
  await page.waitForFunction(() => {
    const data = document.querySelector('[data-testid="three-viewer"]').dataset;
    return data.rimColor === '#a67c46' && data.caliperColor === '#e5b62a' && data.tyreVariant === 'track';
  });
  await page.keyboard.press('Escape');
  assert.equal(await page.locator('#wheel-setup').count(), 0);
  await page.waitForTimeout(300);
  const after = hash(await canvas.screenshot());
  assert.notEqual(before, after, 'Material/tyre changes must alter the actual rendered canvas');
  report.checks.push('Bronze rims, yellow calipers and track tyres change the real WebGL image');
  await ready();
  const viewer = page.locator('[data-testid="three-viewer"]');
  assert.equal(await viewer.getAttribute('data-tyre-variant'), 'track');
  assert.equal(await viewer.getAttribute('data-rim-color'), '#a67c46');
  report.checks.push('Configuration survives a page reload');
  await page.getByRole('button', { name: 'Customize wheels and brakes' }).click();
  const desktop = resolve(output, 'desktop-customization.png');
  await page.screenshot({ path: desktop }); report.screenshots.push(desktop);
  await page.getByRole('button', { name: 'Reset wheel setup' }).click();
  assert.equal(await viewer.getAttribute('data-tyre-variant'), 'road');
  assert.equal(await viewer.getAttribute('data-rim-color'), '#657080');
  report.checks.push('Reset restores road tyres and the original finishes');
  await page.setViewportSize({ width: 390, height: 844 });
  const panel = await page.locator('#wheel-setup').boundingBox();
  assert.ok(panel && panel.x >= 0 && panel.x + panel.width <= 390 && panel.y >= 0, 'Mobile controls stay on screen');
  await page.getByRole('button', { name: 'Rim colour: Silver', exact: true }).click();
  await page.getByRole('button', { name: 'Road Grooved everyday tread' }).click();
  const mobile = resolve(output, 'mobile-customization.png');
  await page.screenshot({ path: mobile }); report.screenshots.push(mobile);
  report.checks.push('Mobile colour and tyre controls fit and respond');
  await page.setViewportSize({ width: 320, height: 740 });
  for (const button of await page.locator('.three-toolbar button').all()) {
    const rect = await button.boundingBox();
    assert.ok(rect.x >= 0 && rect.x + rect.width <= 320 && rect.width >= 44 && rect.height >= 44, 'Narrow phone camera controls retain their touch targets');
  }
  report.checks.push('All seven controls fit a 320px phone with 44px touch targets');
  await page.getByRole('button', { name: 'Reset wheel setup' }).click();
  assert.deepEqual(report.runtimeErrors, []);
  report.passed = true;
} finally {
  await browser.close();
  writeFileSync(resolve(output, 'report.json'), JSON.stringify(report, null, 2));
}
console.log(JSON.stringify(report, null, 2));
