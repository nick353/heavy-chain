import test from 'node:test';
import assert from 'node:assert/strict';
import { refineCoarseGarmentMask } from '../src/features/printing/selection/refineCoarseGarmentMask.ts';

const makeRgba = (width: number, height: number, color: [number, number, number, number]) => {
  const rgba = new Uint8ClampedArray(width * height * 4);
  for (let index = 0; index < width * height; index += 1) rgba.set(color, index * 4);
  return rgba;
};

const setPixel = (rgba: Uint8ClampedArray, width: number, x: number, y: number, color: [number, number, number, number]) => {
  rgba.set(color, ((y * width) + x) * 4);
};

test('refines a coarse rectangular cloth mask against the model appearance', () => {
  const width = 100;
  const height = 120;
  const source = makeRgba(width, height, [54, 126, 72, 255]);
  const mask = makeRgba(width, height, [0, 0, 0, 0]);
  for (let y = 30; y <= 96; y += 1) {
    for (let x = 20; x <= 80; x += 1) {
      mask[((y * width) + x) * 4 + 3] = 255;
    }
  }
  for (let y = 38; y <= 94; y += 1) {
    for (let x = 36; x <= 64; x += 1) setPixel(source, width, x, y, [184, 172, 154, 255]);
  }
  for (let y = 46; y <= 88; y += 1) {
    for (let x = 24; x <= 35; x += 1) setPixel(source, width, x, y, [178, 166, 150, 255]);
    for (let x = 65; x <= 76; x += 1) setPixel(source, width, x, y, [178, 166, 150, 255]);
  }

  const result = refineCoarseGarmentMask({
    mask,
    source,
    width,
    height,
    modelBounds: { left: 0, top: 0, right: width - 1, bottom: height - 1 },
  });

  assert.equal(result.coarseMaskWasRectangular, true);
  assert.equal(result.refined, true);
  assert.equal(result.alpha[(35 * width) + 25], 0);
  assert.equal(result.alpha[(60 * width) + 50], 255);
  assert.ok(result.alpha.reduce((sum, value) => sum + (value > 0 ? 1 : 0), 0) < 61 * 67 * 0.82);
});

test('does not rewrite an already contoured garment mask', () => {
  const width = 20;
  const height = 20;
  const source = makeRgba(width, height, [150, 150, 150, 255]);
  const mask = makeRgba(width, height, [0, 0, 0, 0]);
  for (let y = 4; y <= 15; y += 1) {
    for (let x = 6; x <= 13; x += 1) {
      if (y === 4 || y === 15 || x === 6 || x === 13 || Math.abs(x - 9) + Math.abs(y - 9) < 5) {
        mask[((y * width) + x) * 4 + 3] = 255;
      }
    }
  }
  const result = refineCoarseGarmentMask({
    mask,
    source,
    width,
    height,
    modelBounds: { left: 0, top: 0, right: width - 1, bottom: height - 1 },
  });
  assert.equal(result.coarseMaskWasRectangular, false);
  assert.equal(result.refined, false);
  assert.deepEqual(result.alpha, Uint8ClampedArray.from({ length: width * height }, (_value, index) => mask[(index * 4) + 3]));
});

test('fails closed when a rectangular mask has no separable appearance', () => {
  const width = 40;
  const height = 40;
  const source = makeRgba(width, height, [120, 120, 120, 255]);
  const mask = makeRgba(width, height, [0, 0, 0, 0]);
  for (let y = 8; y <= 31; y += 1) {
    for (let x = 8; x <= 31; x += 1) mask[((y * width) + x) * 4 + 3] = 255;
  }
  const result = refineCoarseGarmentMask({
    mask,
    source,
    width,
    height,
    modelBounds: { left: 0, top: 0, right: width - 1, bottom: height - 1 },
  });
  assert.equal(result.coarseMaskWasRectangular, true);
  assert.equal(result.refined, false);
});
