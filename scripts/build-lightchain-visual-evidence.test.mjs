import assert from 'node:assert/strict';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { test } from 'node:test';
import { deflateSync } from 'node:zlib';

import { buildVisualEvidence } from './build-lightchain-visual-evidence.mjs';

const scriptPath = fileURLToPath(new URL('./build-lightchain-visual-evidence.mjs', import.meta.url));
const SIGNATURE = Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]);

function crc32(buffer) {
  let crc = 0xffffffff;
  for (const byte of buffer) {
    crc ^= byte;
    for (let bit = 0; bit < 8; bit += 1) crc = (crc >>> 1) ^ (0xedb88320 & -(crc & 1));
  }
  return (crc ^ 0xffffffff) >>> 0;
}

function chunk(type, data) {
  const typeBuffer = Buffer.from(type, 'ascii');
  const body = Buffer.concat([typeBuffer, data]);
  const checksum = Buffer.alloc(4);
  checksum.writeUInt32BE(crc32(body));
  const length = Buffer.alloc(4);
  length.writeUInt32BE(data.length);
  return Buffer.concat([length, body, checksum]);
}

function png(width, height, rgba = [255, 0, 0, 255]) {
  const header = Buffer.alloc(13);
  header.writeUInt32BE(width, 0);
  header.writeUInt32BE(height, 4);
  header[8] = 8;
  header[9] = 6;
  const row = Buffer.from([0, ...rgba]);
  const raw = Buffer.concat(Array.from({ length: height }, () => row));
  return Buffer.concat([
    SIGNATURE,
    chunk('IHDR', header),
    chunk('IDAT', deflateSync(raw)),
    chunk('IEND', Buffer.alloc(0)),
  ]);
}

async function fixture() {
  const root = await mkdtemp(join(tmpdir(), 'lightchain-visual-evidence-'));
  const sourcePath = join(root, 'source.png');
  const heavyPath = join(root, 'heavy.png');
  await writeFile(sourcePath, png(2, 1));
  await writeFile(heavyPath, png(2, 1, [0, 0, 255, 255]));
  const sourceManifest = {
    schema: 'light_chain_source_route_baseline.v1',
    origin: 'https://jp.linkaigc.com',
    recordedAt: '2026-09-25T06:49:32+09:00',
    rows: [
      { path: '/model', status: 'ok' },
      { path: '/gallery', status: '404' },
    ],
    captures: [{
      route: '/model',
      path: sourcePath,
      viewport: { width: 1440, height: 1050 },
      provenance: { source: 'lightchain-authenticated-source', role: 'lightchain_source_capture' },
    }],
  };
  const heavyManifest = {
    schema: 'heavy-chain-visual-captures.v1',
    capturedAt: '2026-09-25T07:00:00+09:00',
    captures: [{
      route: '/model',
      path: heavyPath,
      viewport: { width: 1440, height: 1050 },
      provenance: { source: 'heavy-chain-authenticated', role: 'heavy_authenticated_route_capture' },
    }],
  };
  return { root, sourcePath, heavyPath, sourceManifest, heavyManifest };
}

test('assembles an exact-route pair only when both captures are independently proven', async () => {
  const data = await fixture();
  try {
    const result = await buildVisualEvidence(data);
    assert.equal(result.ok, true);
    assert.deepEqual(result.summary, {
      total: 2,
      readyForComparison: 1,
      pendingConfirmation: 0,
      source404Excluded: 1,
    });
    const ready = result.routes.find((route) => route.route === '/model');
    assert.equal(ready.status, 'ready_for_comparison');
    assert.equal(ready.comparison.status, 'ready');
    assert.equal(ready.sourceCapture.readable, true);
    assert.equal(ready.heavyCapture.readable, true);
    assert.equal(ready.sourceCapture.bytes > 0, true);
    assert.match(ready.sourceCapture.sha256, /^[a-f0-9]{64}$/);
    assert.deepEqual(ready.sourceCapture.dimensions, { width: 2, height: 1 });
    assert.deepEqual(result.routes.find((route) => route.route === '/gallery'), {
      route: '/gallery',
      status: 'source_404_excluded',
      sourceStatus: '404',
      sourceCapture: null,
      heavyCapture: null,
      comparison: { status: 'not_applicable' },
      reasons: ['source_route_not_available'],
    });
  } finally {
    await rm(data.root, { recursive: true, force: true });
  }
});

