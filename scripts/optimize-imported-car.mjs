// Prepare an uploaded, textured GLB for garage previews without changing it.
// Uses only locally cached glTF Transform tools. The JPEG atlas is preserved.
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, unlinkSync, writeFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawn } from 'node:child_process';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const args = process.argv.slice(2);
if (args.includes('--help')) {
  console.log('node scripts/optimize-imported-car.mjs [--input PATH] [--output PATH] [--cli PATH] [--keep-intermediates]');
  process.exit(0);
}
function option(flag, fallback) {
  const index = args.indexOf(flag);
  if (index < 0) return fallback;
  assert.ok(args[index + 1] && !args[index + 1].startsWith('--'), `${flag} requires a value.`);
  return args[index + 1];
}
const input = path.resolve(option('--input', path.join(os.homedir(), 'Downloads', 'model.glb')));
const output = path.resolve(option('--output', path.join(root, 'output', 'car-refinement', 'imported', 'model-web.glb')));
assert.notEqual(input.toLowerCase(), output.toLowerCase(), 'The source model must never be overwritten.');
assert.ok(existsSync(input), `Input model does not exist: ${input}`);
const digest = (bytes) => createHash('sha256').update(bytes).digest('hex');
const sourceHash = digest(readFileSync(input));
function findCli() {
  const explicit = option('--cli', undefined);
  if (explicit) { assert.ok(existsSync(explicit)); return path.resolve(explicit); }
  const local = path.join(root, 'node_modules', '@gltf-transform', 'cli', 'bin', 'cli.js');
  if (existsSync(local)) return local;
  // Only the version pinned in package.json (or an explicit --cli): never a copy from the npx cache.
  throw new Error('Run npm install for the pinned @gltf-transform/cli, or pass --cli PATH.');
}
const cli = findCli();
const requireTool = createRequire(cli);
const { NodeIO, getBounds } = requireTool('@gltf-transform/core');
const { ALL_EXTENSIONS } = requireTool('@gltf-transform/extensions');
const { MeshoptDecoder } = requireTool('meshoptimizer');
await MeshoptDecoder.ready;
const io = new NodeIO().registerExtensions(ALL_EXTENSIONS).registerDependencies({ 'meshopt.decoder': MeshoptDecoder });
const dimensions = [4.797, 1.85, 2.1]; // Existing garage fit: length, roof-box height, mirror width.
const run = (commandArgs) => new Promise((resolve, reject) => {
  const processTool = spawn(process.execPath, [cli, ...commandArgs], { cwd: root, stdio: 'inherit', windowsHide: true });
  processTool.on('error', reject);
  processTool.on('exit', (code) => code === 0 ? resolve() : reject(new Error(`glTF Transform exited ${code}`)));
});
function describe(document) {
  const modelRoot = document.getRoot();
  const scene = modelRoot.getDefaultScene() || modelRoot.listScenes()[0];
  assert.ok(scene, 'A GLB scene is required.');
  const bounds = getBounds(scene);
  const primitives = modelRoot.listMeshes().flatMap((mesh) => mesh.listPrimitives());
  assert.ok(primitives.every((primitive) => primitive.getMode() === 4), 'Expected triangle primitives.');
  for (const primitive of primitives) {
    const vertexCount = primitive.getAttribute('POSITION').getCount();
    for (const semantic of ['POSITION', 'NORMAL', 'TEXCOORD_0']) {
      const attribute = primitive.getAttribute(semantic);
      assert.ok(attribute, `The textured car needs ${semantic}.`);
      assert.equal(attribute.getCount(), vertexCount, `${semantic} count does not match positions.`);
      assert.ok(attribute.getArray().every(Number.isFinite), `${semantic} contains invalid values.`);
    }
    assert.ok(!primitive.getIndices() || primitive.getIndices().getArray().every((index) => index < vertexCount), 'An index points outside the vertex buffer.');
  }
  return {
    triangles: primitives.reduce((sum, primitive) => sum + (primitive.getIndices()?.getCount() ?? primitive.getAttribute('POSITION').getCount()) / 3, 0),
    vertices: primitives.reduce((sum, primitive) => sum + primitive.getAttribute('POSITION').getCount(), 0),
    drawCalls: primitives.length,
    bounds: { ...bounds, size: bounds.max.map((value, axis) => value - bounds.min[axis]) },
    textures: modelRoot.listTextures().map((texture) => ({ name: texture.getName(), mimeType: texture.getMimeType(), bytes: texture.getImage().length, sha256: digest(texture.getImage()) })),
    extensions: modelRoot.listExtensionsUsed().map((extension) => extension.extensionName),
  };
}
const document = await io.read(input);
const before = describe(document);
assert.ok(before.bounds.size.every((value) => Number.isFinite(value) && value > 0));
assert.equal(document.getRoot().listScenes().length, 1, 'Review multi-scene imports before normalizing them.');
const scene = document.getRoot().getDefaultScene() || document.getRoot().listScenes()[0];
const scale = dimensions.map((value, axis) => value / before.bounds.size[axis]);
const translation = [
  -(before.bounds.min[0] + before.bounds.max[0]) * scale[0] / 2,
  -before.bounds.min[1] * scale[1],
  -(before.bounds.min[2] + before.bounds.max[2]) * scale[2] / 2,
];
const roots = [...scene.listChildren()];
const vehicle = document.createNode('Imported Audi | garage normalization')
  .setScale(scale).setTranslation(translation)
  .setExtras({ source: 'User-provided model.glb', coordinates: 'metres, Y up, nose +X', normalizedFor: 'Existing garage dimensions' });
