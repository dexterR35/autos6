// Package the supplied, articulated A6. Do not run the old generated-body pipeline.
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { copyFileSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { spawnSync } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import * as THREE from 'three';
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const release = 'a6-c5-v5-original-glass';
// Keep the editable authoring project at its documented, stable local path.
const working = path.join(root, 'output/car-refinement/a6-c5-v1');
const directory = path.join(root, 'public/car-releases', release);
const cli = path.join(root, 'node_modules/@gltf-transform/cli/bin/cli.js');
const require = createRequire(cli);
const { NodeIO, getBounds } = require('@gltf-transform/core');
const { ALL_EXTENSIONS } = require('@gltf-transform/extensions');
const functions = require('@gltf-transform/functions');
const { MeshoptDecoder } = require('meshoptimizer');
await MeshoptDecoder.ready;
const io = new NodeIO().registerExtensions(ALL_EXTENSIONS).registerDependencies({ 'meshopt.decoder': MeshoptDecoder });
const document = await io.read(path.join(working, 'a6-c5-uncompressed.glb'));
// Join static surfaces only within each joint and part/material boundary.
// The editable master retains separately editable panels and seat components.
for (const parent of [...document.getRoot().listNodes()]) {
  const groups = new Map();
  for (const node of parent.listChildren()) {
    if (!node.getMesh() || node.listChildren().length || node.getExtras().wheelCorner || node.getExtras().windowPane) continue;
    const primitives = node.getMesh().listPrimitives();
    if (primitives.length !== 1) continue;
    const primitive = primitives[0];
    const key = JSON.stringify([node.getExtras().partId, primitive.getMaterial()?.getName(), primitive.listSemantics().sort()]);
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key).push(node);
  }
  for (const nodes of groups.values()) {
    if (nodes.length < 2) continue;
    const primitives = nodes.map(node => {
      const p = node.getMesh().listPrimitives()[0].clone();
      functions.compactPrimitive(p);
      functions.transformPrimitive(p, node.getMatrix());
      return p;
    });
    const mesh = document.createMesh(nodes[0].getName()).addPrimitive(functions.joinPrimitives(primitives));
    const sourceObjects = [...new Set(nodes.flatMap(n => n.getExtras().sourceObjects ?? [n.getExtras().sourceObject]).filter(Boolean))];
    const node = document.createNode(nodes[0].getName()).setMesh(mesh).setExtras({ ...nodes[0].getExtras(), ...(sourceObjects.length ? { sourceObjects } : {}) });
    parent.addChild(node);
    primitives.forEach(p => p.dispose());
    nodes.forEach(n => n.dispose());
  }
}
// Empty joint targets are functional rig data, including the bonnet strut's
// moving ball joint. Preserve authored extras while removing unused resources.
await document.transform(functions.dedup(), functions.prune({ keepExtras: true }));
const raw = path.join(working, 'a6-c5-web.glb');
const output = path.join(working, 's6-c5.glb');
await io.write(raw, document);
const result = spawnSync(process.execPath, [cli, 'meshopt', raw, output, '--level', 'medium', '--quantize-position', '16', '--quantize-normal', '14', '--quantize-texcoord', '16'], { cwd: root, stdio: 'inherit', windowsHide: true });
assert.equal(result.status, 0, 'Meshopt compression failed');
const exported = await io.read(output), model = exported.getRoot();
const scene = model.getDefaultScene() || model.listScenes()[0];
const primitives = model.listNodes().flatMap(n => n.getMesh()?.listPrimitives() ?? []);
const parts = [...new Set(model.listNodes().map(n => n.getExtras().partId).filter(Boolean))].sort();
const anchor = (position, normal) => ({ position, normal });
// Seat the bonnet marker on its actual source surface (a guessed height can
// intersect a different panel at the low hero camera angle).
const hoodRay = new THREE.Ray(new THREE.Vector3(1.75, 3, 0), new THREE.Vector3(0, -1, 0));
const hoodPoint = new THREE.Vector3(), vertices = [new THREE.Vector3(), new THREE.Vector3(), new THREE.Vector3()];
let hoodY = -Infinity;
for (const node of model.listNodes().filter(n => n.getExtras().partId === 'hood' && n.getMesh())) {
  const matrix = new THREE.Matrix4().fromArray(node.getWorldMatrix());
  for (const primitive of node.getMesh().listPrimitives()) {
    const position = primitive.getAttribute('POSITION'), indices = primitive.getIndices(), point = [];
    for (let i = 0; i < indices.getCount(); i += 3) {
      vertices.forEach((vertex, k) => { position.getElement(indices.getScalar(i + k), point); vertex.fromArray(point).applyMatrix4(matrix); });
      if (hoodRay.intersectTriangle(...vertices, false, hoodPoint)) hoodY = Math.max(hoodY, hoodPoint.y);
    }
  }
}
assert.ok(Number.isFinite(hoodY), 'Bonnet anchor must intersect the supplied panel');
const sourceReport = JSON.parse(readFileSync(path.join(working, 'import-report.json'), 'utf8'));
const digest = file => createHash('sha256').update(readFileSync(file)).digest('hex');
const manifest = {
  release, url: `/car-releases/${release}/s6-c5.glb`,
  source: { file: sourceReport.source, sha256: sourceReport.sha256, model: 'Audi A6 Avant C5 1997–2006', editable: sourceReport.blend },
  coordinates: { unit: 'metres', up: '+Y', vehicleNose: '+X', driverSide: '+Z', ground: 0 },
  car: { file: `/car-releases/${release}/s6-c5.glb`, bytes: readFileSync(output).length, sha256: digest(output), meshes: model.listMeshes().length, drawCalls: primitives.length, triangles: primitives.reduce((sum, p) => sum + p.getIndices().getCount() / 3, 0), bounds: getBounds(scene), parts, compression: 'Meshopt medium; 16-bit positions, 14-bit normals, 16-bit UVs' },
  anchors: {
    hood: [anchor([1.75, hoodY + .002, 0], [0, 1, 0])],
    'front-bumper': [anchor([2.31, .43, .43], [1, 0, 0]), anchor([2.31, .43, -.43], [1, 0, 0])],
    wheels: [1, -1].map(s => anchor([1.4325, .317, s * .884], [0, 0, s])),
    'brake-kit': [1, -1].map(s => anchor([1.4325, .33, s * .8], [0, 0, s])),
    'side-skirts': [1, -1].map(s => anchor([-.02, .25, s * .85], [0, 0, s])),
    'rear-bumper': [1, -1].map(s => anchor([-2.34, .54, s * .42], [-1, 0, 0])),
    exhaust: [anchor([-1.9, .25, -.18], [-1, 0, 0])],
  },
  materials: { paint: sourceReport.paint },
  interior: sourceReport.interior,
  engine: sourceReport.engine,
  articulation: { panels: sourceReport.panels, wheelCorners: sourceReport.wheelCorners, clips: model.listAnimations().map(a => a.getName()), joints: model.listNodes().filter(n => n.getExtras().articulationId).map(n => ({ name: n.getName(), ...n.getExtras() })) },
  modularWheels: { corners: sourceReport.wheelCorners, components: ['rim', 'tyre', 'brake-disc', 'rotor-hat', 'caliper', 'backing-plate', 'centre-badge', 'wheel-hardware'], tyreVariants: ['road', 'track'], axles: { front: 1.4325, rear: -1.3275 }, tyreRadius: .317, tyreWidth: .23, source: 'Original supplied Audi wheels, split into axle-centred steering and rolling groups; separate track tyre alternative' },
  garageSha256: digest(path.join(root, 'public/models/garage.glb')),
  notes: ['Supplied A6 OBJ geometry replaces the old generated car.', 'Original body scale, UVs and badges preserved; source colour-chart plane excluded.', 'Matching dark blue Recaro-style inserts and bolsters, rear bench and door cards; black Alcantara headlining.', 'Fixed dashboard end caps and footwell closures; moving door-card shells below the source window frames.', 'Clear boot opening with horizontal load floor and quarter linings; the hatch liner moves with the tailgate.', 'Existing deep blue paint values retained.', 'Four independent hinged doors with their glass, mirrors, handles and door cards; separate bonnet and tailgate.', 'Four axle-centred wheel assemblies; rotating discs/rims/tyres and stationary calipers; front steering joints.', 'Reference-built 2.7 V6 biturbo fitted in the engine bay; silver Y intake, twin turbos, drive belt, filter, cooling and service reservoirs are separate authored meshes.', 'The original bonnet underside and edge linings follow the hood hinge; closed-bonnet clearance is measured against the imported geometry.'],
};
mkdirSync(directory, { recursive: true });
copyFileSync(output, path.join(directory, 's6-c5.glb'));
copyFileSync(path.join(root, 'public/car-releases/imported-v4/paint-studio.hdr'), path.join(directory, 'paint-studio.hdr'));
writeFileSync(path.join(directory, 'manifest.json'), JSON.stringify(manifest, null, 2) + '\n');
writeFileSync(path.join(working, 'manifest.json'), JSON.stringify(manifest, null, 2) + '\n');
console.log(JSON.stringify({ release, ...manifest.car, clips: manifest.articulation.clips }, null, 2));
