import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import * as THREE from 'three';
import { MeshoptDecoder } from 'three/addons/libs/meshopt_decoder.module.js';
import { meshComponents } from '../src/lib/meshComponents.js';
import { arrangeGarageEquipment, EQUIPMENT_LAYOUT } from '../src/lib/garageEquipment.js';

function components(mesh) {
  const world = new THREE.Mesh(mesh.geometry.clone().applyMatrix4(mesh.matrixWorld));
  const boxes = meshComponents(world);
  world.geometry.dispose();
  return boxes;
}
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

describe('east-wall garage equipment', () => {
  it('repairs the actual split cabinet, grounds its wheels and parks complete equipment with no extra meshes', async () => {
    const garage = await shippedGarage();
    garage.updateMatrixWorld(true);
    const childCount = garage.children.length;
    const preserved = garage.children.filter((mesh) => /wet concrete|aged concrete block|neon phosphor/i.test(mesh.material.name)).map((mesh) => ({ mesh, geometry: mesh.geometry, count: mesh.geometry.index.count }));
    const report = arrangeGarageEquipment(garage);
    expect(report.removedFaces).toBeGreaterThan(300);
    expect(report.addedMeshes).toBe(0);
    expect(garage.children).toHaveLength(childCount);
    preserved.forEach(({ mesh, geometry, count }) => {
      expect(mesh.geometry).toBe(geometry);
      expect(mesh.geometry.index.count).toBe(count);
    });
    const red = garage.children.find((mesh) => /deep red powdercoat/i.test(mesh.material.name));
    const drawers = components(red).filter((box) => {
      const c = box.getCenter(new THREE.Vector3()), s = box.getSize(new THREE.Vector3());
      return c.x > 12.6 && c.x < 13 && c.z > -4 && c.z < -3 && s.y < .2 && s.z > .8;
    });
    expect(drawers).toHaveLength(7);
    drawers.forEach((box) => expect(box.getCenter(new THREE.Vector3()).x).toBeCloseTo(EQUIPMENT_LAYOUT.cabinet[0] - .376, 2));
    const rubber = garage.children.find((mesh) => /charcoal rubber/i.test(mesh.material.name));
    const casters = components(rubber).filter((box) => {
      const c = box.getCenter(new THREE.Vector3());
      return c.x > 12.7 && c.x < 13.5 && c.z > -4 && c.z < -3 && box.max.y < .2;
    });
    expect(casters).toHaveLength(4);
    casters.forEach((box) => expect(box.min.y).toBeCloseTo(0, 3));
    const steel = garage.children.find((mesh) => /aged charcoal enamel/i.test(mesh.material.name));
    const cartTrays = components(steel).filter((box) => {
      const c = box.getCenter(new THREE.Vector3()), s = box.getSize(new THREE.Vector3());
      return Math.abs(c.x - EQUIPMENT_LAYOUT.trolley[0]) < .03 && Math.abs(c.z - EQUIPMENT_LAYOUT.trolley[2]) < .03 && s.z > 1.8 && s.y < .15;
    });
    expect(cartTrays).toHaveLength(2);
    const drum = components(steel).find((box) => {
      const c = box.getCenter(new THREE.Vector3());
      return Math.abs(c.x - EQUIPMENT_LAYOUT.drum[0]) < .03 && Math.abs(c.z - EQUIPMENT_LAYOUT.drum[2]) < .03 && box.max.y > 1;
    });
    expect(drum).toBeDefined();
    expect(drum.min.y).toBeCloseTo(0, 3);
    const westernDrum = components(steel).find((box) => {
      const c = box.getCenter(new THREE.Vector3());
      return Math.abs(c.x - EQUIPMENT_LAYOUT.westDrum[0]) < .03 && Math.abs(c.z - EQUIPMENT_LAYOUT.westDrum[2]) < .03 && box.max.y > .8;
    });
    expect(westernDrum).toBeDefined();
    expect(westernDrum.min.y).toBeCloseTo(0, 3);
    const westernCart = components(steel).filter((box) => {
      const c = box.getCenter(new THREE.Vector3()), s = box.getSize(new THREE.Vector3());
      return Math.abs(c.x - EQUIPMENT_LAYOUT.westTrolley[0]) < .03 && Math.abs(c.z - EQUIPMENT_LAYOUT.westTrolley[2]) < .03 && s.z > 1.3 && s.y < .15;
    });
    expect(westernCart).toHaveLength(2);
    for (const [jx, , jz] of EQUIPMENT_LAYOUT.westJacks) {
      const chassis = components(red).filter((box) => {
        const c = box.getCenter(new THREE.Vector3()), s = box.getSize(new THREE.Vector3());
        return Math.abs(c.x - jx) < .03 && Math.abs(c.z - jz) < .3 && s.x > 1;
      });
      expect(chassis).toHaveLength(2);
    }
    expect(arrangeGarageEquipment(garage)).toBe(report);
    garage.traverse((mesh) => { mesh.geometry?.dispose(); mesh.material?.dispose(); });
  });
});
