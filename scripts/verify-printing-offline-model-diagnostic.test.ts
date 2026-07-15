import assert from 'node:assert/strict';
import { mkdtemp, mkdir, realpath, symlink, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';

import {
  applyAlphaOnceSourceOverWhite,
  assertCanonicalManifestUnchanged,
  assertModelCaseBounds,
  assertOutputPathContained,
  buildDiagnosticBannerSvg,
  canonicalManifestDigest,
  clampByte,
  isPathInsideRoot,
  normalizeImageNetInput,
  normalizeModelMaskToAlpha,
  PRINTING_OFFLINE_MODEL_DIAGNOSTIC_BANNER_TEXT,
  PRINTING_OFFLINE_MODEL_DIAGNOSTIC_CASE_LIMIT,
  PRINTING_OFFLINE_MODEL_DIAGNOSTIC_FLAGS,
  PRINTING_OFFLINE_MODEL_DIAGNOSTIC_INPUT_HEIGHT,
  PRINTING_OFFLINE_MODEL_DIAGNOSTIC_INPUT_WIDTH,
  PRINTING_OFFLINE_MODEL_DIAGNOSTIC_MODEL_INPUT_NAME,
  PRINTING_OFFLINE_MODEL_DIAGNOSTIC_MODEL_OUTPUT_NAME,
  PRINTING_OFFLINE_MODEL_DIAGNOSTIC_MODEL_SHA256,
  PRINTING_OFFLINE_MODEL_DIAGNOSTIC_MAX_OUTPUT_BYTES,
  PRINTING_OFFLINE_MODEL_DIAGNOSTIC_MAX_DECODED_BYTES,
  PRINTING_OFFLINE_MODEL_DIAGNOSTIC_MAX_SOURCE_BYTES,
  stableDigest,
  validateContainedPathCandidate,
  PRINTING_OFFLINE_MODEL_DIAGNOSTIC_TOTAL_MAX_OUTPUT_BYTES,
} from './lib/printing-offline-model-diagnostic.ts';

test('exports the fixed banner, model metadata, and synthetic-only flags', () => {
  assert.equal(PRINTING_OFFLINE_MODEL_DIAGNOSTIC_CASE_LIMIT, 24);
  assert.equal(PRINTING_OFFLINE_MODEL_DIAGNOSTIC_INPUT_WIDTH, 320);
  assert.equal(PRINTING_OFFLINE_MODEL_DIAGNOSTIC_INPUT_HEIGHT, 320);
  assert.equal(PRINTING_OFFLINE_MODEL_DIAGNOSTIC_MODEL_INPUT_NAME, 'input.1');
  assert.equal(PRINTING_OFFLINE_MODEL_DIAGNOSTIC_MODEL_OUTPUT_NAME, '1959');
  assert.equal(
    PRINTING_OFFLINE_MODEL_DIAGNOSTIC_MODEL_SHA256,
    '75da6c8d2f8096ec743d071951be73b4a8bc7b3e51d9a6625d63644f90ffeedb',
  );
  assert.equal(PRINTING_OFFLINE_MODEL_DIAGNOSTIC_FLAGS.cutoutPipelineParity, false);
  assert.equal(PRINTING_OFFLINE_MODEL_DIAGNOSTIC_FLAGS.browserParity, false);
  assert.equal(PRINTING_OFFLINE_MODEL_DIAGNOSTIC_FLAGS.realPhoto, false);
  assert.equal(PRINTING_OFFLINE_MODEL_DIAGNOSTIC_FLAGS.userApproval, false);
  assert.ok(PRINTING_OFFLINE_MODEL_DIAGNOSTIC_BANNER_TEXT.includes('SYNTHETIC OFFLINE DIAGNOSTIC'));
  assert.ok(PRINTING_OFFLINE_MODEL_DIAGNOSTIC_BANNER_TEXT.includes('NOT BROWSER'));
  assert.ok(PRINTING_OFFLINE_MODEL_DIAGNOSTIC_BANNER_TEXT.includes('NOT REAL PHOTO'));
  assert.ok(PRINTING_OFFLINE_MODEL_DIAGNOSTIC_BANNER_TEXT.includes('NOT APPROVAL'));
});

test('banner svg encodes the required diagnostic text', () => {
  const svg = buildDiagnosticBannerSvg().toString('utf8');
  const text = svg.match(/<text[^>]*>([^<]*)<\/text>/)?.[1];
  assert.equal(text, PRINTING_OFFLINE_MODEL_DIAGNOSTIC_BANNER_TEXT);
  assert.ok(svg.includes('width="1440"'));
  assert.ok(svg.includes('height="128"'));
});

test('mask normalization performs finite min-max quantization and rejects constant or NaN inputs', () => {
  const mask = new Float32Array(320 * 320);
  mask.fill(0.4);
  mask[0] = 0.2;
  mask[mask.length - 1] = 0.6;
  const alpha = normalizeModelMaskToAlpha(mask);
  assert.ok(Math.abs(alpha.min - 0.2) < 1e-6);
  assert.ok(Math.abs(alpha.max - 0.6) < 1e-6);
  assert.equal(alpha.alpha[0], 0);
  assert.equal(alpha.alpha[1], 127);
  assert.equal(alpha.alpha[alpha.alpha.length - 1], 255);
  assert.throws(() => normalizeModelMaskToAlpha(new Float32Array(3)), /MASK_LENGTH_INVALID/);
  assert.throws(() => normalizeModelMaskToAlpha(new Float32Array(320 * 320).fill(1)), /MASK_CONSTANT/);
  const nonFiniteMask = new Float32Array(320 * 320);
  nonFiniteMask[1] = Number.NaN;
  assert.throws(() => normalizeModelMaskToAlpha(nonFiniteMask), /MASK_NON_FINITE/);
});

test('normalizeImageNetInput stretches dynamic max and builds CHW float32 tensors', () => {
  const rgb = new Uint8Array(320 * 320 * 3);
  rgb[0] = 1;
  rgb[rgb.length - 1] = 255;
  const normalized = normalizeImageNetInput(rgb);
  assert.equal(normalized.dynamicMax, 255);
  assert.deepEqual(normalized.tensorShape, [1, 3, 320, 320]);
  assert.equal(normalized.tensorData.length, 320 * 320 * 3);
  assert.ok(Number.isFinite(normalized.tensorData[0]));
  assert.throws(() => normalizeImageNetInput(new Uint8Array(3)), /IMAGE_INPUT_INVALID/);
});

test('exact alpha oracle multiplies once and source-over composites onto white', () => {
  const rgba = new Uint8ClampedArray([
    100, 150, 200, 255,
    20, 40, 60, 128,
  ]);
  const alpha = new Uint8ClampedArray([255, 128]);
  const output = applyAlphaOnceSourceOverWhite({ rgba, alpha, width: 2, height: 1 });
  assert.deepEqual([...output.slice(0, 4)], [100, 150, 200, 255]);
  assert.deepEqual([...output.slice(4, 8)], [196, 201, 206, 255]);
});

test('path helpers reject traversal and symlink escapes while allowing contained paths', async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), 'hc-offline-diag-'));
  const nested = path.join(root, 'assets');
  await mkdir(nested, { recursive: true });
  const filePath = path.join(nested, 'fixture.png');
  await writeFile(filePath, 'x');
  const canonicalRoot = await realpath(root);
  const resolved = await realpath(filePath);
  const canonical = resolved;

  assert.equal(isPathInsideRoot(canonicalRoot, canonical), true);
  assert.equal(isPathInsideRoot(canonicalRoot, path.join(canonicalRoot, 'assets', '..', 'assets', 'fixture.png')), true);
  assert.equal(isPathInsideRoot(canonicalRoot, path.join(canonicalRoot, '..', 'escape.png')), false);
  assert.equal(validateContainedPathCandidate(canonicalRoot, canonical, canonical), canonical);
  assert.throws(() => validateContainedPathCandidate(canonicalRoot, path.join(canonicalRoot, '..', 'escape.png'), canonical), /PATH_TRAVERSAL/);

  const outside = path.join(os.tmpdir(), `hc-offline-diag-outside-${process.pid}.png`);
  await writeFile(outside, 'y');
  const symlinkPath = path.join(root, 'linked.png');
  await symlink(outside, symlinkPath);
  const symlinkRealPath = await realpath(symlinkPath);
  assert.throws(() => validateContainedPathCandidate(canonicalRoot, symlinkPath, symlinkRealPath), /PATH_TRAVERSAL|SYMLINK_REJECTED/);
});

