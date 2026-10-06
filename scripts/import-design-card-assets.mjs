import { createHash } from 'node:crypto';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

// Mechanical acquisition of the eight public source posters observed in r933.
// No user-provided URLs, transformations, runtime upstream, or credential forwarding.
const directory = join(dirname(fileURLToPath(import.meta.url)), '..', 'public', 'design-card-assets');
const base = 'https://lightchain-qlxy-prod.oss-cn-hangzhou.aliyuncs.com/light-chain-platform/marketing/card/';
const names = ['clothing2.png', 'clothing1.png', 'print2.png', 'print1.png', 'fabric2.png', 'fabric1.png', 'techpack2.png', 'techpack1.png'];
const hash = bytes => createHash('sha256').update(bytes).digest('hex');
const manifestPath = join(directory, 'manifest.json');
const maxBytes = 20 * 1024 * 1024;
let manifest;
try { manifest = JSON.parse(await readFile(manifestPath, 'utf8')); }
catch (error) { if (error.code !== 'ENOENT') throw error; }
if (manifest) {
  if (manifest.assets?.length !== names.length) throw new Error('card_manifest_count_mismatch');
  for (const name of names) {
    const row = manifest.assets.find(row => row.name === name && row.source === `${base}${name}`);
    if (!row) throw new Error('card_manifest_identity_mismatch');
    const bytes = await readFile(join(directory, name));
    if (bytes.length !== row.bytes || hash(bytes) !== row.sha256) throw new Error('card_local_hash_mismatch');
  }
  console.log(JSON.stringify({ status: 'verified_existing', assets: names.length, networkRequests: 0 }));
} else {
  const originals = [];
  for (const name of names) {
    const source = `${base}${name}`;
    const response = await fetch(source, { redirect: 'error', signal: AbortSignal.timeout(30000) });
    if (!response.ok || response.headers.get('content-type')?.split(';')[0] !== 'image/png') throw new Error(`card_upstream_invalid:${name}`);
    if (Number(response.headers.get('content-length')) > maxBytes) throw new Error('card_asset_oversized');
    const reader = response.body.getReader();
    const chunks = []; let size = 0;
    for (;;) {
      const { done, value } = await reader.read(); if (done) break;
      size += value.length;
      if (size > maxBytes) { await reader.cancel(); throw new Error('card_asset_oversized'); }
      chunks.push(Buffer.from(value));
    }
    const bytes = Buffer.concat(chunks);
    if (!size || !bytes.subarray(0, 8).equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]))) throw new Error(`card_signature_invalid:${name}`);
    originals.push({ name, source, bytes });
  }
  await mkdir(directory, { recursive: true });
  const assets = [];
  for (const entry of originals) {
    const target = join(directory, entry.name);
    try { await writeFile(target, entry.bytes, { flag: 'wx' }); }
    catch (error) {
      if (error.code !== 'EEXIST') throw error;
      if (hash(await readFile(target)) !== hash(entry.bytes)) throw new Error('card_existing_content_conflict');
    }
    assets.push({ name: entry.name, source: entry.source, bytes: entry.bytes.length, contentType: 'image/png', sha256: hash(entry.bytes) });
  }
  await writeFile(manifestPath, `${JSON.stringify({ version: 1, evidence: 'work/light-design-creation-hover-r933.md', acquiredAt: new Date().toISOString(), assets }, null, 2)}\n`, { flag: 'wx' });
  console.log(JSON.stringify({ status: 'imported_originals', assets: assets.length, bytes: assets.reduce((sum, row) => sum + row.bytes, 0) }));
}
