import assert from 'node:assert/strict';
import test from 'node:test';

import { polishCutoutAlpha } from '../src/features/printing/matte/polishCutoutAlpha.ts';

const pixel = (rgba: Uint8ClampedArray, width: number, x: number, y: number) => ((y * width) + x) * 4;

test('cutout alpha polish removes tiny islands and softens only the binary contour', () => {
  const width = 8;
  const height = 8;
  const input = new Uint8ClampedArray(width * height * 4);
  for (let y = 2; y < 6; y += 1) {
    for (let x = 2; x < 6; x += 1) {
      const offset = pixel(input, width, x, y);
      input[offset] = 32;
      input[offset + 1] = 64;
      input[offset + 2] = 96;
      input[offset + 3] = 255;
    }
  }
  const island = pixel(input, width, 0, 0);
  input[island] = 240;
  input[island + 1] = 10;
  input[island + 2] = 10;
  input[island + 3] = 255;

  const output = polishCutoutAlpha({ rgba: input, width, height });
  assert.equal(output[island + 3], 0);
  assert.equal(output[pixel(output, width, 3, 3) + 3], 255);
  assert.ok(output[pixel(output, width, 1, 3) + 3] > 0);
  assert.ok(output[pixel(output, width, 1, 3) + 3] < 255);
  assert.deepEqual(
    [...output.slice(pixel(output, width, 3, 3), pixel(output, width, 3, 3) + 3)],
    [32, 64, 96],
  );
});

test('cutout alpha polish rejects malformed input', () => {
  assert.throws(
    () => polishCutoutAlpha({ rgba: new Uint8ClampedArray(3), width: 1, height: 1 }),
    /CUTOUT_ALPHA_POLISH_INVALID_INPUT/,
  );
});