test('bounds helpers enforce the synthetic source and output ceilings', () => {
  assert.doesNotThrow(() => assertModelCaseBounds(4096, 4096, PRINTING_OFFLINE_MODEL_DIAGNOSTIC_MAX_SOURCE_BYTES));
  assert.throws(() => assertModelCaseBounds(4097, 4096, PRINTING_OFFLINE_MODEL_DIAGNOSTIC_MAX_SOURCE_BYTES), /SOURCE_DIMENSION_EXCEEDED/);
  assert.throws(() => assertModelCaseBounds(4096, 4096, PRINTING_OFFLINE_MODEL_DIAGNOSTIC_MAX_SOURCE_BYTES + 1), /SOURCE_BYTES_EXCEEDED/);
  assert.throws(() => assertModelCaseBounds(0, 1, 0), /WIDTH_INVALID/);
  assert.throws(() => assertModelCaseBounds(1, -1, 0), /HEIGHT_INVALID/);
  assert.throws(() => assertModelCaseBounds(1, 1, -1), /SOURCE_BYTES_INVALID/);
  assert.throws(() => assertModelCaseBounds(1, 1, Number.NaN), /SOURCE_BYTES_INVALID/);
  assert.equal(PRINTING_OFFLINE_MODEL_DIAGNOSTIC_MAX_DECODED_BYTES, 4096 * 4096 * 4);
  assert.equal(PRINTING_OFFLINE_MODEL_DIAGNOSTIC_MAX_OUTPUT_BYTES, 10 * 1024 * 1024);
  assert.equal(PRINTING_OFFLINE_MODEL_DIAGNOSTIC_TOTAL_MAX_OUTPUT_BYTES, 300 * 1024 * 1024);
});

