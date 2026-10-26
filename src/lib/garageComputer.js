import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';

const UP = new THREE.Vector3(0, 1, 0);

function workspaceTexture() {
  const canvas = globalThis.document?.createElement('canvas');
  if (!canvas) {
    const texture = new THREE.DataTexture(new Uint8Array([10, 24, 36, 255]), 1, 1);
    texture.colorSpace = THREE.SRGBColorSpace;
    texture.needsUpdate = true;
    return texture;
  }
  canvas.width = 1024; canvas.height = 600;
  const context = canvas.getContext('2d');
  if (context) {
    context.fillStyle = '#07121e'; context.fillRect(0, 0, 1024, 600);
    const background = context.createLinearGradient(0, 0, 1024, 600);
    background.addColorStop(0, '#0f2e43'); background.addColorStop(1, '#080f19');
    context.fillStyle = background; context.fillRect(0, 0, 1024, 600);
    context.fillStyle = '#31c5e6'; context.fillRect(0, 0, 9, 600);
    context.font = '700 43px Arial'; context.fillStyle = '#eef8ff'; context.fillText('PROJECT S6', 43, 68);
    context.font = '20px Arial'; context.fillStyle = '#85a6be'; context.fillText('WORKSHOP / SERVICE WORKSPACE', 45, 104);
    context.fillStyle = '#182f42'; context.fillRect(42, 132, 940, 2);
    context.font = '600 18px Arial'; context.fillStyle = '#72def0'; context.fillText('BUILD PLAN', 44, 170);
    context.fillStyle = '#8ba3b9'; context.fillText('PARTS CATALOGUE', 202, 170); context.fillText('SERVICE NOTES', 455, 170);
    context.fillStyle = '#102334'; context.fillRect(42, 200, 596, 277);
    context.strokeStyle = '#55cbe1'; context.lineWidth = 4;
    context.beginPath(); context.moveTo(79, 366); context.lineTo(91, 340); context.lineTo(148, 324);
    context.lineTo(218, 269); context.lineTo(444, 269); context.lineTo(506, 316); context.lineTo(586, 335);
    context.lineTo(604, 368); context.lineTo(575, 382); context.lineTo(113, 382); context.closePath(); context.stroke();
    context.beginPath(); context.moveTo(230, 279); context.lineTo(174, 323); context.lineTo(477, 323);
    context.lineTo(436, 279); context.closePath(); context.stroke();
    for (const x of [173, 514]) {
      context.fillStyle = '#0a1521'; context.beginPath(); context.arc(x, 378, 34, 0, Math.PI * 2); context.fill();
      context.strokeStyle = '#9ee6ef'; context.lineWidth = 4; context.stroke();
      context.beginPath(); context.arc(x, 378, 18, 0, Math.PI * 2); context.stroke();
    }
    context.font = '600 19px Arial'; context.fillStyle = '#bfd2e1'; context.fillText('AUDI S6 C5 / AVANT', 75, 449);
    const notes = ['Vehicle inspection', 'Engine & drivetrain', 'Parts and fitment', 'Workshop notes'];
    notes.forEach((note, index) => {
      const y = 224 + index * 64;
      context.fillStyle = '#173749'; context.fillRect(672, y, 305, 51);
      context.fillStyle = '#5ed1d9'; context.fillRect(686, y + 16, 17, 17);
      context.font = '19px Arial'; context.fillStyle = '#deedf4'; context.fillText(note, 716, y + 33);
    });
    context.fillStyle = '#183247'; context.fillRect(42, 505, 940, 53);
    context.fillStyle = '#87a4b8'; context.font = '18px Arial'; context.fillText('GARAGE DESK', 62, 538);
    context.fillStyle = '#75d9d5'; context.fillText('PROJECT FILES / OFFLINE', 683, 538);
  }
  const texture = new THREE.CanvasTexture(canvas);
  texture.colorSpace = THREE.SRGBColorSpace;
  texture.anisotropy = 4;
  return texture;
}

