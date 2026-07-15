import assert from 'node:assert/strict';
import test from 'node:test';

import {
  conformBoundedSurfaceRoi,
  BoundedSurfaceConformerRoiValidationError,
} from '../src/features/printing/render/boundedSurfaceConformerRoi.ts';
import { conformSurface } from '../src/features/printing/render/surfaceConformer.ts';

const alphaPlane = (width: number, height: number, fill: number) => {
  const alpha = new Uint8ClampedArray(width * height);
  alpha.fill(fill);
  return { width, height, alpha };
};

const byteIdentical = (left: Uint8ClampedArray, right: Uint8ClampedArray) => Buffer.compare(Buffer.from(left), Buffer.from(right)) === 0;

const cropRgba = (rgba: Uint8ClampedArray, width: number, roi: { left: number; top: number; width: number; height: number }) => {
  const output = new Uint8ClampedArray(roi.width * roi.height * 4);
  for (let row = 0; row < roi.height; row += 1) {
    const sourceStart = (((roi.top + row) * width) + roi.left) * 4;
    output.set(rgba.subarray(sourceStart, sourceStart + (roi.width * 4)), row * roi.width * 4);
  }
  return output;
};

const cropAlpha = (alpha: Uint8ClampedArray, width: number, roi: { left: number; top: number; width: number; height: number }) => {
  const output = new Uint8ClampedArray(roi.width * roi.height);
  for (let row = 0; row < roi.height; row += 1) {
    const sourceStart = ((roi.top + row) * width) + roi.left;
    output.set(alpha.subarray(sourceStart, sourceStart + roi.width), row * roi.width);
  }
  return output;
};

const cropInput = (
  input: {
    source: { width: number; height: number; rgba: Uint8ClampedArray };
    design: { width: number; height: number; rgba: Uint8ClampedArray };
    garment: { width: number; height: number; alpha: Uint8ClampedArray };
    clip: { width: number; height: number; alpha: Uint8ClampedArray };
    occluder?: { width: number; height: number; alpha: Uint8ClampedArray };
    sourceReferenceSize?: { width: number; height: number };
    deadlineAtMs?: number;
  },
  roi: { left: number; top: number; width: number; height: number },
) => ({
  source: {
    width: roi.width,
    height: roi.height,
    rgba: cropRgba(input.source.rgba, input.source.width, roi),
  },
  design: {
    width: roi.width,
    height: roi.height,
    rgba: cropRgba(input.design.rgba, input.design.width, roi),
  },
  garment: {
    width: roi.width,
    height: roi.height,
    alpha: cropAlpha(input.garment.alpha, input.garment.width, roi),
  },
  clip: {
    width: roi.width,
    height: roi.height,
    alpha: cropAlpha(input.clip.alpha, input.clip.width, roi),
  },
  ...(input.occluder ? {
    occluder: {
      width: roi.width,
      height: roi.height,
      alpha: cropAlpha(input.occluder.alpha, input.occluder.width, roi),
    },
  } : {}),
  sourceReferenceSize: input.sourceReferenceSize,
  deadlineAtMs: input.deadlineAtMs,
});

const gradientSource = (width: number, height: number) => {
  const rgba = new Uint8ClampedArray(width * height * 4);
  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) {
      const index = ((y * width) + x) * 4;
      const xRatio = width <= 1 ? 0 : x / (width - 1);
      const yRatio = height <= 1 ? 0 : y / (height - 1);
      // Keep the source comfortably inside the conformer's luminance-clipping
      // domain while retaining non-uniform, asymmetric shading.
      rgba[index] = 112 + Math.round(xRatio * 32);
      rgba[index + 1] = 96 + Math.round(yRatio * 48);
      rgba[index + 2] = 144 - Math.round(xRatio * 24);
      rgba[index + 3] = 255;
    }
  }
  return { width, height, rgba };
};

