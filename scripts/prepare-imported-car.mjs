// Normalize the uploaded car to the garage envelope WITHOUT simplifying it.
// The earlier preview derivative (model-web.glb) reduced the mesh to 32 % before
// any cleanup, which crumpled the body panels. Release builds start from this
// full-detail file instead; triangle reduction happens once, per material, at
// the end of build-imported-car.mjs. The source upload is never modified.
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const args = process.argv.slice(2);
const option = (flag, fallback) => { const index = args.indexOf(flag); return index < 0 ? fallback : args[index + 1]; };
const input = path.resolve(option('--input', path.join(root, 'output', 'car-refinement', 'imported', 'model.glb')));
const output = path.resolve(option('--output', path.join(root, 'output', 'car-refinement', 'imported', 'model-clean.glb')));
assert.ok(existsSync(input), `Input model does not exist: ${input}`);
assert.notEqual(input.toLowerCase(), output.toLowerCase(), 'The source model must never be overwritten.');
const cli = path.resolve(option('--cli', path.join(root, 'node_modules', '@gltf-transform', 'cli', 'bin', 'cli.js')));
assert.ok(existsSync(cli), 'Run npm install for the pinned @gltf-transform/cli, or pass --cli PATH.');
const requireTool = createRequire(cli);
const { NodeIO, getBounds } = requireTool('@gltf-transform/core');
const { ALL_EXTENSIONS } = requireTool('@gltf-transform/extensions');
const { MeshoptDecoder } = requireTool('meshoptimizer');
await MeshoptDecoder.ready;
const io = new NodeIO().registerExtensions(ALL_EXTENSIONS).registerDependencies({ 'meshopt.decoder': MeshoptDecoder });
const digest = file => createHash('sha256').update(readFileSync(file)).digest('hex');
const sourceHash = digest(input);
const dimensions = [4.797, 1.85, 2.1]; // Same garage fit as optimize-imported-car.mjs.
const document = await io.read(input), scene = document.getRoot().getDefaultScene() || document.getRoot().listScenes()[0];
const bounds = getBounds(scene), size = bounds.max.map((value, axis) => value - bounds.min[axis]);
const scale = dimensions.map((value, axis) => value / size[axis]);
const translation = [-(bounds.min[0] + bounds.max[0]) * scale[0] / 2, -bounds.min[1] * scale[1], -(bounds.min[2] + bounds.max[2]) * scale[2] / 2];
const vehicle = document.createNode('Imported Audi | garage normalization').setScale(scale).setTranslation(translation)
  .setExtras({ source: 'User-provided model.glb', coordinates: 'metres, Y up, nose +X', normalizedFor: 'Existing garage dimensions', simplified: false });
for (const child of [...scene.listChildren()]) { scene.removeChild(child); vehicle.addChild(child); }
scene.addChild(vehicle);
mkdirSync(path.dirname(output), { recursive: true });
await io.write(output, document);
assert.equal(digest(input), sourceHash, 'The original uploaded model changed.');
const primitives = document.getRoot().listMeshes().flatMap(mesh => mesh.listPrimitives());
console.log(JSON.stringify({ output, bytes: readFileSync(output).length, triangles: primitives.reduce((sum, p) => sum + p.getIndices().getCount() / 3, 0), scale, translation }, null, 2));
