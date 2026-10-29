import { test } from 'node:test';
import assert from 'node:assert/strict';
import { isLineArt, tracePixelsToSvg } from '../src/lib/rasterToSvg.ts';

/** A white sheet with grey anti-aliased strokes, like a 平絵 the AI returns. */
const sheet = (width: number, height: number, paint: (x: number, y: number) => [number, number, number]) => {
  const data = new Uint8ClampedArray(width * height * 4);
  for (let y = 0; y < height; y++) for (let x = 0; x < width; x++) {
    const [r, g, b] = paint(x, y);
    data.set([r, g, b, 255], (y * width + x) * 4);
  }
  return { width, height, data };
};
// A box outline 3px wide whose middle is black and whose edges are soft greys.
const stroke = (x: number, y: number) => {
  const edge = Math.min(Math.abs(x - 20), Math.abs(x - 80), Math.abs(y - 20), Math.abs(y - 80));
  const inside = x >= 19 && x <= 81 && y >= 19 && y <= 81;
  if (!inside || edge > 1) return [255, 255, 255] as [number, number, number];
  const level = edge === 0 ? 20 : 150;
  return [level, level, level] as [number, number, number];
};

test('grey line art is traced as one ink colour so strokes stay whole', () => {
  const art = sheet(100, 100, stroke);
  assert.equal(isLineArt(art), true);
  const traced = tracePixelsToSvg(art, { colors: 6 });
  assert.equal(traced.colors.length, 1);
  assert.equal(traced.pathCount, 1);
});

test('colour artwork and pale fabric keep the colour tracer', () => {
  const print = sheet(100, 100, (x, y) => ((x + y) % 20 < 10 ? [200, 40, 60] : [255, 255, 255]));
  assert.equal(isLineArt(print), false);
  const cream = sheet(100, 100, (x, y) => ((x * 7 + y) % 50 === 0 ? [30, 30, 30] : [236, 228, 216]));
  assert.equal(isLineArt(cream), false);
  assert.ok(tracePixelsToSvg(print, { colors: 4 }).colors.length >= 1);
});
