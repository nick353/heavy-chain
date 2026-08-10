import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

import {
  BEN2_ONNX_PRODUCTION_MODEL_URL,
  isBen2OnnxModelConfigured,
  resolveBen2OnnxModelUrl,
} from '../src/features/printing/matte/ben2MattingRuntimeContract.ts';

const worker = readFileSync(
  new URL('../src/features/printing/matte/ben2Matting.worker.ts', import.meta.url),
  'utf8',
);
const library = readFileSync(
  new URL('../src/lib/workspaceMaterialReferences.ts', import.meta.url),
  'utf8',
);

test('production BEN2 route is pinned and configured without embedding model bytes', () => {
  assert.match(BEN2_ONNX_PRODUCTION_MODEL_URL, /onnx-community\/BEN2-ONNX\/resolve\/c552aa82688edce09f0ac9d2e31ad53d9d629010\/onnx\/model_fp16\.onnx$/);
  assert.equal(resolveBen2OnnxModelUrl({ configuredUrl: '', isProduction: true }), BEN2_ONNX_PRODUCTION_MODEL_URL);
  assert.equal(resolveBen2OnnxModelUrl({ configuredUrl: '', isProduction: false }), '');
  assert.equal(isBen2OnnxModelConfigured(BEN2_ONNX_PRODUCTION_MODEL_URL), true);
  assert.equal(isBen2OnnxModelConfigured(''), false);
});

test('BEN2 is isolated in a worker with a deterministic WASM fallback and alpha resizing', () => {
  assert.match(worker, /new ort\.Tensor\(\s*'float32'/);
  assert.match(worker, /executionProviders: \['webgpu', 'wasm'\]/);
  assert.match(worker, /executionProviders: \['wasm'\]/);
  assert.match(worker, /resizeToNchwFloat/);
  assert.match(worker, /readAlpha/);
  assert.match(library, /modelName === 'ben2'/);
  assert.match(library, /engine: 'browser-ai-ben2-v1'/);
  assert.match(library, /selectionMaskUrl,[\s\S]*?maxDataUrlBytes/);
});
