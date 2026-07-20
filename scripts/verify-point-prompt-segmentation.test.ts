import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';
import { fileURLToPath } from 'node:url';
import sharp from 'sharp';

import {
  fillEnclosedPointPromptMaskHoles,
  selectPointPromptCandidate,
} from '../src/features/printing/selection/pointPromptSegmentation.ts';

const source = readFileSync(
  new URL('../src/features/printing/selection/pointPromptSegmentation.ts', import.meta.url),
  'utf8',
);
const workerSource = readFileSync(
  new URL('../src/features/printing/selection/pointPromptSegmentation.worker.ts', import.meta.url),
  'utf8',
);

test('point-prompt runtime uses a deployable module worker, retryable single-threaded WASM, and one operator point', () => {
  assert.match(source, /new Worker\(new URL\('\.\/pointPromptSegmentation\.worker\.ts', import\.meta\.url\)/);
  assert.match(source, /type: 'module'/);
  assert.match(workerSource, /const pointPromptEnv = import\.meta\.env \?\? \{\}/);
  assert.match(workerSource, /ort\.env\.wasm\.proxy = false/);
  assert.match(workerSource, /ort\.env\.wasm\.numThreads = 1/);
  assert.match(workerSource, /\.catch\(\(error\) => \{\s*sessionsPromise = null/);
  assert.match(workerSource, /new Float32Array\(\[point\.x, point\.y\]\)/);
  assert.match(workerSource, /\[1, 1, 1, 2\]/);
  assert.doesNotMatch(workerSource, /nearCenter|promptPoints|width - point\.x/);
});

test('point-prompt candidate selector keeps the compact credible instance near the best IoU', () => {
  const width = 5;
  const height = 5;
  const plane = width * height;
  const logits = new Float32Array(plane * 3).fill(-4);
  const selectRect = (candidate: number, left: number, top: number, right: number, bottom: number) => {
    for (let y = top; y < bottom; y += 1) {
      for (let x = left; x < right; x += 1) logits[(candidate * plane) + (y * width) + x] = 1;
    }
  };
  selectRect(0, 0, 0, 5, 5);
  selectRect(1, 1, 1, 4, 4);
  selectRect(2, 0, 1, 5, 4);

  const selected = selectPointPromptCandidate({
    logits,
    iouPredictions: new Float32Array([0.92, 0.81, 0.88]),
    width,
    height,
    point: { x: 2, y: 2 },
  });

  assert.equal(selected.index, 1);
  assert.equal(selected.selectedPixels, 9);
  assert.deepEqual(selected.bbox, { x: 1, y: 1, width: 3, height: 3 });
});

test('point-prompt candidate selector rejects a tiny low-IoU fragment even when it is smallest', () => {
  const width = 10;
  const height = 10;
  const plane = width * height;
  const logits = new Float32Array(plane * 2).fill(-4);
  for (let y = 4; y < 6; y += 1) {
    for (let x = 4; x < 6; x += 1) logits[(y * width) + x] = 1;
  }
  for (let y = 2; y < 8; y += 1) {
    for (let x = 2; x < 8; x += 1) logits[plane + (y * width) + x] = 1;
  }
  const selected = selectPointPromptCandidate({
    logits,
    iouPredictions: new Float32Array([0.2, 0.8]),
    width,
    height,
    point: { x: 5, y: 5 },
  });
  assert.equal(selected.index, 1);
});

test('point-prompt candidate selector fails closed when only unsafe masks contain the tap', () => {
  const width = 10;
  const height = 10;
  const plane = width * height;
  const logits = new Float32Array(plane).fill(1);
  assert.throws(() => selectPointPromptCandidate({
    logits,
    iouPredictions: new Float32Array([0.99]),
    width,
    height,
    point: { x: 5, y: 5 },
  }), /point_prompt_mask_candidate_unsafe/);
});

test('point-prompt candidate selector rejects candidates that miss the tap', () => {
  const logits = new Float32Array(4 * 4 * 3).fill(-4);
  assert.throws(() => selectPointPromptCandidate({
    logits,
    iouPredictions: new Float32Array([0.9, 0.8, 0.7]),
    width: 4,
    height: 4,
    point: { x: 2, y: 2 },
  }), /point_prompt_mask_candidate_missing/);
});

test('point-prompt mask fills enclosed garment texture holes but preserves openings connected to the exterior', () => {
  const width = 7;
  const height = 7;
  const mask = new Uint8Array(width * height);
  for (let y = 1; y < 6; y += 1) {
    for (let x = 1; x < 6; x += 1) mask[(y * width) + x] = 1;
  }
  mask[(3 * width) + 3] = 0;
  mask[(1 * width) + 2] = 0;
  mask[(2 * width) + 2] = 0;
  const filled = fillEnclosedPointPromptMaskHoles(mask, width, height);
  assert.equal(filled[(3 * width) + 3], 1);
  assert.equal(filled[(1 * width) + 2], 0);
  assert.equal(filled[(2 * width) + 2], 0);
});

test('canonical black-hoodie chest and sleeve masks converge after bounded hole fill', async () => {
  const loadMask = async (name: 'chest' | 'sleeve') => {
    const { data, info } = await sharp(fileURLToPath(new URL(
      `./fixtures/efficient-sam-ti-black-hoodie-${name}-candidate-1-thm1.png`,
      import.meta.url,
    ))).greyscale().raw().toBuffer({ resolveWithObject: true });
    assert.equal(info.width, 1024);
    assert.equal(info.height, 1536);
    return fillEnclosedPointPromptMaskHoles(new Uint8Array(data), info.width, info.height);
  };
  const [chest, sleeve] = await Promise.all([loadMask('chest'), loadMask('sleeve')]);
  let intersection = 0;
  let union = 0;
  for (let pixel = 0; pixel < chest.length; pixel += 1) {
    if (chest[pixel] && sleeve[pixel]) intersection += 1;
    if (chest[pixel] || sleeve[pixel]) union += 1;
  }
  assert.ok(intersection / union >= 0.95, `canonical tap mask IoU was ${intersection / union}`);
});

test('canonical black-hoodie sleeve accepts the measured peripheral low-confidence candidate only', async () => {
  const { data, info } = await sharp(fileURLToPath(new URL(
    './fixtures/efficient-sam-ti-black-hoodie-sleeve-candidate-1-thm1.png',
    import.meta.url,
  ))).greyscale().raw().toBuffer({ resolveWithObject: true });
  const logits = new Float32Array(info.width * info.height);
  for (let pixel = 0; pixel < logits.length; pixel += 1) {
    logits[pixel] = data[pixel] ? 1 : -4;
  }

  const sleeve = selectPointPromptCandidate({
    logits,
    iouPredictions: new Float32Array([0.4184]),
    width: info.width,
    height: info.height,
    point: { x: 202, y: 765 },
  });
  assert.equal(sleeve.index, 0);
  assert.equal(sleeve.touchesFrame, false);

  assert.throws(() => selectPointPromptCandidate({
    logits,
    iouPredictions: new Float32Array([0.4184]),
    width: info.width,
    height: info.height,
    point: { x: 512, y: 765 },
  }), /point_prompt_mask_candidate_unsafe/);
});
