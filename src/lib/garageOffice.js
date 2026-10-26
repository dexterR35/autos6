import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { createGarageComputer } from './garageComputer.js';
import { createGarageOfficeArt, createGarageDeskPapers } from './garageOfficeArt.js';

export const GARAGE_OFFICE = Object.freeze({ position: [13, 0, 7], rotationY: -Math.PI / 2 });

function desktopWood() {
  const canvas = document.createElement('canvas');
  canvas.width = 256; canvas.height = 128;
  const context = canvas.getContext('2d');
  context.fillStyle = '#997651'; context.fillRect(0, 0, 256, 128);
  for (let row = 0; row < 128; row++) {
    context.strokeStyle = `rgba(50,24,8,${.025 + .035 * (1 + Math.sin(row * 2.71))})`;
    context.beginPath(); context.moveTo(0, row);
    for (let x = 0; x <= 256; x += 8) context.lineTo(x, row + Math.sin(x * .025 + row * 2.1) * 1.4);
    context.stroke();
  }
  const texture = new THREE.CanvasTexture(canvas);
  texture.colorSpace = THREE.SRGBColorSpace; texture.anisotropy = 4;
  texture.wrapS = texture.wrapT = THREE.RepeatWrapping; texture.repeat.set(3, 1);
  return texture;
}

