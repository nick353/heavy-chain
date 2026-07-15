import assert from 'node:assert/strict';
import test from 'node:test';

import {
  decontaminateRefinedEdge,
  EDGE_REFINEMENT_PIXEL_LIMIT_EXCEEDED,
  refineAlphaEdge,
} from '../src/features/printing/matte/refineAlphaEdge.ts';
import { PRINTING_FOUNDATION_CASES } from '../src/features/printing/quality/printingFoundationManifest.ts';
import {
  buildLegacyWholeGarmentFallback,
  composePrintableSurface,
  SurfaceMapValidationError,
} from '../src/features/printing/surface/semanticSurfaceMap.ts';
import { buildPrintRequestSignatureValue } from '../src/lib/printMaskCandidateStrategy.ts';

const plane = (alpha: number[], width = alpha.length, height = 1) => ({
  width,
  height,
  alpha: new Uint8ClampedArray(alpha),
});

test('foundation manifest has 16 unique classified cases', () => {
  assert.equal(PRINTING_FOUNDATION_CASES.length, 16);
  assert.equal(new Set(PRINTING_FOUNDATION_CASES.map((item) => item.id)).size, 16);
  assert.ok(PRINTING_FOUNDATION_CASES.some((item) => item.oracle === 'bit-exact'));
  assert.ok(PRINTING_FOUNDATION_CASES.some((item) => item.oracle === 'tolerance'));
  assert.ok(PRINTING_FOUNDATION_CASES.some((item) => item.oracle === 'ui-readback'));
});

test('semantic precedence excludes forbidden and occluder while retaining occluder plane', () => {
  const result = composePrintableSurface({
    planes: {
      garment: plane([255, 255, 255, 0]),
      printable: plane([255, 255, 255, 255]),
      forbidden: plane([0, 255, 0, 0]),
      occluder: plane([0, 0, 128, 0]),
    },
  });
  assert.deepEqual([...result.printableAlpha], [255, 0, 127, 0]);
  assert.deepEqual([...result.occluderAlpha], [0, 0, 128, 0]);
  assert.equal(result.status, 'semantic-ready');
});

test('conditional plane is opt-in and never escapes garment alpha', () => {
  const planes = {
    garment: plane([255, 128, 0]),
    printable: plane([0, 0, 0]),
    conditional: plane([255, 255, 255]),
  };
  assert.deepEqual([...composePrintableSurface({ planes }).printableAlpha], [0, 0, 0]);
  assert.deepEqual([...composePrintableSurface({ planes, allowConditional: true }).printableAlpha], [255, 128, 0]);
});

test('conditional plane overrides overlapping printable pixels unless policy explicitly allows it', () => {
  const planes = {
    garment: plane([255, 255]),
    printable: plane([255, 255]),
    conditional: plane([255, 128]),
  };
  assert.deepEqual([...composePrintableSurface({ planes }).printableAlpha], [0, 127]);
  assert.deepEqual([...composePrintableSurface({ planes, allowConditional: true }).printableAlpha], [255, 255]);
});

test('legacy whole-garment map is explicit low-confidence fallback and byte-identical', () => {
  const garment = plane([0, 64, 255]);
  const result = buildLegacyWholeGarmentFallback({ garment, fallbackReason: 'semantic-map-unavailable' });
  assert.equal(result.status, 'fallback-required');
  assert.equal(result.confidence, 0);
  assert.equal(result.fallbackReason, 'semantic-map-unavailable');
  assert.deepEqual([...result.printableAlpha], [...garment.alpha]);
  assert.notEqual(result.printableAlpha, garment.alpha);
});

test('semantic plane dimension mismatch fails visibly', () => {
  assert.throws(
    () => composePrintableSurface({ planes: { garment: plane([255, 255], 2, 1), printable: plane([255], 1, 1) } }),
    (error) => error instanceof SurfaceMapValidationError && error.code === 'SURFACE_DIMENSION_MISMATCH',
  );
});

test('semantic planes reject zero, negative, and over-budget dimensions', () => {
  for (const garment of [plane([], 0, 0), plane([255], -1, -1), plane([], 4_001, 4_000)]) {
    assert.throws(() => composePrintableSurface({ planes: { garment } }), SurfaceMapValidationError);
  }
});

