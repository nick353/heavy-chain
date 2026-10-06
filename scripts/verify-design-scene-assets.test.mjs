import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { spawn } from 'node:child_process';
import { request } from 'node:http';
import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import test from 'node:test';

const publicRoot = process.env.DESIGN_ASSET_TEST_DIST
  ? resolve(process.env.DESIGN_ASSET_TEST_DIST)
  : fileURLToPath(new URL('../public/', import.meta.url));
const manifest = JSON.parse(await readFile(new URL('../public/scene-assets/manifest.json', import.meta.url), 'utf8'));
const cardManifest = JSON.parse(await readFile(new URL('../public/design-card-assets/manifest.json', import.meta.url), 'utf8'));
const hash = bytes => createHash('sha256').update(bytes).digest('hex');
test('original imported scene assets match exact manifest bytes, MIME and hash', async () => {
  assert.equal(manifest.assets.length, 15);
  assert.equal(new Set(manifest.assets.map(row => row.name)).size, 15);
  for (const row of manifest.assets) {
    const bytes = await readFile(new URL(`../public/scene-assets/${row.name}`, import.meta.url));
    assert.equal(bytes.length, row.bytes); assert.equal(hash(bytes), row.sha256);
    if (row.contentType === 'image/png') assert.deepEqual([...bytes.subarray(0, 8)], [137,80,78,71,13,10,26,10]);
    else { assert.equal(row.contentType, 'image/jpeg'); assert.deepEqual([...bytes.subarray(0, 3)], [255,216,255]); }
  }
  assert.equal(manifest.assets.find(row => row.name === 'fabric5.png').bytes, 3354997);
});
test('eight public creation posters match original PNG signatures and manifest hashes', async () => {
  assert.equal(cardManifest.assets.length, 8);
  assert.equal(new Set(cardManifest.assets.map(row => row.name)).size, 8);
  for (const row of cardManifest.assets) {
    assert.equal(row.source, `https://lightchain-qlxy-prod.oss-cn-hangzhou.aliyuncs.com/light-chain-platform/marketing/card/${row.name}`);
    const bytes = await readFile(new URL(`../public/design-card-assets/${row.name}`, import.meta.url));
    assert.equal(bytes.length, row.bytes); assert.equal(hash(bytes), row.sha256);
    assert.equal(row.contentType, 'image/png');
    assert.deepEqual([...bytes.subarray(0, 8)], [137,80,78,71,13,10,26,10]);
  }
});
test('actual production static server serves exact original bytes and rejects invalid asset paths', async t => {
  const child = spawn(process.execPath, [fileURLToPath(new URL('./serve-zeabur.mjs', import.meta.url))], {
    env: { ...process.env, DIST_DIR: publicRoot, HOST: '127.0.0.1', PORT: '0', AUTH_BASE_URL: '' }, stdio: ['ignore', 'pipe', 'pipe'],
  });
  t.after(async () => { if (child.exitCode === null) { child.kill(); await new Promise(resolve => child.once('exit', resolve)); } });
  // Production script logs actual bound port, including ephemeral test ports.
  const port = await new Promise((resolve, reject) => {
    let output = ''; const timer = setTimeout(() => reject(new Error('server_start_timeout')), 5000);
    child.stdout.on('data', chunk => { output += chunk; const match = output.match(/listening on 127\.0\.0\.1:(\d+)/); if (match) { clearTimeout(timer); resolve(Number(match[1])); } });
    child.once('error', error => { clearTimeout(timer); reject(error); });
  });
  assert.ok(port > 0);
  const get = path => new Promise((resolve, reject) => {
    const req = request({ hostname: '127.0.0.1', port, path, method: 'GET' }, response => {
      const chunks = []; response.on('data', chunk => chunks.push(chunk));
      response.on('end', () => resolve({ status: response.statusCode, headers: response.headers, bytes: Buffer.concat(chunks) }));
    }); req.on('error', reject); req.end();
  });
  for (const row of [...manifest.assets.map(row => ({ ...row, prefix: 'scene-assets' })), ...cardManifest.assets.map(row => ({ ...row, prefix: 'design-card-assets' }))]) {
    const response = await get(`/${row.prefix}/${row.name}`);
    assert.equal(response.status, 200); assert.equal(response.headers['content-type'], row.contentType);
    assert.equal(hash(response.bytes), row.sha256); assert.equal(response.headers.location, undefined);
  }
  for (const path of ['/scene-assets/nope.png', '/scene-assets/fabric5.png?url=https://example.com', '/scene-assets/FABRIC5.png', '/scene-assets/fabric5.png/', '/scene-assets', '/scene-assets/../package.json', '/scene-assets/%2e%2e%2fpackage.json', '/scene-assets/%252e%252e%252fpackage.json']) {
    const response = await get(path); assert.ok([400,404].includes(response.status), path);
    assert.match(response.headers['content-type'], /application\/json/); assert.notEqual(response.status, 200);
  }
  for (const path of ['/design-card-assets/nope.png', '/design-card-assets/clothing1.png?url=https://example.com', '/design-card-assets/CLOTHING1.png', '/design-card-assets/clothing1.png/', '/design-card-assets', '/design-card-assets/../package.json', '/design-card-assets/%2e%2e%2fpackage.json', '/design-card-assets/%252e%252e%252fpackage.json']) {
    const response = await get(path); assert.ok([400,404].includes(response.status), path);
    assert.match(response.headers['content-type'], /application\/json/); assert.notEqual(response.status, 200);
  }
});