const gradientDesign = (width: number, height: number) => {
  const rgba = new Uint8ClampedArray(width * height * 4);
  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) {
      const index = ((y * width) + x) * 4;
      const xRatio = width <= 1 ? 0 : x / (width - 1);
      const yRatio = height <= 1 ? 0 : y / (height - 1);
      rgba[index] = Math.round((0.7 * xRatio + 0.1 * yRatio) * 255);
      rgba[index + 1] = Math.round((0.2 + (0.8 * yRatio)) * 255) % 256;
      rgba[index + 2] = Math.round((1 - (0.35 * xRatio) - (0.25 * yRatio)) * 255);
      rgba[index + 3] = 255;
    }
  }
  return { width, height, rgba };
};

const profileClip = (
  width: number,
  height: number,
  rows: (y: number) => Array<[number, number, number]>,
) => {
  const alpha = new Uint8ClampedArray(width * height);
  for (let y = 0; y < height; y += 1) {
    for (const [start, end, value] of rows(y)) {
      for (let x = Math.max(0, start); x <= Math.min(width - 1, end); x += 1) {
        alpha[(y * width) + x] = value;
      }
    }
  }
  return { width, height, alpha };
};

test('forced ROI matches direct conformSurface byte-for-byte on an under-budget asymmetric stage', () => {
  const width = 480;
  const height = 240;
  const input = {
    source: gradientSource(width, height),
    design: gradientDesign(width, height),
    garment: alphaPlane(width, height, 255),
    clip: profileClip(width, height, (y) => {
      if (y < 40 || y > 199) return [];
      const rowShift = Math.round(((y - 40) / 159) * 8);
      return [[120 + rowShift, 359 + rowShift, 255]];
    }),
    sourceReferenceSize: { width: 1200, height: 1200 },
  };

  const direct = conformSurface(input);
  const forced = conformBoundedSurfaceRoi({ ...input, forceRoi: true });

  assert.equal(direct.kind, 'success');
  assert.equal(forced.kind, 'success');
  assert.ok(forced.diagnostics.inner.panelWarpApplied);
  assert.ok(forced.diagnostics.inner.maxPanelDisplacement > 0);
  assert.ok(byteIdentical(direct.rgba, forced.rgba));
  assert.equal(forced.diagnostics.fullStageSize.width, width);
  assert.equal(forced.diagnostics.visibleBounds.alphaGt0?.width, 248);
  assert.equal(forced.diagnostics.visibleBounds.alphaGte8?.width, 248);
});

test('forced ROI forwards an optional occluder byte-for-byte', () => {
  const width = 480;
  const height = 240;
  const occluder = alphaPlane(width, height, 0);
  for (let y = 96; y < 144; y += 1) {
    for (let x = 220; x < 260; x += 1) occluder.alpha[(y * width) + x] = x < 240 ? 255 : 128;
  }
  const input = {
    source: gradientSource(width, height),
    design: gradientDesign(width, height),
    garment: alphaPlane(width, height, 255),
    clip: profileClip(width, height, (y) => y >= 40 && y <= 199 ? [[120, 359, 255]] : []),
    occluder,
    sourceReferenceSize: { width: 1200, height: 1200 },
  };
  const direct = conformSurface(input);
  const forced = conformBoundedSurfaceRoi({ ...input, forceRoi: true });
  assert.equal(direct.kind, 'success');
  assert.equal(forced.kind, 'success');
  assert.ok(byteIdentical(direct.rgba, forced.rgba));
  const hiddenIndex = ((120 * width) + 225) * 4;
  const partialIndex = ((120 * width) + 245) * 4;
  assert.equal(direct.rgba[hiddenIndex + 3], 0);
  assert.equal(direct.rgba[partialIndex + 3], 127);
});

test('forced ROI preserves the adaptive mesh mode for the inner conformer', () => {
  const width = 480;
  const height = 240;
  const input = {
    source: gradientSource(width, height),
    design: gradientDesign(width, height),
    garment: alphaPlane(width, height, 255),
    clip: profileClip(width, height, (y) => y >= 40 && y <= 199 ? [[120, 359, 255]] : []),
    sourceReferenceSize: { width: 1200, height: 1200 },
    surfaceWarpMode: 'adaptive' as const,
  };
  const result = conformBoundedSurfaceRoi({ ...input, forceRoi: true });
  assert.equal(result.kind, 'success');
  assert.equal(result.diagnostics.inner.surfaceWarpMode, 'adaptive');
  assert.equal(result.diagnostics.inner.panelWarpApplied, true);
});

