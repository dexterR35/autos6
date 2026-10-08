// Completes the exported workshop for a 360° orbit. The Blender scene was built for
// one camera, so its side walls stop beside the car and the front is open. This adds
// the front bay (roller doors, flag, neon), the side-wall extensions and matching
// dressing (shelves, bottles, cabinets, posters, piers, neon), reusing the GLB's own
// materials and artwork so it lights and reads like the authored back wall.
import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { meshComponents } from './meshComponents.js';

const SIDE_X = 13.82; // inner face of both side walls
const FRONT_Z = 13.92; // inner face of the new front wall
const OLD_WALL_END = 3.9; // where the exported side walls stop
const UP = new THREE.Vector3(0, 1, 0);

function random(seed) {
  return () => {
    seed = (seed + 0x6d2b79f5) | 0;
    let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** Collects geometry per material and merges it into one mesh each. */
class Builder {
  constructor() { this.parts = new Map(); }

  add(material, geometry) {
    if (!material) return;
    if (!this.parts.has(material)) this.parts.set(material, []);
    this.parts.get(material).push(geometry);
  }

  box(material, [w, h, d], [x, y, z], rotationY = 0) {
    const geometry = new THREE.BoxGeometry(w, h, d);
    if (rotationY) geometry.rotateY(rotationY);
    this.add(material, geometry.translate(x, y, z));
  }

  rod(material, a, b, radius, segments = 12) {
    const start = new THREE.Vector3(...a);
    const direction = new THREE.Vector3(...b).sub(start);
    const length = direction.length();
    const geometry = new THREE.CylinderGeometry(radius, radius, length, segments, 1);
    const matrix = new THREE.Matrix4().compose(
      start.addScaledVector(direction, 0.5),
      new THREE.Quaternion().setFromUnitVectors(UP, direction.normalize()),
      new THREE.Vector3(1, 1, 1),
    );
    this.add(material, geometry.applyMatrix4(matrix));
  }

  build(name, userData = {}) {
    const group = new THREE.Group();
    group.name = name;
    for (const [material, geometries] of this.parts) {
      const mesh = new THREE.Mesh(mergeGeometries(geometries), material);
      mesh.name = `${name} | ${material.name}`;
      Object.assign(mesh.userData, userData);
      group.add(mesh);
      geometries.forEach((geometry) => geometry.dispose());
    }
    return group;
  }
}

function shutterTexture() {
  const canvas = document.createElement('canvas');
  canvas.width = 4;
  canvas.height = 64;
  const context = canvas.getContext('2d');
  const gradient = context.createLinearGradient(0, 0, 0, 64);
  gradient.addColorStop(0, '#2a2d31');
  gradient.addColorStop(0.12, '#c8ccd2');
  gradient.addColorStop(0.5, '#8d939b');
  gradient.addColorStop(0.86, '#5a6068');
  gradient.addColorStop(0.94, '#1c1e21');
  gradient.addColorStop(1, '#2a2d31');
  context.fillStyle = gradient;
  context.fillRect(0, 0, 4, 64);
  const texture = new THREE.CanvasTexture(canvas);
  texture.wrapS = THREE.RepeatWrapping;
  texture.wrapT = THREE.RepeatWrapping;
  return texture;
}

function glowTexture() {
  const canvas = document.createElement('canvas');
  canvas.width = 128;
  canvas.height = 128;
  const context = canvas.getContext('2d');
  const gradient = context.createRadialGradient(64, 64, 0, 64, 64, 64);
  for (let i = 0; i <= 10; i++) gradient.addColorStop(i / 10, `rgba(255,255,255,${Math.exp(-((i / 10) ** 2) * 4.2) * (1 - i / 10)})`);
  context.fillStyle = gradient;
  context.fillRect(0, 0, 128, 128);
  return new THREE.CanvasTexture(canvas);
}

/**
 * The reference Audi sign: thick, saturated rings and a blue halo on the masonry.
 * The exported rings are thin bevelled curves, so heavier tori are fitted over the
 * four ring pieces found in the blue neon mesh, with a scattering glow behind them.
 */
function audiEmblem(root, blueMesh) {
  const rings = meshComponents(blueMesh).filter((box) => {
    const size = box.getSize(new THREE.Vector3());
    return size.x > 0.45 && size.x < 1.1 && Math.abs(size.x - size.y) < 0.15 && size.z < 0.2;
  });
  if (rings.length !== 4) return;
  // Its own material: a little less intense than the tubes, so the rings stay blue
  // through tone mapping instead of clipping to white.
  const sign = blueMesh.material.clone();
  const tubes = new Builder();
  const emblem = new THREE.Box3();
  for (const box of rings) {
    const centre = box.getCenter(new THREE.Vector3());
    const radius = box.getSize(new THREE.Vector3()).x / 2 - 0.026;
    tubes.add(sign, new THREE.TorusGeometry(radius, 0.031, 18, 128).translate(centre.x, centre.y, centre.z + 0.012));
    emblem.union(box);
  }
  // One dedicated, stronger wall wash for the sign (see the practical lights in garageLook).
  root.add(tubes.build('Garage extension | Audi neon rings', { lightBudget: 1, lightPower: 2.2, lightReach: 3.5, emissiveStrength: 6 }));
  const centre = emblem.getCenter(new THREE.Vector3());
  const size = emblem.getSize(new THREE.Vector3());
  const halo = new THREE.Mesh(
    new THREE.PlaneGeometry(size.x * 2.1, size.y * 3.4),
    new THREE.MeshBasicMaterial({
      name: 'Audi sign | blue halo', map: glowTexture(), color: new THREE.Color(0.003, 0.03, 0.17),
      transparent: true, depthWrite: false, blending: THREE.AdditiveBlending,
    }),
  );
  halo.position.set(centre.x, centre.y, emblem.min.z - 0.01);
  halo.name = 'Garage extension | Audi sign halo';
  halo.renderOrder = 2;
  root.add(halo);
}

/** Adds the missing walls and dressing to the loaded garage scene (glTF space, Y up). */
export function extendGarage(garage) {
  garage.updateMatrixWorld(true);
  const meshes = [];
  garage.traverse((object) => { if (object.isMesh) meshes.push(object); });
  const material = (pattern) => meshes.find((mesh) => pattern.test(mesh.material.name))?.material;
  const m = {
    wall: material(/aged concrete block/i),
    ceiling: material(/ceiling \| soot/i),
    steel: material(/aged charcoal enamel/i),
    silver: material(/machined steel/i),
    black: material(/black recess/i),
    paper: material(/ivory label/i),
    rubber: material(/charcoal rubber/i),
    cabinet: material(/deep red powdercoat/i),
    blue: material(/cobalt blue neon/i),
    red: material(/crimson neon/i),
    warm: material(/warm fluorescent/i),
    yellow: material(/ochre safety/i),
    bulb: material(/tungsten worklamp/i),
  };
  const blueMesh = meshes.find((mesh) => mesh.material === m.blue);
  const posters = meshes.filter((mesh) => /reference motorsport print/i.test(mesh.material.name));
  const flag = meshes.find((mesh) => /faded charcoal fabric/i.test(mesh.material.name));
  const root = new THREE.Group();
  root.name = 'Garage extension | front bay and side walls';
  const rand = random(612);
  if (blueMesh) audiEmblem(root, blueMesh);

  // Shell: side-wall extensions, front wall, ceiling, purlins and two roof trusses.
  const shell = new Builder();
  for (const side of [-1, 1]) {
    const length = FRONT_Z + 0.2 - OLD_WALL_END;
    shell.box(m.wall, [0.35, 7, length], [side * 14, 3.5, OLD_WALL_END + length / 2]);
  }
  shell.box(m.wall, [28.35, 7, 0.35], [0, 3.5, FRONT_Z + 0.175]);
  shell.box(m.ceiling, [28.35, 0.2, FRONT_Z - 6.3], [0, 7.25, (FRONT_Z + 6.5) / 2]);
  for (let x = -12; x <= 12; x += 4) shell.box(m.steel, [0.14, 0.18, FRONT_Z - 6.3], [x, 6.98, (FRONT_Z + 6.5) / 2]);
  for (const z of [3.7, 8.9]) {
    for (const y of [5.7, 6.45]) shell.box(m.steel, [28, 0.13, 0.14], [0, y, z]);
    for (let x = -14; x < 14; x += 1) {
      shell.rod(m.silver, [x, 5.72, z], [x + 1, 6.41, z], 0.032, 6);
      shell.rod(m.steel, [x, 5.72, z], [x, 6.41, z], 0.026, 6);
    }
  }
  // I-beam piers keep the back wall's structural rhythm along every wall.
  const pier = (x, z, alongX) => {
    const w = 0.3;
    if (alongX) {
      shell.box(m.steel, [0.065, 6.95, w], [x, 3.475, z]);
      for (const dz of [-w / 2, w / 2]) shell.box(m.steel, [w, 6.95, 0.06], [x, 3.475, z + dz]);
    } else {
      shell.box(m.steel, [w, 6.95, 0.065], [x, 3.475, z]);
      for (const dx of [-w / 2, w / 2]) shell.box(m.steel, [0.06, 6.95, w], [x + dx, 3.475, z]);
    }
    shell.box(m.steel, [w + 0.28, 0.1, w + 0.28], [x, 0.05, z]);
  };
  for (const side of [-1, 1]) for (const z of [-12.4, -5.8, 2.4, 12.8]) pier(side * (SIDE_X - 0.17), z, true);
  for (const x of [-11, 11]) pier(x, FRONT_Z - 0.17, false);
  root.add(shell.build('Garage extension | shell'));

  // Two closed roller-shutter doors in the front wall.
  const slats = shutterTexture();
  slats.colorSpace = THREE.SRGBColorSpace;
  const relief = slats.clone();
  relief.colorSpace = THREE.NoColorSpace;
  for (const texture of [slats, relief]) texture.repeat.set(1, 4.6 / 0.11);
  const shutter = new THREE.MeshStandardMaterial({
    name: 'Roller shutter | galvanised slats', color: new THREE.Color(0.3, 0.32, 0.35), map: slats, bumpMap: relief,
    bumpScale: 2.5, metalness: 0.65, roughness: 0.42,
  });
  // Control-box indicator: glows, but is too small to be a practical light source.
  const led = new THREE.MeshStandardMaterial({ name: 'Door control | red indicator LED', color: 0x000000, emissive: new THREE.Color(1, 0.04, 0.05), emissiveIntensity: 9 });
  const doors = new Builder();
  for (const x of [-5.6, 5.6]) {
    const panel = new THREE.PlaneGeometry(5.2, 4.6).rotateY(Math.PI).translate(x, 2.3, FRONT_Z - 0.04);
    doors.add(shutter, panel);
    doors.box(m.steel, [5.75, 0.72, 0.62], [x, 4.95, FRONT_Z - 0.3]);
    for (const dx of [-2.68, 2.68]) doors.box(m.steel, [0.16, 4.7, 0.22], [x + dx, 2.35, FRONT_Z - 0.11]);
    doors.box(m.black, [5.2, 0.09, 0.08], [x, 0.045, FRONT_Z - 0.08]);
    doors.box(m.yellow, [5.6, 0.012, 0.32], [x, 0.006, FRONT_Z - 0.55]);
    doors.box(m.steel, [0.22, 0.32, 0.12], [x + 3.05, 1.35, FRONT_Z - 0.08]);
    doors.box(led, [0.07, 0.07, 0.03], [x + 3.05, 1.42, FRONT_Z - 0.15]);
  }
  root.add(doors.build('Garage extension | roller doors'));

  // Neon and work lights. Tubes are one mesh per wall and colour, so each wall
  // gets its own practical light; rails and sockets share one mesh.
  const hardware = new Builder();
  const fixtures = (name, specs) => {
    for (const [material, list] of specs) {
      const tubes = new Builder();
      for (const [a, b, normal] of list) {
        const back = normal.map((value) => -value * 0.06);
        hardware.rod(m.steel, a.map((v, i) => v + back[i]), b.map((v, i) => v + back[i]), 0.055, 8);
        tubes.rod(material, a, b, 0.029, 12);
        const along = new THREE.Vector3(...b).sub(new THREE.Vector3(...a)).normalize().multiplyScalar(0.035);
        for (const end of [a, b]) {
          hardware.rod(m.silver, end.map((v, i) => v - along.getComponent(i)), end.map((v, i) => v + along.getComponent(i)), 0.04, 10);
        }
      }
      root.add(tubes.build(`Garage extension | ${name}`, { lightBudget: 1 }));
    }
  };
  for (const side of [-1, 1]) {
    const x = side * (SIDE_X - 0.08);
    const normal = [-side, 0, 0];
    fixtures(side < 0 ? 'west neon' : 'east neon', [
      [m.blue, [[[x, 5.35, -11], [x, 5.3, -6.3], normal], [[x, 5.3, 5.2], [x, 5.35, 11], normal]]],
      [m.red, [[[x, 1.75, side < 0 ? 1.4 : -1.4], [x, 3.15, side < 0 ? 1.4 : -1.4], normal], [[x, 1.75, side < 0 ? 12.4 : 12.2], [x, 3.15, side < 0 ? 12.4 : 12.2], normal]]],
    ]);
  }
  const front = [0, 0, -1];
  const fz = FRONT_Z - 0.08;
  fixtures('front neon', [
    [m.blue, [[[-7.4, 5.75, fz], [-3.8, 5.75, fz], front], [[3.8, 5.75, fz], [7.4, 5.75, fz], front]]],
    [m.red, [[[-2.3, 1.6, fz], [-2.3, 3.6, fz], front], [[2.3, 1.6, fz], [2.3, 3.6, fz], front]]],
    [m.warm, [[[-1.2, 5.85, FRONT_Z - 0.6], [1.2, 5.85, FRONT_Z - 0.6], front]]],
  ]);
  // Rows of twin-tube fluorescent battens under the trusses, as in the reference
  // ceiling. Dim by default; the viewer's ceiling-light switch drives each row's
  // material (garageLook), so every row is its own mesh and material.
  const battens = new Builder();
  const diffuser = new THREE.MeshStandardMaterial({
    name: 'Ceiling fluorescent diffuser', color: 0x000000, emissive: new THREE.Color(1, 0.84, 0.66), emissiveIntensity: 3,
  });
  [-9.3, -4.1, 1.1, 6.3, 11.3].forEach((z, row) => {
    const tubes = new Builder();
    const material = diffuser.clone();
    for (const x of [-11, -6.6, -2.2, 2.2, 6.6, 11]) {
      battens.box(m.steel, [1.9, 0.06, 0.2], [x, 5.48, z]);
      for (const dz of [-0.045, 0.045]) tubes.rod(material, [x - 0.88, 5.42, z + dz], [x + 0.88, 5.42, z + dz], 0.022, 10);
      for (const dx of [-0.75, 0.75]) battens.rod(m.steel, [x + dx, 5.51, z], [x + dx, 7.15, z], 0.006, 4);
    }
    root.add(tubes.build(`Garage extension | ceiling tubes row ${row + 1}`, { excludeFromProbe: true, ceilingRow: row }));
  });
  // Blue LED strips under two truss chords, as in the reference ceiling.
  const trussBlue = new THREE.MeshStandardMaterial({
    name: 'Truss LED strip | blue', color: 0x000000, emissive: new THREE.Color(0.01, 0.12, 1), emissiveIntensity: 2.4,
  });
  for (const z of [-6.7, -1.5]) for (const x of [-9, -3, 3, 9]) battens.box(trussBlue, [4.2, 0.028, 0.05], [x, 5.615, z]);
  // The ceiling reaches the room through bloom and the floor mirror, not through the
  // environment probe, which would otherwise wash every wall with its light.
  root.add(battens.build('Garage extension | ceiling battens', { excludeFromProbe: true }));

  // Caged pendant work lamps hanging at the top left of the reference frame.
  const lamps = new Builder();
  const bulbs = new Builder();
  for (const [x, y, z] of [[-10.04, 5.1, -12.8], [-10.08, 4.49, -12.2]]) {
    lamps.rod(m.rubber, [x, y + 0.16, z], [x, 7.15, z], 0.008, 6);
    lamps.add(m.steel, new THREE.CylinderGeometry(0.032, 0.032, 0.08, 14).translate(x, y + 0.13, z));
    lamps.add(m.silver, new THREE.CylinderGeometry(0.035, 0.12, 0.1, 20, 1, true).translate(x, y + 0.06, z));
    for (let i = 0; i < 6; i++) {
      const a = (i / 6) * Math.PI * 2;
      lamps.rod(m.steel, [x + Math.cos(a) * 0.1, y + 0.02, z + Math.sin(a) * 0.1], [x + Math.cos(a) * 0.05, y - 0.09, z + Math.sin(a) * 0.05], 0.004, 4);
    }
    if (m.bulb) bulbs.add(m.bulb, new THREE.SphereGeometry(0.05, 16, 12).translate(x, y, z));
  }
  root.add(lamps.build('Garage extension | pendant lamps'));
  root.add(bulbs.build('Garage extension | pendant bulbs', { lightBudget: 1 }));
  root.add(hardware.build('Garage extension | neon hardware'));

  // Wall shelves with bottles and red rolling cabinets on both side walls.
  const dressing = new Builder();
  const bottles = [];
  const cabinetRun = (side, zFrom, count) => {
    let z = zFrom;
    for (let i = 0; i < count; i++) {
      const width = 0.95 + rand() * 0.45;
      const height = 1.38 + rand() * 0.22;
      const drawers = 7 + Math.floor(rand() * 3);
      const depth = 0.69;
      const cx = side * (SIDE_X - 0.06 - depth / 2);
      const cz = z + width / 2;
      const face = side * (SIDE_X - 0.06 - depth) - side * 0.012;
      dressing.box(m.cabinet, [depth, height, width], [cx, height / 2 + 0.19, cz]);
      dressing.box(m.rubber, [depth + 0.04, 0.055, width + 0.045], [cx, height + 0.215, cz]);
      for (let j = 0; j < drawers; j++) {
        const dh = (height - 0.13) / drawers;
        const y = 0.25 + dh / 2 + j * dh;
        dressing.box(m.black, [0.02, 0.012, width - 0.1], [face, y + dh / 2 - 0.006, cz]);
        dressing.box(m.silver, [0.035, 0.026, width - 0.22], [face - side * 0.02, y + dh * 0.28, cz]);
        dressing.box(m.paper, [0.006, 0.032, 0.1], [face - side * 0.004, y, cz + width * 0.3]);
      }
      for (const dz of [-width * 0.4, width * 0.4]) dressing.box(m.rubber, [0.09, 0.17, 0.065], [face + side * 0.12, 0.09, cz + dz]);
      for (let k = 0; k < 4 + rand() * 4; k++) {
        bottles.push([cx + (rand() - 0.5) * 0.4, height + 0.245, cz + (rand() - 0.5) * (width - 0.2)]);
      }
      z += width + 0.04;
    }
  };
  const shelf = (side, zFrom, zTo, y) => {
    const x = side * (SIDE_X - 0.24);
    dressing.box(m.steel, [0.48, 0.055, zTo - zFrom], [x, y, (zFrom + zTo) / 2]);
    for (const z of [zFrom + 0.1, (zFrom + zTo) / 2, zTo - 0.1]) {
      dressing.rod(m.silver, [side * (SIDE_X - 0.02), y - 0.35, z], [side * (SIDE_X - 0.42), y - 0.035, z], 0.018, 6);
    }
    for (let z = zFrom + 0.12; z < zTo - 0.08; z += 0.17) {
      if (rand() < 0.84) bottles.push([x + (rand() - 0.5) * 0.2, y + 0.027, z + (rand() - 0.5) * 0.04]);
    }
  };
  for (const side of [-1, 1]) {
    cabinetRun(side, side < 0 ? 4.6 : 3.9, 5);
    for (const y of [2.38, 3.12]) shelf(side, side < 0 ? 4.3 : 3.7, side < 0 ? 10.4 : 9.6, y);
    for (const y of [2.38, 3.12]) shelf(side, -11.6, -6.4, y);
  }
  root.add(dressing.build('Garage extension | cabinets and shelves'));

  // Instanced bottles: one draw call for the bodies and one for the caps.
  const palette = [[0.26, 0.015, 0.012], [0.018, 0.055, 0.18], [0.58, 0.36, 0.035], [0.57, 0.54, 0.43], [0.21, 0.077, 0.018], [0.03, 0.04, 0.05]];
  const bodyGeometry = new THREE.CylinderGeometry(1, 1, 1, 14).translate(0, 0.5, 0);
  const bodies = new THREE.InstancedMesh(bodyGeometry, new THREE.MeshStandardMaterial({ name: 'Bottle | instanced', roughness: 0.32, metalness: 0.15 }), bottles.length);
  const caps = new THREE.InstancedMesh(bodyGeometry, m.black, bottles.length);
  const matrix = new THREE.Matrix4();
  const color = new THREE.Color();
  bottles.forEach(([x, y, z], index) => {
    const height = 0.14 + rand() * 0.23;
    const radius = 0.031 + rand() * 0.028;
    bodies.setMatrixAt(index, matrix.makeScale(radius, height * 0.9, radius).setPosition(x, y, z));
    bodies.setColorAt(index, color.setRGB(...palette[Math.floor(rand() * palette.length)]));
    caps.setMatrixAt(index, matrix.makeScale(radius * 0.5, height * 0.1, radius * 0.5).setPosition(x, y + height * 0.9, z));
  });
  bodies.name = 'Garage extension | bottles';
  caps.name = 'Garage extension | bottle caps';
  root.add(bodies, caps);

  // Framed prints and the S6 flag, cloned from the authored back-wall artwork.
  const framed = new Builder();
  const hang = (source, position, rotationY) => {
    const geometry = source.geometry.clone();
    geometry.computeBoundingBox();
    const centre = geometry.boundingBox.getCenter(new THREE.Vector3());
    geometry.translate(-centre.x, -centre.y, -centre.z);
    const print = new THREE.Mesh(geometry, source.material);
    print.position.set(...position);
    print.rotation.y = rotationY;
    print.name = `Garage extension | ${source.name}`;
    root.add(print);
    return geometry.boundingBox.getSize(new THREE.Vector3());
  };
  const prints = [
    [-1, -9.9], [-1, -8.1], [1, -9.6], [1, -7.8], [-1, 6.4], [-1, 8.6], [1, 5.7], [1, 7.9],
  ];
  prints.forEach(([side, z], index) => {
    const source = posters[index % posters.length];
    if (!source) return;
    const rotation = side < 0 ? Math.PI / 2 : -Math.PI / 2;
    const size = hang(source, [side * (SIDE_X - 0.075), 4.15, z], rotation);
    const width = Math.max(size.x, size.z);
    framed.box(m.black, [0.06, size.y + 0.23, width + 0.18], [side * (SIDE_X - 0.03), 4.15, z]);
    framed.box(m.paper, [0.014, size.y + 0.1, width + 0.06], [side * (SIDE_X - 0.05), 4.15, z]);
  });
  root.add(framed.build('Garage extension | print frames'));
  if (flag) hang(flag, [0, 3.95, FRONT_Z - 0.12], Math.PI);

  garage.add(root);
  root.updateMatrixWorld(true);
  return root;
}
