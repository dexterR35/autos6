// Development harness: renders the web garage at the Blender reference cameras so
// it can be compared with the reference images. Not part of the production build.
// Open /scripts/garage-lab.html?shot=reference&car=0 on the Vite dev server.
// Keys: C car, O orbit, R reference overlay (cycles opacity).
import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { MeshoptDecoder } from 'three/addons/libs/meshopt_decoder.module.js';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { createGarageLook } from '../src/lib/garageLighting.js';
import { extendGarage } from '../src/lib/garageExtension.js';
import { cameraPreset, GARAGE_TARGET } from '../src/lib/garage3d.js';
import { createGarageSupportersBoard, supporterWallCamera } from '../src/lib/garageSupporters.js';
import { modelUrl } from '../src/lib/modelAssets.js';

const params = new URLSearchParams(location.search);
const comparing=params.get('compare')==='1';
const width = Number(params.get('w') || (comparing?innerWidth:1672));
const height = Number(params.get('h') || (comparing?innerHeight:941));
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
  supporters: supporterWallCamera(),
  lifts: { position: [10.5, 5, 2.5], target: [0, 1.5, -7.4], fov: 55 },
  equipment: { position: [5.5, 3.2, -5.3], target: [13.1, 1.65, -1.4], fov: 49 },
  weststation: { position: [-4.7, 3.7, 4.5], target: [-13, 2, -1.8], fov: 55 },
  office: { position: [5.5, 2.7, 3.3], target: [12.9, 1.7, 7], fov: 48 },
  officepc: { position: [11.4, 1.55, 9], target: [12.8, 1.45, 8.46], fov: 42 },
  top: { position: [0, 42, -0.5], target: [0, 0, -0.6], fov: 48, near: 35 },
  // Car close-ups at roughly the reference photographs' camera heights.
  carfront: { position: [6.4, 1.05, 0], target: [0, 0.68, 0], fov: 30 },
  car34: { position: [5.3, 1.15, 5.9], target: [0.35, 0.62, 0], fov: 30 },
  carside: { position: [0, 0.95, 10.5], target: [0, 0.72, 0], fov: 30 },
  carwheel: { position: [2.7, 0.55, 2.9], target: [1.5, 0.36, 0.8], fov: 30 },
  carfrontphoto: { position: [12.2, 1.38, 0], target: [0, 0.82, 0], fov: 15 },
  carrearphoto: { position: [-12.2, 1.38, 0], target: [0, 0.82, 0], fov: 15 },
  carrear34: { position: [-5.9, 1.4, 6.2], target: [-.2, .75, 0], fov: 30 },
};
const shot = shots[params.get('shot')] ?? shots.reference;
const referenceImage = { reference: '/ChatGPT Image Oct 4, 2026, 01_38_30 AM-1.png', s6: '/ChatGPT Image Oct 4, 2026, 01_38_30 AM-1.png' }[params.get('shot') ?? 'reference'];

const renderer = new THREE.WebGLRenderer({ antialias: true, powerPreference: 'high-performance', preserveDrawingBuffer: true });
renderer.setPixelRatio(1);
renderer.setSize(width, height);
renderer.outputColorSpace = THREE.SRGBColorSpace;
document.body.appendChild(renderer.domElement);
const scene = new THREE.Scene();
const previewFov=(aspect)=>comparing?THREE.MathUtils.radToDeg(2*Math.atan(Math.tan(THREE.MathUtils.degToRad(shot.fov)/2)*Math.max(1,(1672/941)/aspect))):shot.fov;
const camera = new THREE.PerspectiveCamera(previewFov(width/height), width / height, shot.near ?? 0.08, 90);
camera.position.fromArray(shot.position);
const controls = new OrbitControls(camera, renderer.domElement);
controls.target.fromArray(shot.target);
controls.enabled = params.get('orbit') === '1';
controls.update();
const look = createGarageLook({ renderer, scene, camera, compact: params.get('compact') === '1' });
look.setSize(width, height);

