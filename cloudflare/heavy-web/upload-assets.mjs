import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';
import { assetDescriptor } from './build.mjs';

const here = path.dirname(fileURLToPath(import.meta.url));
const apiRoot = path.resolve(here, '../heavy-api');
const manifest = JSON.parse(await fs.readFile(path.join(here, '.build/public-assets.json'), 'utf8'));
const uploaded = new Set();
for (const [route, asset] of Object.entries(manifest)) {
  const relative = route.replace(/^\//, '');
  const file = path.join(here, '.build/site', relative);
  const actual = assetDescriptor(relative, await fs.readFile(file));
  if (JSON.stringify(actual) !== JSON.stringify(asset)) throw new Error(`Build changed: ${relative}`);
  if (uploaded.has(asset.key)) continue;
  const result = spawnSync(path.join(apiRoot, 'node_modules/.bin/wrangler'), [
    'r2', 'object', 'put', `heavy-chain-public-assets/${asset.key}`,
    '--remote', '--file', file, '--content-type', asset.contentType,
    '--cache-control', 'public, max-age=31536000, immutable',
  ], { cwd: apiRoot, stdio: 'inherit' });
  if (result.status !== 0) throw new Error(`Upload failed: ${relative}`);
  uploaded.add(asset.key);
}
console.log(JSON.stringify({ uploadedUniqueObjects: uploaded.size, routes: Object.keys(manifest).length }));
