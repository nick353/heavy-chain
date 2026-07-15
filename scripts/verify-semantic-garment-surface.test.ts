import assert from 'node:assert/strict';
import test from 'node:test';

import {
  buildSemanticGarmentSurface,
  semanticRegionPixelCounts,
} from '../src/features/printing/surface/semanticGarmentSurface.ts';

const shape = (width: number, height: number) => {
  const alpha = new Uint8ClampedArray(width * height);
  const fill = (left: number, top: number, right: number, bottom: number, value = 255) => {
    for (let y = top; y <= bottom; y += 1) {
      for (let x = left; x <= right; x += 1) alpha[(y * width) + x] = value;
    }
  };
  return { alpha, fill };
};

test('builds a manual-ready deterministic surface proposal with explicit torso and peripheral regions', () => {
  const width = 160;
  const height = 180;
  const { alpha, fill } = shape(width, height);
  fill(45, 35, 115, 160);
  fill(20, 40, 140, 75);
  fill(75, 35, 85, 50, 0);

  const result = buildSemanticGarmentSurface({ width, height, garmentAlpha: alpha });
  assert.equal(result.kind, 'success');
  if (result.kind !== 'success') return;

  assert.equal(result.provenance, 'deterministic-alpha-structure-v1');
  assert.equal(result.surface.status, 'manual-ready');
  assert.ok(result.surface.confidence >= 0.55);
  assert.ok(result.regions.torso.alpha[(100 * width) + 80] > 0);
  assert.equal(result.surface.printableAlpha[(60 * width) + 25], 0, 'left sleeve is excluded');
  assert.equal(result.surface.printableAlpha[(42 * width) + 80], 0, 'collar is excluded');
  assert.equal(result.surface.printableAlpha[(155 * width) + 80], 0, 'hem is excluded');

  const counts = semanticRegionPixelCounts(result.regions);
  assert.equal(counts.torso, result.diagnostics.regionPixels.torso);
  assert.ok(counts['sleeve-left'] > 0);
  assert.ok(counts['sleeve-right'] > 0);
  assert.ok(counts.collar > 0);
  assert.ok(counts.hem > 0);
  assert.ok(result.diagnostics.forbiddenPixels > 0);
});

test('preserves partial alpha and never expands beyond the garment plane', () => {
  const width = 160;
  const height = 180;
  const { alpha, fill } = shape(width, height);
  fill(40, 30, 120, 165);
  alpha[(100 * width) + 80] = 128;

  const result = buildSemanticGarmentSurface({ width, height, garmentAlpha: alpha });
  assert.equal(result.kind, 'success');
  if (result.kind !== 'success') return;
  for (let index = 0; index < alpha.length; index += 1) {
    assert.ok(result.surface.printableAlpha[index] <= alpha[index]);
  }
  assert.ok(result.surface.printableAlpha[(100 * width) + 80] > 0);
  assert.ok(result.surface.printableAlpha[(100 * width) + 80] <= 128);
});

test('delegates uncertain shapes to the existing fallback instead of guessing', () => {
  const width = 180;
  const height = 180;
  const { alpha, fill } = shape(width, height);
  fill(15, 25, 70, 155);
  fill(110, 25, 165, 155);
  const result = buildSemanticGarmentSurface({ width, height, garmentAlpha: alpha });
  assert.equal(result.kind, 'fallback-required');
  if (result.kind === 'fallback-required') assert.equal(result.reason, 'MULTIPLE_COMPONENTS');
});

test('is deterministic for the same source alpha', () => {
  const width = 140;
  const height = 160;
  const { alpha, fill } = shape(width, height);
  fill(32, 24, 108, 145);
  const first = buildSemanticGarmentSurface({ width, height, garmentAlpha: alpha });
  const second = buildSemanticGarmentSurface({ width, height, garmentAlpha: alpha });
  assert.deepEqual(first, second);
});
