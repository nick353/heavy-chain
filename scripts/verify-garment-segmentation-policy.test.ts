import assert from 'node:assert/strict';
import test from 'node:test';

import {
  garmentSelectionModelStatus,
  resolveGarmentCutoutModel,
} from '../src/features/printing/selection/garmentSegmentationPolicy.ts';

test('tap selects the cloth model only when the build explicitly provides one', () => {
  assert.equal(resolveGarmentCutoutModel({ selectionSource: 'tap', clothModelConfigured: true }), 'u2net_cloth_seg');
  assert.equal(resolveGarmentCutoutModel({ selectionSource: 'tap', clothModelConfigured: false }), 'silueta');
});

test('automatic and range paths never silently switch to the cloth model', () => {
  assert.equal(resolveGarmentCutoutModel({ selectionSource: 'automatic', clothModelConfigured: true }), 'silueta');
  assert.equal(resolveGarmentCutoutModel({ selectionSource: 'range', clothModelConfigured: true }), 'silueta');
});

test('status tells the operator whether tap recognition is model-backed or fallback-only', () => {
  assert.equal(garmentSelectionModelStatus({ selectionSource: 'tap', clothModelConfigured: true }).semantic, true);
  assert.match(
    garmentSelectionModelStatus({ selectionSource: 'tap', clothModelConfigured: false }).message,
    /未配置/,
  );
});
