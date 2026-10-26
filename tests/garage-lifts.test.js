import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { MeshoptDecoder } from 'three/addons/libs/meshopt_decoder.module.js';
import { replaceGarageLifts, SERVICE_LIFT_BAYS } from '../src/lib/garageLifts.js';

function dispose(root) {
  root.traverse((object) => { object.geometry?.dispose(); object.material?.dispose(); });
}

// Decode the shipped compressed positions and indices without loading textures
// or a DOM renderer. This checks the actual exported layout, not a mock of it.
async function shippedGarage() {
  await MeshoptDecoder.ready;
  const bytes = readFileSync('public/models/garage.glb');
  const jsonLength = bytes.readUInt32LE(12);
  const gltf = JSON.parse(bytes.subarray(20, 20 + jsonLength));
  const binary = bytes.subarray(28 + jsonLength);
  const views = new Map();
  function view(id) {
    if (views.has(id)) return views.get(id);
    const source = gltf.bufferViews[id];
    const compressed = source.extensions?.EXT_meshopt_compression;
    let data;
    if (compressed) {
      data = new Uint8Array(compressed.count * compressed.byteStride);
      MeshoptDecoder.decodeGltfBuffer(data, compressed.count, compressed.byteStride,
        binary.subarray(compressed.byteOffset, compressed.byteOffset + compressed.byteLength), compressed.mode, compressed.filter);
    } else data = binary.subarray(source.byteOffset ?? 0, (source.byteOffset ?? 0) + source.byteLength);
    views.set(id, data);
    return data;
  }
  function accessor(id, itemSize) {
    const source = gltf.accessors[id], data = view(source.bufferView);
    const types = { 5120: ['getInt8', 1, 127], 5121: ['getUint8', 1, 255], 5122: ['getInt16', 2, 32767], 5123: ['getUint16', 2, 65535], 5125: ['getUint32', 4, 4294967295], 5126: ['getFloat32', 4, 1] };
    const [read, size, maximum] = types[source.componentType];
    const stride = gltf.bufferViews[source.bufferView].byteStride ?? itemSize * size;
    const buffer = new DataView(data.buffer, data.byteOffset, data.byteLength);
    const values = itemSize === 1 ? new Uint32Array(source.count) : new Float32Array(source.count * itemSize);
    for (let i = 0; i < source.count; i++) for (let k = 0; k < itemSize; k++) {
      const value = buffer[read]((source.byteOffset ?? 0) + i * stride + k * size, true);
      values[i * itemSize + k] = source.normalized ? Math.max(-1, value / maximum) : value;
    }
    return new THREE.BufferAttribute(values, itemSize);
  }
  const garage = new THREE.Group();
  for (const node of gltf.nodes) {
    if (node.mesh === undefined) continue;
    const primitive = gltf.meshes[node.mesh].primitives[0];
    const geometry = new THREE.BufferGeometry();
    geometry.setAttribute('position', accessor(primitive.attributes.POSITION, 3));
    geometry.setIndex(accessor(primitive.indices, 1));
    const material = new THREE.MeshStandardMaterial();
    material.name = gltf.materials[primitive.material].name;
    const mesh = new THREE.Mesh(geometry, material);
    mesh.name = node.name;
    mesh.position.fromArray(node.translation ?? [0, 0, 0]);
    mesh.scale.fromArray(node.scale ?? [1, 1, 1]);
    if (node.rotation) mesh.quaternion.fromArray(node.rotation);
    garage.add(mesh);
  }
  return garage;
}

describe('paired garage service lifts', () => {
  it('creates opposing connected pairs with four inward lifting pads each and clear bays', () => {
    const garage = new THREE.Group();
    const group = replaceGarageLifts(garage);
    expect(group.children).toHaveLength(7);
    expect(group.userData.postCenters).toHaveLength(4);
    expect(group.userData.padCenters).toHaveLength(8);
    SERVICE_LIFT_BAYS.forEach((bay, i) => {
      const posts = group.userData.postCenters.slice(i * 2, i * 2 + 2);
      const pads = group.userData.padCenters.slice(i * 4, i * 4 + 4);
      expect(posts[0][2]).toBe(posts[1][2]);
      expect(posts[1][0] - posts[0][0]).toBeCloseTo(3.4);
      expect((posts[0][0] + posts[1][0]) / 2).toBe(bay.center[0]);
      pads.forEach(([x, y, z]) => {
        expect(Math.abs(x - bay.center[0])).toBeCloseTo(0.76);
        expect(Math.abs(z - bay.center[2])).toBeCloseTo(1.22);
        expect(y).toBe(0.3);
      });
      expect(bay.height).toBeLessThan(4);
      expect(Math.abs(bay.center[0]) - bay.postSpacing / 2).toBeGreaterThan(4);
    });
    expect(replaceGarageLifts(garage)).toBe(group);
    expect(garage.children).toHaveLength(1);
    dispose(garage);
  });

  it('removes original lift faces from shared materials while preserving remote furniture', () => {
    const garage = new THREE.Group();
    garage.position.set(4, 2, 1);
    garage.rotation.y = 0.2;
    const old = new THREE.BoxGeometry(0.3, 6.6, 0.35).translate(-8.56395, 3.3, -9.51005);
    const furniture = new THREE.BoxGeometry(0.5, 1.5, 0.5).translate(12, 0.75, -13);
    const shared = new THREE.Mesh(mergeGeometries([old, furniture]), new THREE.MeshStandardMaterial());
    shared.material.name = 'Lift | worn midnight blue enamel | web';
    const wall = new THREE.Mesh(new THREE.BoxGeometry(28, 7, 0.3).translate(0, 3.5, -14.5), new THREE.MeshStandardMaterial());
    wall.material.name = 'Wall | aged concrete block masonry | web';
    garage.add(shared, wall);
    const wallGeometry = wall.geometry;
    const group = replaceGarageLifts(garage);
    expect(group.userData.originalLiftFacesRemoved).toBe(12);
    expect(shared.geometry.index.count).toBe(36);
    expect(shared.geometry.boundingBox.min.x).toBeCloseTo(11.75);
    expect(wall.geometry).toBe(wallGeometry);
    old.dispose(); furniture.dispose(); dispose(garage);
  });

  it('replaces the five tall posts in the shipped compressed GLB without altering floor, wall or neon', async () => {
    const garage = await shippedGarage();
    const preserved = garage.children.filter((mesh) => /wet concrete|aged concrete block|neon phosphor/i.test(mesh.material.name))
      .map((mesh) => ({ mesh, geometry: mesh.geometry, indices: mesh.geometry.index.count }));
    const group = replaceGarageLifts(garage);
    expect(group.userData.originalLiftFacesRemoved).toBeGreaterThan(1500);
    expect(garage.children.filter((mesh) => mesh.userData.originalLiftFacesRemoved).length).toBeGreaterThanOrEqual(8);
    preserved.forEach(({ mesh, geometry, indices }) => {
      expect(mesh.geometry).toBe(geometry);
      expect(mesh.geometry.index.count).toBe(indices);
    });
    // The blue material is also used by workshop furniture. Its remaining
    // maximum height proves all five 6.6 m masts have actually been removed.
    const blue = garage.children.find((mesh) => /midnight blue enamel/i.test(mesh.material?.name ?? ''));
    blue.geometry.computeBoundingBox();
    const blueBounds = blue.geometry.boundingBox.clone().applyMatrix4(blue.matrix);
    expect(blueBounds.max.y).toBeLessThan(3.5);
    expect(new THREE.Box3().setFromObject(group).max.y).toBeLessThan(3.9);
    dispose(garage);
  });
});
