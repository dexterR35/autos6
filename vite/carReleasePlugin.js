import { readFileSync } from 'node:fs';
import path from 'node:path';
import { CAR_RELEASE } from '../src/lib/modelAssets.js';

// The car release manifest lives in public/ (it ships next to the GLB it describes),
// but Vite doesn't allow JavaScript to import files from public/. This serves the same
// file as `virtual:car-release`, so there is still one copy, and edits reload in dev.
const ID = 'virtual:car-release';
const RESOLVED = `\0${ID}`;

export default function carReleasePlugin() {
  let file;
  return {
    name: 'car-release-manifest',
    configResolved(config) {
      file = path.join(config.publicDir || path.join(config.root, 'public'), 'car-releases', CAR_RELEASE, 'manifest.json');
    },
    resolveId: (id) => (id === ID ? RESOLVED : null),
    load(id) {
      if (id !== RESOLVED) return null;
      this.addWatchFile(file);
      return `export default ${JSON.stringify(JSON.parse(readFileSync(file, 'utf8')))};`;
    },
  };
}
