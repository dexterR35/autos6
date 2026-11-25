// Real WebGL and UI checks for the supplied A6, without database writes.
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { mkdirSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { chromium } from 'playwright';
import { CAR_RELEASE } from '../src/lib/modelAssets.js';

const base = process.argv[2] || 'http://127.0.0.1:5173';
const output = resolve('output/car-refinement/a6-c5-v1/browser-check');
mkdirSync(output, { recursive: true });
const report = { story: 'Garage loads the supplied blue A6; controls articulate its panels and axles and preserve wheel customization.', checks: [], assets: [], runtimeErrors: [], screenshots: [] };
const browser = await chromium.launch({ channel: 'msedge', args: ['--enable-gpu', '--ignore-gpu-blocklist', '--use-angle=d3d11', '--enable-unsafe-swiftshader'] });
const hash = bytes => createHash('sha256').update(bytes).digest('hex');
try {
  const page = await browser.newPage({ viewport: { width: 1440, height: 1000 } });
  page.on('pageerror', error => report.runtimeErrors.push(error.message));
  page.on('response', response => { if (/\.glb(?:\?|$)/.test(response.url())) report.assets.push({ url: response.url(), status: response.status() }); });
  await page.route('**/rest/v1/rpc/get_garage_supporters', route => route.fulfill({ json: [] }));
  const viewer = page.locator('[data-testid="three-viewer"]');
  const canvas = page.locator('canvas.three-canvas');
  const pose = () => viewer.evaluate(element => JSON.parse(element.dataset.carRig));
  const screenshot = async name => { const file = resolve(output, name + '.png'); await page.screenshot({ path: file }); report.screenshots.push(file); };
  async function settled() {
    await page.waitForTimeout(1000);
    await page.waitForFunction(() => {
      const rig = JSON.parse(document.querySelector('[data-testid="three-viewer"]').dataset.carRig);
      return Object.values(rig.panels).every(Number.isFinite);
    });
  }
  await page.goto(base);
  await page.locator('[data-testid="three-viewer"][data-loaded="true"]').waitFor({ timeout: 120000 });
  await settled();
  assert.ok(report.assets.some(asset => asset.url.includes(`/car-releases/${CAR_RELEASE}/`) && asset.status === 200));
  assert.ok(!report.assets.some(asset => /car-releases\/(imported|reference)/.test(asset.url)));
  report.checks.push('Only the new versioned A6 is requested and rendered');
  await screenshot('desktop-assembled');
  const closedImage = hash(await canvas.screenshot());
  await page.getByRole('button', { name: 'Open doors and car controls', exact: true }).click();
  const panels = [['door-fl', 'Front left door'], ['door-fr', 'Front right door'], ['door-rl', 'Rear left door'], ['door-rr', 'Rear right door'], ['hood', 'Bonnet'], ['tailgate', 'Tailgate']];
  for (const [id, label] of panels) {
    await page.locator('#car-rig').getByRole('button', { name: label + ' Closed', exact: true }).click();
    await page.waitForFunction(id => JSON.parse(document.querySelector('[data-testid="three-viewer"]').dataset.carRig).panels[id] > .9, id);
  }
  await settled();
  assert.ok(Object.values((await pose()).panels).every(angle => angle > 1));
  report.checks.push('All four door hinges, bonnet and tailgate respond independently');
  await screenshot('desktop-controls');
  await page.keyboard.press('Escape');
  assert.equal(await page.locator('#car-rig').count(), 0);
  assert.notEqual(hash(await canvas.screenshot()), closedImage);
  await screenshot('desktop-open-panels');
  await page.getByRole('button', { name: 'Open doors and car controls', exact: true }).click();
  await page.getByRole('slider', { name: 'Front steering', exact: true }).focus();
  await page.keyboard.press('End');
  await page.getByRole('slider', { name: 'Wheel rotation', exact: true }).focus();
  await page.keyboard.press('Home');
  for (let i = 0; i < 18; i++) await page.keyboard.press('ArrowRight');
  await page.waitForFunction(() => {
    const rig = JSON.parse(document.querySelector('[data-testid="three-viewer"]').dataset.carRig);
    return rig.steering.every(angle => Math.abs(angle - Math.PI / 6) < .002) && rig.wheelRotation.every(angle => Math.abs(angle - Math.PI / 2) < .002);
  });
  report.checks.push('Keyboard sliders steer both front axles 30 degrees and rotate all four wheels 90 degrees');
  await page.getByRole('button', { name: 'Close all & reset wheels' }).click();
  await page.waitForFunction(() => {
    const rig = JSON.parse(document.querySelector('[data-testid="three-viewer"]').dataset.carRig);
    return [...Object.values(rig.panels), ...rig.steering, ...rig.wheelRotation].every(angle => Math.abs(angle) < .0001);
  });
  report.checks.push('Reset closes all panels and restores neutral axles');
  await page.getByRole('button', { name: 'Customize wheels and brakes' }).click();
  assert.equal(await page.locator('#car-rig').count(), 0);
  await page.getByRole('button', { name: 'Rim colour: Bronze', exact: true }).click();
  await page.getByRole('button', { name: 'Caliper colour: Yellow', exact: true }).click();
  await page.getByRole('button', { name: 'Track Semi-slick tread' }).click();
  await page.keyboard.press('Escape');
  await settled();
  assert.notEqual(hash(await canvas.screenshot()), closedImage);
  await page.reload();
  await page.locator('[data-testid="three-viewer"][data-loaded="true"]').waitFor({ timeout: 120000 });
  assert.equal(await viewer.getAttribute('data-rim-color'), '#a67c46');
  assert.equal(await viewer.getAttribute('data-tyre-variant'), 'track');
  await page.getByRole('button', { name: 'Customize wheels and brakes' }).click();
  await page.getByRole('button', { name: 'Reset wheel setup' }).click();
  await page.keyboard.press('Escape');
  report.checks.push('Original A6 rims/calipers and alternative tyres remain configurable and persist after reload');
  for (const width of [390, 320]) {
    await page.setViewportSize({ width, height: 844 });
    await page.getByRole('button', { name: 'Open doors and car controls', exact: true }).click();
    const rect = await page.locator('#car-rig').boundingBox();
    assert.ok(rect.x >= 0 && rect.y >= 0 && rect.x + rect.width <= width && rect.y + rect.height <= 844, 'Phone panel fits the viewport');
    for (const button of await page.locator('.three-toolbar button').all()) {
      const bounds = await button.boundingBox();
      assert.ok(bounds.x >= 0 && bounds.x + bounds.width <= width && bounds.width >= 44 && bounds.height >= 44, 'All eight toolbar controls remain visible touch targets');
    }
    await page.locator('#car-rig').getByRole('button', { name: 'Front left door Closed', exact: true }).click();
    await page.waitForFunction(() => JSON.parse(document.querySelector('[data-testid="three-viewer"]').dataset.carRig).panels['door-fl'] > 1);
    await screenshot('mobile-' + width);
    await page.getByRole('button', { name: 'Close all & reset wheels' }).click();
    await page.keyboard.press('Escape');
    await settled();
  }
  report.checks.push('390px and 320px phones can operate panels and all eight toolbar controls have 44px touch targets');
  assert.deepEqual(report.runtimeErrors, []);
  console.log(JSON.stringify(report, null, 2));
} finally {
  writeFileSync(resolve(output, 'report.json'), JSON.stringify(report, null, 2) + '\n');
  await browser.close();
}