test('output paths canonicalize existing parents and reject symlinked parent chains', async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), 'hc-offline-output-'));
  const nested = path.join(root, 'nested');
  await mkdir(nested);
  const output = path.join(nested, 'new', 'artifact.png');
  assert.equal(
    await assertOutputPathContained(root, output),
    path.join(await realpath(nested), 'new', 'artifact.png'),
  );
  await assert.rejects(assertOutputPathContained(root, path.join(root, '..', 'escape.png')), /OUTPUT_PATH_TRAVERSAL/);

  const outside = await mkdtemp(path.join(os.tmpdir(), 'hc-offline-outside-'));
  const linkedParent = path.join(root, 'linked-parent');
  await symlink(outside, linkedParent);
  await assert.rejects(
    assertOutputPathContained(root, path.join(linkedParent, 'artifact.png')),
    /OUTPUT_PATH_SYMLINK_REJECTED/,
  );
});

test('canonical manifest snapshot detects in-place mutation of the same object', () => {
  const manifest = {
    schemaVersion: 'printing-offline-model-diagnostic-v1',
    cases: [
      { id: 'case-a', output: 1, nested: { b: 2, a: 3 } },
      { id: 'case-b', output: 2 },
    ],
  };
  const first = canonicalManifestDigest(manifest);
  const second = canonicalManifestDigest(JSON.parse(JSON.stringify(manifest)));
  assert.equal(first, second);
  assert.doesNotThrow(() => assertCanonicalManifestUnchanged(first, manifest));
  manifest.cases[0].nested.a = 4;
  assert.notEqual(first, stableDigest(manifest));
  assert.throws(() => assertCanonicalManifestUnchanged(first, manifest), /CANONICAL_MANIFEST_CHANGED/);
  assert.throws(() => assertCanonicalManifestUnchanged('not-a-digest', manifest), /CANONICAL_MANIFEST_DIGEST_INVALID/);
});

test('clampByte fails closed around normalization bounds', () => {
  assert.equal(clampByte(-10), 0);
  assert.equal(clampByte(12.4), 12);
  assert.equal(clampByte(999), 255);
});
