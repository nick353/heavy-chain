import assert from 'node:assert/strict';
import test from 'node:test';

import {
  canExplicitlyConfirmProcessedGarmentMask,
  canSubmitGarmentSelectionPreview,
  DEFAULT_GARMENT_SEGMENTATION_TARGET,
  garmentSelectionModelStatus,
  isGarmentMaskExplicitlyConfirmed,
  isCurrentGarmentMaskEditorTarget,
  isGarmentSemanticSegmentationResult,
  normalizeGarmentSegmentationTarget,
  resolveGarmentCutoutModel,
  resolveGarmentSegmentationMaskIndex,
  resolveTransparentGarmentCutoutRoute,
  shouldRunConfiguredClothModelForGarmentInput,
} from '../src/features/printing/selection/garmentSegmentationPolicy.ts';

test('only an explicit visible-mask confirmation or manual-mask apply unlocks downstream artwork', () => {
  const base = { cutoutDone: true, hasProcessedMask: true, explicitlyConfirmed: false };
  assert.equal(isGarmentMaskExplicitlyConfirmed({ ...base, selectionSource: 'automatic', maskCandidateId: 'auto' }), false);
  assert.equal(isGarmentMaskExplicitlyConfirmed({ ...base, selectionSource: 'automatic', maskCandidateId: 'refined', explicitlyConfirmed: true }), false);
  assert.equal(isGarmentMaskExplicitlyConfirmed({ ...base, selectionSource: 'automatic', maskCandidateId: 'manual' }), true);
  assert.equal(isGarmentMaskExplicitlyConfirmed({ ...base, selectionSource: 'tap', maskCandidateId: 'auto', explicitlyConfirmed: true }), true);
  assert.equal(isGarmentMaskExplicitlyConfirmed({ ...base, selectionSource: 'range', maskCandidateId: 'auto' }), false);
  assert.equal(isGarmentMaskExplicitlyConfirmed({ ...base, selectionSource: 'range', maskCandidateId: 'auto', explicitlyConfirmed: true }), true);
  assert.equal(isGarmentMaskExplicitlyConfirmed({ ...base, selectionSource: 'tap', maskCandidateId: 'auto', explicitlyConfirmed: true, cutoutDone: false }), false);
  assert.equal(isGarmentMaskExplicitlyConfirmed({ ...base, selectionSource: 'tap', maskCandidateId: 'auto', explicitlyConfirmed: true, hasProcessedMask: false }), false);
});

test('tap submission requires an actual visible mask while range remains an input-only submission', () => {
  assert.equal(canSubmitGarmentSelectionPreview({ selectionSource: 'tap', hasGuidedMask: false }), false);
  assert.equal(canSubmitGarmentSelectionPreview({ selectionSource: 'tap', hasGuidedMask: true }), true);
  assert.equal(canSubmitGarmentSelectionPreview({ selectionSource: 'range', hasGuidedMask: false }), true);
  assert.equal(canSubmitGarmentSelectionPreview({ selectionSource: null, hasGuidedMask: true }), false);
});

test('processed tap or range masks can be reconfirmed but automatic output cannot', () => {
  const ready = { cutoutDone: true, hasProcessedMask: true };
  assert.equal(canExplicitlyConfirmProcessedGarmentMask({ ...ready, selectionSource: 'tap' }), true);
  assert.equal(canExplicitlyConfirmProcessedGarmentMask({ ...ready, selectionSource: 'range' }), true);
  assert.equal(canExplicitlyConfirmProcessedGarmentMask({ ...ready, selectionSource: 'automatic' }), false);
  assert.equal(canExplicitlyConfirmProcessedGarmentMask({ ...ready, selectionSource: 'range', cutoutDone: false }), false);
});

test('manual garment editor results are bound to exact request, candidate, and revision identity', () => {
  const current = {
    capturedCandidateId: 'auto',
    currentCandidateId: 'auto',
    capturedMaskRevision: 3,
    currentMaskRevision: 3,
    capturedCutoutRequestId: 7,
    currentCutoutRequestId: 7,
  };
  assert.equal(isCurrentGarmentMaskEditorTarget(current), true);
  assert.equal(isCurrentGarmentMaskEditorTarget({ ...current, currentCandidateId: 'refined' }), false);
  assert.equal(isCurrentGarmentMaskEditorTarget({ ...current, currentMaskRevision: 4 }), false);
  assert.equal(isCurrentGarmentMaskEditorTarget({ ...current, currentCutoutRequestId: 8 }), false);
});

test('garment target defaults and unknown values normalize to tops', () => {
  assert.equal(DEFAULT_GARMENT_SEGMENTATION_TARGET, 'upper');
  assert.equal(normalizeGarmentSegmentationTarget(undefined), 'upper');
  assert.equal(normalizeGarmentSegmentationTarget('unexpected'), 'upper');
  assert.equal(normalizeGarmentSegmentationTarget('lower'), 'lower');
  assert.equal(normalizeGarmentSegmentationTarget('full'), 'full');
});

