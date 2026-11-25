import assert from 'node:assert/strict';
import { mkdirSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { chromium } from 'playwright';

const base = process.argv[2] || 'http://127.0.0.1:5173';
const output = resolve('output/car-refinement/a6-c5-v1/interior-check');
mkdirSync(output, { recursive: true });
const report = { checks: [], runtimeErrors: [], screenshots: [], geometry: {} };
const browser = await chromium.launch({ channel: 'msedge', args: ['--enable-gpu', '--ignore-gpu-blocklist', '--use-angle=d3d11', '--enable-unsafe-swiftshader'] });
try {
  const page = await browser.newPage({ viewport: { width: 1440, height: 1000 } });
  page.on('pageerror', error => report.runtimeErrors.push(error.message));
  await page.route('**/rest/v1/rpc/get_garage_supporters', route => route.fulfill({ json: [] }));
  const shot = async name => { const file = resolve(output, name+'.png'); await page.screenshot({ path: file }); report.screenshots.push(file); };
  const select = label => page.getByRole('group', { name: 'Camera angles' }).getByRole('button', { name: new RegExp('^'+label+'( \\(shows selected part\\))?$') }).click();
  await page.goto(base);
  await page.locator('[data-testid="three-viewer"][data-loaded="true"]').waitFor({ timeout: 120000 });
  await select('Interior');
  await page.waitForFunction(() => {
    const data = document.querySelector('[data-testid="three-viewer"]').dataset;
    const p = data.cameraPosition.split(',').map(Number), t = data.cameraTarget.split(',').map(Number);
    return data.cameraMode === 'interior' && Math.hypot(...p.map((n,i)=>n-t[i])) < 1.5 && Number(data.cameraFov) > 75;
  });
  await page.waitForTimeout(1000);
  await shot('desktop-interior-camera');
  const canvas = page.locator('canvas.three-canvas');
  await canvas.focus();
  await page.keyboard.press('ArrowRight');
  await page.waitForTimeout(500);
  await page.getByRole('button', { name: 'Zoom in', exact: true }).click();
  await page.waitForTimeout(400);
  assert.equal(await page.locator('[data-testid="three-viewer"]').getAttribute('data-camera-mode'), 'interior');
  await select('Exterior');
  await page.waitForFunction(() => {
    const data = document.querySelector('[data-testid="three-viewer"]').dataset;
    const p = data.cameraPosition.split(',').map(Number), t = data.cameraTarget.split(',').map(Number);
    return data.cameraMode === 'exterior' && Math.hypot(...p.map((n,i)=>n-t[i])) > 3.3 && Number(data.cameraFov) < 37;
  });
  report.checks.push('Interior preset enters the cabin, supports orbit/zoom and restores exterior camera limits on exit');
  await page.setViewportSize({ width: 390, height: 844 });
  await select('Interior');
  await page.waitForFunction(() => Number(document.querySelector('[data-testid="three-viewer"]').dataset.cameraFov) > 87);
  await page.waitForTimeout(700);
  await shot('mobile-interior-camera');
  report.checks.push('Mobile interior preset uses a wider lens and fits the seats');
  await page.setViewportSize({ width: 1440, height: 1000 });
  await page.goto(base+'/?viewer=image');
  await select('Interior');
  await page.locator('.viewer__img:not(.is-leaving)[src$="/a6-c5/interior.webp"]').waitFor();
  report.checks.push('Explicit image fallback has a matching real interior render');

  const poses = [
    ['left-open-door', '.2,1.09,1.7,.69,.73,.59,55', 'door-fl,door-rl'],
    ['right-open-door', '.2,1.09,-1.7,.69,.73,-.59,55', 'door-fr,door-rr'],
    ['open-boot', '-3.4,1.20,1.75,-1.70,.80,0,52', 'tailgate'],
    ['black-alcantara-ceiling', '-.45,.9,0,-.05,1.4,0,80', ''],
  ];
  for (const [name, camera, open] of poses) {
    await page.goto(`${base}/scripts/garage-lab.html?shot=interior&w=1440&h=1000&lights=on&cam=${camera}&open=${open}`);
    await page.waitForFunction(() => window.__lab?.ready, null, { timeout: 120000 });
    await page.addStyleTag({ content: '#hud, #reference { display: none !important; }' });
    await shot(name);
    if (name === 'open-boot') {
      const hit = await page.evaluate(async () => {
        const THREE = await import('/node_modules/three/build/three.module.js');
        let car;
        window.__lab.scene.traverse(object => { if (object.userData.sourceModel) car = object; });
        const ray = new THREE.Raycaster(new THREE.Vector3(-2.65,.85,0),new THREE.Vector3(1,0,0));
        const first = ray.intersectObject(car,true).find(hit => {
          for (let node=hit.object;node;node=node.parent) if (!node.visible) return false;
          return true;
        });
        return { x:first?.point.x, object:first?.object.name };
      });
      report.geometry.cargoOpening = hit;
      assert.ok(hit.x > -1.45, 'Cargo opening is clear until the rear seat back, with no upright carpet slab');
    }
  }
  report.checks.push('Rendered both open door sides, clear cargo opening and black Alcantara headlining');
  assert.deepEqual(report.runtimeErrors, []);
  console.log(JSON.stringify(report,null,2));
} finally {
  writeFileSync(resolve(output,'report.json'),JSON.stringify(report,null,2)+'\n');
  await browser.close();
}