class ComputerBuilder {
  constructor() { this.parts = new Map(); }
  add(material, geometry) {
    if (!this.parts.has(material)) this.parts.set(material, []);
    this.parts.get(material).push(geometry);
  }
  box(material, size, at, rotation = 0) {
    const geometry = new THREE.BoxGeometry(...size);
    if (rotation) geometry.rotateY(rotation);
    this.add(material, geometry.translate(...at));
  }
  rod(material, a, b, radius, segments = 12) {
    const start = new THREE.Vector3(...a), end = new THREE.Vector3(...b), direction = end.clone().sub(start);
    const transform = new THREE.Matrix4().compose(start.add(end).multiplyScalar(.5),
      new THREE.Quaternion().setFromUnitVectors(UP, direction.clone().normalize()), new THREE.Vector3(1, 1, 1));
    this.add(material, new THREE.CylinderGeometry(radius, radius, direction.length(), segments).applyMatrix4(transform));
  }
  rgb(material, geometry, offset = 0) {
    const position = geometry.attributes.position, color = new THREE.Color(), colors = [];
    for (let i = 0; i < position.count; i++) {
      color.setHSL((Math.atan2(position.getY(i), position.getX(i)) / (Math.PI * 2) + offset + 1) % 1, .95, .58);
      colors.push(color.r * 1.2, color.g * 1.2, color.b * 1.2);
    }
    geometry.setAttribute('color', new THREE.Float32BufferAttribute(colors, 3));
    this.add(material, geometry);
  }
  build(root) {
    for (const [material, pieces] of this.parts) {
      const mesh = new THREE.Mesh(mergeGeometries(pieces), material);
      mesh.name = material.name;
      mesh.userData.garageComputer = true;
      root.add(mesh);
      pieces.forEach((piece) => piece.dispose());
    }
  }
}

