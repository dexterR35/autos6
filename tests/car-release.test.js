import { describe, expect, it } from 'vitest';
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import * as THREE from 'three';
import { HDRLoader } from 'three/addons/loaders/HDRLoader.js';
import { MeshoptDecoder } from 'three/addons/libs/meshopt_decoder.module.js';
import { CAR_RELEASE, modelUrl } from '../src/lib/modelAssets.js';
import { includeCarRelease, includePublicAsset } from '../vite/modelAssetsPlugin.js';

const directory = `public/car-releases/${CAR_RELEASE}`;
const parts = ['body', 'brake-kit', 'exhaust', 'front-bumper', 'hood', 'rear-bumper', 'side-skirts', 'wheels'];
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

describe('supplied Audi A6 C5 release', () => {
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
    expect(includeCarRelease('car-releases/imported-v4/s6-c5.glb')).toBe(false);
    expect(includeCarRelease('car-releases/a6-c5-v1/s6-c5.glb')).toBe(false);
    expect(includeCarRelease('car-releases/a6-c5-v2-engine/s6-c5.glb')).toBe(false);
    expect(includeCarRelease('car-releases/a6-c5-v3-bay/s6-c5.glb')).toBe(false);
    expect(includePublicAsset('car-releases/imported-v4/manifest.json')).toBe(false);
    expect(includeCarRelease('models/garage.glb')).toBe(true);
    expect(manifest.car.bytes).toBe(bytes.length);
    expect(bytes.length).toBeLessThan(4_000_000);
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
    // Preserve the supplied A6 dimensions, without the old S6 calibration warp.
    expect(size.x).toBeGreaterThan(4.79);
    expect(size.x).toBeLessThan(4.81);
    expect(size.z).toBeGreaterThan(1.8);
    expect(size.z).toBeLessThan(2.2);
    expect(bounds.min.y).toBeGreaterThan(-.005);
    expect(bounds.min.y).toBeLessThan(.005);
    expect(bounds.max.y).toBeGreaterThan(1.47);
    expect(bounds.max.y).toBeLessThan(1.49);
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

  it('ships real clearcoat paint and distinct component finishes within the geometry budget', async () => {
    const { gltf } = await decodedCar();
    const manifest = JSON.parse(readFileSync(`${directory}/manifest.json`, 'utf8'));
    const material = pattern => gltf.materials.find(entry => pattern.test(entry.name));
    const paint = material(/deep blue pearl paint/);
    expect(paint.pbrMetallicRoughness.baseColorTexture).toBeUndefined();
    expect(paint.pbrMetallicRoughness.metallicFactor).toBeGreaterThan(.6);
    expect(paint.pbrMetallicRoughness.roughnessFactor).toBeLessThan(.3);
    expect(paint.extensions.KHR_materials_clearcoat.clearcoatFactor).toBe(1);
    expect(material(/tyre rubber/).pbrMetallicRoughness.roughnessFactor).toBeGreaterThan(.8);
    expect(material(/S6.Modular.RimPaint/).pbrMetallicRoughness.metallicFactor).toBeGreaterThan(.8);
    expect(material(/polished chrome trim/).pbrMetallicRoughness.metallicFactor).toBeGreaterThan(.9);
    expect(material(/lamp lenses/).extensions.KHR_materials_clearcoat.clearcoatFactor).toBe(1);
    expect(manifest.car.triangles).toBeGreaterThan(125_000);
    expect(manifest.car.triangles).toBeLessThan(250_000);
    const glass = material(/windscreen glass/);
    expect(glass.pbrMetallicRoughness.roughnessFactor).toBeLessThan(.1);
    [0.151058, 0.293216, 0.254916].forEach((value, axis) =>
      expect(glass.pbrMetallicRoughness.baseColorFactor[axis]).toBeCloseTo(value, 6));
    expect(glass.alphaMode).toBe('BLEND');
    expect(gltf.nodes.filter(node => node.extras?.windowPane)).toHaveLength(8);
    paint.pbrMetallicRoughness.baseColorFactor.forEach((value, axis) => expect(value).toBeCloseTo([.01, .036, .155, 1][axis], 7));
    expect(manifest.source.file).toBe('1998+Audi+A6+Avant.obj');
    expect(manifest.source.sha256).toBe('d839ff6591909934637ba6b08a68a4df07e95a1cfdee08483e304c4ce18eaa9d');
    for (const pattern of [/blue Recaro upholstery/, /dark blue Alcantara inserts/, /matching dark blue leather bolsters/]) {
      const upholstery = material(pattern).pbrMetallicRoughness;
      expect(upholstery.baseColorTexture).toBeUndefined();
      expect(upholstery.baseColorFactor[2]).toBeGreaterThan(upholstery.baseColorFactor[0] * 8);
      expect(upholstery.baseColorFactor[2]).toBeGreaterThan(upholstery.baseColorFactor[1] * 3);
    }
    const ceiling = material(/black Alcantara headlining/);
    expect(ceiling.pbrMetallicRoughness.baseColorFactor.slice(0, 3).every(value => value < .01)).toBe(true);
    expect(ceiling.pbrMetallicRoughness.roughnessFactor).toBeGreaterThan(.9);
    expect(ceiling.normalTexture).toBeDefined();
    const insert = material(/dark blue Alcantara inserts/).pbrMetallicRoughness.baseColorFactor;
    const bolster = material(/matching dark blue leather bolsters/).pbrMetallicRoughness.baseColorFactor;
    insert.forEach((value, axis) => expect(bolster[axis]).toBeCloseTo(value, 7));
    expect(manifest.interior.style).toBe('Blue Recaro-style sport interior');
    expect(gltf.nodes.some(node => /roof.?box/i.test(node.name))).toBe(false);
  });

  it('preserves separately configurable Blender components at all four wheel positions', async () => {
    const { gltf } = await decodedCar();
    const manifest = JSON.parse(readFileSync(`${directory}/manifest.json`, 'utf8'));
    for (const corner of ['FL', 'FR', 'RL', 'RR']) {
      const nodes = gltf.nodes.filter(node => node.extras?.wheelCorner === corner);
      expect(nodes.filter(node => node.extras?.assemblyId)).toHaveLength(1);
      const components = new Set(nodes.map(node => node.extras?.componentId));
      for (const component of ['rim', 'tyre', 'brake-disc', 'caliper', 'rotor-hat', 'centre-badge', 'backing-plate']) expect(components.has(component), `${corner}: ${component}`).toBe(true);
      expect(nodes.filter(node => node.extras?.tyreVariant === 'road')).toHaveLength(1);
      expect(nodes.filter(node => node.extras?.tyreVariant === 'track')).toHaveLength(1);
      expect(nodes.filter(node => node.extras?.componentId).every(node => node.extras.authoredIn === 'Blender')).toBe(true);
    }
    expect(manifest.modularWheels.corners).toEqual(['FL', 'FR', 'RL', 'RR']);
    expect(manifest.car.drawCalls).toBeLessThan(220);
    const parentOf = id => gltf.nodes.find(node => node.children?.includes(id));
    for (const corner of ['FL', 'FR', 'RL', 'RR']) {
      const roll = gltf.nodes.find(node => node.extras?.rollingId === corner);
      expect(roll.extras.rollingAxis).toEqual([0, 0, 1]);
      for (const type of ['rim', 'tyre', 'brake-disc']) {
        gltf.nodes.forEach((node, id) => {
          if (node.extras?.wheelCorner === corner && node.extras.componentId === type) expect(parentOf(id)).toBe(roll);
        });
      }
      const caliperId = gltf.nodes.findIndex(node => node.extras?.wheelCorner === corner && node.extras?.componentId === 'caliper');
      expect(parentOf(caliperId).extras.assemblyId).toBe('wheel-' + corner.toLowerCase());
    }
  });

  it('exports six real panel hinges with attached skins, glass and opening clips', async () => {
    const { gltf } = await decodedCar();
    const manifest = JSON.parse(readFileSync(`${directory}/manifest.json`, 'utf8'));
    const ids = ['door-fl', 'door-fr', 'door-rl', 'door-rr', 'hood', 'tailgate'];
    expect(manifest.articulation.panels).toEqual(ids);
    const descendants = node => (node.children ?? []).flatMap(id => [gltf.nodes[id], ...descendants(gltf.nodes[id])]);
    for (const id of ids) {
      const hingeId = gltf.nodes.findIndex(node => node.extras?.articulationId === id);
      const hinge = gltf.nodes[hingeId];
      expect(hinge.extras.openAngle).toBeGreaterThan(1);
      expect(Math.hypot(...hinge.extras.hingeAxis)).toBeCloseTo(1);
      const meshes = descendants(hinge).filter(node => node.mesh !== undefined);
      expect(meshes.length).toBeGreaterThan(0);
      const materials = meshes.flatMap(node => gltf.meshes[node.mesh].primitives.map(p => gltf.materials[p.material].name));
      expect(materials.some(name => /deep blue pearl paint/.test(name))).toBe(true);
      if (id.startsWith('door-') || id === 'tailgate') expect(materials.some(name => /windscreen glass/.test(name))).toBe(true);
      const clip = gltf.animations.find(animation => animation.name === 'A6 | ' + id);
      expect(clip.channels.some(channel => channel.target.node === hingeId && channel.target.path === 'rotation')).toBe(true);
    }
  });

  it('keeps dashboard closures fixed and exports moving door cards and a lined cargo bay', async () => {
    const { gltf } = await decodedCar();
    const parentOf = id => gltf.nodes.findIndex(node => node.children?.includes(id));
    for (const side of ['left', 'right']) {
      let id = gltf.nodes.findIndex(node => node.extras?.componentId === 'dashboard-cap-' + side);
      expect(id).toBeGreaterThanOrEqual(0);
      while (id >= 0) {
        expect(gltf.nodes[id].extras?.articulationId).toBeUndefined();
        id = parentOf(id);
      }
    }
    for (const id of ['door-fl', 'door-fr', 'door-rl', 'door-rr']) {
      const card = gltf.nodes.findIndex(node => node.extras?.componentId === 'door-card-shell-' + id);
      expect(card).toBeGreaterThanOrEqual(0);
      let parent = card, attached = false;
      while (parent >= 0) {
        attached ||= gltf.nodes[parent].extras?.articulationId === id;
        parent = parentOf(parent);
      }
      expect(attached).toBe(true);
    }
    expect(gltf.nodes.some(node => node.extras?.componentId === 'cargo-bay-lining')).toBe(true);
  });

  it('ships a fixed V6 engine with separate named systems and measured closed-bonnet clearance', async () => {
    const { gltf } = await decodedCar();
    const manifest = JSON.parse(readFileSync(`${directory}/manifest.json`, 'utf8'));
    const rootId = gltf.nodes.findIndex(node => node.extras?.engineAssembly);
    expect(rootId).toBeGreaterThanOrEqual(0);
    const children = node => (node.children ?? []).flatMap(id => [gltf.nodes[id], ...children(gltf.nodes[id])]);
    const engine = children(gltf.nodes[rootId]);
    expect(engine.every(node => !node.extras?.articulationId)).toBe(true);
    const components = new Set(engine.map(node => node.extras?.componentId));
    for (const system of ['long-block','cover','induction','turbos','accessories','cooling','wiring']) {
      expect(components.has('engine-'+system),system).toBe(true);
    }
    expect(engine.filter(node => node.mesh !== undefined).length).toBeGreaterThan(15);
    for (const name of ['satin silver Y intake','textured black engine cover','blue silicone couplers','pleated rose air filter','orange dipstick handle']) {
      expect(gltf.materials.some(mat => mat.name.endsWith(name)),name).toBe(true);
    }
    expect(manifest.engine.clearance.samples).toBeGreaterThan(100);
    expect(manifest.engine.clearance.minimumMetres).toBeGreaterThan(.004);
    expect(manifest.engine.referenceUrl).toContain('2-7l-v6-gas');
    const hood = gltf.nodes.find(node => node.extras?.articulationId === 'hood');
    expect(children(hood).some(node => node.extras?.componentId === 'bonnet-insulation')).toBe(true);
  });

  it('lifts the complete upper grille with the bonnet and retains the fitted fixed bay panels', async () => {
    const { gltf } = await decodedCar();
    const manifest = JSON.parse(readFileSync(`${directory}/manifest.json`, 'utf8'));
    const descendants = node => (node.children ?? []).flatMap(id => [gltf.nodes[id], ...descendants(gltf.nodes[id])]);
    const hood = gltf.nodes.find(node => node.extras?.articulationId === 'hood');
    const sources = node => node.extras?.sourceObjects ?? [node.extras?.sourceObject];
    const lifted = descendants(hood).flatMap(sources);
    for (const number of ['073','074','075','077','079','098','099']) {
      expect(lifted).toContain('G-Object.' + number);
    }
    expect(lifted).not.toContain('G-Object.128');
    expect(gltf.nodes.some(node => node.extras?.partId === 'front-bumper' && sources(node).includes('G-Object.075'))).toBe(true);
    const panels = gltf.nodes.find(node => node.extras?.componentId === 'engine-bay-panels');
    expect(panels).toBeDefined();
    expect(descendants(panels).filter(node => node.mesh !== undefined).length).toBeGreaterThan(3);
    expect(descendants(panels).every(node => !node.extras?.articulationId)).toBe(true);
    expect(manifest.engine.bayRepairs.headlightHousings).toEqual(['left','right']);
    expect(manifest.engine.bayRepairs.innerWings).toContain('stamped aprons');
    const underHood = descendants(hood);
    for (const component of ['bonnet-inner-frame','bonnet-insulation','bonnet-hardware']) {
      expect(underHood.some(node => node.extras?.componentId === component),component).toBe(true);
    }
    const felt = gltf.materials.find(mat => mat.name === 'Bonnet | charcoal moulded acoustic felt');
    expect(felt.normalTexture).toBeDefined();
    expect(felt.pbrMetallicRoughness.roughnessFactor).toBeGreaterThan(.9);
    expect(felt.extensions?.KHR_materials_sheen).toBeUndefined();
    expect(gltf.nodes.some(node => node.extras?.bonnetStrut)).toBe(true);
    expect(gltf.nodes.some(node => node.extras?.bonnetStrutRod)).toBe(true);
    expect(underHood.some(node => node.extras?.bonnetStrutTarget)).toBe(true);
  });
});
