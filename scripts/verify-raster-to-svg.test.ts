import assert from 'node:assert/strict';
import test from 'node:test';
import { simplifyLoop, traceLabel, tracePixelsToSvg, type RasterPixels } from '../src/lib/rasterToSvg.ts';

const image = (width: number, height: number, paint: (x: number, y: number) => [number, number, number]): RasterPixels => {
  const data = new Uint8ClampedArray(width * height * 4);
  for (let y = 0; y < height; y++) for (let x = 0; x < width; x++) {
    const [r, g, b] = paint(x, y);
    data.set([r, g, b, 255], (y * width + x) * 4);
  }
  return { width, height, data };
};

test('a filled square on white becomes one red path with the square outline and no background path', () => {
  const pixels = image(8, 8, (x, y) => (x >= 2 && x < 5 && y >= 3 && y < 6 ? [220, 20, 30] : [255, 255, 255]));
  const { svg, colors, pathCount } = tracePixelsToSvg(pixels, { colors: 4, simplify: 0, minArea: 1 });
  assert.equal(pathCount, 1);
  assert.equal(colors.length, 1);
  assert.match(colors[0], /^#d[0-9a-f]1[0-9a-f]1[0-9a-f]$/);
  assert.match(svg, /^<svg xmlns="http:\/\/www\.w3\.org\/2000\/svg" viewBox="0 0 8 8"/);
  const d = /d="([^"]+)"/.exec(svg)?.[1] ?? '';
  const points = [...d.matchAll(/(\d+) (\d+)/g)].map((m) => `${m[1]},${m[2]}`).sort();
  assert.deepEqual(points, ['2,3', '2,6', '5,3', '5,6']);
});

test('a ring keeps its hole as a second loop rendered with evenodd', () => {
  const pixels = image(9, 9, (x, y) => {
    const ring = x >= 1 && x < 8 && y >= 1 && y < 8 && !(x >= 3 && x < 6 && y >= 3 && y < 6);
    return ring ? [20, 60, 200] : [255, 255, 255];
  });
  const labels = new Uint8Array(81).map((_, i) => {
    const x = i % 9, y = Math.floor(i / 9);
    return x >= 1 && x < 8 && y >= 1 && y < 8 && !(x >= 3 && x < 6 && y >= 3 && y < 6) ? 1 : 0;
  });
  assert.equal(traceLabel(labels, 9, 9, 1).length, 2);
  const { svg } = tracePixelsToSvg(pixels, { colors: 2, simplify: 0, minArea: 1 });
  assert.match(svg, /fill-rule="evenodd"/);
  assert.equal((svg.match(/M/g) ?? []).length, 2);
});

test('straight pixel runs collapse to corners only', () => {
  const loop: [number, number][] = [[0, 0], [1, 0], [2, 0], [2, 1], [2, 2], [1, 2], [0, 2], [0, 1]];
  assert.deepEqual(simplifyLoop(loop, 0), [[0, 0], [2, 0], [2, 2], [0, 2]]);
});

test('multiple colours each get their own path and transparent pixels count as background', () => {
  const width = 10, height = 4;
  const data = new Uint8ClampedArray(width * height * 4);
  for (let y = 0; y < height; y++) for (let x = 0; x < width; x++) {
    const i = (y * width + x) * 4;
    if (y === 0 || y === 3) data.set([0, 0, 0, 0], i);
    else data.set(x < 5 ? [0, 160, 0, 255] : [240, 200, 0, 255], i);
  }
  const { pathCount, colors } = tracePixelsToSvg({ width, height, data }, { colors: 4, minArea: 1 });
  assert.equal(pathCount, 2);
  assert.equal(new Set(colors).size, 2);
});