/** Desktop-level Y=0; screen, keys and case window face local +Z. */
export function createGarageComputer(materials = {}, { monitorCount = 2 } = {}) {
  const count = [1, 2, 3].includes(monitorCount) ? monitorCount : 2;
  const root = new THREE.Group();
  root.name = 'Garage office | gaming computer and peripherals';
  root.userData = { garageComputer: true, monitorCount: count, rgbFans: 3, rearFans: 1, transparentCase: true, peripherals: ['monitor', 'keyboard', 'mouse', 'headset'] };
  const steel = materials.steel ?? new THREE.MeshStandardMaterial({ name: 'Computer | graphite steel', color: '#222b33', roughness: .42, metalness: .65 });
  const black = materials.black ?? new THREE.MeshStandardMaterial({ name: 'Computer | black plastic', color: '#090e13', roughness: .7 });
  const silver = materials.silver ?? new THREE.MeshStandardMaterial({ name: 'Computer | brushed alloy', color: '#9aa8b6', roughness: .28, metalness: .85 });
  const rgb = new THREE.MeshBasicMaterial({ name: 'Computer | RGB fan rings and keyboard LEDs', vertexColors: true, toneMapped: false });
  const glass = new THREE.MeshStandardMaterial({ name: 'Computer | transparent tempered glass', color: '#9bb3c9', transparent: true, opacity: .16, roughness: .12, metalness: .05, depthWrite: false });
  const screen = new THREE.MeshBasicMaterial({ name: 'Computer | service workspace display', map: workspaceTexture(), color: '#d2edff', toneMapped: false });
  const b = new ComputerBuilder();

  // Two or three 27-inch displays fit the smaller desk without shrinking the PC.
  // Outer displays angle toward the seated user; all panels share one screen atlas.
  const monitorCenters = count === 3 ? [-.88, -.18, .52] : count === 2 ? [-.53, .17] : [-.18];
  root.userData.monitorCenters = monitorCenters;
  monitorCenters.forEach((center, index) => {
    const angle = count === 1 ? 0 : count === 3 ? (index === 0 ? .24 : index === 2 ? -.24 : 0) : (index === 0 ? .10 : -.10);
    const width = count === 1 ? 1.1 : .67, height = count === 1 ? .62 : .40;
    const bodyY = count === 1 ? .445 : .36;
    const addMonitor = (material, geometry) => b.add(material, geometry.rotateY(angle).translate(center, 0, -.25));
    addMonitor(black, new THREE.BoxGeometry(width, height, .045).translate(0, bodyY, 0));
    addMonitor(steel, new THREE.BoxGeometry(count === 1 ? .36 : .26, .018, .22).translate(0, .01, 0));
    addMonitor(steel, new THREE.CylinderGeometry(.024, .024, .165, 12).translate(0, .0925, -.02));
    addMonitor(silver, new THREE.BoxGeometry(.1, .09, .025).translate(0, .145, .024));
    addMonitor(screen, new THREE.PlaneGeometry(width - .055, height - .044).translate(0, bodyY + .009, .025));
    addMonitor(silver, new THREE.BoxGeometry(.065, .008, .002).translate(0, bodyY - height / 2 + .01, .024));
    addMonitor(black, new THREE.BoxGeometry(.018, .01, .006).translate(width / 2 - .04, bodyY - height / 2 + .024, .026));
  });

  // Mechanical keyboard, individual key caps, mouse and fabric desk mat.
  b.box(black, [.77, .012, .28], [-.18, .007, .24]);
  b.box(steel, [.73, .018, .24], [-.18, .021, .24]);
  for (let row = 0; row < 5; row++) for (let key = 0; key < 15; key++) {
    if (row === 4 && key > 3 && key < 10) continue;
    b.box(black, [.038, .012, .034], [-.51 + key * .046, .036, .15 + row * .043]);
  }
  b.box(black, [.27, .012, .034], [-.2, .036, .322]);
  for (let row = 0; row < 5; row++) {
    const strip = new THREE.BoxGeometry(.675, .004, .004).translate(0, 0, 0);
    b.rgb(rgb, strip, row / 6);
    // Translate after assigning local LED colors.
    b.parts.get(rgb).at(-1).translate(-.18, .029, .15 + row * .043);
  }
  b.box(black, [.40, .006, .39], [.46, .004, .23]);
  b.add(steel, new THREE.SphereGeometry(1, 16, 10).scale(.046, .027, .069).translate(.45, .029, .23));
  b.box(black, [.003, .009, .045], [.45, .055, .207]);
  b.rod(silver, [.45, .054, .191], [.45, .054, .212], .006, 8);

  // Full headphones with padded cups, curved headband, cable and desk stand.
  b.box(steel, [.16, .013, .14], [-.83, .007, .20]);
  b.rod(silver, [-.83, .014, .18], [-.83, .305, .18], .009, 10);
  b.box(black, [.07, .015, .06], [-.83, .31, .18]);
  b.add(black, new THREE.TorusGeometry(.101, .014, 8, 36, Math.PI).translate(-.83, .275, .205));
  for (const side of [-1, 1]) {
    b.add(silver, new THREE.SphereGeometry(1, 12, 8).scale(.034, .059, .035).translate(-.83 + side * .101, .255, .205));
    b.add(black, new THREE.SphereGeometry(1, 12, 8).scale(.027, .052, .032).translate(-.83 + side * .103, .255, .227));
  }
  const cable = new THREE.CatmullRomCurve3([new THREE.Vector3(-.929, .224, .205), new THREE.Vector3(-.961, .10, .20), new THREE.Vector3(-.86, .018, .31), new THREE.Vector3(-.68, .02, .29)]);
  b.add(black, new THREE.TubeGeometry(cable, 18, .003, 5, false));

  // Windowed tower. All side geometry is real, without a transmission pass.
  const tx = count === 1 ? 1.03 : 1.31;
  b.box(steel, [.45, .03, .52], [tx, .045, -.02]);
  b.box(steel, [.45, .025, .52], [tx, .7375, -.02]);
  b.box(black, [.45, .69, .023], [tx, .39, -.269]);
  for (const side of [-1, 1]) {
    b.box(steel, [.018, .69, .52], [tx + side * .216, .39, -.02]);
    for (const z of [-.21, .17]) b.box(black, [.055, .025, .055], [tx + side * .16, .0125, z]);
  }
  for (const x of [tx - .208, tx + .208]) b.box(steel, [.025, .69, .025], [x, .39, .25]);
  b.box(steel, [.43, .025, .024], [tx, .055, .25]);
  b.box(steel, [.43, .025, .024], [tx, .73, .25]);
  b.add(glass, new THREE.PlaneGeometry(.405, .65).translate(tx, .393, .265));
  // Four mounting screws around the removable glass panel.
  for (const x of [tx - .186, tx + .186]) for (const y of [.09, .695]) b.rod(silver, [x, y, .261], [x, y, .274], .009, 8);
  b.box(black, [.285, .48, .02], [tx - .035, .405, -.19]);
  b.box(steel, [.29, .075, .23], [tx - .025, .248, -.04]);
  b.box(silver, [.27, .012, .22], [tx - .025, .294, -.04]);
  // CPU cooler, GPU heat sink, RAM modules and power supply behind the glass.
  b.box(silver, [.095, .12, .08], [tx - .075, .505, -.13]);
  b.box(black, [.18, .13, .20], [tx - .06, .12, -.08]);
  for (let fin = 0; fin < 9; fin++) b.box(silver, [.006, .066, .18], [tx - .14 + fin * .026, .249, -.04]);
  for (const x of [tx - .015, tx + .025]) b.box(steel, [.02, .18, .035], [x, .52, -.12]);
  for (const y of [.508, .55]) b.box(silver, [.075, .012, .06], [tx - .1, y, -.079]);
  for (let fan = 0; fan < 3; fan++) {
    const fx = tx + .106, fy = .17 + fan * .211, fz = .205;
    b.add(black, new THREE.TorusGeometry(.077, .01, 8, 36).translate(fx, fy, fz));
    b.rgb(rgb, new THREE.TorusGeometry(.072, .006, 8, 48), fan / 3);
    b.parts.get(rgb).at(-1).translate(fx, fy, fz + .012);
    b.rod(silver, [fx, fy, fz - .008], [fx, fy, fz + .019], .021, 12);
    for (let blade = 0; blade < 7; blade++) {
      const angle = blade / 7 * Math.PI * 2;
      const geometry = new THREE.BoxGeometry(.029, .052, .006).rotateZ(angle - .45)
        .translate(fx + Math.sin(angle) * .039, fy + Math.cos(angle) * .039, fz + .004);
      b.add(steel, geometry);
    }
  }
  const rearX = tx - .11, rearY = .63;
  b.add(black, new THREE.TorusGeometry(.055, .008, 8, 30).translate(rearX, rearY, -.13));
  b.rod(silver, [rearX, rearY, -.15], [rearX, rearY, -.11], .019, 10);
  for (let blade = 0; blade < 5; blade++) {
    const angle = blade * Math.PI * 2 / 5;
    b.add(steel, new THREE.BoxGeometry(.02, .036, .005).rotateZ(angle).translate(rearX + Math.sin(angle) * .028, rearY + Math.cos(angle) * .028, -.12));
  }
  // Tiny top controls, front USB ports and a looped internal power cable.
  b.rod(silver, [tx + .12, .75, .16], [tx + .12, .756, .16], .014, 12);
  for (const x of [tx - .08, tx - .03]) b.box(black, [.032, .009, .016], [x, .751, .16]);
  const powerCable = new THREE.CatmullRomCurve3([new THREE.Vector3(tx - .1, .16, .02), new THREE.Vector3(tx - .16, .35, .09), new THREE.Vector3(tx - .13, .46, -.04)]);
  b.add(black, new THREE.TubeGeometry(powerCable, 16, .007, 6, false));
  b.build(root);
  return root;
}
