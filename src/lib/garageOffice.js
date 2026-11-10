import * as THREE from 'three';
import { mergeGeometries, mergeVertices } from 'three/addons/utils/BufferGeometryUtils.js';
import { RoundedBoxGeometry } from 'three/addons/geometries/RoundedBoxGeometry.js';
import { createGarageComputer } from './garageComputer.js';
import { createGarageOfficeArt, createGarageDeskPapers } from './garageOfficeArt.js';

export const GARAGE_OFFICE = Object.freeze({ position: [13, 0, 7], rotationY: -Math.PI / 2 });

// Dark oiled walnut: long boards with their own tone, fine pores and a few
// darker figure lines. The former flat tan read as orange under the neon.
function desktopWood() {
  const canvas = document.createElement('canvas');
  canvas.width = 1024; canvas.height = 256;
  const context = canvas.getContext('2d');
  let seed = 7;
  const random = () => (seed = (seed * 16807) % 2147483647) / 2147483647;
  const boards = 4, boardHeight = canvas.height / boards;
  for (let board = 0; board < boards; board++) {
    const tone = 58 + random() * 20;
    context.fillStyle = `rgb(${tone + 34},${tone + 4},${tone - 22})`;
    context.fillRect(0, board * boardHeight, canvas.width, boardHeight);
    for (let line = 0; line < 46; line++) {
      const y = board * boardHeight + random() * boardHeight, drift = random() * 6.28, sway = 1 + random() * 3.5;
      context.strokeStyle = `rgba(${random() < .5 ? '28,13,6' : '150,104,66'},${.05 + random() * .16})`;
      context.lineWidth = .6 + random() * 1.5;
      context.beginPath(); context.moveTo(0, y);
      for (let x = 0; x <= canvas.width; x += 16) context.lineTo(x, y + Math.sin(x * .008 + drift) * sway);
      context.stroke();
    }
    context.fillStyle = 'rgba(14,7,3,.55)'; context.fillRect(0, board * boardHeight, canvas.width, 1.5);
  }
  for (let pore = 0; pore < 2600; pore++) {
    context.fillStyle = `rgba(20,10,5,${.10 + random() * .18})`;
    context.fillRect(random() * canvas.width, random() * canvas.height, 3 + random() * 9, 1);
  }
  const texture = new THREE.CanvasTexture(canvas);
  texture.colorSpace = THREE.SRGBColorSpace; texture.anisotropy = 8;
  texture.wrapS = texture.wrapT = THREE.RepeatWrapping; texture.repeat.set(1, 1);
  return texture;
}

