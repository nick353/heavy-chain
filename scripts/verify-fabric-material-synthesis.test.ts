import assert from 'node:assert/strict';
import test from 'node:test';

import {
  applyFabricMaterialResponse,
  type FabricMaterialProfile,
} from '../src/features/printing/fabricMaterialSynthesis.ts';

const profile = (overrides: Partial<FabricMaterialProfile> = {}): FabricMaterialProfile => ({
  tintColor: [245, 245, 240],
  tintStrength: 0.08,
  sourceTextureStrength: 0.92,
  weaveStrength: 0.018,
  sheenStrength: 0.02,
  drapeStrength: 0.11,
  ...overrides,
});

test('bright material replaces a darker model garment instead of disappearing under multiply', () => {
  const material = new Uint8ClampedArray([250, 250, 248, 255]);
  const garment = new Uint8ClampedArray([92, 92, 92, 255]);
  const output = applyFabricMaterialResponse({
    materialRgba: material,
    garmentRgba: garment,
    width: 1,
    height: 1,
    profile: profile(),
  });

  assert.equal(output[3], 255);
  assert.ok(output[0] > garment[0] + 60);
  assert.ok(output[1] > garment[1] + 60);
  assert.ok(output[2] > garment[2] + 60);
});

test('material profiles remain visibly distinct while preserving source alpha', () => {
  const material = new Uint8ClampedArray([
    245, 245, 245, 255,
    220, 220, 220, 255,
  ]);
  const garment = new Uint8ClampedArray([
    145, 145, 145, 255,
    210, 210, 210, 255,
  ]);
  const cotton = applyFabricMaterialResponse({
    materialRgba: material,
    garmentRgba: garment,
    width: 2,
    height: 1,
    profile: profile(),
  });
  const denim = applyFabricMaterialResponse({
    materialRgba: material,
    garmentRgba: garment,
    width: 2,
    height: 1,
    profile: profile({
      tintColor: [46, 72, 108],
      tintStrength: 0.78,
      sourceTextureStrength: 0.75,
      weaveStrength: 0.035,
      sheenStrength: 0.03,
      drapeStrength: 0.14,
    }),
  });

  assert.deepEqual(
    Array.from(cotton, (_, index) => index % 4 === 3 ? cotton[index] : undefined)
      .filter((value): value is number => value !== undefined),
    [255, 255],
  );
  assert.deepEqual(
    Array.from(denim, (_, index) => index % 4 === 3 ? denim[index] : undefined)
      .filter((value): value is number => value !== undefined),
    [255, 255],
  );
  assert.ok(denim[2] > denim[0]);
  assert.ok(Math.abs(cotton[0] - denim[0]) > 30);
  assert.notDeepEqual([...cotton.slice(0, 3)], [...denim.slice(0, 3)]);
});

test('transparent pixels remain untouched and model folds affect material RGB only', () => {
  const width = 3;
  const height = 3;
  const material = new Uint8ClampedArray(width * height * 4);
  const garment = new Uint8ClampedArray(width * height * 4);
  for (let pixel = 0; pixel < width * height; pixel += 1) {
    const offset = pixel * 4;
    material.set([230, 230, 230, 255], offset);
    garment.set([120, 120, 120, 255], offset);
  }
  material.set([0, 0, 0, 0], 0);
  garment.set([255, 255, 255, 255], 4 * 4);

  const output = applyFabricMaterialResponse({
    materialRgba: material,
    garmentRgba: garment,
    width,
    height,
    profile: profile(),
  });

  assert.deepEqual([...output.slice(0, 4)], [...material.slice(0, 4)]);
  assert.equal(output[4 * 4 + 3], 255);
  assert.ok(output[4 * 4] > output[4 * 0]);
});
