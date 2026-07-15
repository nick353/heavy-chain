import assert from 'node:assert/strict';
import test from 'node:test';

import {
  canCommitPrintableSurfaceEditorOperation,
  canCommitPrintableSuggestion,
  type PrintableSuggestionCommitToken,
} from '../src/features/printing/surface/printableSuggestionRequest.ts';
import {
  enforcePrintableSuggestionCapacity,
  preparePrintableSurfaceSuggestion,
} from '../src/features/printing/surface/printableSurfaceSuggestionAdapter.ts';
import { buildSemanticGarmentSurface } from '../src/features/printing/surface/semanticGarmentSurface.ts';

const token: PrintableSuggestionCommitToken = {
  requestId: 7,
  garmentUrl: 'data:image/png;base64,garment',
  candidateId: 'refined',
  garmentMaskRevision: 3,
  cutoutRequestId: 11,
  outputWidth: 100,
  outputHeight: 120,
};

test('printable suggestion commit requires every captured field to remain exact', () => {
  assert.equal(canCommitPrintableSuggestion(token, { ...token }), true);
  for (const [field, value] of [
    ['requestId', 8],
    ['garmentUrl', 'data:image/png;base64,new'],
    ['candidateId', 'manual'],
    ['garmentMaskRevision', 4],
    ['cutoutRequestId', 12],
    ['outputWidth', 101],
    ['outputHeight', 121],
  ] as const) {
    assert.equal(
      canCommitPrintableSuggestion(token, { ...token, [field]: value }),
      false,
      `${field} must reject a stale commit`,
    );
  }
});

test('older request cannot clear or replace the newer printable suggestion', () => {
  const newer = { ...token, requestId: token.requestId + 1 };
  assert.equal(canCommitPrintableSuggestion(token, newer), false);
  assert.equal(canCommitPrintableSuggestion(newer, newer), true);
});

test('manual open, proposal open, Apply, and close use one monotonic editor-operation gate', () => {
  const manualOpen = 20;
  const proposalOpen = 21;
  const apply = 22;
  const closeOrNewOpen = 23;
  assert.equal(canCommitPrintableSurfaceEditorOperation(manualOpen, proposalOpen), false);
  assert.equal(canCommitPrintableSurfaceEditorOperation(proposalOpen, proposalOpen), true);
  assert.equal(canCommitPrintableSurfaceEditorOperation(apply, closeOrNewOpen), false);
  assert.equal(canCommitPrintableSurfaceEditorOperation(closeOrNewOpen, closeOrNewOpen), true);
});

test('adapter rejects decoded dimensions that differ from the selected cutout', () => {
  const result = preparePrintableSurfaceSuggestion({
    expectedSize: { width: 100, height: 120 },
    decoded: { width: 99, height: 120, rgba: new Uint8ClampedArray(99 * 120 * 4) },
  });
  assert.deepEqual(result, {
    kind: 'fallback-required',
    reason: 'DIMENSION_MISMATCH',
    width: 99,
    height: 120,
  });
});

test('adapter creates a bounded white-alpha editor mask for a stable garment', () => {
  const width = 100;
  const height = 120;
  const rgba = new Uint8ClampedArray(width * height * 4);
  for (let y = 8; y <= 111; y += 1) {
    for (let x = 18; x <= 81; x += 1) {
      const offset = ((y * width) + x) * 4;
      rgba[offset] = 40;
      rgba[offset + 1] = 80;
      rgba[offset + 2] = 120;
      rgba[offset + 3] = 255;
    }
  }
  const result = preparePrintableSurfaceSuggestion({
    expectedSize: { width, height },
    decoded: { width, height, rgba },
  });
  assert.equal(result.kind, 'success');
  if (result.kind !== 'success') return;
  let printablePixels = 0;
  for (let index = 0; index < width * height; index += 1) {
    const offset = index * 4;
    assert.equal(result.rgba[offset], 255);
    assert.equal(result.rgba[offset + 1], 255);
    assert.equal(result.rgba[offset + 2], 255);
    assert.ok(result.rgba[offset + 3] <= rgba[offset + 3]);
    if (result.rgba[offset + 3] > 0) printablePixels += 1;
  }
  assert.ok(printablePixels > 256);
});

