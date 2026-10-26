// Regenerate a versioned car asset without exporting or changing the garage.
// Uses an installed Blender and locally cached glTF Transform; never installs tools.
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, readdirSync, statSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawn } from 'node:child_process';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const args = process.argv.slice(2);
if (args.includes('--help')) {
  console.log('node scripts/rebuild-car.mjs [--release reference-v2] [--blender PATH] [--cli PATH] [--compress-only]');
  process.exit(0);
}
const value = (flag, fallback) => { const i = args.indexOf(flag); return i < 0 ? fallback : args[i + 1]; };
const release = value('--release', 'reference-v2');
assert.match(release, /^[a-z0-9][a-z0-9-]{0,63}$/, 'Release must be a short lowercase name.');
const rawDirectory = path.join(root, 'output', 'car-refinement', release);
const releaseDirectory = path.join(root, 'public', 'car-releases', release);
const raw = path.join(rawDirectory, 's6-c5.glb');
const output = path.join(releaseDirectory, 's6-c5.glb');
const garagePath = path.join(root, 'public', 'models', 'garage.glb');
const sha256 = (file) => createHash('sha256').update(readFileSync(file)).digest('hex');
const garageBefore = sha256(garagePath);
const originalCarBefore = sha256(path.join(root, 'public', 'models', 's6-c5.glb'));
const run = (command, commandArgs) => new Promise((resolve, reject) => {
  const child = spawn(command, commandArgs, { cwd: root, stdio: 'inherit', windowsHide: true });
  child.on('error', reject);
  child.on('exit', (code) => code === 0 ? resolve() : reject(new Error(`${path.basename(command)} exited ${code}`)));
});
function blenderPath() {
  const explicit = value('--blender', process.env.BLENDER_BIN);
  if (explicit) { assert.ok(existsSync(explicit), 'Configured Blender executable is missing.'); return explicit; }
  const base = path.join(process.env.ProgramFiles || 'C:\\Program Files', 'Blender Foundation');
  if (existsSync(base)) for (const folder of readdirSync(base).sort().reverse()) {
    const candidate = path.join(base, folder, 'blender.exe');
    if (existsSync(candidate)) return candidate;
  }
  throw new Error('Blender is not installed in its usual folder; pass --blender PATH.');
}
function gltfCliPath() {
  const explicit = value('--cli');
  if (explicit) { assert.ok(existsSync(explicit), 'Configured glTF Transform CLI is missing.'); return explicit; }
  const local = path.join(root, 'node_modules', '@gltf-transform', 'cli', 'bin', 'cli.js');
  if (existsSync(local)) return local;
  // Only the version pinned in package.json (or an explicit --cli): never a copy from the npx cache.
  throw new Error('Run npm install for the pinned @gltf-transform/cli, or pass --cli PATH.');
}
function gltfStats(file) {
  const bytes = readFileSync(file);
  assert.equal(bytes.toString('utf8', 0, 4), 'glTF');
  const gltf = JSON.parse(bytes.toString('utf8', 20, 20 + bytes.readUInt32LE(12)));
  return {
    bytes: bytes.length,
    triangles: gltf.meshes.reduce((sum, mesh) => sum + mesh.primitives.reduce((n, p) => n + gltf.accessors[p.indices].count / 3, 0), 0),
    parts: [...new Set(gltf.nodes.map((node) => node.extras?.partId).filter(Boolean))].sort(),
    materials: gltf.materials.map((material) => material.name).sort(),
    meshes: gltf.meshes.length,
    extensions: gltf.extensionsUsed,
  };
}

mkdirSync(rawDirectory, { recursive: true });
mkdirSync(releaseDirectory, { recursive: true });
const cli = gltfCliPath();
if (!args.includes('--compress-only')) await run(blenderPath(), ['-b', '--factory-startup', '--python', path.join(root, 'scripts', 'rebuild_s6_car.py'), '--', '--out-dir', rawDirectory]);
assert.ok(existsSync(raw), 'Raw car GLB has not been built.');
const before = gltfStats(raw);
// High mode clamps normals to 8 bits internally. Medium retains the explicit
// 14-bit normal precision needed for smooth clearcoat and wheel reflections.
await run(process.execPath, [cli, 'meshopt', raw, output, '--level', 'medium', '--quantize-position', '16', '--quantize-normal', '14']);
const after = gltfStats(output);
assert.equal(after.triangles, before.triangles, 'Compression must retain the exported triangle count.');
assert.deepEqual(after.parts, before.parts, 'Interactive part IDs must survive compression.');
assert.deepEqual(after.materials, before.materials, 'Material identity must survive compression.');
assert.ok(after.extensions.includes('EXT_meshopt_compression'));
assert.equal(sha256(garagePath), garageBefore, 'Garage asset must remain unchanged.');
assert.equal(sha256(path.join(root, 'public', 'models', 's6-c5.glb')), originalCarBefore, 'Original car asset must remain available.');
const sourceInfo = JSON.parse(readFileSync(path.join(rawDirectory, 'car-source-info.json'), 'utf8'));
const report = {
  ...sourceInfo,
  release,
  url: `/car-releases/${release}/s6-c5.glb`,
  car: { ...sourceInfo.car, ...after, file: `/car-releases/${release}/s6-c5.glb`, uncompressedBytes: statSync(raw).size, sha256: sha256(output), compression: 'Meshopt medium; 16-bit positions and 14-bit normals; triangle count retained' },
  garageSha256: garageBefore,
};
writeFileSync(path.join(releaseDirectory, 'manifest.json'), JSON.stringify(report, null, 2) + '\n');
console.log(JSON.stringify({ release, url: report.url, beforeBytes: before.bytes, bytes: after.bytes, triangles: after.triangles, parts: after.parts, sha256: report.car.sha256, garageUnchanged: true }, null, 2));
