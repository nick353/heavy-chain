import assert from 'node:assert/strict';
import test from 'node:test';

import {
  applyFabricLuminanceModulation,
  mergeDelayedSurfaceResult,
  applyManualMaskBrushStroke,
  assemblePrintGarmentMaskCandidates,
  buildEdgeConnectedSoftAlphaMatte,
  buildPrintMaskCandidateRgba,
  buildRefinedPrintMaskCandidateRgba,
  buildPrintRequestSignatureValue,
  decontaminateBoundaryRgb,
  mergePrintResultHistory,
  selectPrintGarmentMaskCandidateValue,
  sourceOverRgbaPixel,
  summarizePrintEdgeRefinement,
} from '../src/lib/printMaskCandidateStrategy.ts';
import { refineAlphaEdge } from '../src/features/printing/matte/refineAlphaEdge.ts';
import {
  buildPrintArtworkBackgroundCutoutRgba,
  isPrintArtworkBackgroundCutoutAcceptable,
  mapPrintMaskPointerToImage,
  mergePrintMaskAlpha,
  paintPrintMaskAlpha,
} from '../src/lib/printArtworkMaskStrategy.ts';

const rgbaFromAlpha = (alphas: number[]) => new Uint8ClampedArray(
  alphas.flatMap((alpha, index) => [20 + index, 40 + index, 60 + index, alpha]),
);

test('auto candidate preserves every RGBA byte', () => {
  const input = rgbaFromAlpha([0, 64, 128, 255]);
  const output = buildPrintMaskCandidateRgba({ rgba: input, width: 2, height: 2, candidateId: 'auto' });
  assert.deepEqual([...output], [...input]);
  assert.notEqual(output, input);
});

test('derived candidates preserve RGB and maintain strict <= auto <= detail alpha', () => {
  const input = rgbaFromAlpha([0, 20, 80, 140, 255, 170, 90, 30, 0]);
  const detail = buildPrintMaskCandidateRgba({ rgba: input, width: 3, height: 3, candidateId: 'detail' });
  const strict = buildPrintMaskCandidateRgba({ rgba: input, width: 3, height: 3, candidateId: 'strict' });

  for (let index = 0; index < input.length; index += 4) {
    assert.deepEqual([...detail.slice(index, index + 3)], [...input.slice(index, index + 3)]);
    assert.deepEqual([...strict.slice(index, index + 3)], [...input.slice(index, index + 3)]);
    assert.ok(strict[index + 3] <= input[index + 3]);
    assert.ok(input[index + 3] <= detail[index + 3]);
  }
});

test('fully transparent input stays transparent', () => {
  const input = rgbaFromAlpha([0, 0, 0, 0]);
  for (const candidateId of ['detail', 'strict'] as const) {
    const output = buildPrintMaskCandidateRgba({ rgba: input, width: 2, height: 2, candidateId });
    assert.deepEqual([output[3], output[7], output[11], output[15]], [0, 0, 0, 0]);
  }
});

test('detail never revives fully transparent edge RGB and strict erodes edge contact', () => {
  const input = rgbaFromAlpha([255, 0, 0, 0]);
  const detail = buildPrintMaskCandidateRgba({ rgba: input, width: 2, height: 2, candidateId: 'detail' });
  const strict = buildPrintMaskCandidateRgba({ rgba: input, width: 2, height: 2, candidateId: 'strict' });
  assert.deepEqual([detail[3], detail[7], detail[11], detail[15]], [255, 0, 0, 0]);
  assert.deepEqual([strict[3], strict[7], strict[11], strict[15]], [0, 0, 0, 0]);
});

test('one-pixel detail is retained without a black halo and removed by strict', () => {
  const input = new Uint8ClampedArray([
    0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0,
    0, 0, 0, 0, 220, 110, 40, 120, 0, 0, 0, 0,
    0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0,
  ]);
  const detail = buildPrintMaskCandidateRgba({ rgba: input, width: 3, height: 3, candidateId: 'detail' });
  const strict = buildPrintMaskCandidateRgba({ rgba: input, width: 3, height: 3, candidateId: 'strict' });
  assert.deepEqual(Array.from({ length: 9 }, (_, index) => detail[index * 4 + 3]), [0, 0, 0, 0, 120, 0, 0, 0, 0]);
  assert.deepEqual([...detail.slice(16, 19)], [220, 110, 40]);
  assert.deepEqual(Array.from({ length: 9 }, (_, index) => strict[index * 4 + 3]), Array(9).fill(0));
});

