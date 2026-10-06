import { createHash } from 'node:crypto';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

// Mechanical import of exact known public original assets, never user URLs.
const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const directory = join(root, 'public', 'scene-assets');
const base = 'https://lightchain-qlxy-prod.oss-cn-hangzhou.aliyuncs.com/light-chain-platform/design/ja/';
const names = ['fabric1.jpg', 'fabric2.jpg', 'fabric3.jpg', 'fabric4.jpg', 'fabric5.png', 'draft1.png', 'multi1.jpg', 'multi2.jpg', 'print1.png', 'print2.jpg', 'fabric.png', 'draft.png', 'multi.png', 'print.png'];
const entries = names.map(name => ({ name, source: `${base}${name}` }));
entries.push({ name: 'upload-placeholder.png', source: 'https://jp.linkaigc.com/marketing/upload-placeholder.png' });
const maxBytes = 20 * 1024 * 1024;
const hash = bytes => createHash('sha256').update(bytes).digest('hex');
const manifestPath = join(directory, 'manifest.json');
let existing = null;
try { existing = JSON.parse(await readFile(manifestPath, 'utf8')); }
catch (error) { if (error.code !== 'ENOENT') throw error; }
if (existing) {
  if (existing.assets?.length !== entries.length) throw new Error('scene_manifest_count_mismatch');
  for (const entry of entries) {
    const row = existing.assets.find(row => row.name === entry.name && row.source === entry.source);
    if (!row) throw new Error('scene_manifest_identity_mismatch');
    const bytes = await readFile(join(directory, entry.name));
    if (bytes.length !== row.bytes || hash(bytes) !== row.sha256) throw new Error('scene_local_hash_mismatch');
  }
  console.log(JSON.stringify({ status: 'verified_existing', assets: entries.length, networkRequests: 0 }));
} else {
  // Fetch and validate every asset before publishing any imported bytes.
  const originals = [];
  for (const entry of entries) {
    const response = await fetch(entry.source, { redirect: 'error', signal: AbortSignal.timeout(30000) });
    const mime = entry.name.endsWith('.png') ? 'image/png' : 'image/jpeg';
    if (!response.ok || response.headers.get('content-type')?.split(';')[0] !== mime) throw new Error(`scene_upstream_invalid:${entry.name}`);
    if (Number(response.headers.get('content-length')) > maxBytes) throw new Error('scene_asset_oversized');
    const reader = response.body.getReader();
    const chunks = []; let size = 0;
    for (;;) {
      const { done, value } = await reader.read(); if (done) break;
      size += value.length;
      if (size > maxBytes) { await reader.cancel(); throw new Error('scene_asset_oversized'); }
      chunks.push(Buffer.from(value));
    }
    const bytes = Buffer.concat(chunks);
    const valid = mime === 'image/png'
      ? bytes.subarray(0, 8).equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]))
      : bytes[0] === 255 && bytes[1] === 216 && bytes[2] === 255;
    if (!size || !valid) throw new Error(`scene_signature_invalid:${entry.name}`);
    originals.push({ ...entry, bytes, mime });
  }
  await mkdir(directory, { recursive: true });
  const assets = [];
  for (const entry of originals) {
    const target = join(directory, entry.name);
    // Do not overwrite any existing unrelated/user asset.
    try { await writeFile(target, entry.bytes, { flag: 'wx' }); }
    catch (error) {
      if (error.code !== 'EEXIST') throw error;
      if (hash(await readFile(target)) !== hash(entry.bytes)) throw new Error('scene_existing_content_conflict');
    }
    assets.push({ name: entry.name, source: entry.source, bytes: entry.bytes.length, contentType: entry.mime, sha256: hash(entry.bytes) });
  }
  await writeFile(manifestPath, `${JSON.stringify({ version: 1, acquiredAt: new Date().toISOString(), assets }, null, 2)}\n`, { flag: 'wx' });
  console.log(JSON.stringify({ status: 'imported_originals', assets: assets.length, bytes: assets.reduce((sum, entry) => sum + entry.bytes, 0) }));
}
