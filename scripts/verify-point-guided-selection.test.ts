import test from 'node:test';
import assert from 'node:assert/strict';

import {
  buildPointGuidedSelection,
} from '../src/features/printing/selection/pointGuidedSelection.ts';

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

const makeTransparentImage = (
  width: number,
  height: number,
  paint: (x: number, y: number) => [number, number, number, number],
) => {
  const data = new Uint8ClampedArray(width * height * 4);
  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) {
      const offset = (y * width + x) * 4;
      const [r, g, b, a] = paint(x, y);
      data[offset] = r;
      data[offset + 1] = g;
      data[offset + 2] = b;
      data[offset + 3] = a;
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
  assert.ok(result.mask);
  assert.equal(result.mask?.width, width);
  assert.equal(result.mask?.height, height);
  assert.equal(result.mask?.data[(50 * width) + 60], 1);
  assert.equal(result.mask?.data[0], 0);
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

test('point-guided selection exposes a preview and leaves application to explicit confirmation', () => {
  const result = buildPointGuidedSelection({
    width: 120,
    height: 100,
    data: makeImage(120, 100, (x, y) => (
      x >= 34 && x < 86 && y >= 16 && y < 84 ? [24, 110, 180] : [248, 248, 248]
    )),
    point: { x: 60, y: 50 },
  });
  assert.equal(result.source, 'color-region');
  assert.ok(result.mask);
  assert.ok(result.selectedPixels > 0);
});

test('point-guided selection preserves garment texture while excluding uniform background', () => {
  const width = 160;
  const height = 120;
  const background: [number, number, number] = [44, 44, 44];
  const result = buildPointGuidedSelection({
    width,
    height,
    data: makeImage(width, height, (x, y) => {
      const inShirt = x >= 38 && x < 122 && y >= 20 && y < 106;
      if (!inShirt) return background;
      const inPrint = x >= 78 && x < 94 && y >= 42 && y < 58;
      const inCollarHole = x >= 68 && x < 92 && y >= 20 && y < 32;
      if (inCollarHole) return background;
      if (inPrint) return [4, 4, 4];
      return [232, 220, 196];
    }),
    point: { x: 58, y: 70 },
  });
  assert.equal(result.source, 'color-region');
  assert.ok(result.mask);
  assert.equal(result.mask?.data[(50 * width) + 84], 1);
  assert.equal(result.mask?.data[(27 * width) + 80], 0);
  assert.equal(result.mask?.data[0], 0);
});

test('point-guided selection can start on garment texture when the outer background is uniform', () => {
  const width = 160;
  const height = 120;
  const background: [number, number, number] = [40, 40, 40];
  const result = buildPointGuidedSelection({
    width,
    height,
    data: makeImage(width, height, (x, y) => {
      const inShirt = x >= 38 && x < 122 && y >= 20 && y < 106;
      if (!inShirt) return background;
      const inPrint = x >= 78 && x < 94 && y >= 42 && y < 58;
      if (inPrint) return [8, 8, 8];
      return [232, 220, 196];
    }),
    point: { x: 84, y: 50 },
  });
  assert.equal(result.source, 'color-region');
  assert.ok(result.mask);
  assert.equal(result.mask?.data[(50 * width) + 84], 1);
  assert.equal(result.mask?.data[(70 * width) + 60], 1);
  assert.equal(result.mask?.data[0], 0);
});

test('point-guided selection keeps enclosed texture even when it matches the background', () => {
  const width = 160;
  const height = 120;
  const background: [number, number, number] = [40, 40, 40];
  const result = buildPointGuidedSelection({
    width,
    height,
    data: makeImage(width, height, (x, y) => {
      const inShirt = x >= 38 && x < 122 && y >= 20 && y < 106;
      if (!inShirt) return background;
      const inPrint = x >= 78 && x < 94 && y >= 42 && y < 58;
      const inCollarHole = x >= 68 && x < 92 && y >= 20 && y < 32;
      if (inPrint || inCollarHole) return background;
      return [232, 220, 196];
    }),
    point: { x: 58, y: 70 },
  });
  assert.equal(result.source, 'color-region');
  assert.ok(result.mask);
  assert.equal(result.mask?.data[(50 * width) + 84], 1);
  assert.equal(result.mask?.data[(25 * width) + 80], 0);
  assert.equal(result.mask?.data[0], 0);
});

test('point-guided selection fills enclosed texture holes on a non-uniform background', () => {
  const width = 180;
  const height = 140;
  const result = buildPointGuidedSelection({
    width,
    height,
    data: makeImage(width, height, (x, y) => {
      const backgroundLevel = 20 + Math.round((x / width) * 80) + Math.round((y / height) * 24);
      const background: [number, number, number] = [backgroundLevel, backgroundLevel, backgroundLevel];
      const inShirt = x >= 42 && x < 138 && y >= 24 && y < 124;
      if (!inShirt) return background;
      const inPrint = x >= 82 && x < 102 && y >= 52 && y < 72;
      const inCollarHole = x >= 78 && x < 106 && y >= 24 && y < 38;
      if (inPrint || inCollarHole) return background;
      return [232, 220, 196];
    }),
    point: { x: 60, y: 80 },
  });
  assert.equal(result.source, 'color-region');
  assert.ok(result.mask);
  assert.equal(result.mask?.data[(60 * width) + 92], 1);
  assert.equal(result.mask?.data[(30 * width) + 92], 0);
  assert.equal(result.mask?.data[0], 0);
});

test('point-guided selection keeps printed garment texture on a transparent gradient background', () => {
  const width = 180;
  const height = 140;
  const result = buildPointGuidedSelection({
    width,
    height,
    data: makeTransparentImage(width, height, (x, y) => {
      const backgroundLevel = 20 + Math.round((x / width) * 80) + Math.round((y / height) * 24);
      const inShirt = x >= 42 && x < 138 && y >= 24 && y < 124;
      const inPrint = x >= 82 && x < 102 && y >= 52 && y < 72;
      const inCollarHole = x >= 78 && x < 106 && y >= 24 && y < 38;
      if (inCollarHole) return [backgroundLevel, backgroundLevel, backgroundLevel, 0];
      if (inPrint) return [8, 36, 180, 255];
      if (inShirt) return [232, 220, 196, 255];
      return [backgroundLevel, backgroundLevel, backgroundLevel, 0];
    }),
    point: { x: 60, y: 80 },
  });
  assert.equal(result.source, 'color-region');
  assert.ok(result.mask);
  assert.equal(result.mask?.data[(60 * width) + 92], 1);
  assert.equal(result.mask?.data[(30 * width) + 92], 0);
  assert.equal(result.mask?.data[0], 0);
});

test('chest and sleeve taps resolve to the same connected T-shirt mask', () => {
  const width = 180;
  const height = 140;
  const background: [number, number, number] = [246, 246, 246];
  const garment: [number, number, number] = [42, 116, 188];
  const data = makeImage(width, height, (x, y) => {
    const inTorso = x >= 50 && x < 130 && y >= 30 && y < 130;
    const inLeftSleeve = x >= 25 && x < 50 && y >= 42 && y < 78;
    const inRightSleeve = x >= 130 && x < 155 && y >= 42 && y < 78;
    const inCollar = x >= 78 && x < 102 && y >= 30 && y < 42;
    return (inTorso || inLeftSleeve || inRightSleeve) && !inCollar ? garment : background;
  });

  const chest = buildPointGuidedSelection({
    width,
    height,
    data,
    point: { x: 90, y: 84 },
  });
  const sleeve = buildPointGuidedSelection({
    width,
    height,
    data,
    point: { x: 36, y: 58 },
  });

  assert.equal(chest.source, 'color-region');
  assert.equal(sleeve.source, 'color-region');
  assert.deepEqual(
    { x: chest.x, y: chest.y, width: chest.width, height: chest.height },
    { x: sleeve.x, y: sleeve.y, width: sleeve.width, height: sleeve.height },
  );
  assert.equal(chest.selectedPixels, sleeve.selectedPixels);
  assert.deepEqual(chest.mask?.data, sleeve.mask?.data);
  assert.equal(chest.mask?.data[(58 * width) + 36], 1);
  assert.equal(chest.mask?.data[(84 * width) + 90], 1);
  assert.equal(chest.mask?.data[0], 0);
});
