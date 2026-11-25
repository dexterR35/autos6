// Capture the current car and garage for matching thumbnails and image fallback.
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { createRequire } from 'node:module';
import { chromium } from 'playwright';
import { CAR_RELEASE } from '../src/lib/modelAssets.js';
const require = createRequire(resolve('node_modules/@gltf-transform/cli/bin/cli.js'));
const sharp = require('sharp');
const base = process.argv[2] || 'http://127.0.0.1:5173';
const folder = resolve('public/assets/car/a6-c5');
mkdirSync(resolve(folder, 'parts'), { recursive: true });
const release = JSON.parse(readFileSync(`public/car-releases/${CAR_RELEASE}/manifest.json`, 'utf8'));
const browser = await chromium.launch({ channel: 'msedge', args: ['--enable-gpu', '--ignore-gpu-blocklist', '--use-angle=d3d11', '--enable-unsafe-swiftshader'] });
const manifest = {};
try {
  const page = await browser.newPage({ viewport: { width: 1672, height: 941 } });
  page.on('pageerror', error => console.error('Preview page:', error.message));
  await page.goto(`${base}/scripts/garage-lab.html?shot=exterior&lights=on`);
  await page.waitForFunction(() => window.__lab?.ready, null, { timeout: 120000 });
  await page.addStyleTag({ content: '#hud, #reference { display: none !important; }' });
  for (const id of ['exterior-a', 'exterior-b', 'front', 'side-a', 'side-b', 'rear-quarter-a', 'rear-quarter-b', 'rear', 'interior', 'engine']) {
    const data = await page.evaluate(async ({ id, anchors }) => {
      const THREE = await import('/node_modules/three/build/three.module.js');
      const { cameraPreset } = await import('/src/lib/garage3d.js');
      const { scene, camera, renderer, look, rig } = window.__lab;
      const preset = cameraPreset(id);
      rig.setPose({ openPanels: preset.engine ? ['hood'] : [] });
      rig.update(0,true);
      renderer.shadowMap.needsUpdate = true;
      camera.position.fromArray(preset.position);
      camera.fov = preset.fov ?? 36;
      camera.near = preset.interior ? .018 : preset.engine ? .025 : .08;
      camera.lookAt(...preset.target);
      camera.updateProjectionMatrix();
      camera.updateMatrixWorld(true);
      look.render(performance.now());
      let car;
      scene.traverse(object => { if (object.userData.sourceModel) car = object; });
      const bounds = new THREE.Box3().setFromObject(car);
      const points = [];
      for (const x of [bounds.min.x, bounds.max.x]) for (const y of [bounds.min.y, bounds.max.y]) for (const z of [bounds.min.z, bounds.max.z]) {
        const p = new THREE.Vector3(x, y, z).project(camera);
        points.push([(p.x + 1) / 2, (1 - p.y) / 2]);
      }
      const focus = preset.interior || preset.engine ? { x0: 0, y0: 0, x1: 1, y1: 1 } : { x0: Math.max(0, Math.min(...points.map(p => p[0])) - .025), y0: Math.max(0, Math.min(...points.map(p => p[1])) - .035), x1: Math.min(1, Math.max(...points.map(p => p[0])) + .025), y1: Math.min(1, Math.max(...points.map(p => p[1])) + .035) };
      const hotspots = [];
      const raycaster = new THREE.Raycaster();
      for (const [partId, candidates] of Object.entries(anchors)) {
        if (preset.interior || preset.engine) continue;
        // The supplied exhaust is tucked behind the bumper, with no visible tip.
        if (partId === 'exhaust') continue;
        for (const { position, normal } of candidates) {
          const point = new THREE.Vector3().fromArray(position);
          const direction = point.clone().sub(camera.position);
          if (new THREE.Vector3().fromArray(normal).dot(direction.clone().normalize()) > -.04) continue;
          raycaster.set(camera.position, direction.clone().normalize());
          const first = raycaster.intersectObject(car, true).find(hit => {
            for (let obj = hit.object; obj; obj = obj.parent) if (!obj.visible) return false;
            return true;
          });
          if (first && first.distance < direction.length() - .14) continue;
          point.project(camera);
          hotspots.push({ partId, x: (point.x + 1) / 2, y: (1 - point.y) / 2 });
          break;
        }
      }
      return { focus, hotspots };
    }, { id, anchors: release.anchors });
    const png = await page.locator('canvas').screenshot();
    const raw = sharp(png);
    await raw.clone().webp({ quality: 91 }).toFile(resolve(folder, `${id}.webp`));
    const left = Math.floor(data.focus.x0 * 1672), top = Math.floor(data.focus.y0 * 941);
    const width = Math.ceil((data.focus.x1 - data.focus.x0) * 1672), height = Math.ceil((data.focus.y1 - data.focus.y0) * 941);
    await raw.clone().extract({ left, top, width, height }).resize(384, 216, { fit: 'contain', background: '#101725' }).webp({ quality: 90 }).toFile(resolve(folder, `${id}-thumb.webp`));
    manifest[id] = { width: 1672, height: 941, ...data, src: `/assets/car/a6-c5/${id}.webp`, original: `/assets/car/a6-c5/${id}.webp`, thumb: `/assets/car/a6-c5/${id}-thumb.webp`, renderNote: id === 'engine' ? '2.7 V6 biturbo · 3D model' : 'Audi A6 C5 Avant · 3D render', alt: id === 'engine' ? 'Reference-built Audi 2.7 V6 biturbo fitted beneath the open bonnet' : `Blue Audi A6 C5 Avant in the garage, ${id} view` };
    console.log(`Captured ${id}: ${data.hotspots.map(h => h.partId).join(', ')}`);
  }
  for (const [part, viewId] of Object.entries({ 'front-bumper': 'front', hood: 'exterior-b', wheels: 'side-a', 'side-skirts': 'side-a', 'rear-bumper': 'rear', 'brake-kit': 'side-b' })) {
    const view = manifest[viewId];
    const hotspot = view.hotspots.find(h => h.partId === part);
    if (!hotspot) continue;
    const width = part === 'wheels' || part === 'brake-kit' ? 230 : 360, height = 220;
    const left = Math.max(0, Math.min(1672 - width, Math.round(hotspot.x * 1672 - width / 2)));
    const top = Math.max(0, Math.min(941 - height, Math.round(hotspot.y * 941 - height / 2)));
    await sharp(resolve(folder, `${viewId}.webp`)).extract({ left, top, width, height }).resize(240, 160).webp({ quality: 90 }).toFile(resolve(folder, 'parts', `${part}.webp`));
    view.partThumbnails ??= {};
    view.partThumbnails[part] = `/assets/car/a6-c5/parts/${part}.webp`;
  }
  writeFileSync(resolve('src/data/a6RenderManifest.json'), JSON.stringify(manifest, null, 2) + '\n');
} finally { await browser.close(); }