test('adapter never lets edge refinement expand the selected cutout alpha', () => {
  const width = 100;
  const height = 120;
  const rgba = new Uint8ClampedArray(width * height * 4);
  for (let y = 8; y <= 111; y += 1) {
    for (let x = 18; x <= 81; x += 1) {
      const offset = ((y * width) + x) * 4;
      rgba[offset] = 40;
      rgba[offset + 1] = 80;
      rgba[offset + 2] = 120;
      rgba[offset + 3] = 255;
    }
  }
  // A low-alpha boundary sample with opaque, same-RGB neighbours is exactly
  // the case where smoothing could otherwise borrow alpha from the interior.
  const partialIndex = ((54 * width) + 45) * 4;
  rgba[partialIndex + 3] = 32;
  const result = preparePrintableSurfaceSuggestion({
    expectedSize: { width, height },
    decoded: { width, height, rgba },
  });
  assert.equal(result.kind, 'success');
  if (result.kind !== 'success') return;
  assert.ok(result.rgba[partialIndex + 3] <= 32);
  for (let index = 0; index < width * height; index += 1) {
    assert.ok(result.rgba[(index * 4) + 3] <= rgba[(index * 4) + 3]);
    assert.equal(result.rgba[index * 4], 255);
    assert.equal(result.rgba[(index * 4) + 1], 255);
    assert.equal(result.rgba[(index * 4) + 2], 255);
  }
});

test('already-refined candidate skips a second edge pass and matches the direct surface proposal', () => {
  const width = 100;
  const height = 120;
  const rgba = new Uint8ClampedArray(width * height * 4);
  for (let y = 8; y <= 111; y += 1) {
    for (let x = 18; x <= 81; x += 1) {
      const offset = ((y * width) + x) * 4;
      rgba[offset] = 40;
      rgba[offset + 1] = 80;
      rgba[offset + 2] = 120;
      rgba[offset + 3] = 255;
    }
  }
  rgba[((54 * width) + 45) * 4 + 3] = 96;
  const sourceAlpha = new Uint8ClampedArray(width * height);
  for (let index = 0; index < sourceAlpha.length; index += 1) sourceAlpha[index] = rgba[(index * 4) + 3];
  const direct = buildSemanticGarmentSurface({ width, height, garmentAlpha: sourceAlpha });
  const prepared = preparePrintableSurfaceSuggestion({
    expectedSize: { width, height },
    decoded: { width, height, rgba },
    sourceAlphaAlreadyRefined: true,
  });
  assert.equal(direct.kind, 'success');
  assert.equal(prepared.kind, 'success');
  if (direct.kind !== 'success' || prepared.kind !== 'success') return;
  const preparedAlpha = new Uint8ClampedArray(width * height);
  for (let index = 0; index < preparedAlpha.length; index += 1) {
    preparedAlpha[index] = prepared.rgba[(index * 4) + 3];
  }
  assert.deepEqual(preparedAlpha, direct.surface.printableAlpha);
});

test('adapter returns a typed fallback for malformed decoded pixel buffers', () => {
  const result = preparePrintableSurfaceSuggestion({
    expectedSize: { width: 20, height: 20 },
    decoded: { width: 20, height: 20, rgba: new Uint8ClampedArray(20 * 20 * 4 - 1) },
  });
  assert.deepEqual(result, {
    kind: 'fallback-required',
    reason: 'INVALID_RGBA',
    width: 20,
    height: 20,
  });
});

test('adapter enforces the exact data-url byte capacity before opening the editor', () => {
  const suggestion = {
    kind: 'success' as const,
    width: 20,
    height: 20,
    rgba: new Uint8ClampedArray(20 * 20 * 4),
    diagnostics: {
      garmentBounds: { x: 2, y: 2, width: 16, height: 16 },
      foregroundPixels: 256,
      mainComponentRatio: 1,
      centerlineCoverage: 1,
      profileVariation: 0,
      printablePixels: 100,
      printableToGarmentRatio: 100 / 256,
      confidence: 1,
    },
  };
  assert.equal(enforcePrintableSuggestionCapacity({
    dataUrl: 'data:image/png;base64,ok',
    dataUrlBytes: 750_000,
    maxDataUrlBytes: 750_000,
    suggestion,
  }).kind, 'success');
  assert.equal(enforcePrintableSuggestionCapacity({
    dataUrl: 'data:image/png;base64,too-large',
    dataUrlBytes: 750_001,
    maxDataUrlBytes: 750_000,
    suggestion,
  }).kind, 'fallback-required');
});