test('garment targets select the model class masks shown in the reference flow', () => {
  assert.equal(resolveGarmentSegmentationMaskIndex('upper'), 0);
  assert.equal(resolveGarmentSegmentationMaskIndex('lower'), 1);
  assert.equal(resolveGarmentSegmentationMaskIndex('full'), 2);
});

test('tap selects the cloth model only when the build explicitly provides one', () => {
  assert.equal(resolveGarmentCutoutModel({ selectionSource: 'tap', clothModelConfigured: true }), 'u2net_cloth_seg');
  assert.equal(resolveGarmentCutoutModel({ selectionSource: 'tap', clothModelConfigured: false }), 'silueta');
});

test('automatic and range paths never silently switch to the cloth model', () => {
  assert.equal(resolveGarmentCutoutModel({ selectionSource: 'automatic', clothModelConfigured: true }), 'silueta');
  assert.equal(resolveGarmentCutoutModel({ selectionSource: 'range', clothModelConfigured: true }), 'silueta');
});

test('a confirmed transparent tap mask is preserved as the user-reviewed blue area', () => {
  assert.equal(resolveTransparentGarmentCutoutRoute({
    modelName: 'u2net_cloth_seg',
    clothModelConfigured: true,
  }), 'preserve-existing');
  assert.equal(resolveTransparentGarmentCutoutRoute({
    modelName: 'u2net_cloth_seg',
    clothModelConfigured: false,
  }), 'preserve-existing');
  assert.equal(resolveTransparentGarmentCutoutRoute({
    modelName: 'silueta',
    clothModelConfigured: true,
  }), 'preserve-existing');
});

test('transparent confirmed input skips cloth inference while opaque input still uses it', () => {
  assert.equal(shouldRunConfiguredClothModelForGarmentInput({
    hasTransparentPixels: true,
    modelName: 'u2net_cloth_seg',
    clothModelConfigured: true,
  }), false);
  assert.equal(shouldRunConfiguredClothModelForGarmentInput({
    hasTransparentPixels: false,
    modelName: 'u2net_cloth_seg',
    clothModelConfigured: true,
  }), true);
  assert.equal(shouldRunConfiguredClothModelForGarmentInput({
    hasTransparentPixels: false,
    modelName: 'silueta',
    clothModelConfigured: true,
  }), false);
});

test('semantic success requires the exact cloth result engine on the tap path', () => {
  assert.equal(isGarmentSemanticSegmentationResult({
    selectionSource: 'tap',
    resultEngine: 'browser-ai-u2net_cloth_seg-v1',
    requestedTarget: 'upper',
    resultTarget: 'upper',
  }), true);
  assert.equal(isGarmentSemanticSegmentationResult({
    selectionSource: 'tap',
    resultEngine: 'browser-ai-silueta-v1',
    requestedTarget: 'upper',
    resultTarget: 'upper',
  }), false);
  assert.equal(isGarmentSemanticSegmentationResult({
    selectionSource: 'automatic',
    resultEngine: 'browser-ai-u2net_cloth_seg-v1',
    requestedTarget: 'upper',
    resultTarget: 'upper',
  }), false);
  assert.equal(isGarmentSemanticSegmentationResult({
    selectionSource: 'range',
    resultEngine: 'browser-ai-u2net_cloth_seg-v1',
    requestedTarget: 'upper',
    resultTarget: 'upper',
  }), false);
  assert.equal(isGarmentSemanticSegmentationResult({
    selectionSource: 'tap',
    resultEngine: 'browser-ai-u2net_cloth_seg-v1',
    requestedTarget: 'full',
    resultTarget: 'upper',
  }), false);
});

test('status tells the operator whether the completed engine is cloth-specific or fallback-only', () => {
  assert.equal(garmentSelectionModelStatus({
    selectionSource: 'tap',
    clothModelConfigured: true,
    resultEngine: 'browser-ai-u2net_cloth_seg-v1',
    requestedTarget: 'full',
    resultTarget: 'full',
  }).semantic, true);
  const configuredFallback = garmentSelectionModelStatus({
    selectionSource: 'tap',
    clothModelConfigured: true,
    resultEngine: 'browser-ai-silueta-v1',
    requestedTarget: 'upper',
    resultTarget: undefined,
  });
  assert.equal(configuredFallback.semantic, false);
  assert.match(configuredFallback.message, /既存AI/);
  const confirmedMask = garmentSelectionModelStatus({
    selectionSource: 'tap',
    clothModelConfigured: true,
    resultEngine: 'browser-existing-transparent-garment-v1',
    requestedTarget: 'upper',
    resultTarget: undefined,
  });
  assert.equal(confirmedMask.model, 'confirmed-tap-mask');
  assert.match(confirmedMask.message, /確認した青い認識範囲/);
  assert.match(
    garmentSelectionModelStatus({
      selectionSource: 'tap',
      clothModelConfigured: false,
      resultEngine: 'browser-ai-silueta-v1',
      requestedTarget: 'upper',
      resultTarget: undefined,
    }).message,
    /未配置/,
  );
});
