import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';

function canvasTexture(width, height, paint) {
  const canvas = document.createElement('canvas');
  canvas.width = width; canvas.height = height;
  paint(canvas.getContext('2d'));
  const texture = new THREE.CanvasTexture(canvas);
  texture.colorSpace = THREE.SRGBColorSpace;
  texture.anisotropy = 4;
  return texture;
}

function line(context, points, color = '#b2dded', width = 2, close = false) {
  context.strokeStyle = color; context.lineWidth = width; context.beginPath();
  points.forEach(([x, y], i) => i ? context.lineTo(x, y) : context.moveTo(x, y));
  if (close) context.closePath();
  context.stroke();
}

function wheel(context, x, y, radius, color = '#9bd9ef') {
  context.strokeStyle = color; context.lineWidth = 3;
  for (const r of [radius, radius * .73, radius * .16]) {
    context.beginPath(); context.arc(x, y, r, 0, Math.PI * 2); context.stroke();
  }
  for (let i = 0; i < 5; i++) {
    const a = i * Math.PI * 2 / 5;
    line(context, [[x + Math.cos(a) * radius * .2, y + Math.sin(a) * radius * .2], [x + Math.cos(a + .12) * radius * .7, y + Math.sin(a + .12) * radius * .7]], color, 2);
  }
}

function wagon(context, x, y, scale = 1, color = '#bee8f6') {
  context.save(); context.translate(x, y); context.scale(scale, scale);
  line(context, [[0, 105], [4, 63], [34, 51], [76, 48], [108, 12], [253, 12], [291, 44], [350, 53], [377, 76], [379, 104], [351, 109], [344, 91], [333, 80], [306, 79], [290, 91], [284, 109], [107, 109], [102, 91], [87, 79], [63, 79], [47, 92], [43, 109], [0, 105]], color, 3);
  line(context, [[91, 49], [117, 23], [247, 23], [277, 49], [91, 49]], color, 2);
  for (const px of [155, 211]) line(context, [[px, 24], [px + 2, 49]], color, 2);
  line(context, [[160, 55], [162, 102]], color, 1.5);
  line(context, [[248, 55], [255, 102]], color, 1.5);
  line(context, [[14, 67], [43, 65]], '#ff6c6c', 5);
  line(context, [[353, 66], [373, 72]], '#ecf8ff', 5);
  wheel(context, 75, 109, 26, color); wheel(context, 318, 109, 26, color);
  line(context, [[127, 9], [230, 9]], color, 3);
  context.restore();
}

function blueprint(context) {
  context.fillStyle = '#102a3b'; context.fillRect(0, 0, 512, 512);
  context.strokeStyle = '#1b3d50'; context.lineWidth = 1;
  for (let i = 24; i < 512; i += 24) {
    line(context, [[i, 0], [i, 512]], '#1b3d50', 1);
    line(context, [[0, i], [512, i]], '#1b3d50', 1);
  }
  context.fillStyle = '#c5eaf6'; context.font = '600 17px Arial'; context.fillText('ARCHIVE / 2003', 34, 49);
  context.font = '700 48px Arial'; context.fillText('S6 AVANT', 32, 108);
  context.fillStyle = '#7ba9ba'; context.font = '15px Arial'; context.fillText('C5 · QUATTRO · TECHNICAL STUDY', 35, 137);
  wagon(context, 43, 215, 1.13);
  line(context, [[46, 398], [468, 398]], '#669bae', 1.5);
  for (const px of [46, 468]) line(context, [[px, 388], [px, 408]], '#669bae', 1.5);
  context.fillStyle = '#a5c9d7'; context.font = '14px Arial'; context.fillText('FORM / PROPORTION / PURPOSE', 99, 425);
  line(context, [[35, 461], [477, 461]], '#507e91', 1);
  context.fillStyle = '#6f9cae'; context.font = '12px Arial'; context.fillText('PROJECT S6', 35, 484); context.fillText('01 — DESIGN ARCHIVE', 343, 484);
}

