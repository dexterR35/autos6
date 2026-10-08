// Development harness: renders the web garage at the Blender reference cameras so
// it can be compared with the reference images. Not part of the production build.
// Open /scripts/garage-lab.html?shot=reference&car=0 on the Vite dev server.
// Keys: C car, O orbit, R reference overlay (cycles opacity).
import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { createGarageLook } from '../src/lib/garageLook.js';
import { extendGarage } from '../src/lib/garageExtension.js';
import { cameraPreset, GARAGE_TARGET } from '../src/lib/garage3d.js';

const params = new URLSearchParams(location.search);
const width = Number(params.get('w') || 1672);
const height = Number(params.get('h') || 941);
// Blender cameras converted to glTF space (garage offset +5.5 m, Y up).
const shots = {
  reference: { position: [1.15, 2.45, 7.5], target: [0, 0.1, -14.5], fov: 32.28, carYaw: -31 },
  s6: { position: [1.15, 1.78, 7.5], target: [0, 0.7, 0], fov: 30.6, carYaw: -31 },
  exterior: { ...cameraPreset('exterior-a'), fov: 36 },
  front: { ...cameraPreset('front'), fov: 36 },
  rear: { ...cameraPreset('rear'), fov: 36 },
  side: { ...cameraPreset('side-a'), fov: 36 },
  sideb: { ...cameraPreset('side-b'), fov: 36 },
  rearq: { ...cameraPreset('rear-quarter-b'), fov: 36 },
  garage: { position: [6.5, 4.4, 8.1], target: GARAGE_TARGET, fov: 50 },
  top: { position: [0, 42, -0.5], target: [0, 0, -0.6], fov: 48, near: 35 },
};
const shot = shots[params.get('shot')] ?? shots.reference;
const referenceImage = { reference: '/ChatGPT Image Oct 4, 2026, 01_38_30 AM-1.png', s6: '/ChatGPT Image Oct 4, 2026, 01_38_30 AM-1.png' }[params.get('shot') ?? 'reference'];

const renderer = new THREE.WebGLRenderer({ antialias: true, powerPreference: 'high-performance', preserveDrawingBuffer: true });
renderer.setPixelRatio(1);
renderer.setSize(width, height);
renderer.outputColorSpace = THREE.SRGBColorSpace;
document.body.appendChild(renderer.domElement);
const scene = new THREE.Scene();
const camera = new THREE.PerspectiveCamera(shot.fov, width / height, shot.near ?? 0.08, 90);
camera.position.fromArray(shot.position);
const controls = new OrbitControls(camera, renderer.domElement);
controls.target.fromArray(shot.target);
controls.enabled = params.get('orbit') === '1';
controls.update();
const look = createGarageLook({ renderer, scene, camera, compact: params.get('compact') === '1' });
look.setSize(width, height);

const hud = document.getElementById('hud');
const overlay = document.getElementById('reference');
if (referenceImage) { overlay.src = referenceImage; overlay.style.width = `${width}px`; overlay.style.height = `${height}px`; }

const loader = new GLTFLoader();
const [car, garage] = await Promise.all(['/models/s6-c5.glb', '/models/garage.glb'].map(async (url) => (await loader.loadAsync(url)).scene));
car.traverse((object) => { if (object.isMesh) { object.castShadow = true; object.receiveShadow = true; } });
if (shot.carYaw && params.get('yaw') !== '0') car.rotation.y = THREE.MathUtils.degToRad(shot.carYaw);
if (params.get('extend') !== '0') extendGarage(garage);
scene.add(car, garage);
if (params.get('flat') === '1') scene.add(new THREE.AmbientLight('#ffffff', 6));
look.attach({ car, garage });
if (params.get('lights') === 'on') look.setCeilingLights(true, true);
car.visible = params.get('car') !== '0';
renderer.shadowMap.needsUpdate = true;
// Tuning overrides: lights=on (ceiling lights), exposure=0.85, tone=aces|agx|neutral,
// emblem=r,g,b,strength (Audi rings only).
if (params.get('exposure')) renderer.toneMappingExposure = Number(params.get('exposure'));
if (params.get('tone')) renderer.toneMapping = { aces: THREE.ACESFilmicToneMapping, agx: THREE.AgXToneMapping, neutral: THREE.NeutralToneMapping }[params.get('tone')];
if (params.get('emblem')) {
  const [r, g, b, strength] = params.get('emblem').split(',').map(Number);
  garage.traverse((object) => {
    if (!object.name.includes('Audi neon rings') || !object.isMesh) return;
    object.material = object.material.clone();
    object.material.emissive.setRGB(r, g, b);
    object.material.emissiveIntensity = strength;
  });
}

function frame() {
  controls.update();
  const started = performance.now();
  look.render();
  const lights = look.practicalLights?.children.length ?? 0;
  hud.textContent = `lights ${lights} · calls ${renderer.info.render.calls} · ${(performance.now() - started).toFixed(1)} ms · cam ${camera.position.toArray().map((n) => n.toFixed(2))}`;
}
controls.addEventListener('change', frame);
addEventListener('keydown', (event) => {
  if (event.key === 'c') { car.visible = !car.visible; renderer.shadowMap.needsUpdate = true; }
  if (event.key === 'o') controls.enabled = !controls.enabled;
  if (event.key === 'r') overlay.style.opacity = String((Number(overlay.style.opacity || 0) + 0.5) % 1.5);
  frame();
});
frame();
await new Promise((resolve) => requestAnimationFrame(resolve));
frame();
window.__lab = { ready: true, scene, look, camera, renderer };
