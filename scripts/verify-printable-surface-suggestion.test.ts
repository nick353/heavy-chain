import assert from 'node:assert/strict';
import test from 'node:test';

import {
  PrintableSurfaceSuggestionValidationError,
  suggestPrintableSurface,
} from '../src/features/printing/surface/suggestPrintableSurface.ts';

const shape = (width: number, height: number) => {
  const alpha = new Uint8ClampedArray(width * height);
  const fill = (left: number, top: number, right: number, bottom: number, value = 255) => {
    for (let y = top; y <= bottom; y += 1) {
      for (let x = left; x <= right; x += 1) alpha[(y * width) + x] = value;
    }
  };
  return { alpha, fill };
};

test('suggests a conservative torso panel while excluding sleeves, collar, and hem', () => {
  const { alpha, fill } = shape(160, 180);
  fill(45, 35, 115, 160);
  fill(20, 40, 140, 75);
  fill(75, 35, 85, 50, 0);
  const result = suggestPrintableSurface({ width: 160, height: 180, garmentAlpha: alpha });
  assert.equal(result.kind, 'success');
  if (result.kind !== 'success') return;
  assert.equal(result.provenance, 'deterministic-central-panel-suggestion');
  assert.equal(result.alpha[(60 * 160) + 25], 0, 'sleeve is excluded');
  assert.equal(result.alpha[(42 * 160) + 80], 0, 'collar/top zone is excluded');
  assert.equal(result.alpha[(155 * 160) + 80], 0, 'hem zone is excluded');
  assert.ok(result.alpha[(100 * 160) + 80] > 0, 'central torso remains printable');
  for (let index = 0; index < alpha.length; index += 1) assert.ok(result.alpha[index] <= alpha[index]);
  assert.ok(result.diagnostics.confidence >= 0.55);
});

test('retains partial garment alpha and is deterministic', () => {
  const { alpha, fill } = shape(160, 180);
  fill(40, 30, 120, 165);
  alpha[(100 * 160) + 80] = 128;
  const first = suggestPrintableSurface({ width: 160, height: 180, garmentAlpha: alpha });
  const second = suggestPrintableSurface({ width: 160, height: 180, garmentAlpha: alpha });
  assert.equal(first.kind, 'success');
  assert.equal(second.kind, 'success');
  if (first.kind !== 'success' || second.kind !== 'success') return;
  assert.deepEqual(first.alpha, second.alpha);
  assert.ok(first.alpha[(100 * 160) + 80] > 0);
  assert.ok(first.alpha[(100 * 160) + 80] <= 128);
  assert.deepEqual(first.diagnostics, second.diagnostics);
});

test('rejects multiple disconnected foreground components', () => {
  const { alpha, fill } = shape(180, 180);
  fill(15, 25, 70, 155);
  fill(110, 25, 165, 155);
  const result = suggestPrintableSurface({ width: 180, height: 180, garmentAlpha: alpha });
  assert.equal(result.kind, 'fallback-required');
  if (result.kind === 'fallback-required') assert.equal(result.reason, 'MULTIPLE_COMPONENTS');
});

test('preserves a narrow transparent gap at source resolution when detecting components', () => {
  const { alpha, fill } = shape(1_000, 1_000);
  fill(300, 100, 700, 900);
  fill(705, 400, 904, 599);
  const result = suggestPrintableSurface({ width: 1_000, height: 1_000, garmentAlpha: alpha });
  assert.equal(result.kind, 'fallback-required');
  if (result.kind === 'fallback-required') {
    assert.equal(result.reason, 'MULTIPLE_COMPONENTS');
    assert.ok(result.diagnostics.mainComponentRatio < 0.9);
  }
});

test('rejects garments touching the source frame', () => {
  const { alpha, fill } = shape(160, 180);
  fill(0, 20, 120, 170);
  const result = suggestPrintableSurface({ width: 160, height: 180, garmentAlpha: alpha });
  assert.equal(result.kind, 'fallback-required');
  if (result.kind === 'fallback-required') assert.equal(result.reason, 'FRAME_CROPPED');
});

test('rejects a connected garment with a wide centerline gap', () => {
  const { alpha, fill } = shape(180, 200);
  fill(25, 25, 70, 175);
  fill(110, 25, 155, 175);
  fill(25, 25, 155, 45);
  fill(25, 160, 155, 175);
  const result = suggestPrintableSurface({ width: 180, height: 200, garmentAlpha: alpha });
  assert.equal(result.kind, 'fallback-required');
  if (result.kind === 'fallback-required') assert.equal(result.reason, 'CENTERLINE_GAP');
});

test('rejects an unstable alternating torso profile', () => {
  const { alpha, fill } = shape(200, 220);
  for (let y = 25; y <= 195; y += 1) {
    const halfWidth = Math.floor(y / 8) % 2 === 0 ? 24 : 70;
    fill(100 - halfWidth, y, 100 + halfWidth, y);
  }
  const result = suggestPrintableSurface({ width: 200, height: 220, garmentAlpha: alpha });
  assert.equal(result.kind, 'fallback-required');
  if (result.kind === 'fallback-required') assert.equal(result.reason, 'PROFILE_UNSTABLE');
});

test('rejects empty and too-small printable areas with typed fallback', () => {
  const empty = suggestPrintableSurface({ width: 80, height: 80, garmentAlpha: new Uint8ClampedArray(80 * 80) });
  assert.equal(empty.kind, 'fallback-required');
  if (empty.kind === 'fallback-required') assert.equal(empty.reason, 'EMPTY_GARMENT');

  const { alpha, fill } = shape(40, 40);
  fill(10, 8, 30, 32);
  const small = suggestPrintableSurface({ width: 40, height: 40, garmentAlpha: alpha });
  assert.equal(small.kind, 'fallback-required');
  if (small.kind === 'fallback-required') assert.equal(small.reason, 'PRINTABLE_AREA_TOO_SMALL');
});

test('rejects malformed dimensions, length, and pixel budgets', () => {
  assert.throws(
    () => suggestPrintableSurface({ width: 0, height: 2, garmentAlpha: new Uint8ClampedArray() }),
    (error: unknown) => error instanceof PrintableSurfaceSuggestionValidationError && error.code === 'SUGGESTION_DIMENSIONS_INVALID',
  );
  assert.throws(
    () => suggestPrintableSurface({ width: 2, height: 2, garmentAlpha: new Uint8ClampedArray(3) }),
    (error: unknown) => error instanceof PrintableSurfaceSuggestionValidationError && error.code === 'SUGGESTION_ALPHA_LENGTH_INVALID',
  );
  assert.throws(
    () => suggestPrintableSurface({ width: 4_001, height: 4_000, garmentAlpha: new Uint8ClampedArray() }),
    (error: unknown) => error instanceof PrintableSurfaceSuggestionValidationError && error.code === 'SUGGESTION_PIXEL_LIMIT_EXCEEDED',
  );
});