test('candidate assembly has canonical IDs, keeps automatic data, and derives every optional candidate', async () => {
  const derivedIds: string[] = [];
  const candidates = await assemblePrintGarmentMaskCandidates({
    automaticResult: { dataUrl: 'data:image/png;base64,AUTO' },
    deriveResult: async (candidateId) => {
      derivedIds.push(candidateId);
      return { dataUrl: `data:image/png;base64,${candidateId.toUpperCase()}` };
    },
  });

  assert.deepEqual(candidates.map((candidate) => candidate.candidateId), ['auto', 'refined', 'detail', 'strict']);
  assert.deepEqual(derivedIds, ['refined', 'detail', 'strict']);
  assert.equal(candidates[0].result.dataUrl, 'data:image/png;base64,AUTO');
  assert.ok(candidates.every((candidate) => candidate.result.dataUrl.startsWith('data:image/png;base64,')));
});

test('refined candidate is directly identical to the source-resolution edge refinement helper', () => {
  const input = new Uint8ClampedArray([
    20, 30, 40, 0,
    20, 30, 40, 80,
    20, 30, 40, 180,
    20, 30, 40, 255,
  ]);
  const refined = buildRefinedPrintMaskCandidateRgba({ rgba: input, width: 4, height: 1 });
  const direct = refineAlphaEdge({ rgba: input, width: 4, height: 1 });
  assert.deepEqual([...refined], [...direct]);
  for (let index = 0; index < input.length; index += 4) {
    assert.deepEqual([...refined.slice(index, index + 3)], [...input.slice(index, index + 3)]);
  }
  assert.equal(refined[3], 0);
  assert.equal(refined[15], 255);
});

test('refined metadata counts partial and changed alpha and contains only freeze-safe values', () => {
  const input = new Uint8ClampedArray([
    10, 20, 30, 0,
    10, 20, 30, 80,
    10, 20, 30, 180,
    10, 20, 30, 255,
  ]);
  const output = buildRefinedPrintMaskCandidateRgba({ rgba: input, width: 4, height: 1 });
  const metadata = summarizePrintEdgeRefinement({ inputRgba: input, outputRgba: output, width: 4, height: 1 });
  assert.equal(metadata.version, 'source-edge-refinement-v1');
  assert.equal(metadata.source, 'base-mask-alpha');
  assert.deepEqual(metadata.inputSize, { width: 4, height: 1 });
  assert.equal(metadata.partialAlphaPixels, 2);
  assert.ok(metadata.changedAlphaPixels >= 1);
  assert.ok(metadata.maxAlphaDelta >= 1);
  assert.doesNotThrow(() => Object.freeze(JSON.parse(JSON.stringify(metadata))));
});

test('one optional candidate failure does not remove successful candidates or required auto', async () => {
  const failures: string[] = [];
  const candidates = await assemblePrintGarmentMaskCandidates({
    automaticResult: { dataUrl: 'AUTO' },
    deriveResult: async (candidateId) => {
      if (candidateId === 'refined') throw new Error('over-limit');
      return { dataUrl: candidateId.toUpperCase() };
    },
    onOptionalFailure: (candidateId) => failures.push(candidateId),
  });
  assert.deepEqual(candidates.map((candidate) => candidate.candidateId), ['auto', 'detail', 'strict']);
  assert.deepEqual(failures, ['refined']);
});