const hud = document.getElementById('hud');
if(comparing) {
  const bar=document.createElement('nav');bar.setAttribute('aria-label','Comparație modele Audi');
  Object.assign(bar.style,{position:'fixed',top:'12px',left:'12px',right:'12px',display:'flex',flexWrap:'wrap',gap:'8px',alignItems:'center',padding:'10px',background:'#0a111fee',border:'1px solid #385473',borderRadius:'8px',color:'#dce9ff',font:'14px system-ui',zIndex:'3'});
  const label=document.createElement('span');label.textContent='Trage pentru rotire ·';bar.append(label);
  for(const [title,candidate,angle] of [['Model din site','',null],['GLB-ul tău optimizat','web',null],['Față',null,'car34'],['Lateral',null,'carside'],['Spate',null,'carrear34']]) {
    const link=document.createElement('a'),url=new URL(location.href);
    if(candidate!==null){if(candidate)url.searchParams.set('candidate',candidate);else url.searchParams.delete('candidate');}
    if(angle)url.searchParams.set('shot',angle);
    url.searchParams.set('orbit','1');link.href=url.href;link.textContent=title;
    Object.assign(link.style,{color:'#e7f0ff',textDecoration:'none',padding:'7px 10px',border:'1px solid #46617e',borderRadius:'5px',background:candidate!==null&&(params.get('candidate')||'')===candidate?'#254f79':'#142235'});
    bar.append(link);
  }
  document.body.append(bar);
  addEventListener('resize',()=>{const w=innerWidth,h=innerHeight;camera.aspect=w/h;camera.fov=previewFov(w/h);camera.updateProjectionMatrix();renderer.setSize(w,h);look.setSize(w,h);frame();});
}
const overlay = document.getElementById('reference');
if (referenceImage) { overlay.src = referenceImage; overlay.style.width = `${width}px`; overlay.style.height = `${height}px`; }

const loader = new GLTFLoader().setMeshoptDecoder(MeshoptDecoder);
const carUrl=params.get('candidate')==='staging'?'/output/car-refinement/imported-v3/s6-c5.glb':params.get('candidate')==='web'?'/output/car-refinement/imported/model-web.glb':params.get('candidate')==='1'?'/output/car-refinement/imported/model.glb':params.get('original')==='1'?'/models/s6-c5.glb':modelUrl('s6-c5.glb');
const [car, garage] = await Promise.all([carUrl, '/models/garage.glb'].map(async (url) => (await loader.loadAsync(url)).scene));
if(params.get('candidate')==='1') {
  if(params.get('rotate'))car.rotation.x=THREE.MathUtils.degToRad(Number(params.get('rotate')));
  const box=new THREE.Box3().setFromObject(car),size=box.getSize(new THREE.Vector3());
  car.scale.multiplyScalar(4.797/size.x);car.updateMatrixWorld(true);
  const aligned=new THREE.Box3().setFromObject(car),center=aligned.getCenter(new THREE.Vector3());
  car.position.set(-center.x,-aligned.min.y,-center.z);
  if(params.get('flip')==='1')car.rotation.y=Math.PI;
}
car.traverse((object) => { if (object.isMesh) { object.castShadow = true; object.receiveShadow = true; } });
if (shot.carYaw && params.get('yaw') !== '0') car.rotation.y = THREE.MathUtils.degToRad(shot.carYaw);
if (params.get('extend') !== '0') extendGarage(garage);
const supporters = createGarageSupportersBoard({ isDemo: true });
garage.add(supporters.group);
scene.add(car, garage);
if (params.get('flat') === '1') scene.add(new THREE.AmbientLight('#ffffff', 6));
look.attach({ car, garage });
if (params.get('lights') === 'on') look.setLightLevel(1, true);
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
await look.loadEnvironment();
await new Promise((resolve) => requestAnimationFrame(resolve));
frame();
window.__lab = { ready: true, scene, look, camera, renderer };
