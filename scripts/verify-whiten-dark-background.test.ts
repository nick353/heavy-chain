import assert from 'node:assert/strict';
import test from 'node:test';
import { whitenDarkBackgroundPixels } from '../src/lib/whitenDarkBackground.ts';

const image = (w: number, h: number, bg: [number, number, number], motif: [number, number, number]) => {
  const data = new Uint8ClampedArray(w * h * 4);
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
    const inMotif = x > w / 4 && x < (3 * w) / 4 && y > h / 4 && y < (3 * h) / 4;
    const c = inMotif ? motif : bg; const i = (y * w + x) * 4;
    data[i] = c[0]; data[i + 1] = c[1]; data[i + 2] = c[2]; data[i + 3] = 255;
  }
  return data;
};

test('a flat black background becomes white and the motif colour is kept', () => {
  const data = image(64, 64, [0, 0, 0], [80, 160, 220]);
  assert.equal(whitenDarkBackgroundPixels(data, 64, 64), true);
  assert.deepEqual([...data.slice(0, 4)], [255, 255, 255, 255]);
  const centre = (32 * 64 + 32) * 4;
  assert.deepEqual([...data.slice(centre, centre + 3)], [80, 160, 220]);
});

test('light backgrounds are left untouched', () => {
  const data = image(64, 64, [240, 240, 240], [0, 0, 0]);
  const before = data.slice();
  assert.equal(whitenDarkBackgroundPixels(data, 64, 64), false);
  assert.deepEqual(data, before);
});

test('a non-uniform dark border (photo-like) is left untouched', () => {
  const data = image(64, 64, [10, 10, 10], [200, 50, 50]);
  for (let x = 0; x < 64; x += 2) { const i = x * 4; data[i] = 200; data[i + 1] = 200; data[i + 2] = 0; }
  for (let y = 0; y < 64; y += 2) { const i = (y * 64) * 4; data[i] = 200; data[i + 1] = 200; data[i + 2] = 0; }
  const before = data.slice();
  assert.equal(whitenDarkBackgroundPixels(data, 64, 64), false);
  assert.deepEqual(data, before);
});
