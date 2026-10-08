// Run against a running Vite server: node scripts/verify-orbit.mjs [baseUrl] [outputDir]
// Uses real WebGL, GLB requests and browser input; no renderer or controls mocks.
import assert from 'node:assert/strict';
import { mkdirSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { chromium } from 'playwright';

const base = (process.argv[2] || 'http://127.0.0.1:5173').replace(/\/$/, '');
const output = resolve(process.argv[3] || 'output/orbit-verification');
mkdirSync(output, { recursive: true });
const report = { base, checks: [], assets: [], screenshots: [], runtimeErrors: [], consoleErrors: [] };
const browser = await chromium.launch({
  channel: process.env.PLAYWRIGHT_CHANNEL || 'msedge',
  args: ['--enable-unsafe-swiftshader'],
});

const viewerSelector = '[data-testid="three-viewer"]';
const separation = (a, b) => Math.hypot(...a.map((value, index) => value - b[index]));
const camera = async (page) => page.locator(viewerSelector).evaluate((element) => ({
  position: element.dataset.cameraPosition.split(',').map(Number),
  target: element.dataset.cameraTarget.split(',').map(Number),
}));
const distance = (pose) => separation(pose.position, pose.target);
async function moved(page, previous, minimum = 0.15) {
  await page.waitForFunction(({ selector, position, minimum }) => {
    const value = document.querySelector(selector)?.dataset.cameraPosition;
    if (!value) return false;
    const current = value.split(',').map(Number);
    return Math.hypot(...current.map((coordinate, index) => coordinate - position[index])) > minimum;
  }, { selector: viewerSelector, position: previous.position, minimum }, { timeout: 12000 });
  return camera(page);
}
async function settled(page) {
  let previous = await camera(page);
  let stable = 0;
  for (let index = 0; index < 60; index++) {
    await page.waitForTimeout(100);
    const next = await camera(page);
    stable = separation(previous.position, next.position) < 0.005 ? stable + 1 : 0;
    if (stable >= 3) return next;
    previous = next;
  }
  throw new Error('Camera did not settle after input');
}
async function ready(page, path = '/') {
  await page.goto(`${base}${path}`, { waitUntil: 'networkidle' });
  await page.locator(`${viewerSelector}[data-loaded="true"]`).waitFor({ timeout: 120000 });
  const canvas = page.locator('canvas[aria-label^="Interactive 3D Audi S6 and garage"]');
  assert.equal(await canvas.count(), 1, 'A real accessible 3D canvas is present');
  assert.equal(await page.locator('.viewer__img').count(), 0, 'Default viewer does not render an image substitute');
  return canvas;
}
async function screenshot(page, name) {
  if (await page.locator(`${viewerSelector}[data-loaded="true"]`).count()) await settled(page);
  const path = resolve(output, `${name}.png`);
  await page.screenshot({ path, fullPage: true });
  report.screenshots.push(path);
}
function monitor(page) {
  page.on('pageerror', (error) => report.runtimeErrors.push(error.message));
  page.on('console', (message) => {
    if (message.type() === 'error') report.consoleErrors.push(message.text());
  });
  page.on('response', (response) => {
    if (/\.glb(?:\?|$)/.test(response.url())) report.assets.push({ url: response.url(), status: response.status() });
  });
}
async function drag(page, canvas, deltaX = 220, deltaY = 40) {
  const bounds = await canvas.boundingBox();
  assert.ok(bounds?.width > 100 && bounds?.height > 100, 'Canvas has a usable size');
  const x = bounds.x + bounds.width * 0.45;
  const y = bounds.y + bounds.height * 0.37;
  await page.mouse.move(x, y);
  await page.mouse.down();
  await page.mouse.move(x + deltaX, y + deltaY, { steps: 20 });
  await page.mouse.up();
}

try {
  const desktop = await browser.newPage({ viewport: { width: 1440, height: 1000 }, deviceScaleFactor: 1 });
  monitor(desktop);
  const canvas = await ready(desktop);
  await screenshot(desktop, 'desktop-before-orbit');
  const initial = await camera(desktop);
  assert.ok(initial.position.every(Number.isFinite) && initial.target.every(Number.isFinite));
  await drag(desktop, canvas);
  const dragged = await moved(desktop, initial);
  await screenshot(desktop, 'desktop-after-orbit');
  report.checks.push({ name: 'mouse drag orbits the real camera', movement: separation(initial.position, dragged.position) });

  const beforeZoom = await camera(desktop);
  const bounds = await canvas.boundingBox();
  await desktop.mouse.move(bounds.x + bounds.width * 0.5, bounds.y + bounds.height * 0.4);
  await desktop.mouse.wheel(0, -500);
  await moved(desktop, beforeZoom);
  const afterZoom = await camera(desktop);
  assert.ok(distance(afterZoom) < distance(beforeZoom) - 0.1, 'Wheel zoom reduces distance to orbit target');
  report.checks.push({ name: 'wheel zoom', before: distance(beforeZoom), after: distance(afterZoom) });

  await settled(desktop);
  const beforeButtonZoom = await camera(desktop);
  await desktop.getByRole('button', { name: 'Zoom in', exact: true }).click();
  await moved(desktop, beforeButtonZoom);
  assert.ok(distance(await camera(desktop)) < distance(beforeButtonZoom) - 0.1, 'Zoom in button reduces camera distance');
  report.checks.push({ name: 'zoom button direction is correct' });

  await desktop.locator('[data-angle="front"]').click();
  const front = await moved(desktop, afterZoom);
  await screenshot(desktop, 'desktop-front-preset');
  report.checks.push({ name: 'Front preset moves the camera', position: front.position });

  const garageButton = desktop.getByRole('button', { name: 'Garage view', exact: true });
  const beforeGarage = await camera(desktop);
  await garageButton.click();
  await moved(desktop, beforeGarage);
  assert.equal(await garageButton.getAttribute('aria-pressed'), 'true');
  await screenshot(desktop, 'desktop-garage-orbit');
  report.checks.push({ name: 'Garage view expands the orbit' });

  await desktop.getByRole('button', { name: 'Reset view', exact: true }).click();
  await desktop.locator('[data-angle="exterior-a"]').click();
  await settled(desktop);
  const hood = desktop.locator(`${viewerSelector} [data-part-id="hood"]`);
  await hood.waitFor({ state: 'visible' });
  await hood.click();
  await desktop.getByRole('complementary', { name: 'Hood', exact: true }).waitFor();
  assert.equal(await desktop.locator('[data-part-row="hood"]').getAttribute('aria-current'), 'true');
  await screenshot(desktop, 'desktop-selected-part');
  await desktop.getByRole('button', { name: 'Close part details' }).click();
  report.checks.push({ name: '3D hotspot opens matching part details and selects catalogue row' });

  const search = desktop.getByPlaceholder('Search parts...').first();
  await search.fill('bumper');
  assert.equal(await desktop.locator('.part-row').count(), 2);
  const filteredAnchors = await desktop.locator(`${viewerSelector} [data-part-id]`).evaluateAll((elements) => elements.map((element) => element.dataset.partId));
  assert.ok(filteredAnchors.every((id) => id === 'front-bumper' || id === 'rear-bumper'), 'Search filters 3D hotspots too');
  await search.fill('');
  await desktop.getByRole('button', { name: 'Bought (1)', exact: true }).click();
  assert.deepEqual(await desktop.locator('.part-row').evaluateAll((elements) => elements.map((element) => element.dataset.partRow)), ['roof-box']);
  const boughtAnchors = await desktop.locator(`${viewerSelector} [data-part-id]`).evaluateAll((elements) => elements.map((element) => element.dataset.partId));
  assert.ok(boughtAnchors.every((id) => id === 'roof-box'));
  report.checks.push({ name: 'search and status filters apply to catalogue and 3D hotspots' });

  const stats = await desktop.locator(viewerSelector).evaluate((element) => ({
    renderer: element.dataset.renderer,
    drawCalls: Number(element.dataset.renderCalls),
    triangles: Number(element.dataset.triangles),
  }));
  assert.equal(stats.renderer, 'three');
  assert.ok(stats.drawCalls > 0 && stats.triangles > 0, 'Renderer actually drew model geometry');
  report.renderer = stats;
  assert.ok(new Set(report.assets.filter((asset) => asset.status === 200).map((asset) => asset.url)).size >= 2, 'Both car and garage GLBs loaded');
  report.checks.push({ name: 'real car and garage GLBs loaded and rendered' });

  await desktop.getByRole('button', { name: 'All (10)', exact: true }).click();
  await canvas.focus();
  let previousOrbit = await camera(desktop);
  let accumulatedAzimuth = 0;
  const azimuth = (pose) => Math.atan2(pose.position[0] - pose.target[0], pose.position[2] - pose.target[2]);
  const angleBetween = (from, to) => Math.atan2(Math.sin(to - from), Math.cos(to - from));
  for (let step = 0; step < 48; step++) {
    await desktop.keyboard.press('ArrowRight');
    await desktop.waitForTimeout(90);
    const nextOrbit = await camera(desktop);
    accumulatedAzimuth += angleBetween(azimuth(previousOrbit), azimuth(nextOrbit));
    previousOrbit = nextOrbit;
  }
  const completeOrbit = await settled(desktop);
  accumulatedAzimuth += angleBetween(azimuth(previousOrbit), azimuth(completeOrbit));
  assert.ok(Math.abs(accumulatedAzimuth) > Math.PI * 2, 'Keyboard navigation allows a complete 360° horizontal orbit');
  report.checks.push({ name: 'full horizontal orbit using keyboard', degrees: Math.abs(accumulatedAzimuth) * 180 / Math.PI });

  const panBefore = await camera(desktop);
  const panBounds = await canvas.boundingBox();
  await desktop.mouse.move(panBounds.x + panBounds.width * 0.18, panBounds.y + panBounds.height * 0.24);
  await desktop.mouse.down({ button: 'right' });
  await desktop.mouse.move(panBounds.x + panBounds.width * 0.28, panBounds.y + panBounds.height * 0.3, { steps: 15 });
  await desktop.mouse.up({ button: 'right' });
  await moved(desktop, panBefore);
  const panAfter = await settled(desktop);
  assert.ok(separation(panBefore.target, panAfter.target) > 0.1, 'Right-drag changes the orbit target');
  report.checks.push({ name: 'right-drag pans camera and target', targetMovement: separation(panBefore.target, panAfter.target) });

  await desktop.mouse.move(panBounds.x + panBounds.width * 0.18, panBounds.y + panBounds.height * 0.3);
  await desktop.mouse.wheel(0, 10000);
  await settled(desktop);
  await canvas.focus();
  for (let step = 0; step < 16; step++) await desktop.keyboard.press('ArrowUp');
  const extremePose = await settled(desktop);
  assert.ok(distance(extremePose) <= 12.55, 'Zoom out stays within the workshop orbit limit');
  assert.ok(extremePose.position[1] <= 6.45, 'Upward orbit stays below the ceiling');
  assert.ok(Math.abs(extremePose.position[0]) <= 13.25 && extremePose.position[2] >= -14.15, 'Camera remains within the workshop side and back walls');
  await screenshot(desktop, 'desktop-extreme-orbit-bounds');
  report.checks.push({ name: 'extreme zoom out and upward orbit stay inside workshop', position: extremePose.position, distance: distance(extremePose) });

  const mobile = await browser.newPage({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 1, isMobile: true, hasTouch: true });
  monitor(mobile);
  const mobileCanvas = await ready(mobile);
  await screenshot(mobile, 'mobile-before-orbit');
  const mobilePose = await camera(mobile);
  const mobileBounds = await mobileCanvas.boundingBox();
  const touchX = mobileBounds.x + mobileBounds.width * 0.36;
  // Start on the garage floor, away from the car's part buttons; those correctly
  // consume their own touch input rather than forwarding it to OrbitControls.
  const touchY = mobileBounds.y + mobileBounds.height * 0.72;
  assert.equal(await mobile.evaluate(({ x, y }) => document.elementFromPoint(x, y)?.tagName, { x: touchX, y: touchY }), 'CANVAS');
  const cdp = await mobile.context().newCDPSession(mobile);
  await cdp.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [{ x: touchX, y: touchY }] });
  for (let step = 1; step <= 12; step++) {
    await cdp.send('Input.dispatchTouchEvent', { type: 'touchMove', touchPoints: [{ x: touchX + step * 9, y: touchY + step * 2 }] });
  }
  await cdp.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
  const afterTouch = await moved(mobile, mobilePose);
  await screenshot(mobile, 'mobile-after-orbit');
  report.checks.push({ name: 'mobile touch drag orbits the real camera', movement: separation(mobilePose.position, afterTouch.position) });
  await mobile.close();

  await desktop.goto(`${base}/?viewer=image`, { waitUntil: 'networkidle' });
  await desktop.locator('.viewer__img').waitFor();
  assert.equal(await desktop.locator(viewerSelector).count(), 0);
  await desktop.locator('[data-angle="rear"]').click();
  await desktop.locator('.hotspot-layer[data-view="rear"]').waitFor();
  report.checks.push({ name: 'explicit image fallback still supports angle changes' });
  await desktop.close();

  const failedAsset = await browser.newPage({ viewport: { width: 1280, height: 900 } });
  await failedAsset.route('**/models/*.glb', (route) => route.fulfill({ status: 503, contentType: 'text/plain', body: 'Intentional unavailable model for regression check' }));
  await failedAsset.goto(`${base}/`, { waitUntil: 'networkidle' });
  await failedAsset.getByRole('alert').filter({ hasText: 'The 3D garage could not open.' }).waitFor();
  assert.equal(await failedAsset.locator(`${viewerSelector}[data-loaded="true"]`).count(), 0);
  assert.equal(await failedAsset.locator('.viewer__img').count(), 0, 'Asset failures do not silently pretend image fallback is 3D');
  await screenshot(failedAsset, 'asset-failure-recovery');
  await failedAsset.unroute('**/models/*.glb');
  await failedAsset.getByRole('button', { name: 'Retry 3D', exact: true }).click();
  await failedAsset.locator(`${viewerSelector}[data-loaded="true"]`).waitFor({ timeout: 120000 });
  assert.equal(await failedAsset.getByRole('alert').count(), 0);
  report.checks.push({ name: 'failed GLB exposes error; Retry 3D reloads successfully' });
  await failedAsset.close();

  const unavailable = await browser.newPage({ viewport: { width: 1280, height: 900 } });
  await unavailable.addInitScript(() => {
    const nativeContext = HTMLCanvasElement.prototype.getContext;
    HTMLCanvasElement.prototype.getContext = function (kind, ...options) {
      if (/^(webgl2?|experimental-webgl)$/.test(kind)) return null;
      return nativeContext.call(this, kind, ...options);
    };
  });
  await unavailable.goto(`${base}/`, { waitUntil: 'networkidle' });
  await unavailable.getByRole('alert').filter({ hasText: 'The 3D garage could not open.' }).waitFor();
  assert.equal(await unavailable.locator('.viewer__img').count(), 0);
  assert.equal(await unavailable.locator(`${viewerSelector}[data-loaded="true"]`).count(), 0);
  await unavailable.getByRole('button', { name: 'View rendered photos', exact: true }).click();
  await unavailable.locator('.viewer__img').waitFor();
  assert.equal(await unavailable.locator(viewerSelector).count(), 0);
  await unavailable.getByText('Image view', { exact: true }).waitFor();
  report.checks.push({ name: 'unavailable WebGL offers explicit, accurately labeled image fallback' });
  await unavailable.close();

  assert.deepEqual(report.runtimeErrors, [], 'No unexpected browser runtime errors');
  assert.deepEqual(report.consoleErrors, [], 'No browser console errors');
  report.passed = true;
} catch (error) {
  report.passed = false;
  report.failure = error.stack || String(error);
  for (const [index, page] of browser.contexts().flatMap((context) => context.pages()).entries()) {
    await screenshot(page, `failure-${index}`).catch(() => {});
  }
  console.error(report.failure);
  process.exitCode = 1;
} finally {
  await browser.close();
  writeFileSync(resolve(output, 'report.json'), JSON.stringify(report, null, 2) + '\n');
  console.log(JSON.stringify(report, null, 2));
}
