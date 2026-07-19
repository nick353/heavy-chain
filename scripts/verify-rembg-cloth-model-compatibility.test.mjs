import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import {
  OFFICIAL_CLOTH_MODEL,
  parseCrop,
  runCompatibilityDiagnostic,
  summarizeClassMap,
} from './verify-rembg-cloth-model-compatibility.mjs';

test('official cloth model contract matches background plus three garment classes', () => {
  assert.deepEqual(OFFICIAL_CLOTH_MODEL.inputShape, [1, 3, 768, 768]);
  assert.deepEqual(OFFICIAL_CLOTH_MODEL.outputShape, [1, 4, 768, 768]);
  assert.equal(OFFICIAL_CLOTH_MODEL.bytes, 176194565);
  assert.equal(OFFICIAL_CLOTH_MODEL.sha256.length, 64);
});

test('crop parser accepts a bounded rectangle and rejects invalid dimensions', () => {
  assert.deepEqual(parseCrop('543,95,217,288'), { left: 543, top: 95, width: 217, height: 288 });
  assert.throws(() => parseCrop('1,2,0,4'), /crop_must_be_left_top_width_height/);
  assert.throws(() => parseCrop('1,2,3'), /crop_must_be_left_top_width_height/);
  assert.throws(() => parseCrop('1x,2,3,4'), /crop_must_be_left_top_width_height/);
  assert.throws(() => parseCrop('1.9,2,3,4'), /crop_must_be_left_top_width_height/);
  assert.throws(() => parseCrop('0x10,2,3,4'), /crop_must_be_left_top_width_height/);
});

test('class summary keeps upper, lower, and full distinct', () => {
  const summary = summarizeClassMap(Uint8Array.from([0, 1, 1, 2, 3, 3, 3]));
  assert.equal(summary.background.pixels, 1);
  assert.equal(summary.categories.upper.pixels, 2);
  assert.equal(summary.categories.lower.pixels, 1);
  assert.equal(summary.categories.full.pixels, 3);
});

test('a failed rerun replaces stale success evidence and removes old masks', async () => {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), 'cloth-model-compatibility-'));
  const modelPath = path.join(directory, 'invalid.onnx');
  await fs.writeFile(modelPath, 'not-an-onnx-model');
  await fs.writeFile(path.join(directory, 'compatibility.json'), '{"ok":true}\n');
  await fs.writeFile(path.join(directory, 'upper-mask.png'), 'stale-mask');
  await assert.rejects(() => runCompatibilityDiagnostic({
    modelPath,
    imagePath: path.join(directory, 'unused.png'),
    outputDir: directory,
  }), /cloth_model_identity_mismatch/);
  const evidence = JSON.parse(await fs.readFile(path.join(directory, 'compatibility.json'), 'utf8'));
  assert.equal(evidence.ok, false);
  assert.equal(evidence.status, 'failed');
  assert.match(evidence.exactBlocker, /cloth_model_identity_mismatch/);
  await assert.rejects(() => fs.access(path.join(directory, 'upper-mask.png')));
  await fs.rm(directory, { recursive: true, force: true });
});

test('CLI crop validation also replaces stale evidence before failing', async () => {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), 'cloth-model-compatibility-cli-'));
  await fs.writeFile(path.join(directory, 'compatibility.json'), '{"ok":true}\n');
  await fs.writeFile(path.join(directory, 'category-mask.png'), 'stale-mask');
  const result = spawnSync(process.execPath, [
    'scripts/verify-rembg-cloth-model-compatibility.mjs',
    '--model=/unused/model.onnx',
    '--image=/unused/image.png',
    `--output-dir=${directory}`,
    '--crop=1x,2,3,4',
  ], {
    cwd: process.cwd(),
    encoding: 'utf8',
  });
  assert.equal(result.status, 1);
  assert.doesNotMatch(result.stderr, /at parseCrop/);
  const evidence = JSON.parse(await fs.readFile(path.join(directory, 'compatibility.json'), 'utf8'));
  assert.equal(evidence.ok, false);
  assert.equal(evidence.status, 'failed');
  assert.equal(evidence.exactBlocker, 'crop_must_be_left_top_width_height');
  await assert.rejects(() => fs.access(path.join(directory, 'category-mask.png')));
  await fs.rm(directory, { recursive: true, force: true });
});
