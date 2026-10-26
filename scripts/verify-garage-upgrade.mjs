import assert from 'node:assert/strict';
import { mkdirSync, writeFileSync } from 'node:fs';
import { chromium } from 'playwright';

const base = process.argv[2] || 'http://127.0.0.1:5173';
const output = 'output/garage-upgrade';
mkdirSync(output, { recursive: true });
const browser = await chromium.launch({ channel: 'msedge', args: ['--enable-gpu', '--ignore-gpu-blocklist', '--use-angle=d3d11', '--enable-unsafe-swiftshader'] });
const report = { profiles: [], errors: [] };
try {
  for (const profile of [{ name: 'desktop', viewport: { width: 1440, height: 900 } }, { name: 'mobile', viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true }]) {
    const context = await browser.newContext(profile);
    const page = await context.newPage();
    page.on('pageerror', (error) => report.errors.push(error.message));
    page.on('console', (message) => { if (message.type() === 'error' && /WebGL|shader|THREE\./i.test(message.text())) report.errors.push(message.text()); });
    await page.goto(base);
    const viewer = page.locator('[data-testid="three-viewer"][data-loaded="true"]');
    await viewer.waitFor({ timeout: 120000 });
    const lightingButton = page.getByRole('button', { name: 'Adjust garage lighting', exact: true });
    const normalImage = await page.locator('canvas.three-canvas').screenshot();
    await lightingButton.click();
    const brightness = page.getByRole('slider', { name: 'Brightness' });
    await brightness.focus();
    await page.keyboard.press('Home');
    assert.equal(await brightness.inputValue(), '35');
    await page.keyboard.press('End');
    assert.equal(await brightness.inputValue(), '200');
    assert.equal(await viewer.getAttribute('data-light-level'), '200');
    await page.waitForTimeout(350);
    const boostedImage = await page.locator('canvas.three-canvas').screenshot({ path: `${output}/${profile.name}-brightness-200.png` });
    assert.equal(normalImage.equals(boostedImage), false, 'Boost changes the rendered garage, not just its percentage');
    await page.keyboard.press('Home');
    for (let step = 0; step < 13; step++) await page.keyboard.press('ArrowRight');
    assert.equal(await brightness.inputValue(), '100');
    await page.keyboard.press('Escape');
    await page.getByRole('button', { name: 'Garage view', exact: true }).click();
    await page.waitForTimeout(1200);
    const calls = Number(await viewer.getAttribute('data-render-calls'));
    assert.ok(calls < 160, `Single-pass garage remains bounded: ${calls} calls`);
    await page.screenshot({ path: `${output}/${profile.name}-garage.png` });
    await page.getByRole('button', { name: 'Supporter wall', exact: true }).click();
    await page.waitForTimeout(1200);
    assert.equal(await page.getByRole('button', { name: 'Supporter wall', exact: true }).getAttribute('aria-pressed'), 'true');
    const wallTarget = (await viewer.getAttribute('data-camera-target')).split(',').map(Number);
    assert.ok(Math.abs(wallTarget[0] + 13.5) < .05, 'Camera reaches the wall behind the car beyond the normal car orbit');
    await page.screenshot({ path: `${output}/${profile.name}-wall.png` });
    await page.getByRole('button', { name: 'Read supporter table', exact: true }).click();
    const dialog = page.getByRole('dialog', { name: 'The people behind the build' });
    await dialog.waitFor();
    await page.getByRole('button', { name: 'Close', exact: true }).click();
    assert.equal(await dialog.isVisible(), false);
    await page.getByRole('button', { name: 'Reset view', exact: true }).click();
    assert.equal(await page.getByRole('button', { name: 'Supporter wall', exact: true }).getAttribute('aria-pressed'), 'false');
    assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), true, 'No horizontal overflow');
    report.profiles.push({ name: profile.name, drawCalls: calls, wallCamera: true, dialog: true });

    // Explicitly synthetic transport fixtures exercise the complete-feed UI;
    // never write these names or payments to the application database.
    await page.route('**/rest/v1/rpc/get_garage_supporters', (route) => route.fulfill({ json: Array.from({ length: 12 }, (_, i) => ({ display_name: `QA Supporter ${i + 1}`, donation_count: i === 0 ? 3 : 1, amount_cents: i === 0 ? 7500 : 1000 })) }));
    await page.reload();
    await viewer.waitFor({ timeout: 120000 });
    await page.getByRole('button', { name: 'Supporter wall', exact: true }).click();
    await page.getByRole('button', { name: 'Next board page', exact: true }).waitFor();
    await page.getByRole('button', { name: 'Next board page', exact: true }).click();
    await page.getByRole('button', { name: 'Read supporter table', exact: true }).click();
    await dialog.waitFor();
    await page.getByRole('rowheader', { name: '3× QA Supporter 1', exact: true }).waitFor();
    assert.equal(await dialog.getByRole('rowheader').count(), 12);
    assert.equal(await dialog.getByRole('cell', { name: 'Hidden', exact: true }).count(), 12);
    assert.equal(await dialog.getByRole('cell', { name: '$75', exact: true }).count(), 1);
    await page.keyboard.press('Escape');
    assert.equal(await dialog.isVisible(), false);
    await context.close();
  }
  assert.deepEqual(report.errors, []);
  writeFileSync(`${output}/report.json`, JSON.stringify(report, null, 2));
  console.log(JSON.stringify(report, null, 2));
} finally { await browser.close(); }
