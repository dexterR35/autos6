import { describe, expect, it } from 'vitest';
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import * as THREE from 'three';
import { HDRLoader } from 'three/addons/loaders/HDRLoader.js';
import { MeshoptDecoder } from 'three/addons/libs/meshopt_decoder.module.js';
import { CAR_RELEASE, modelUrl } from '../src/lib/modelAssets.js';
import { includePublicAsset } from '../vite/modelAssetsPlugin.js';

const directory = `public/car-releases/${CAR_RELEASE}`;
const parts = ['body', 'brake-kit', 'exhaust', 'front-bumper', 'hood', 'rear-bumper', 'roof-box', 'side-skirts', 'wheels'];
const sha256 = (bytes) => createHash('sha256').update(bytes).digest('hex');

async function decodedCar() {
  await MeshoptDecoder.ready;
  const bytes = readFileSync(`${directory}/s6-c5.glb`);
  expect(bytes.toString('utf8', 0, 4)).toBe('glTF');
  expect(bytes.readUInt32LE(4)).toBe(2);
  expect(bytes.readUInt32LE(8)).toBe(bytes.length);
  let gltf, binary;
  for (let offset = 12; offset < bytes.length;) {
    const length = bytes.readUInt32LE(offset), type = bytes.readUInt32LE(offset + 4);
    const chunk = bytes.subarray(offset + 8, offset + 8 + length);
    if (type === 0x4e4f534a) gltf = JSON.parse(chunk.toString('utf8'));
    if (type === 0x004e4942) binary = chunk;
    offset += 8 + length;
  }
  expect(gltf).toBeDefined();
  expect(binary).toBeDefined();
  const views = new Map();
  function view(id) {
    if (views.has(id)) return views.get(id);
    const source = gltf.bufferViews[id];
    const compressed = source.extensions?.EXT_meshopt_compression;
    let data;
    if (compressed) {
      data = new Uint8Array(compressed.count * compressed.byteStride);
      MeshoptDecoder.decodeGltfBuffer(data, compressed.count, compressed.byteStride,
        binary.subarray(compressed.byteOffset ?? 0, (compressed.byteOffset ?? 0) + compressed.byteLength),
        compressed.mode, compressed.filter);
    } else data = binary.subarray(source.byteOffset ?? 0, (source.byteOffset ?? 0) + source.byteLength);
    views.set(id, data);
    return data;
  }
  const accessorCache = new Map();
  function accessor(id) {
    if (accessorCache.has(id)) return accessorCache.get(id);
    const source = gltf.accessors[id], data = view(source.bufferView);
    const components = { SCALAR: 1, VEC2: 2, VEC3: 3, VEC4: 4 }[source.type];
    const types = {
      5120: ['getInt8', 1, 127], 5121: ['getUint8', 1, 255],
      5122: ['getInt16', 2, 32767], 5123: ['getUint16', 2, 65535],
      5125: ['getUint32', 4, 4294967295], 5126: ['getFloat32', 4, 1],
    };
    const [read, size, maximum] = types[source.componentType];
    const stride = gltf.bufferViews[source.bufferView].byteStride ?? components * size;
    const buffer = new DataView(data.buffer, data.byteOffset, data.byteLength);
    const values = new Float64Array(source.count * components);
    for (let i = 0; i < source.count; i++) for (let k = 0; k < components; k++) {
      const value = buffer[read]((source.byteOffset ?? 0) + i * stride + k * size, true);
      values[i * components + k] = source.normalized ? Math.max(-1, value / maximum) : value;
    }
    accessorCache.set(id, { values, count: source.count, components });
    return accessorCache.get(id);
  }
  return { bytes, gltf, accessor };
}