test('surface identity changes signature while omitted identity preserves legacy serialization', () => {
  const base = {
    brandId: 'brand',
    brandName: 'Brand',
    stageSize: { width: 720, height: 900 },
    garment: { sourceUrl: 'garment', referenceType: 'base', maskCandidateId: 'auto' as const, maskRevision: 0 },
    designs: [],
  };
  const legacy = buildPrintRequestSignatureValue(base);
  assert.equal(legacy, '{"brandId":"brand","brandName":"Brand","stageSize":{"width":720,"height":900},"garment":{"sourceUrl":"garment","referenceType":"base","maskCandidateId":"auto","maskRevision":0},"designs":[]}');
  const first = buildPrintRequestSignatureValue({
    ...base,
    surfaceIdentity: { version: 'garment-surface-map-v1', sourceHash: 'sha256:a', contentHash: 'sha256:b', manualRevision: 0, status: 'semantic-ready' },
  });
  const revised = buildPrintRequestSignatureValue({
    ...base,
    surfaceIdentity: { version: 'garment-surface-map-v1', sourceHash: 'sha256:a', contentHash: 'sha256:c', manualRevision: 1, status: 'semantic-ready' },
  });
  assert.notEqual(first, legacy);
  assert.notEqual(revised, first);
});

test('edge refinement is deterministic and leaves RGB, transparent exterior, and opaque interior exact', () => {
  const input = new Uint8ClampedArray([
    20, 30, 40, 0,
    20, 30, 40, 128,
    20, 30, 40, 255,
  ]);
  const first = refineAlphaEdge({ rgba: input, width: 3, height: 1 });
  const second = refineAlphaEdge({ rgba: input, width: 3, height: 1 });
  assert.deepEqual([...first], [...second]);
  assert.deepEqual([...first.slice(0, 4)], [...input.slice(0, 4)]);
  assert.deepEqual([...first.slice(8, 12)], [...input.slice(8, 12)]);
  assert.deepEqual([first[4], first[5], first[6]], [20, 30, 40]);
});

test('edge guide does not blur alpha across a high-contrast RGB boundary', () => {
  const input = new Uint8ClampedArray([
    0, 0, 0, 0,
    255, 255, 255, 128,
    255, 255, 255, 255,
  ]);
  const output = refineAlphaEdge({ rgba: input, width: 3, height: 1 });
  assert.ok(output[7] >= 128);
  assert.equal(output[3], 0);
  assert.equal(output[11], 255);
});

test('decontamination follows the fixed partial-alpha formula only', () => {
  const input = new Uint8ClampedArray([
    20, 30, 40, 0,
    180, 170, 160, 128,
    90, 100, 110, 255,
  ]);
  const output = decontaminateRefinedEdge({ rgba: input, width: 3, height: 1, background: { r: 255, g: 255, b: 255 } });
  assert.deepEqual([...output.slice(0, 4)], [...input.slice(0, 4)]);
  assert.deepEqual([...output.slice(8, 12)], [...input.slice(8, 12)]);
  assert.equal(output[7], 128);
  assert.notDeepEqual([...output.slice(4, 7)], [...input.slice(4, 7)]);
});

test('edge refinement rejects images above the fixed pixel budget', () => {
  assert.throws(
    () => refineAlphaEdge({ rgba: new Uint8ClampedArray(0), width: 4_001, height: 4_000 }),
    new RegExp(EDGE_REFINEMENT_PIXEL_LIMIT_EXCEEDED),
  );
});

test('edge refinement and decontamination reject fractional and malformed dimensions', () => {
  assert.throws(
    () => refineAlphaEdge({ rgba: new Uint8ClampedArray(4), width: 0.5, height: 2 }),
    /EDGE_REFINEMENT_INVALID_INPUT/,
  );
  assert.throws(
    () => decontaminateRefinedEdge({ rgba: new Uint8ClampedArray(4), width: 0, height: 1, background: { r: 0, g: 0, b: 0 } }),
    /EDGE_REFINEMENT_INVALID_INPUT/,
  );
});