/** A complete workstation facing the room, in the former east cabinet bay. */
export function createGarageOffice() {
  const group = new THREE.Group(); group.name = 'Garage office | desk, computer and artwork';
  const materials = {
    steel: new THREE.MeshStandardMaterial({ name: 'Office | charcoal steel', color: '#222b33', roughness: .42, metalness: .65 }),
    black: new THREE.MeshStandardMaterial({ name: 'Office | padded black', color: '#090e13', roughness: .7 }),
    silver: new THREE.MeshStandardMaterial({ name: 'Office | brushed metal', color: '#9aa8b6', roughness: .28, metalness: .85 }),
    wood: new THREE.MeshStandardMaterial({ name: 'Office | walnut desktop', color: '#ffffff', map: desktopWood(), roughness: .38 }),
    linen: new THREE.MeshStandardMaterial({ name: 'Office | bed linen', color: '#d9dde2', roughness: .92 }),
    blanket: new THREE.MeshStandardMaterial({ name: 'Office | charcoal wool blanket', color: '#262b33', roughness: .96 }),
    accent: new THREE.MeshStandardMaterial({ name: 'Office | red blanket stripe', color: '#b3121f', roughness: .9 }),
    foam: new THREE.MeshStandardMaterial({ name: 'Office | blue flip-flop foam', color: '#1463c8', roughness: .82 }),
    lamp: new THREE.MeshStandardMaterial({ name: 'Office | white task lamp diffuser', color: 0x000000, emissive: new THREE.Color(.92, .96, 1), emissiveIntensity: 4, toneMapped: false }),
  };
  function add(name, material, geometry, position = [0, 0, 0]) {
    const mesh = new THREE.Mesh(geometry, material); mesh.name = name; mesh.position.fromArray(position); group.add(mesh); return mesh;
  }
  const box = (name, material, size, position) => add(name, material, new THREE.BoxGeometry(...size), position);
  // Soft edges for cushions, bedding and the desktop; plain boxes look cut from card.
  const soft = (name, material, size, position, radius = .03, segments = 3) => add(name, material, mergeVertices(new RoundedBoxGeometry(...size, segments, Math.min(radius, Math.min(...size) / 2 - .001))), position);
  const rod = (name, material, start, end, radius) => {
    const a = new THREE.Vector3(...start), b = new THREE.Vector3(...end), direction = b.clone().sub(a);
    const geometry = new THREE.CylinderGeometry(radius, radius, direction.length(), 10);
    geometry.applyQuaternion(new THREE.Quaternion().setFromUnitVectors(new THREE.Vector3(0, 1, 0), direction.normalize()));
    return add(name, material, geometry, a.add(b).multiplyScalar(.5).toArray());
  };
  soft('Office | thick walnut desktop', materials.wood, [4.32, .075, 1.1], [0, 1.04, 0], .016, 2);
  box('Office | desktop shadow edge', materials.black, [4.26, .025, 1.05], [0, .99, 0]);
  // A steel frame and back panel carry the top between the pedestals.
  box('Office | desk front rail', materials.steel, [2.58, .07, .04], [0, .945, .40]);
  box('Office | desk rear rail', materials.steel, [2.58, .07, .04], [0, .945, -.47]);
  box('Office | desk modesty panel', materials.steel, [2.58, .52, .022], [0, .66, -.46]);
  box('Office | desk foot rail', materials.silver, [2.58, .035, .035], [0, .16, -.20]);
  for (const x of [-1.66, 1.66]) {
    soft('Office | drawer pedestal', materials.steel, [.76, .92, .88], [x, .51, -.035], .012, 2);
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
  soft('Office | padded chair seat', materials.black, [.62, .11, .58], [0, .62, chairZ], .05, 4);
  const back = soft('Office | padded chair back', materials.black, [.61, .72, .105], [0, 1.05, chairZ + .29], .05, 4); back.rotation.x = .12;
  for (const side of [-1, 1]) {
    rod('Office | chair arm support', materials.steel, [side * .30, .60, chairZ + .10], [side * .36, .83, chairZ + .08], .017);
    soft('Office | chair armrest', materials.black, [.075, .045, .31], [side * .36, .85, chairZ], .02, 2);
  }

  // Single bed in the corner beyond the desk: its head is at the front wall
  // (local +X runs towards that corner). It stands 22 cm off the east wall so
  // the steel column there passes behind the frame, not through the mattress.
  const bedX = 5.80, bedZ = -.08, bedLength = 2.06, bedWidth = .96;
  for (const side of [-1, 1]) soft('Office | bed side rail', materials.wood, [bedLength, .16, .04], [bedX, .30, bedZ + side * (bedWidth / 2 + .02)], .012, 2);
  soft('Office | bed foot board', materials.wood, [.045, .34, bedWidth + .08], [bedX - bedLength / 2 - .02, .30, bedZ], .014, 2);
  soft('Office | bed headboard', materials.wood, [.05, .84, bedWidth + .08], [bedX + bedLength / 2 + .025, .55, bedZ], .016, 2);
  for (const end of [-1, 1]) for (const side of [-1, 1]) box('Office | bed leg', materials.steel, [.05, .22, .05], [bedX + end * (bedLength / 2 - .06), .11, bedZ + side * (bedWidth / 2 - .01)]);
  box('Office | bed slat base', materials.black, [bedLength - .04, .03, bedWidth], [bedX, .25, bedZ]);
  soft('Office | bed mattress', materials.linen, [bedLength - .05, .20, bedWidth - .03], [bedX, .385, bedZ], .07, 5);
  const pillow = soft('Office | bed pillow', materials.linen, [.42, .13, .68], [bedX + bedLength / 2 - .30, .535, bedZ], .06, 5); pillow.rotation.z = -.10;
  // Blanket pulled over two thirds of the mattress, with the sheet folded back.
  soft('Office | bed blanket', materials.blanket, [1.36, .075, bedWidth + .02], [bedX - .32, .478, bedZ], .035, 4);
  soft('Office | bed blanket room-side drape', materials.blanket, [1.36, .20, .03], [bedX - .32, .40, bedZ + bedWidth / 2 + .012], .014, 2);
  soft('Office | bed sheet fold', materials.linen, [.17, .085, bedWidth + .03], [bedX + .40, .482, bedZ], .035, 4);
  for (const offset of [-.62, -.52]) soft('Office | bed blanket stripe', materials.accent, [.055, .079, bedWidth + .024], [bedX + offset, .478, bedZ], .035, 3);

  // Flip-flops kicked off beside the bed: foot-shaped soles and Y straps.
  const sole = new THREE.Shape();
  sole.moveTo(-.036, -.135);
  sole.bezierCurveTo(-.046, -.06, -.058, .03, -.05, .09);
  sole.bezierCurveTo(-.045, .132, -.012, .142, .014, .136);
  sole.bezierCurveTo(.05, .126, .056, .07, .05, .02);
  sole.bezierCurveTo(.044, -.04, .042, -.09, .036, -.135);
  sole.bezierCurveTo(.022, -.152, -.022, -.152, -.036, -.135);
  for (const [x, z, turn, mirror] of [[5.18, .74, .30, 1], [5.33, .82, -.16, -1]]) {
    const pair = new THREE.Group(); pair.position.set(x, .006, z); pair.rotation.y = turn; pair.scale.x = mirror; group.add(pair);
    const base = mergeVertices(new THREE.ExtrudeGeometry(sole, { depth: .018, bevelEnabled: true, bevelThickness: .004, bevelSize: .004, bevelSegments: 2, curveSegments: 10 }));
    base.rotateX(-Math.PI / 2);
    const slab = new THREE.Mesh(base, materials.foam); slab.name = 'Office | flip-flop sole'; pair.add(slab);
    for (const side of [-1, 1]) {
      const path = new THREE.CatmullRomCurve3([new THREE.Vector3(-.006, .020, -.082), new THREE.Vector3(side * .012, .050, -.055), new THREE.Vector3(side * .040, .046, -.012), new THREE.Vector3(side * .046, .020, .030)]);
      const strap = new THREE.Mesh(new THREE.TubeGeometry(path, 12, .0065, 6), materials.black); strap.name = 'Office | flip-flop strap'; pair.add(strap);
    }
    if (mirror < 0) pair.traverse((mesh) => { if (mesh.isMesh) { mesh.geometry.scale(-1, 1, 1); mesh.geometry.index.array.reverse(); } }), pair.scale.x = 1;
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
