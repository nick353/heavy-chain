import assert from 'node:assert/strict';
import test from 'node:test';

import { rasterizeGuidedMaskAlpha } from '../src/features/printing/selection/guidedMaskRasterization.ts';

test('guided mask rasterization produces partial contour coverage instead of a binary staircase', () => {
  const alpha = rasterizeGuidedMaskAlpha({
    mask: new Uint8Array([
      0, 0, 0, 0,
      0, 1, 1, 1,
      0, 1, 1, 1,
      0, 1, 1, 1,
    ]),
    maskWidth: 4,
    maskHeight: 4,
    outputWidth: 5,
    outputHeight: 5,
    sourceImageWidth: 4,
    sourceImageHeight: 4,
    context: { x: 0, y: 0, width: 4, height: 4 },
    samplesPerPixel: 4,
  });

  assert.equal(alpha[0], 0);
  assert.equal(alpha[24], 255);
  assert.ok(alpha.some((value) => value > 0 && value < 255));
  assert.ok(alpha[6] >= alpha[1]);
  assert.ok(alpha[18] >= alpha[13]);
});

test('guided mask rasterization keeps fully selected and excluded regions exact', () => {
  const alpha = rasterizeGuidedMaskAlpha({
    mask: new Uint8Array([1, 1, 0, 0]),
    maskWidth: 4,
    maskHeight: 1,
    outputWidth: 5,
    outputHeight: 1,
    sourceImageWidth: 4,
    sourceImageHeight: 1,
    context: { x: 0, y: 0, width: 4, height: 1 },
    samplesPerPixel: 4,
  });

  assert.equal(alpha[0], 255);
  assert.equal(alpha[1], 255);
  assert.equal(alpha[4], 0);
  assert.ok(alpha[2] > 0 && alpha[2] < 255);
  assert.equal(alpha[3], 0);
});

test('guided mask rasterization rejects malformed dimensions', () => {
  assert.throws(
    () => rasterizeGuidedMaskAlpha({
      mask: new Uint8Array(2),
      maskWidth: 2,
      maskHeight: 2,
      outputWidth: 1,
      outputHeight: 1,
      sourceImageWidth: 1,
      sourceImageHeight: 1,
      context: { x: 0, y: 0, width: 1, height: 1 },
    }),
    /GUIDED_MASK_RASTERIZATION_INVALID_INPUT/,
  );
});
