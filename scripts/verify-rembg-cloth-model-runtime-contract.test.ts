import assert from 'node:assert/strict';
import test from 'node:test';
import {
  isRembgClothSegModelConfigured,
  REMBG_CLOTH_SEG_PRODUCTION_MODEL_URL,
  resolveRembgClothSegModelUrl,
} from '../src/features/printing/selection/clothModelRuntimeContract.ts';

test('production blank env resolves the pinned URL and enables the runtime predicate', () => {
  const url = resolveRembgClothSegModelUrl({ configuredUrl: '', isProduction: true });
  assert.equal(url, REMBG_CLOTH_SEG_PRODUCTION_MODEL_URL);
  assert.equal(isRembgClothSegModelConfigured(url), true);
});

test('development blank env retains fallback and explicit overrides remain available', () => {
  const developmentUrl = resolveRembgClothSegModelUrl({ configuredUrl: '', isProduction: false });
  assert.equal(developmentUrl, '');
  assert.equal(isRembgClothSegModelConfigured(developmentUrl), false);
  assert.equal(
    resolveRembgClothSegModelUrl({
      configuredUrl: ' https://models.example.com/custom.onnx ',
      isProduction: true,
    }),
    'https://models.example.com/custom.onnx',
  );
});