/** A complete workstation facing the room, in the former east cabinet bay. */
export function createGarageOffice() {
  const group = new THREE.Group(); group.name = 'Garage office | desk, computer and artwork';
  const materials = {
    steel: new THREE.MeshStandardMaterial({ name: 'Office | charcoal steel', color: '#222b33', roughness: .42, metalness: .65 }),
    black: new THREE.MeshStandardMaterial({ name: 'Office | padded black', color: '#090e13', roughness: .7 }),
    silver: new THREE.MeshStandardMaterial({ name: 'Office | brushed metal', color: '#9aa8b6', roughness: .28, metalness: .85 }),
    wood: new THREE.MeshStandardMaterial({ name: 'Office | walnut desktop', color: '#e0c2a2', map: desktopWood(), roughness: .62 }),
    lamp: new THREE.MeshStandardMaterial({ name: 'Office | white task lamp diffuser', color: 0x000000, emissive: new THREE.Color(.92, .96, 1), emissiveIntensity: 4, toneMapped: false }),
  };
  function add(name, material, geometry, position = [0, 0, 0]) {
    const mesh = new THREE.Mesh(geometry, material); mesh.name = name; mesh.position.fromArray(position); group.add(mesh); return mesh;
  }
  const box = (name, material, size, position) => add(name, material, new THREE.BoxGeometry(...size), position);
  const rod = (name, material, start, end, radius) => {
    const a = new THREE.Vector3(...start), b = new THREE.Vector3(...end), direction = b.clone().sub(a);
    const geometry = new THREE.CylinderGeometry(radius, radius, direction.length(), 10);
    geometry.applyQuaternion(new THREE.Quaternion().setFromUnitVectors(new THREE.Vector3(0, 1, 0), direction.normalize()));
    return add(name, material, geometry, a.add(b).multiplyScalar(.5).toArray());
  };
  box('Office | thick walnut desktop', materials.wood, [4.32, .075, 1.1], [0, 1.04, 0]);
  box('Office | desktop shadow edge', materials.black, [4.26, .025, 1.05], [0, .99, 0]);
  for (const x of [-1.66, 1.66]) {
    box('Office | drawer pedestal', materials.steel, [.76, .92, .88], [x, .51, -.035]);
    box('Office | pedestal plinth', materials.black, [.68, .06, .79], [x, .03, -.035]);
    for (let row = 0; row < 4; row++) {
      const y = .19 + row * .21;
      box('Office | drawer reveal', materials.black, [.70, .20, .028], [x, y, .414]);
      box('Office | drawer front', materials.steel, [.675, .182, .025], [x, y, .438]);
      box('Office | drawer handle', materials.silver, [.48, .018, .035], [x, y + .025, .464]);
    }
  }
  box('Office | rear cable tray', materials.steel, [2.8, .10, .13], [0, .90, -.43]);
  const computer = createGarageComputer(materials, { monitorCount: 2 }); computer.position.set(.15, 1.08, -.02); group.add(computer);
  const papers = createGarageDeskPapers(); papers.position.set(-1.50, 1.08, .23); group.add(papers);
  // Wrenches, a screwdriver and a vernier caliper beside the service paperwork.
  for (const [x, z] of [[-1.95, -.30], [-1.78, -.29]]) {
    box('Office | wrench handle', materials.silver, [.025, .012, .25], [x, 1.09, z]);
    for (const end of [-.145, .145]) {
      const ring = new THREE.TorusGeometry(.042, .011, 6, 12); ring.rotateX(Math.PI / 2);
      add('Office | wrench ring end', materials.silver, ring, [x, 1.09, z + end]);
    }
  }
  rod('Office | screwdriver shaft', materials.silver, [-1.55, 1.10, -.43], [-1.32, 1.10, -.43], .008);
  box('Office | screwdriver grip', materials.black, [.13, .035, .045], [-1.615, 1.10, -.43]);
  box('Office | caliper ruler', materials.silver, [.38, .012, .028], [-1.27, 1.092, -.44]);
  for (const x of [-1.45, -1.29]) box('Office | caliper jaw', materials.silver, [.018, .016, .10], [x, 1.094, -.405]);
  add('Office | desk lamp base', materials.steel, new THREE.CylinderGeometry(.10, .11, .025, 16), [-1.6, 1.095, -.40]);
  rod('Office | desk lamp upright', materials.steel, [-1.6, 1.11, -.40], [-1.6, 1.39, -.40], .016);
  rod('Office | desk lamp adjustable arm', materials.silver, [-1.6, 1.39, -.40], [-1.45, 1.75, .05], .012);
  add('Office | desk lamp shade', materials.steel, new THREE.CylinderGeometry(.045, .11, .12, 16), [-1.45, 1.70, .05]);
  const diffuser = new THREE.CircleGeometry(.088, 16); diffuser.rotateX(Math.PI / 2);
  add('Office | desk lamp white diffuser', materials.lamp, diffuser, [-1.45, 1.638, .05]);

  // Five-spoke office chair: the backrest is behind the seat, facing the monitor.
  const chairX = 0, chairZ = 1.16;
  rod('Office | chair gas lift', materials.silver, [chairX, .12, chairZ], [chairX, .58, chairZ], .045);
  for (let leg = 0; leg < 5; leg++) {
    const angle = leg * Math.PI * 2 / 5, x = Math.sin(angle) * .40, z = chairZ + Math.cos(angle) * .40;
    rod('Office | chair spoke', materials.steel, [0, .14, chairZ], [x, .09, z], .025);
    const wheel = new THREE.CylinderGeometry(.065, .065, .055, 12); wheel.rotateZ(Math.PI / 2);
    add('Office | chair caster', materials.black, wheel, [x, .065, z]);
  }
  box('Office | padded chair seat', materials.black, [.62, .10, .58], [0, .62, chairZ]);
  const back = box('Office | padded chair back', materials.black, [.61, .72, .105], [0, 1.05, chairZ + .29]); back.rotation.x = .12;
  for (const side of [-1, 1]) {
    rod('Office | chair arm support', materials.steel, [side * .30, .60, chairZ + .10], [side * .36, .83, chairZ + .08], .017);
    box('Office | chair armrest', materials.black, [.075, .045, .31], [side * .36, .85, chairZ]);
  }
  group.add(createGarageOfficeArt(materials));
  const componentNames = [];
  // All components are static: merge shared materials across the furniture and PC.
  // Transparent glass and atlas textures retain their own material and draw call.
  group.updateMatrixWorld(true);
  const buckets = new Map(), originals = [];
  group.traverse((mesh) => {
    if (!mesh.isMesh) return;
    originals.push(mesh); componentNames.push(mesh.name);
    if (!buckets.has(mesh.material)) buckets.set(mesh.material, []);
    buckets.get(mesh.material).push(mesh.geometry.clone().applyMatrix4(mesh.matrixWorld));
  });
  const geometries = new Set(originals.map((mesh) => mesh.geometry));
  group.clear();
  for (const [material, parts] of buckets) {
    const geometry = mergeGeometries(parts);
    const mesh = new THREE.Mesh(geometry, material); mesh.name = `Garage office | ${material.name}`;
    if (material === materials.lamp) {
      mesh.userData.ceilingRow = 'office-task';
      mesh.userData.taskLightSources = [{ position: [-1.40, 1.60, .12], intensity: 24, reach: 4, name: 'Office desk lamp' }];
    }
    mesh.userData.garageOffice = true; group.add(mesh); parts.forEach((part) => part.dispose());
  }
  geometries.forEach((geometry) => geometry.dispose());
  group.userData.components = componentNames;
  group.userData.computer = computer.userData;
  group.position.fromArray(GARAGE_OFFICE.position); group.rotation.y = GARAGE_OFFICE.rotationY;
  return group;
}