test('keeps missing image, missing viewport, and untrusted provenance pending', async () => {
  const data = await fixture();
  try {
    data.sourceManifest.captures[0].path = join(data.root, 'missing.png');
    const result = await buildVisualEvidence(data);
    const row = result.routes.find((route) => route.route === '/model');
    assert.equal(row.status, 'pending_confirmation');
    assert.deepEqual(row.reasons, ['source_capture_missing']);
    assert.equal(row.comparison.status, 'not_run');

    data.sourceManifest.captures[0].path = data.sourcePath;
    data.sourceManifest.captures[0].viewport = undefined;
    data.sourceManifest.captures[0].provenance = { source: 'heavy-chain', role: 'heavy-observed-source-contract' };
    const untrusted = await buildVisualEvidence(data);
    const untrustedRow = untrusted.routes.find((route) => route.route === '/model');
    assert.deepEqual(untrustedRow.reasons, ['source_provenance_unverified', 'source_viewport_missing']);
  } finally {
    await rm(data.root, { recursive: true, force: true });
  }
});

test('rejects incompatible viewports and duplicate exact routes without guessing aliases', async () => {
  const data = await fixture();
  try {
    data.heavyManifest.captures[0].viewport = { width: 390, height: 844 };
    data.heavyManifest.captures.push({ ...data.heavyManifest.captures[0], path: data.heavyPath });
    const result = await buildVisualEvidence(data);
    assert.equal(result.ok, false);
    assert.deepEqual(result.validationErrors, ['duplicate_heavy_capture:/model']);
    const row = result.routes.find((route) => route.route === '/model');
    assert.equal(row.status, 'pending_confirmation');
    assert.deepEqual(row.reasons, ['viewport_incompatible']);
  } finally {
    await rm(data.root, { recursive: true, force: true });
  }
});

test('is deterministic across repeated assembly with the same inputs', async () => {
  const data = await fixture();
  try {
    const first = await buildVisualEvidence(data);
    const second = await buildVisualEvidence(data);
    assert.deepEqual(second, first);
    assert.equal(first.deterministic, true);
  } finally {
    await rm(data.root, { recursive: true, force: true });
  }
});

test('CLI writes a truthful pending manifest for current artifacts', async () => {
  const data = await fixture();
  const sourceManifestPath = join(data.root, 'source.json');
  const heavyManifestPath = join(data.root, 'heavy.json');
  const outputPath = join(data.root, 'out.json');
  try {
    // No source capture is supplied here: the current workflow artifact must
    // remain pending instead of treating Heavy's source-parity PNG as source.
    const source = { ...data.sourceManifest, captures: undefined };
    const heavy = {
      schema: 'lightchain-all-feature-workflows.v1',
      capturedAt: '2026-09-25T07:00:00+09:00',
      sourceReadback: {
        results: [{
          route: '/model',
          screenshot: data.heavyPath,
          viewport: { width: 1440, height: 1050 },
          screenshotRole: 'heavy-observed-source-contract',
        }],
      },
    };
    await writeFile(sourceManifestPath, `${JSON.stringify(source)}\n`);
    await writeFile(heavyManifestPath, `${JSON.stringify(heavy)}\n`);
    const child = spawn(process.execPath, [
      scriptPath,
      '--source', sourceManifestPath,
      '--heavy', heavyManifestPath,
      '--out', outputPath,
    ], { stdio: ['ignore', 'pipe', 'pipe'] });
    let stdout = '';
    let stderr = '';
    child.stdout.on('data', (chunk) => { stdout += chunk; });
    child.stderr.on('data', (chunk) => { stderr += chunk; });
    const code = await new Promise((resolve) => child.on('close', resolve));
    assert.equal(code, 0, stderr);
    assert.match(stdout, /"ok":true/);
    const manifest = JSON.parse(await readFile(outputPath, 'utf8'));
    assert.equal(manifest.summary.readyForComparison, 0);
    assert.equal(manifest.summary.pendingConfirmation, 1);
    assert.match(manifest.routes[0].reasons.join(','), /source_capture_missing/);
  } finally {
    await rm(data.root, { recursive: true, force: true });
  }
});