test('selected candidate ID and data URL enter the request signature together', async () => {
  const candidates = await assemblePrintGarmentMaskCandidates({
    automaticResult: { dataUrl: 'data:image/png;base64,AUTO' },
    deriveResult: async (candidateId) => ({ dataUrl: `data:image/png;base64,${candidateId.toUpperCase()}` }),
  });
  const selection = selectPrintGarmentMaskCandidateValue(candidates, 'strict');
  const signature = buildPrintRequestSignatureValue({
    brandId: 'brand-1',
    brandName: 'Brand',
    stageSize: { width: 720, height: 900 },
    garment: {
      sourceUrl: selection.dataUrl,
      referenceType: 'base',
      maskCandidateId: selection.candidateId,
      maskRevision: 2,
    },
    designs: [{
      id: 'design-1',
      sourceUrl: 'data:image/png;base64,DESIGN',
      maskRevision: 3,
      transform: { x: 50, y: 50, scale: 1, rotation: 0, opacity: 1 },
    }],
  });
  const parsed = JSON.parse(signature);

  assert.equal(parsed.garment.sourceUrl, 'data:image/png;base64,STRICT');
  assert.equal(parsed.garment.maskCandidateId, 'strict');
  assert.equal(parsed.garment.maskRevision, 2);
  assert.equal(parsed.designs[0].maskRevision, 3);
});

const artworkFixture = (width: number, height: number, color = [255, 255, 255, 255]) => new Uint8ClampedArray(
  Array.from({ length: width * height }, () => color).flat(),
);

const setFixturePixel = (rgba: Uint8ClampedArray, width: number, x: number, y: number, color: number[]) => {
  rgba.set(color, ((y * width) + x) * 4);
};

test('artwork flood removes only border-connected white background and preserves RGB bytes', () => {
  const width = 7;
  const height = 7;
  const input = artworkFixture(width, height);
  for (let y = 2; y <= 4; y += 1) {
    for (let x = 2; x <= 4; x += 1) setFixturePixel(input, width, x, y, [0, 70, 220, 255]);
  }
  const result = buildPrintArtworkBackgroundCutoutRgba({ rgba: input, width, height });
  assert.equal(result.accepted, true);
  for (let index = 0; index < input.length; index += 4) {
    assert.deepEqual([...result.rgba.slice(index, index + 3)], [...input.slice(index, index + 3)]);
  }
  assert.equal(result.rgba[((3 * width) + 3) * 4 + 3], 255);
  assert.equal(result.rgba[3], 0);
});

test('artwork flood preserves blue and black one-pixel lines that touch the border', () => {
  const width = 9;
  const height = 9;
  const input = artworkFixture(width, height);
  for (let y = 0; y < height; y += 1) setFixturePixel(input, width, 2, y, [0, 70, 220, 255]);
  for (let x = 3; x < 8; x += 1) setFixturePixel(input, width, x, 4, [0, 0, 0, 255]);
  const result = buildPrintArtworkBackgroundCutoutRgba({ rgba: input, width, height });
  assert.equal(result.accepted, true);
  assert.equal(result.rgba[((0 * width) + 2) * 4 + 3], 255);
  assert.equal(result.rgba[((4 * width) + 5) * 4 + 3], 255);
});

test('four-neighbour flood keeps an enclosed white center and rejects unsafe ratios', () => {
  const width = 9;
  const height = 9;
  const input = artworkFixture(width, height);
  for (let y = 2; y <= 6; y += 1) {
    for (let x = 2; x <= 6; x += 1) {
      if (x === 2 || x === 6 || y === 2 || y === 6) setFixturePixel(input, width, x, y, [0, 70, 220, 255]);
    }
  }
  const result = buildPrintArtworkBackgroundCutoutRgba({ rgba: input, width, height });
  assert.equal(result.accepted, true);
  assert.equal(result.rgba[((4 * width) + 4) * 4 + 3], 255);
  assert.equal(isPrintArtworkBackgroundCutoutAcceptable({ sampleSpread: 56, removedRatio: 0.5, retainedRatio: 0.5 }), false);
  assert.equal(isPrintArtworkBackgroundCutoutAcceptable({ sampleSpread: 0, removedRatio: 0.99, retainedRatio: 0.01 }), false);
});

