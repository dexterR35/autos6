import * as THREE from 'three';
import { formatSupporterAmount } from './garageSupportersData.js';
export { aggregateGarageSupporters, mapGarageSupporters, formatSupporterAmount } from './garageSupportersData.js';

const BOARD_WIDTH = 5.8;
const BOARD_HEIGHT = 3.7;
const ROWS_PER_PAGE = 10;

// The S6 faces +X: its rear wall is the west wall, with the display facing +X.
export const SUPPORTER_WALL = Object.freeze({
  position: Object.freeze([-13.5, 3.7, -1.8]),
  rotationY: Math.PI / 2,
});

export function supporterWallCamera(compact = false) {
  const [x, y, z] = SUPPORTER_WALL.position;
  return { position: [x + (compact ? 11.9 : 8.8), y + 0.2, z], target: [...SUPPORTER_WALL.position], fov: 48 };
}

function fitText(context, text, x, y, maxWidth) {
  let fitted = String(text);
  if (context.measureText(fitted).width <= maxWidth) { context.fillText(fitted, x, y); return; }
  while (fitted && context.measureText(`${fitted}…`).width > maxWidth) fitted = fitted.slice(0, -1);
  context.fillText(`${fitted}…`, x, y);
}

/** A framed display mounted behind the car. Dispose with the garage scene. */
export function createGarageSupportersBoard({ rows = [], position = SUPPORTER_WALL.position, rotationY = SUPPORTER_WALL.rotationY, isDemo = false, status = 'ready', scope = 'all' } = {}) {
  const group = new THREE.Group();
  group.name = 'Garage supporters | wall board';
  group.position.fromArray(position);
  group.rotation.y = rotationY;
  group.userData.supportersBoard = true;
  const canvas = document.createElement('canvas');
  canvas.width = 1792;
  canvas.height = 1152;
  const context = canvas.getContext('2d');
  const texture = new THREE.CanvasTexture(canvas);
  texture.colorSpace = THREE.SRGBColorSpace;
  texture.anisotropy = 4;
  const materials = [];
  const geometries = [];
  const box = (name, width, height, depth, x, y, z, color, emissive = false) => {
    const geometry = new THREE.BoxGeometry(width, height, depth);
    const material = emissive
      ? new THREE.MeshBasicMaterial({ name, color, toneMapped: false })
      : new THREE.MeshStandardMaterial({ name, color, roughness: 0.4, metalness: 0.7 });
    const mesh = new THREE.Mesh(geometry, material);
    mesh.name = name;
    mesh.position.set(x, y, z);
    geometries.push(geometry); materials.push(material); group.add(mesh);
    return mesh;
  };
  box('Supporters board | aluminium frame', BOARD_WIDTH + 0.16, BOARD_HEIGHT + 0.16, 0.16, 0, 0, -0.09, '#28333e');
  box('Supporters board | cyan edge', BOARD_WIDTH + 0.06, BOARD_HEIGHT + 0.06, 0.04, 0, 0, 0, '#298fa7', true);
  const displayGeometry = new THREE.PlaneGeometry(BOARD_WIDTH, BOARD_HEIGHT);
  const displayMaterial = new THREE.MeshBasicMaterial({ name: 'Supporters board | readable display', map: texture, toneMapped: false });
  geometries.push(displayGeometry); materials.push(displayMaterial);
  const display = new THREE.Mesh(displayGeometry, displayMaterial);
  display.name = 'Supporters board | public contributions';
  display.position.z = 0.026;
  group.add(display);
  // Recessed standoffs keep the screen visibly separate from the masonry.
  for (const x of [-2.65, 2.65]) for (const y of [-1.58, 1.58]) {
    box('Supporters board | wall fixing', 0.09, 0.09, 0.14, x, y, -0.22, '#59646f');
  }
  let currentRows = rows;
  let currentPage = 0;
  let currentDemo = isDemo;
  let currentStatus = status;
  let currentScope = scope;
  const pageCount = () => Math.max(1, Math.ceil(currentRows.length / ROWS_PER_PAGE));

  function draw() {
    if (!context) return;
    const { width, height } = canvas;
    context.fillStyle = '#0a121a'; context.fillRect(0, 0, width, height);
    const gradient = context.createLinearGradient(0, 0, width, 0);
    gradient.addColorStop(0, '#103e4a'); gradient.addColorStop(1, '#0b1821');
    context.fillStyle = gradient; context.fillRect(0, 0, width, 212);
    context.fillStyle = '#8be6ee'; context.font = '600 24px Arial, sans-serif'; context.textAlign = 'left';
    context.fillText('PROJECT S6 / THE PEOPLE BEHIND THE BUILD', 70, 63);
    context.fillStyle = '#f1f7fa'; context.font = '700 73px Arial, sans-serif'; context.fillText('GARAGE SUPPORTERS', 66, 154);
    context.fillStyle = '#1f7587'; context.fillRect(66, 198, width - 132, 3);
    context.fillStyle = '#7f9ba9'; context.font = '600 27px Arial, sans-serif';
    context.fillText('SUPPORTER', 74, 267); context.fillText('EMAIL', 842, 267);
    context.textAlign = 'right'; context.fillText('DONATED', width - 74, 267); context.textAlign = 'left';
    const offset = currentPage * ROWS_PER_PAGE;
    const visible = currentRows.slice(offset, offset + ROWS_PER_PAGE);
    visible.forEach((row, index) => {
      const top = 296 + index * 66;
      context.fillStyle = index % 2 === 0 ? '#12212b' : '#0d1a24'; context.fillRect(63, top, width - 126, 62);
      context.fillStyle = '#607d8b'; context.font = '24px Arial, sans-serif'; context.fillText(String(offset + index + 1).padStart(2, '0'), 83, top + 42);
      context.fillStyle = '#edf4f7'; context.font = '600 31px Arial, sans-serif'; fitText(context, row.label, 149, top + 43, 650);
      context.fillStyle = '#8195a2'; context.font = '27px Arial, sans-serif'; context.fillText('Hidden', 842, top + 42);
      context.fillStyle = '#a2f3d3'; context.font = '600 31px Arial, sans-serif'; context.textAlign = 'right';
      context.fillText(formatSupporterAmount(row), width - 83, top + 43); context.textAlign = 'left';
    });
    if (!visible.length) {
      context.fillStyle = '#d8e8ed'; context.font = '600 47px Arial, sans-serif'; context.textAlign = 'center';
      const title = currentStatus === 'loading' ? 'Loading the supporter wall…' : currentStatus === 'error' ? 'Supporter wall is temporarily unavailable' : 'Your name belongs on this wall.';
      context.fillText(title, width / 2, 540);
      context.fillStyle = '#8da9b7'; context.font = '30px Arial, sans-serif';
      context.fillText(currentDemo ? 'DEMO PREVIEW · No supporter records' : currentStatus === 'error' ? 'Please try again shortly.' : currentStatus === 'loading' ? 'Confirmed public contributions appear here.' : 'Public, confirmed contributions will appear here.', width / 2, 601);
      context.textAlign = 'left';
    }
    context.fillStyle = '#28424f'; context.fillRect(66, 991, width - 132, 2);
    context.fillStyle = '#9eb6c3'; context.font = '25px Arial, sans-serif';
    context.fillText(currentScope === 'recent' ? 'LATEST 100 CONTRIBUTIONS · Matching public names combined' : 'ALL PUBLIC SUPPORTERS · 2× / 3× = contribution count', 73, 1036);
    context.fillStyle = '#6f8a99'; context.font = '24px Arial, sans-serif';
    context.fillText('Public display names only. Subscriber emails stay private.', 73, 1084);
    if (currentRows.length) {
      context.textAlign = 'right'; context.fillStyle = '#82d7df'; context.font = '600 25px Arial, sans-serif';
      context.fillText(`${offset + 1}—${offset + visible.length} OF ${currentRows.length}  /  ${currentPage + 1}:${pageCount()}`, width - 73, 1084);
      context.textAlign = 'left';
    }
    texture.needsUpdate = true;
  }
  function update(nextRows = [], options = {}) {
    currentRows = Array.isArray(nextRows) ? nextRows : [];
    currentPage = Math.min(currentPage, pageCount() - 1);
    currentDemo = options.isDemo ?? currentDemo;
    currentStatus = options.status ?? currentStatus;
    currentScope = options.scope ?? currentScope;
    if (options.page !== undefined) {
      const page = Number.isFinite(options.page) ? Math.trunc(options.page) : 0;
      currentPage = ((page % pageCount()) + pageCount()) % pageCount();
    }
    draw();
  }
  function setPage(page) {
    const next = Number.isFinite(page) ? Math.trunc(page) : 0;
    currentPage = ((next % pageCount()) + pageCount()) % pageCount();
    draw();
  }
  draw();
  return {
    group, update, setPage,
    get pageCount() { return pageCount(); },
    get page() { return currentPage; },
    dispose() { texture.dispose(); geometries.forEach((geometry) => geometry.dispose()); materials.forEach((material) => material.dispose()); group.removeFromParent(); },
  };
}
