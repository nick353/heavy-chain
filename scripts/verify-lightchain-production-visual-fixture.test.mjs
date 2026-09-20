import { deepStrictEqual, match, strictEqual } from 'node:assert';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test } from 'node:test';
import { deflateSync } from 'node:zlib';
import { spawn } from 'node:child_process';

import { comparePngFiles } from './verify-lightchain-production-visual-fixture.mjs';

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

function png(width, height, rgba) {
  const header = Buffer.alloc(13);
  header.writeUInt32BE(width, 0);
  header.writeUInt32BE(height, 4);
  header[8] = 8;
  header[9] = 6;
  const rows = [];
  for (let y = 0; y < height; y += 1) {
    rows.push(Buffer.from([0]), rgba.subarray(y * width * 4, (y + 1) * width * 4));
  }
  return Buffer.concat([SIGNATURE, chunk('IHDR', header), chunk('IDAT', deflateSync(Buffer.concat(rows))), chunk('IEND', Buffer.alloc(0))]);
}

async function fixtureDirectory() {
  return mkdtemp(join(tmpdir(), 'lightchain-visual-fixture-'));
}

function runCli(args) {
  return new Promise((resolve) => {
    const child = spawn(process.execPath, ['./verify-lightchain-production-visual-fixture.mjs', ...args], {
      cwd: new URL('.', import.meta.url),
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    let stderr = '';
    child.stderr.on('data', (chunkData) => { stderr += chunkData; });
    child.on('close', (code) => resolve({ code, stderr }));
  });
}

test('equal RGBA captures produce EQUAL with zero differing pixels', async () => {
  const directory = await fixtureDirectory();
  try {
    const image = png(2, 1, Buffer.from([255, 0, 0, 255, 0, 0, 255, 255]));
    const source = join(directory, 'source.png');
    const heavy = join(directory, 'heavy.png');
    const out = join(directory, 'result.json');
    await Promise.all([writeFile(source, image), writeFile(heavy, image)]);
    const result = await comparePngFiles(source, heavy);
    strictEqual(result.status, 'EQUAL');
    strictEqual(result.differingPixelCount, 0);
    strictEqual(result.totalPixelCount, 2);
    strictEqual(result.differingPixelRatio, 0);
    strictEqual(result.noClaimGuard.mechanicalComparisonOnly, true);
    await writeFile(out, JSON.stringify(result));
    deepStrictEqual(JSON.parse(await readFile(out, 'utf8')).dimensions.source, { width: 2, height: 1 });
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});

test('different pixels honor the threshold and report DIFFERENT', async () => {
  const directory = await fixtureDirectory();
  try {
    await writeFile(join(directory, 'source.png'), png(1, 1, Buffer.from([255, 0, 0, 255])));
    await writeFile(join(directory, 'heavy.png'), png(1, 1, Buffer.from([0, 255, 0, 255])));
    const result = await comparePngFiles(join(directory, 'source.png'), join(directory, 'heavy.png'), 0.5);
    strictEqual(result.differingPixelCount, 1);
    strictEqual(result.differingPixelRatio, 1);
    strictEqual(result.threshold, 0.5);
    strictEqual(result.status, 'DIFFERENT');
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});

test('dimension mismatch is DIFFERENT without inventing pixel counts', async () => {
  const directory = await fixtureDirectory();
  try {
    await writeFile(join(directory, 'source.png'), png(1, 1, Buffer.from([0, 0, 0, 255])));
    await writeFile(join(directory, 'heavy.png'), png(2, 1, Buffer.from([0, 0, 0, 255, 0, 0, 0, 255])));
    const result = await comparePngFiles(join(directory, 'source.png'), join(directory, 'heavy.png'));
    strictEqual(result.status, 'DIFFERENT');
    strictEqual(result.differingPixelCount, null);
    strictEqual(result.differingPixelRatio, null);
    deepStrictEqual(result.dimensions.heavy, { width: 2, height: 1 });
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});

test('CLI fails closed for a missing input', async () => {
  const directory = await fixtureDirectory();
  try {
    const result = await runCli(['--source', join(directory, 'missing.png'), '--heavy', join(directory, 'heavy.png'), '--out', join(directory, 'result.json')]);
    strictEqual(result.code !== 0, true);
    match(result.stderr, /visual fixture comparison failed/);
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});