test('mask brush restores source alpha, removes alpha, maps zoomed coordinates, and merges without RGB drift', () => {
  const sourceAlpha = new Uint8ClampedArray([255, 180, 90, 0]);
  const base = new Uint8ClampedArray([0, 0, 90, 0]);
  const kept = paintPrintMaskAlpha({ alpha: base, sourceAlpha, width: 2, height: 2, centerX: 0, centerY: 0, radius: 1, mode: 'keep' });
  assert.equal(kept[0], 255);
  const removed = paintPrintMaskAlpha({ alpha: kept, sourceAlpha, width: 2, height: 2, centerX: 1, centerY: 0, radius: 1, mode: 'remove' });
  assert.equal(removed[1], 0);
  const mapped = mapPrintMaskPointerToImage({ clientX: 60, clientY: 45, rectLeft: 10, rectTop: 5, rectWidth: 100, rectHeight: 80, imageWidth: 200, imageHeight: 160 });
  assert.deepEqual(mapped, { x: 100, y: 80 });
  const source = new Uint8ClampedArray([10, 20, 30, 255, 40, 50, 60, 255]);
  const merged = mergePrintMaskAlpha(source, new Uint8ClampedArray([0, 128]));
  assert.deepEqual([...merged], [10, 20, 30, 0, 40, 50, 60, 128]);
});

test('edge-connected matte removes the border background but preserves enclosed white foreground', () => {
  const width = 5;
  const height = 5;
  const rgba = new Uint8ClampedArray(width * height * 4).fill(255);
  const paintBlue = (x: number, y: number) => {
    const index = ((y * width) + x) * 4;
    rgba[index] = 20;
    rgba[index + 1] = 70;
    rgba[index + 2] = 220;
  };
  for (let x = 1; x <= 3; x += 1) {
    paintBlue(x, 1);
    paintBlue(x, 3);
  }
  paintBlue(1, 2);
  paintBlue(3, 2);

  const result = buildEdgeConnectedSoftAlphaMatte({ rgba, width, height });
  assert.equal(result.accepted, true);
  assert.equal(result.rgba[3], 0);
  assert.equal(result.rgba[((2 * width) + 2) * 4 + 3], 255);
  assert.deepEqual(
    [...result.rgba.slice(((2 * width) + 2) * 4, ((2 * width) + 2) * 4 + 3)],
    [255, 255, 255],
  );
});

test('boundary decontamination changes only partial-alpha RGB', () => {
  const input = new Uint8ClampedArray([
    120, 80, 40, 255,
    210, 180, 170, 128,
    10, 20, 30, 0,
  ]);
  const output = decontaminateBoundaryRgb({ rgba: input, background: { r: 255, g: 255, b: 255 } });
  assert.deepEqual([...output.slice(0, 4)], [120, 80, 40, 255]);
  assert.equal(output[7], 128);
  assert.deepEqual([...output.slice(8, 12)], [10, 20, 30, 0]);
  assert.notDeepEqual([...output.slice(4, 7)], [...input.slice(4, 7)]);
});

test('manual add restores immutable source RGB while erase only changes alpha', () => {
  const source = new Uint8ClampedArray([30, 60, 220, 255]);
  const transparent = new Uint8ClampedArray([0, 0, 0, 0]);
  const added = applyManualMaskBrushStroke({
    currentRgba: transparent,
    sourceRgba: source,
    width: 1,
    height: 1,
    centerX: 0,
    centerY: 0,
    radius: 2,
    mode: 'add',
  });
  assert.deepEqual([...added], [30, 60, 220, 255]);
  const erased = applyManualMaskBrushStroke({
    currentRgba: added,
    sourceRgba: source,
    width: 1,
    height: 1,
    centerX: 0,
    centerY: 0,
    radius: 2,
    mode: 'erase',
  });
  assert.deepEqual([...erased.slice(0, 3)], [30, 60, 220]);
  assert.equal(erased[3], 0);
});

