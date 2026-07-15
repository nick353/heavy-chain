import test from 'node:test';
import assert from 'node:assert/strict';

import { buildPointGuidedSelection } from '../src/features/printing/selection/pointGuidedSelection.ts';

const makeImage = (width: number, height: number, paint: (x: number, y: number) => [number, number, number]) => {
  const data = new Uint8ClampedArray(width * height * 4);
  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) {
      const offset = (y * width + x) * 4;
      const [r, g, b] = paint(x, y);
      data[offset] = r;
      data[offset + 1] = g;
      data[offset + 2] = b;
      data[offset + 3] = 255;
    }
  }
  return data;
};

test('point-guided selection finds a bounded garment-colored component', () => {
  const width = 120;
  const height = 100;
  const data = makeImage(width, height, (x, y) => {
    const garment = x >= 34 && x < 86 && y >= 16 && y < 84;
    return garment ? [24, 110, 180] : [248, 248, 248];
  });
  const result = buildPointGuidedSelection({ width, height, data, point: { x: 60, y: 50 } });
  assert.equal(result.source, 'color-region');
  assert.ok(result.confidence >= 0.64);
  assert.ok(result.x < 34 && result.y < 16);
  assert.ok(result.x + result.width > 86 && result.y + result.height > 84);
});

test('point-guided selection falls back to a bounded neighborhood when the tap matches the frame', () => {
  const width = 100;
  const height = 100;
  const data = makeImage(width, height, () => [248, 248, 248]);
  const result = buildPointGuidedSelection({ width, height, data, point: { x: 50, y: 50 } });
  assert.equal(result.source, 'tap-neighborhood');
  assert.equal(result.selectedPixels, 0);
  assert.ok(result.width < width);
  assert.ok(result.height < height);
});

test('low-confidence fallback biases the crop below the tap toward the garment torso', () => {
  const width = 200;
  const height = 300;
  const data = makeImage(width, height, () => [248, 248, 248]);
  const result = buildPointGuidedSelection({ width, height, data, point: { x: 100, y: 150 } });
  assert.equal(result.source, 'tap-neighborhood');
  assert.ok(result.y > 100);
  assert.ok(result.y + result.height < 280);
  assert.ok(result.width <= width * 0.6);
});

test('point-guided selection rejects malformed pixel buffers', () => {
  assert.throws(
    () => buildPointGuidedSelection({ width: 10, height: 10, data: new Uint8ClampedArray(3), point: { x: 5, y: 5 } }),
    /POINT_GUIDED_SELECTION_IMAGE_INVALID/,
  );
});