for (const child of roots) { scene.removeChild(child); vehicle.addChild(child); }
scene.addChild(vehicle);
mkdirSync(path.dirname(output), { recursive: true });
const intermediate = ['normalized', 'welded', 'simplified'].map((step) => path.join(path.dirname(output), `.imported-car-${step}-${process.pid}.glb`));
let after;
try {
  await io.write(intermediate[0], document);
  await run(['weld', intermediate[0], intermediate[1]]);
  await run(['simplify', intermediate[1], intermediate[2], '--ratio', '.32', '--error', '.0005']);
  const simplified = describe(await io.read(intermediate[2]));
  await run(['meshopt', intermediate[2], output, '--level', 'medium', '--quantize-position', '16', '--quantize-normal', '14', '--quantize-texcoord', '16']);
  after = describe(await io.read(output));
  assert.equal(after.triangles, simplified.triangles, 'Meshopt must retain the simplified triangle count.');
  assert.ok(after.extensions.includes('EXT_meshopt_compression'), 'Meshopt extension is missing.');
  assert.deepEqual(after.textures.map((texture) => texture.sha256), before.textures.map((texture) => texture.sha256), 'The original texture bytes must be preserved.');
  assert.ok(after.triangles < before.triangles, 'Simplification did not reduce the model.');
  after.bounds.size.forEach((value, axis) => assert.ok(Math.abs(value - dimensions[axis]) < .015, 'Normalized bounds drifted by more than 15mm.'));
  assert.ok(Math.abs(after.bounds.min[1]) < .008, 'Tyres must meet the garage floor within 8mm.');
  const report = {
    source: { file: input, bytes: readFileSync(input).length, sha256: sourceHash, ...before },
    output: { file: output, bytes: readFileSync(output).length, sha256: digest(readFileSync(output)), ...after },
    normalization: { scale, translation, targetDimensions: dimensions, axes: 'metres; Y up; nose +X; centred X/Z; ground Y=0' },
    processing: { simplifyRatio: .32, simplifyError: .0005, meshoptLevel: 'medium', positionBits: 16, normalBits: 14, uvBits: 16, texture: 'Original embedded image bytes preserved' },
  };
  writeFileSync(path.join(path.dirname(output), 'model-web-manifest.json'), JSON.stringify(report, null, 2) + '\n');
  console.log(JSON.stringify({ output, bytes: report.output.bytes, triangles: after.triangles, vertices: after.vertices, bounds: after.bounds, originalTexturePreserved: true, originalFilePreserved: true }, null, 2));
} finally {
  assert.equal(digest(readFileSync(input)), sourceHash, 'The original uploaded model changed.');
  if (!args.includes('--keep-intermediates')) for (const file of intermediate) if (existsSync(file)) unlinkSync(file);
}