test('fabric modulation preserves alpha and geometry and only applies bounded RGB luminance', () => {
  const design = new Uint8ClampedArray([
    100, 150, 200, 255,
    50, 60, 70, 0,
  ]);
  const garment = new Uint8ClampedArray([
    128, 128, 128, 255,
    255, 255, 255, 0,
  ]);
  const output = applyFabricLuminanceModulation({ designRgba: design, garmentRgba: garment });
  assert.equal(output[3], 255);
  assert.equal(output[7], 0);
  assert.deepEqual([...output.slice(4, 7)], [50, 60, 70]);
  assert.ok(output[0] >= 82 && output[0] <= 108);
  assert.deepEqual(
    Array.from({ length: 2 }, (_, index) => output[index * 4 + 3]),
    Array.from({ length: 2 }, (_, index) => design[index * 4 + 3]),
  );
});

test('fabric modulation can add bounded local fold contrast when stage dimensions are known', () => {
  const design = new Uint8ClampedArray(3 * 3 * 4).fill(0);
  const garment = new Uint8ClampedArray(3 * 3 * 4).fill(0);
  for (let index = 0; index < 9; index += 1) {
    const offset = index * 4;
    design[offset] = 100;
    design[offset + 1] = 100;
    design[offset + 2] = 100;
    design[offset + 3] = 255;
    garment[offset] = 120;
    garment[offset + 1] = 120;
    garment[offset + 2] = 120;
    garment[offset + 3] = 255;
  }
  garment[4 * 4] = 180;
  garment[(4 * 4) + 1] = 180;
  garment[(4 * 4) + 2] = 180;
  const output = applyFabricLuminanceModulation({ designRgba: design, garmentRgba: garment, width: 3, height: 3 });
  assert.ok(output[4 * 4] > output[0]);
  assert.ok(output[4 * 4] <= 108);
  assert.deepEqual(Array.from(output, (_, index) => index % 4 === 3 ? output[index] : undefined).filter((value) => value !== undefined), Array(9).fill(255));
});

test('source-over helper matches the expected half-alpha exact composite', () => {
  const output = sourceOverRgbaPixel([200, 0, 0, 128], [100, 100, 100, 255]);
  assert.deepEqual(output, [150, 50, 50, 255]);
});

test('print result history keeps newest results first and is bounded to eight', () => {
  const next = [{ id: 'new-exact' }, { id: 'new-fabric' }];
  const previous = Array.from({ length: 8 }, (_, index) => ({ id: `old-${index}` }));
  const history = mergePrintResultHistory(next, previous);
  assert.equal(history.length, 8);
  assert.deepEqual(history.slice(0, 2), next);
  assert.equal(history.at(-1)?.id, 'old-5');
});

test('delayed surface result keeps exact and fabric first and rejects an old run', () => {
  const exact = { id: 'run-2-exact' };
  const fabric = { id: 'run-2-fabric' };
  const history = [exact, fabric, { id: 'run-1-exact' }, { id: 'run-1-fabric' }];
  assert.deepEqual(
    mergeDelayedSurfaceResult({
      currentResults: history,
      exactId: exact.id,
      fabricId: fabric.id,
      surfaceResult: { id: 'run-2-surface' },
    }).map((result) => result.id),
    ['run-2-exact', 'run-2-fabric', 'run-2-surface', 'run-1-exact', 'run-1-fabric'],
  );
  assert.deepEqual(
    mergeDelayedSurfaceResult({
      currentResults: history,
      exactId: 'run-1-exact',
      fabricId: 'run-1-fabric',
      surfaceResult: { id: 'run-1-surface' },
    }),
    history,
  );
});

test('manual candidate can be selected and is represented in request identity', () => {
  const candidates = [{
    candidateId: 'manual' as const,
    result: { dataUrl: 'data:image/png;base64,MANUAL' },
  }];
  const selection = selectPrintGarmentMaskCandidateValue(candidates, 'manual');
  const signature = buildPrintRequestSignatureValue({
    brandId: 'brand-1',
    brandName: 'Brand',
    stageSize: { width: 720, height: 900 },
    garment: {
      sourceUrl: selection.dataUrl,
      referenceType: 'base',
      maskCandidateId: selection.candidateId,
      maskRevision: 1,
    },
    designs: [],
  });
  assert.equal(JSON.parse(signature).garment.maskCandidateId, 'manual');
});