function motorsport(context) {
  context.fillStyle = '#e2e0d4'; context.fillRect(0, 0, 512, 512);
  context.fillStyle = '#19262f'; context.fillRect(34, 34, 444, 444);
  context.save(); context.beginPath(); context.rect(34, 34, 444, 444); context.clip();
  for (const [offset, color, width] of [[-110, '#bd2738', 83], [7, '#e2e0d4', 23], [48, '#316a86', 70]]) {
    context.fillStyle = color; context.beginPath(); context.moveTo(65 + offset, 512); context.lineTo(200 + offset, 512); context.lineTo(440 + offset, 0); context.lineTo(440 + offset - width, 0); context.closePath(); context.fill();
  }
  context.strokeStyle = '#a5b1b5'; context.lineWidth = 2;
  context.beginPath(); context.ellipse(308, 253, 170, 111, -.45, 0, Math.PI * 2); context.stroke();
  context.beginPath(); context.ellipse(308, 253, 145, 87, -.45, 0, Math.PI * 2); context.stroke();
  context.fillStyle = '#f6f1dd'; context.font = 'italic 900 154px Arial'; context.fillText('S6', 161, 303);
  context.fillStyle = '#bd2738'; context.fillRect(64, 67, 48, 7);
  context.fillStyle = '#d6dfde'; context.font = '600 17px Arial'; context.fillText('BUILT TO BE DRIVEN', 64, 111);
  context.font = '14px Arial'; context.fillText('ALL WHEELS. ALL WEATHER.', 64, 417);
  context.fillStyle = '#85979e'; context.font = '11px Arial'; context.fillText('02 / MOTION STUDY', 64, 443);
  context.restore();
}

function nightGarage(context) {
  context.fillStyle = '#071721'; context.fillRect(0, 0, 512, 512);
  const glow = context.createRadialGradient(263, 249, 7, 263, 249, 230);
  glow.addColorStop(0, '#153b50'); glow.addColorStop(1, '#071721'); context.fillStyle = glow; context.fillRect(0, 0, 512, 512);
  context.fillStyle = '#7ba7b7'; context.font = '14px Arial'; context.fillText('AFTER HOURS / THE WORKSHOP', 34, 49);
  line(context, [[39, 381], [39, 122], [473, 122], [473, 381]], '#306b83', 3);
  for (let i = 0; i < 5; i++) line(context, [[39, 142 + i * 42], [473, 142 + i * 42]], '#183643', 1);
  for (const xx of [63, 430]) line(context, [[xx, 156], [xx, 275]], '#da5263', 5);
  for (const yy of [144, 383]) line(context, [[100, yy], [412, yy]], '#56b7dc', 4);
  line(context, [[92, 356], [99, 290], [132, 268], [163, 210], [350, 210], [381, 268], [413, 290], [421, 356], [92, 356]], '#87cbe2', 3);
  line(context, [[147, 264], [178, 223], [334, 223], [365, 264]], '#5d9eb8', 2);
  line(context, [[116, 286], [192, 293], [185, 311], [114, 304], [116, 286]], '#e3f8ff', 4);
  line(context, [[322, 293], [397, 286], [400, 304], [329, 311], [322, 293]], '#e3f8ff', 4);
  line(context, [[202, 289], [311, 289], [305, 324], [207, 324], [202, 289]], '#a9c1ce', 2);
  for (let x = 232; x <= 280; x += 16) { context.strokeStyle = '#d9eef4'; context.lineWidth = 2; context.beginPath(); context.ellipse(x, 305, 10, 7, 0, 0, Math.PI * 2); context.stroke(); }
  line(context, [[151, 382], [117, 450]], '#214454', 2); line(context, [[367, 382], [404, 450]], '#214454', 2);
  context.fillStyle = '#d1e3e7'; context.font = '600 27px Arial'; context.fillText('NEVER FINISHED.', 111, 434);
  context.fillStyle = '#6b9aaa'; context.font = '12px Arial'; context.fillText('03 / ONE MORE NIGHT IN THE GARAGE', 111, 465);
}

function atlasPlane(width, height, panel, count) {
  const geometry = new THREE.PlaneGeometry(width, height);
  const uv = geometry.attributes.uv;
  for (let i = 0; i < uv.count; i++) uv.setX(i, (uv.getX(i) + panel) / count);
  return geometry;
}