describe('reference car release', () => {
  it('selects and packages the versioned car with a matching manifest', async () => {
    const manifest = JSON.parse(readFileSync(`${directory}/manifest.json`, 'utf8'));
    const { bytes, gltf } = await decodedCar();
    expect(modelUrl('s6-c5.glb')).toBe(`/car-releases/${CAR_RELEASE}/s6-c5.glb`);
    expect(manifest.url).toBe(modelUrl('s6-c5.glb'));
    expect(manifest.release).toBe(CAR_RELEASE);
    for (const asset of ['s6-c5.glb', 'manifest.json', 'paint-studio.hdr']) {
      expect(includePublicAsset(`car-releases/${CAR_RELEASE}/${asset}`)).toBe(true);
    }
    expect(manifest.car.sha256).toBe(sha256(bytes));
    expect(manifest.car.bytes).toBe(bytes.length);
    expect(bytes.length).toBeLessThan(9_000_000);
    expect(manifest.garageSha256).toBe(sha256(readFileSync('public/models/garage.glb')));
    expect(gltf.extensionsRequired).toContain('EXT_meshopt_compression');
    expect(gltf.images.every((image) => image.bufferView !== undefined && image.uri === undefined)).toBe(true);
    expect([...new Set(gltf.nodes.map((node) => node.extras?.partId).filter(Boolean))].sort()).toEqual(parts);
    expect(manifest.car.parts).toEqual(parts);
  });

  it('decodes finite positions and unit normals with intact scale, bounds and indices', async () => {
    const manifest = JSON.parse(readFileSync(`${directory}/manifest.json`, 'utf8'));
    const { gltf, accessor } = await decodedCar();
    const bounds = new THREE.Box3();
    let vertexCount = 0, triangles = 0, largestNormalError = 0, transformedNormalError = 0;
    let finiteWorldGeometry = true;
    const vector = new THREE.Vector3();
    function visit(id, parentMatrix) {
      const node = gltf.nodes[id];
      const local = node.matrix ? new THREE.Matrix4().fromArray(node.matrix) : new THREE.Matrix4().compose(
        new THREE.Vector3().fromArray(node.translation ?? [0, 0, 0]),
        new THREE.Quaternion().fromArray(node.rotation ?? [0, 0, 0, 1]),
        new THREE.Vector3().fromArray(node.scale ?? [1, 1, 1]),
      );
      const world = new THREE.Matrix4().multiplyMatrices(parentMatrix, local);
      expect(world.elements.every(Number.isFinite)).toBe(true);
      const normalMatrix = new THREE.Matrix3().getNormalMatrix(world);
      if (node.mesh !== undefined) for (const primitive of gltf.meshes[node.mesh].primitives) {
        expect(primitive.mode ?? 4).toBe(4);
        const position = accessor(primitive.attributes.POSITION);
        const normal = accessor(primitive.attributes.NORMAL);
        expect(position.components).toBe(3);
        expect(normal.components).toBe(3);
        expect(normal.count).toBe(position.count);
        expect(position.values.every(Number.isFinite)).toBe(true);
        expect(normal.values.every(Number.isFinite)).toBe(true);
        for (let i = 0; i < position.count; i++) {
          vector.fromArray(position.values, i * 3).applyMatrix4(world);
          finiteWorldGeometry &&= Number.isFinite(vector.x + vector.y + vector.z);
          bounds.expandByPoint(vector);
          vector.fromArray(normal.values, i * 3);
          largestNormalError = Math.max(largestNormalError, Math.abs(vector.length() - 1));
          vector.applyMatrix3(normalMatrix).normalize();
          finiteWorldGeometry &&= Number.isFinite(vector.x + vector.y + vector.z);
          transformedNormalError = Math.max(transformedNormalError, Math.abs(vector.length() - 1));
        }
        const indices = accessor(primitive.indices);
        expect(indices.components).toBe(1);
        expect(indices.count % 3).toBe(0);
        expect(indices.values.every((index) => Number.isInteger(index) && index >= 0 && index < position.count)).toBe(true);
        triangles += indices.count / 3;
        vertexCount += position.count;
      }
      for (const child of node.children ?? []) visit(child, world);
    }
    for (const root of gltf.scenes[gltf.scene ?? 0].nodes) visit(root, new THREE.Matrix4());
    expect(vertexCount).toBeGreaterThan(1000);
    expect(finiteWorldGeometry).toBe(true);
    expect(largestNormalError).toBeLessThan(.015);
    expect(transformedNormalError).toBeLessThan(1e-6);
    expect(triangles).toBe(manifest.car.triangles);
    const size = bounds.getSize(new THREE.Vector3());
    expect(size.x).toBeGreaterThan(4.90);
    expect(size.x).toBeLessThan(4.93);
    expect(size.z).toBeGreaterThan(1.8);
    expect(size.z).toBeLessThan(2.2);
    expect(bounds.min.y).toBeGreaterThan(-.005);
    expect(bounds.min.y).toBeLessThan(.005);
    expect(bounds.max.y).toBeGreaterThan(1.6);
    expect(bounds.max.y).toBeLessThan(1.9);
    bounds.min.toArray().forEach((value, axis) => expect(value).toBeCloseTo(manifest.car.bounds.min[axis], 3));
    bounds.max.toArray().forEach((value, axis) => expect(value).toBeCloseTo(manifest.car.bounds.max[axis], 3));
  });

  it('ships a finite HDR reflection environment within its texture budget', () => {
    const bytes = readFileSync(`${directory}/paint-studio.hdr`);
    const hdr = new HDRLoader().setDataType(THREE.FloatType).parse(bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength));
    expect(hdr.width).toBe(1024);
    expect(hdr.height).toBe(512);
    expect(bytes.length).toBeLessThan(150_000);
    expect(hdr.data.length).toBe(hdr.width * hdr.height * 4);
    expect(hdr.data.every((value) => Number.isFinite(value) && value >= 0)).toBe(true);
    let maximum = 0;
    for (let i = 0; i < hdr.data.length; i += 4) maximum = Math.max(maximum, hdr.data[i], hdr.data[i + 1], hdr.data[i + 2]);
    expect(maximum).toBeGreaterThan(1);
  });
});
