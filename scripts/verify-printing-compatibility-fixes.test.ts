import assert from 'node:assert/strict';
import test from 'node:test';

import {
  estimatePrintMaskDataUrlBytes,
  isOversizedManualPrintMask,
  PRINT_CUTOUT_MAX_DATA_URL_BYTES,
  mergePrintMaskCandidatesById,
  nextPrintMaskDownscaleSize,
  resolvePrintMaskCandidateId,
  withManualPrintMaskResult,
} from '../src/lib/printMaskCandidateStrategy.ts';
import { getContainedStageBounds, getInnerContainedBounds, getIntegerStageScale, getStageLocalCenterPoint, getStageLocalPoint, scaleStageBounds } from '../src/lib/printingStageGeometry.ts';

const dataUrlForByteCount = (bytes: number) => `data:image/png;base64,${'A'.repeat(Math.ceil(bytes * 4 / 3))}`;

test('derived completion retains existing manual candidate and selected identity', () => {
  const current = [{ candidateId: 'auto', value: 'old-auto' }, { candidateId: 'manual', value: 'manual' }];
  const derived = [{ candidateId: 'auto', value: 'new-auto' }, { candidateId: 'detail', value: 'detail' }];
  const merged = mergePrintMaskCandidatesById(current, derived);
  assert.deepEqual(merged, [current[0], derived[1], current[1]]);
  assert.equal(resolvePrintMaskCandidateId(merged, 'manual'), 'manual');
  assert.equal(merged.filter((item) => item.candidateId === 'auto').length, 1);
});

test('canonical merge keeps manual selected after refined failure and successful legacy candidates', () => {
  const manual = { candidateId: 'manual', value: 'manual' };
  const merged = mergePrintMaskCandidatesById(
    [{ candidateId: 'auto', value: 'auto' }, manual],
    [{ candidateId: 'detail', value: 'detail' }, { candidateId: 'strict', value: 'strict' }],
  );
  assert.deepEqual(merged.map((item) => item.candidateId), ['auto', 'detail', 'strict', 'manual']);
  assert.equal(resolvePrintMaskCandidateId(merged, 'manual'), 'manual');
  assert.equal(merged.at(-1), manual);
});

test('candidate selection resolves to first available only when current selection is missing', () => {
  assert.equal(resolvePrintMaskCandidateId([{ candidateId: 'detail' }], 'manual'), 'detail');
  assert.equal(resolvePrintMaskCandidateId([], 'manual'), 'manual');
});

test('manual PNG limit accepts the boundary and rejects the next representable oversized payload', () => {
  const atLimit = dataUrlForByteCount(PRINT_CUTOUT_MAX_DATA_URL_BYTES);
  assert.ok(estimatePrintMaskDataUrlBytes(atLimit) >= PRINT_CUTOUT_MAX_DATA_URL_BYTES);
  assert.equal(isOversizedManualPrintMask(atLimit), false);
  const overLimit = dataUrlForByteCount(PRINT_CUTOUT_MAX_DATA_URL_BYTES + 3);
  assert.equal(isOversizedManualPrintMask(overLimit), true);
});

test('manual downscale keeps extreme aspect ratios valid and can continue past a 64px short edge', () => {
  const first = nextPrintMaskDownscaleSize({ width: 2_000, height: 64 });
  assert.deepEqual(first, { width: 1_700, height: 54 });
  const second = nextPrintMaskDownscaleSize({ width: 54, height: 1_700 });
  assert.deepEqual(second, { width: 45, height: 1_445 });
  let size = { width: 2_000, height: 8 };
  for (let index = 0; index < 30; index += 1) size = nextPrintMaskDownscaleSize(size);
  assert.ok(size.width < 64);
  assert.ok(size.height >= 1);
});

test('manual result stores the resized dimensions and the shared byte estimate for garment or design reopen', () => {
  const dataUrl = 'data:image/png;base64,QUJDRA==';
  const original = { dataUrl: 'old', dataUrlBytes: 10, outputSize: { width: 1000, height: 800 }, kind: 'design' };
  const updated = withManualPrintMaskResult(original, dataUrl, { width: 722, height: 578 });
  assert.deepEqual(updated.outputSize, { width: 722, height: 578 });
  assert.equal(updated.dataUrlBytes, estimatePrintMaskDataUrlBytes(dataUrl));
  assert.equal(updated.kind, 'design');
});

test('manual result removes stale edge-refinement metadata', () => {
  const original = {
    dataUrl: 'old',
    dataUrlBytes: 10,
    outputSize: { width: 10, height: 10 },
    refinement: { version: 'source-edge-refinement-v1' },
  };
  const updated = withManualPrintMaskResult(original, 'data:image/png;base64,QQ==', { width: 8, height: 8 });
  assert.equal('refinement' in updated, false);
});

test('stage coordinates are local and invariant under viewport translation', () => {
  const first = getStageLocalPoint({ left: 120, top: 80 }, 270, 230);
  const translated = getStageLocalPoint({ left: 420, top: 280 }, 570, 430);
  assert.deepEqual(first, { x: 150, y: 150 });
  assert.deepEqual(translated, first);
});

test('stage center is expressed in the same local coordinate space', () => {
  const center = getStageLocalCenterPoint({ width: 720, height: 900 });
  const pointer = getStageLocalPoint({ left: 100, top: 50 }, 460, 500);
  assert.deepEqual(center, { x: 360, y: 450 });
  assert.deepEqual(pointer, center);
});

test('non-square source plane is contained without stretching and keeps asymmetric coordinates', () => {
  const bounds = getContainedStageBounds({ width: 720, height: 900 }, { width: 400, height: 200 });
  assert.deepEqual(bounds, { x: 0, y: 270, width: 720, height: 360 });
  const leftQuarter = {
    x: bounds.x + Math.round(bounds.width * 0.25),
    y: bounds.y + Math.round(bounds.height * 0.5),
  };
  assert.deepEqual(leftQuarter, { x: 180, y: 450 });
  assert.notEqual(leftQuarter.x, 540);
});

test('high-resolution geometry is the exact integer multiple of the 720 stage', () => {
  const base = getContainedStageBounds({ width: 720, height: 900 }, { width: 400, height: 500 });
  const scale = getIntegerStageScale({ width: 1440, height: 1800 }, { width: 720, height: 900 });
  assert.equal(scale, 2);
  assert.deepEqual(scaleStageBounds(base, scale), {
    x: base.x * 2,
    y: base.y * 2,
    width: base.width * 2,
    height: base.height * 2,
  });
});

test('odd aspect-ratio inner fit is also the exact integer multiple', () => {
  const base = getInnerContainedBounds({ x: 0, y: 0, width: 274, height: 274 }, { width: 333, height: 200 }, 1);
  const high = getInnerContainedBounds({ x: 0, y: 0, width: 548, height: 548 }, { width: 333, height: 200 }, 2);
  assert.deepEqual(base, { x: 0, y: 55, width: 274, height: 165 });
  assert.deepEqual(high, scaleStageBounds(base, 2));
});