/** Three original garage prints, facing local +Z above the office desk. */
export function createGarageOfficeArt(materials = {}) {
  const group = new THREE.Group(); group.name = 'Garage office | three framed artwork prints';
  const texture = canvasTexture(1536, 512, (context) => {
    [blueprint, motorsport, nightGarage].forEach((paint, panel) => {
      context.save(); context.translate(panel * 512, 0); paint(context); context.restore();
    });
  });
  const frames = [], prints = [];
  [-1.45, 0, 1.45].forEach((x, panel) => {
    frames.push(new THREE.BoxGeometry(1.2, 1.1, .06).translate(x, 2.8, -.64));
    prints.push(atlasPlane(1.11, 1.01, panel, 3).translate(x, 2.8, -.604));
  });
  const frame = new THREE.Mesh(mergeGeometries(frames), materials.steel ?? new THREE.MeshStandardMaterial({ name: 'Office artwork | charcoal frame', color: '#202b32', roughness: .4, metalness: .7 }));
  frame.name = 'Garage office | artwork frames';
  const art = new THREE.Mesh(mergeGeometries(prints), new THREE.MeshBasicMaterial({ name: 'Office artwork | three-print atlas', map: texture, color: '#d8e2e5', toneMapped: false }));
  art.name = 'Garage office | three original art prints'; art.userData.officeArtCount = 3;
  frames.forEach((geometry) => geometry.dispose()); prints.forEach((geometry) => geometry.dispose());
  group.add(frame, art); return group;
}

function paperPage(context, page) {
  context.fillStyle = page === 2 ? '#d8d0b5' : '#e8e6d9'; context.fillRect(0, 0, 512, 724);
  context.fillStyle = '#33434c'; context.font = '700 27px Arial'; context.fillText('PROJECT S6', 39, 55);
  context.fillStyle = '#79858a'; context.font = '13px Arial'; context.fillText(['WORKSHOP / SERVICE CHECKLIST', 'CHASSIS / WORKING SKETCH', 'PARTS / BENCH NOTES'][page], 40, 85);
  line(context, [[40, 104], [471, 104]], '#7a8789', 2);
  if (page === 1) {
    wagon(context, 40, 182, 1.12, '#344e60');
    line(context, [[53, 380], [460, 380]], '#66808e', 2);
    for (const x of [53, 460]) line(context, [[x, 369], [x, 391]], '#66808e', 2);
    context.fillStyle = '#687e86'; context.font = '16px Arial'; context.fillText('VERIFY CLEARANCE AT RIDE HEIGHT', 67, 416);
    for (let row = 0; row < 6; row++) line(context, [[43, 479 + row * 29], [454 - (row % 3) * 63, 479 + row * 29]], '#9a9f98', 2);
    line(context, [[302, 341], [340, 360], [385, 321]], '#a05753', 3);
  } else {
    const labels = page === 0 ? ['Inspect brakes and lines', 'Check suspension joints', 'Torque wheel hardware', 'Inspect fluids and hoses', 'Check charging system', 'Road test / final review'] : ['Fasteners / sorted', 'Brake fittings / measure', 'Trim clips / inspect', 'Service tools / return', 'Reference photos / save', 'Next session / recheck'];
    labels.forEach((label, row) => {
      const y = 156 + row * 64;
      context.strokeStyle = '#697c80'; context.lineWidth = 2; context.strokeRect(43, y - 20, 20, 20);
      if (row < 3) line(context, [[47, y - 11], [52, y - 5], [62, y - 21]], '#4b6f68', 3);
      context.fillStyle = '#465960'; context.font = '18px Arial'; context.fillText(label, 82, y - 3);
      line(context, [[82, y + 16], [455, y + 16]], '#adb1a8', 1);
    });
    context.fillStyle = '#d9c985'; context.fillRect(302, 566, 145, 106);
    context.fillStyle = '#6c664d'; context.font = 'italic 17px Arial'; context.fillText('MEASURE', 317, 604); context.fillText('TWICE.', 317, 631);
  }
  context.fillStyle = '#92988f'; context.font = '12px Arial'; context.fillText('BUILD NOTES / GARAGE COPY', 41, 692);
}

/** Three slightly overlapping sheets; origin lies on the desk surface, faces +Y. */
export function createGarageDeskPapers() {
  const texture = canvasTexture(1536, 724, (context) => {
    for (let page = 0; page < 3; page++) { context.save(); context.translate(page * 512, 0); paperPage(context, page); context.restore(); }
  });
  const sheets = [];
  [[-.28, -.04, -.12], [.01, .015, .08], [.27, .07, -.09]].forEach(([x, z, angle], page) => {
    const geometry = atlasPlane(.31, .44, page, 3);
    geometry.rotateX(-Math.PI / 2).rotateY(angle).translate(x, .002 + page * .0015, z);
    sheets.push(geometry);
  });
  const mesh = new THREE.Mesh(mergeGeometries(sheets), new THREE.MeshBasicMaterial({ name: 'Office desk | service papers atlas', map: texture, toneMapped: false }));
  mesh.name = 'Garage office | three service papers'; mesh.userData.officePaperCount = 3;
  sheets.forEach((geometry) => geometry.dispose());
  return mesh;
}