test('ROI output stays transparent outside the crop and preserves halo alpha on 1440x1800', () => {
  const width = 1440;
  const height = 1800;
  const input = {
    source: gradientSource(width, height),
    design: gradientDesign(width, height),
    garment: alphaPlane(width, height, 255),
    clip: profileClip(width, height, (y) => {
      if (y < 640 || y > 1159) return [];
      if (y < 656 || y > 1143) return [[560, 879, 255]];
      return [[544, 895, 4], [560, 879, 255], [880, 895, 4]];
    }),
    sourceReferenceSize: { width: 1800, height: 1800 },
  };

  const result = conformBoundedSurfaceRoi(input);
  assert.equal(result.kind, 'success');
  assert.equal(result.diagnostics.fullStageSize.width, width);
  assert.equal(result.diagnostics.fullStageSize.height, height);
  assert.ok(result.diagnostics.roiBounds.width >= 600);
  assert.ok(result.diagnostics.roiBounds.height < height);
  assert.equal(result.rgba.length, width * height * 4);

  const cornerIndex = 0;
  assert.deepEqual([...result.rgba.slice(cornerIndex, cornerIndex + 4)], [0, 0, 0, 0]);

  const haloIndex = ((700 * width) + 548) * 4;
  assert.equal(result.rgba[haloIndex + 3], 4);

  const centerIndex = ((900 * width) + 720) * 4;
  assert.equal(result.rgba[centerIndex + 3], 255);
  assert.ok(result.diagnostics.visibleBounds.alphaGt0);
  assert.ok(result.diagnostics.visibleBounds.alphaGte8);
});

test('alpha 1-7 contributes to ROI bounds but not frame-contact diagnostics', () => {
  const width = 200;
  const height = 160;
  const input = {
    source: gradientSource(width, height),
    design: gradientDesign(width, height),
    garment: alphaPlane(width, height, 255),
    clip: profileClip(width, height, (y) => {
      if (y < 24 || y > 135) return [];
      if (y === 24 || y === 135) return [[0, 0, 4], [199, 199, 4]];
      return [[52, 147, 255]];
    }),
    sourceReferenceSize: { width: 1200, height: 1200 },
  };

  const result = conformBoundedSurfaceRoi({ ...input, forceRoi: true });
  assert.equal(result.kind, 'success');
  assert.ok(result.diagnostics.visibleBounds.alphaGt0);
  assert.equal(result.diagnostics.visibleBounds.edgeCounts.top, 0);
  assert.equal(result.diagnostics.visibleBounds.edgeCounts.bottom, 0);
});

test('frameContactReference keeps sparse full-stage edge contact below 2% and rejects above 2% when ROI would mislead the crop', () => {
  const width = 800;
  const height = 200;
  const baseInput = {
    source: gradientSource(width, height),
    design: gradientDesign(width, height),
    garment: alphaPlane(width, height, 255),
    clip: profileClip(width, height, (y) => {
      if (y === 0 || y === 199) return [[100, 112, 255]];
      if (y < 40 || y > 159) return [];
      return [[100, 219, 255]];
    }),
    sourceReferenceSize: { width: 1200, height: 1200 },
  };

  const forced = conformBoundedSurfaceRoi({ ...baseInput, forceRoi: true });
  assert.equal(forced.kind, 'success');
  assert.equal(forced.diagnostics.visibleBounds.edgeCounts.top, 13);
  assert.equal(forced.diagnostics.visibleBounds.edgeCounts.bottom, 13);

  const roiCrop = cropInput(baseInput, forced.diagnostics.roiBounds);
  const croppedWithoutReference = conformSurface(roiCrop);
  assert.equal(croppedWithoutReference.kind, 'ood');
  assert.equal(croppedWithoutReference.domain, 'SURFACE_TOUCHES_FRAME');

  const croppedWithReference = conformSurface({
    ...roiCrop,
    frameContactReference: {
      fullStageSize: { width, height },
      edgeCounts: forced.diagnostics.visibleBounds.edgeCounts,
    },
  });
  assert.equal(croppedWithReference.kind, 'success');

  const overThreshold = {
    ...baseInput,
    clip: profileClip(width, height, (y) => {
      if (y === 0 || y === 199) return [[0, 24, 255]];
      if (y < 40 || y > 159) return [];
      return [[100, 219, 255]];
    }),
  };
  const overThresholdForced = conformBoundedSurfaceRoi({ ...overThreshold, forceRoi: true });
  assert.equal(overThresholdForced.kind, 'ood');
  assert.equal(overThresholdForced.domain, 'SURFACE_TOUCHES_FRAME');
});

test('ROI budget, malformed geometry, and deadline failures are typed before crop allocation', () => {
  assert.throws(
    () => conformBoundedSurfaceRoi({
      source: { width: 0, height: 200, rgba: new Uint8ClampedArray(0) },
      design: gradientDesign(200, 200),
      garment: alphaPlane(200, 200, 255),
      clip: alphaPlane(200, 200, 255),
    }),
    (error) => error instanceof BoundedSurfaceConformerRoiValidationError
      && error.code === 'BOUNDED_SURFACE_CONFORMER_DIMENSION_INVALID',
  );

  assert.throws(
    () => conformBoundedSurfaceRoi({
      source: { ...gradientSource(200, 200), rgba: new Uint8ClampedArray((200 * 200 * 4) - 1) },
      design: gradientDesign(200, 200),
      garment: alphaPlane(200, 200, 255),
      clip: alphaPlane(200, 200, 255),
    }),
    (error) => error instanceof BoundedSurfaceConformerRoiValidationError
      && error.code === 'BOUNDED_SURFACE_CONFORMER_SOURCE_LENGTH_INVALID',
  );

  assert.throws(
    () => conformBoundedSurfaceRoi({
      source: gradientSource(1440, 1800),
      design: gradientDesign(1440, 1800),
      garment: alphaPlane(1440, 1800, 255),
      clip: profileClip(1440, 1800, (y) => {
        if (y === 0 || y === 1799) return [[540, 549, 255]];
        return [[540, 549, 255]];
      }),
    }),
    (error) => error instanceof BoundedSurfaceConformerRoiValidationError
      && error.code === 'BOUNDED_SURFACE_CONFORMER_ROI_TOO_LARGE',
  );

  assert.throws(
    () => conformBoundedSurfaceRoi({
      source: gradientSource(200, 200),
      design: gradientDesign(200, 200),
      garment: alphaPlane(200, 200, 255),
      clip: alphaPlane(200, 200, 255),
      deadlineAtMs: Date.now() - 1,
    }),
    (error) => error instanceof BoundedSurfaceConformerRoiValidationError
      && error.code === 'BOUNDED_SURFACE_CONFORMER_DEADLINE_EXCEEDED',
  );

  const originalNow = Date.now;
  let deadlineChecks = 0;
  Date.now = () => {
    deadlineChecks += 1;
    return deadlineChecks > 7 ? 1_001 : 999;
  };
  try {
    assert.throws(
      () => conformBoundedSurfaceRoi({
        source: gradientSource(100, 96),
        sourceReferenceSize: { width: 1200, height: 1200 },
        design: gradientDesign(100, 96),
        garment: alphaPlane(100, 96, 255),
        clip: profileClip(100, 96, (y) => y >= 16 && y <= 79 ? [[16, 83, 255]] : []),
        deadlineAtMs: 1_000,
        forceRoi: true,
      }),
      (error) => error instanceof BoundedSurfaceConformerRoiValidationError
        && error.code === 'BOUNDED_SURFACE_CONFORMER_DEADLINE_EXCEEDED',
    );
    assert.ok(deadlineChecks > 7);
  } finally {
    Date.now = originalNow;
  }
});
