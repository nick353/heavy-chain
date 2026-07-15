import assert from 'node:assert/strict';
import test from 'node:test';

import {
  buildSurfaceConformer,
  conformSurface,
  conformSurfaceWithoutPanelProfileWarp,
  SurfaceConformerValidationError,
} from '../src/features/printing/render/surfaceConformer.ts';

const SOURCE = { width: 1024, height: 512 } as const;
const DESIGN = { width: 128, height: 128 } as const;
const GARMENT = { width: 128, height: 128 } as const;

const rgbaPlane = (width: number, height: number, fill: [number, number, number, number]) => {
  const rgba = new Uint8ClampedArray(width * height * 4);
  for (let index = 0; index < rgba.length; index += 4) {
    rgba[index] = fill[0];
    rgba[index + 1] = fill[1];
    rgba[index + 2] = fill[2];
    rgba[index + 3] = fill[3];
  }
  return { width, height, rgba };
};

const alphaPlane = (width: number, height: number, fill: number) => {
  const alpha = new Uint8ClampedArray(width * height);
  alpha.fill(fill);
  return { width, height, alpha };
};

const largeSource = (fillA = 255) => rgbaPlane(SOURCE.width, SOURCE.height, [128, 128, 128, fillA]);

const byteIdentical = (left: Uint8ClampedArray, right: Uint8ClampedArray) => Buffer.compare(Buffer.from(left), Buffer.from(right)) === 0;

const mapToPlaneCoordinateExpected = (coord: number, sourceSize: number, targetSize: number) => {
  if (sourceSize <= 1 || targetSize <= 1) return 0;
  return (coord * (sourceSize - 1)) / (targetSize - 1);
};

const sampleRgbaBilinearExpected = (rgba: Uint8ClampedArray, width: number, height: number, x: number, y: number) => {
  const clampedX = Math.min(width - 1, Math.max(0, x));
  const clampedY = Math.min(height - 1, Math.max(0, y));
  const x0 = Math.floor(clampedX);
  const y0 = Math.floor(clampedY);
  const x1 = Math.min(width - 1, x0 + 1);
  const y1 = Math.min(height - 1, y0 + 1);
  const fx = clampedX - x0;
  const fy = clampedY - y0;
  const w00 = (1 - fx) * (1 - fy);
  const w10 = fx * (1 - fy);
  const w01 = (1 - fx) * fy;
  const w11 = fx * fy;
  const i00 = ((y0 * width) + x0) * 4;
  const i10 = ((y0 * width) + x1) * 4;
  const i01 = ((y1 * width) + x0) * 4;
  const i11 = ((y1 * width) + x1) * 4;
  return [
    Math.round((rgba[i00] * w00) + (rgba[i10] * w10) + (rgba[i01] * w01) + (rgba[i11] * w11)),
    Math.round((rgba[i00 + 1] * w00) + (rgba[i10 + 1] * w10) + (rgba[i01 + 1] * w01) + (rgba[i11 + 1] * w11)),
    Math.round((rgba[i00 + 2] * w00) + (rgba[i10 + 2] * w10) + (rgba[i01 + 2] * w01) + (rgba[i11 + 2] * w11)),
    Math.round((rgba[i00 + 3] * w00) + (rgba[i10 + 3] * w10) + (rgba[i01 + 3] * w01) + (rgba[i11 + 3] * w11)),
  ] as const;
};

const gradientDesign = (width: number, height: number) => {
  const rgba = new Uint8ClampedArray(width * height * 4);
  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) {
      const index = ((y * width) + x) * 4;
      const red = Math.round((x / Math.max(1, width - 1)) * 255);
      const green = Math.round((y / Math.max(1, height - 1)) * 255);
      rgba[index] = red;
      rgba[index + 1] = green;
      rgba[index + 2] = 255 - red;
      rgba[index + 3] = 255;
    }
  }
  return { width, height, rgba };
};

const nonlinearDesign = (width: number, height: number) => {
  const rgba = new Uint8ClampedArray(width * height * 4);
  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) {
      const index = ((y * width) + x) * 4;
      rgba[index] = (x * x + (y * 17)) % 256;
      rgba[index + 1] = ((x * 13) + (y * y) + 31) % 256;
      rgba[index + 2] = ((x * 7) + (y * 11) + ((x * y) % 256)) % 256;
      rgba[index + 3] = 255;
    }
  }
  return { width, height, rgba };
};

const buildPanelReferenceClip = (width: number, height: number) => profileClip(width, height, (y) => {
  if (y < 16 || y > 111) return [];
  if (y <= 34) return [[50, 250]];
  if (y <= 62) return [[80, 280]];
  if (y <= 64) return [[100, 300]];
  if (y <= 92) return [[120, 320]];
  return [[50, 250]];
});

const buildPanelExpectedRgba = ({
  design,
  garmentWidth,
  garmentHeight,
  x,
  y,
  rowCenter,
  refCenter,
  rowWidth,
  refWidth,
}: {
  design: { width: number; height: number; rgba: Uint8ClampedArray };
  garmentWidth: number;
  garmentHeight: number;
  x: number;
  y: number;
  rowCenter: number;
  refCenter: number;
  rowWidth: number;
  refWidth: number;
}) => {
  const rowScale = rowWidth / refWidth;
  const clampedRowScale = Math.min(1.2, Math.max(0.8, rowScale));
  const sourceStageX = refCenter + ((x - rowCenter) / clampedRowScale);
  const panelLimit = Math.min(12, garmentWidth * 0.02);
  const panelStageDx = Math.min(panelLimit, Math.max(-panelLimit, sourceStageX - x));
  const panelDesignX = mapToPlaneCoordinateExpected(x + panelStageDx, design.width, garmentWidth);
  const panelDesignY = mapToPlaneCoordinateExpected(y, design.height, garmentHeight);
  return sampleRgbaBilinearExpected(design.rgba, design.width, design.height, panelDesignX, panelDesignY);
};

const profileClip = (
  width: number,
  height: number,
  rows: (y: number) => Array<[number, number]>,
) => {
  const alpha = new Uint8ClampedArray(width * height);
  for (let y = 0; y < height; y += 1) {
    for (const [start, end] of rows(y)) {
      for (let x = Math.max(0, start); x <= Math.min(width - 1, end); x += 1) {
        alpha[(y * width) + x] = 255;
      }
    }
  }
  return { width, height, alpha };
};

const insetAlpha = (width: number, height: number, inset: number, fill: number) => {
  const plane = alphaPlane(width, height, 0);
  for (let y = inset; y < height - inset; y += 1) {
    for (let x = inset; x < width - inset; x += 1) {
      plane.alpha[(y * width) + x] = fill;
    }
  }
  return plane;
};

const conformerInput = (overrides?: Partial<Parameters<typeof conformSurface>[0]>) => ({
  source: largeSource(),
  design: rgbaPlane(DESIGN.width, DESIGN.height, [220, 110, 50, 255]),
  garment: alphaPlane(GARMENT.width, GARMENT.height, 255),
  clip: alphaPlane(GARMENT.width, GARMENT.height, 255),
  ...overrides,
});

test('buildSurfaceConformer aliases conformSurface', () => {
  assert.equal(buildSurfaceConformer, conformSurface);
});

test('panel profile warp keeps a full rectangle byte-identical to the disabled export', () => {
  const input = {
    source: largeSource(),
    design: gradientDesign(192, 128),
    garment: alphaPlane(128, 128, 255),
    clip: insetAlpha(128, 128, 16, 255),
  };
  const enabled = conformSurface(input);
  const disabled = conformSurfaceWithoutPanelProfileWarp(input);
  assert.equal(enabled.kind, 'success');
  assert.equal(disabled.kind, 'success');
  assert.ok(enabled.diagnostics.panelWarpApplied);
  assert.equal(enabled.diagnostics.panelProfileCoverage > 0.72, true);
  assert.equal(enabled.diagnostics.panelWidthVariation, 0);
  assert.equal(enabled.diagnostics.maxPanelDisplacement, 0);
  assert.ok(byteIdentical(enabled.rgba, disabled.rgba));
});

test('panel profile warp enables on a stable mid-span inset profile', () => {
  const clip = profileClip(160, 160, (y) => {
    if (y < 32 || y > 127) return [];
    return [[24, 135]];
  });
  const result = conformSurface({
    source: largeSource(),
    design: gradientDesign(224, 160),
    garment: alphaPlane(160, 160, 255),
    clip,
  });
  assert.equal(result.kind, 'success');
  assert.equal(result.diagnostics.panelWarpApplied, true);
  assert.ok(result.diagnostics.panelProfileCoverage >= 0.5);
  assert.ok(result.diagnostics.panelProfileCoverage <= 1);
  assert.equal(result.diagnostics.maxPanelDisplacement, 0);
});

test('panel profile warp matches independently computed exact coordinates and clamp bounds', () => {
  const garmentWidth = 400;
  const garmentHeight = 160;
  const design = nonlinearDesign(613, 173);
  const clip = buildPanelReferenceClip(garmentWidth, garmentHeight);
  const result = conformSurface({
    source: largeSource(),
    design,
    garment: alphaPlane(garmentWidth, garmentHeight, 255),
    clip,
  });
  assert.equal(result.kind, 'success');
  assert.equal(result.diagnostics.panelWarpApplied, true);
  assert.equal(result.diagnostics.panelProfileCoverage, 1);
  assert.equal(result.diagnostics.maxPanelDisplacement, 8);

  const refCenter = 200;
  const refWidth = 201;
  const rowWidth = 201;

  const lowProbeX = 150;
  const lowProbeY = 20;
  const lowIndex = ((lowProbeY * garmentWidth) + lowProbeX) * 4;
  assert.deepEqual(
    [...result.rgba.slice(lowIndex, lowIndex + 4)],
    [...buildPanelExpectedRgba({
      design,
      garmentWidth,
      garmentHeight,
      x: lowProbeX,
      y: lowProbeY,
      rowCenter: 150,
      refCenter,
      rowWidth,
      refWidth,
    })],
  );

  const midProbeX = 200;
  const midProbeY = 64;
  const midIndex = ((midProbeY * garmentWidth) + midProbeX) * 4;
  assert.deepEqual(
    [...result.rgba.slice(midIndex, midIndex + 4)],
    [...buildPanelExpectedRgba({
      design,
      garmentWidth,
      garmentHeight,
      x: midProbeX,
      y: midProbeY,
      rowCenter: 200,
      refCenter,
      rowWidth,
      refWidth,
    })],
  );
});

test('panel profile warp shifts a trapezoid in the expected direction and clamps stage displacement', () => {
  const garment = 640;
  const design = 960;
  const clip = profileClip(garment, 160, (y) => {
    if (y < 16 || y > 143) return [];
    const t = (y - 16) / 127;
    const centerShift = Math.round(-60 + (120 * t));
    const width = Math.round(336 + (16 * Math.sin(t * Math.PI)));
    const center = 320 + centerShift;
    const start = Math.max(0, Math.round(center - (width / 2)));
    const end = Math.min(garment - 1, start + width - 1);
    return [[start, end]];
  });
  const input = {
    source: largeSource(),
    design: gradientDesign(design, 160),
    garment: alphaPlane(garment, 160, 255),
    clip,
  };
  const enabled = conformSurface(input);
  const disabled = conformSurfaceWithoutPanelProfileWarp(input);
  assert.equal(enabled.kind, 'success');
  assert.equal(disabled.kind, 'success');
  assert.ok(enabled.diagnostics.panelWarpApplied);
  assert.ok(enabled.diagnostics.panelProfileCoverage > 0.72);
  assert.ok(enabled.diagnostics.panelWidthVariation > 0);
  assert.equal(enabled.diagnostics.maxPanelDisplacement, 12);

  const topIndex = ((28 * garment) + 128) * 4;
  const midIndex = ((80 * garment) + 320) * 4;
  const bottomIndex = ((132 * garment) + 512) * 4;

  assert.ok(enabled.rgba[topIndex] > disabled.rgba[topIndex]);
  assert.ok(Math.abs(enabled.rgba[midIndex] - disabled.rgba[midIndex]) <= 2);
  assert.ok(enabled.rgba[bottomIndex] < disabled.rgba[bottomIndex]);
  assert.ok(!byteIdentical(enabled.rgba, disabled.rgba));
});

test('panel profile warp early-returns disabled for width under 96 at the pixel budget edge', () => {
  const width = 1;
  const height = 1_000_000;
  const input = {
    source: rgbaPlane(width, height, [128, 128, 128, 255]),
    design: rgbaPlane(width, height, [42, 84, 126, 255]),
    garment: alphaPlane(width, height, 255),
    clip: alphaPlane(width, height, 255),
    sourceReferenceSize: { width: 1024, height: 1_000_000 },
  };
  const startedAt = Date.now();
  const result = conformSurface(input);
  const elapsedMs = Date.now() - startedAt;
  assert.equal(result.kind, 'ood');
  assert.equal(result.domain, 'SURFACE_TOO_SMALL');
  assert.equal(result.diagnostics.panelWarpApplied, false);
  // This is a runaway-work watchdog, not a host-performance benchmark. Keep
  // enough headroom for the full parallel foundation gate on slower CI hosts.
  assert.ok(elapsedMs < 10_000);
});

test('panel profile warp respects short live deadlines and the disabled export matches the same timeout', () => {
  const garmentWidth = 400;
  const garmentHeight = 400;
  const input = {
    source: largeSource(),
    design: nonlinearDesign(613, 173),
    garment: alphaPlane(garmentWidth, garmentHeight, 255),
    clip: profileClip(garmentWidth, garmentHeight, (y) => {
      if (y < 16 || y > 383) return [];
      return [[80, 319]];
    }),
    deadlineAtMs: Date.now() + 1,
  };
  const startedAt = Date.now();
  assert.throws(
    () => conformSurface(input),
    (error) => error instanceof SurfaceConformerValidationError
      && error.code === 'SURFACE_CONFORMER_DEADLINE_EXCEEDED',
  );
  assert.throws(
    () => conformSurfaceWithoutPanelProfileWarp(input),
    (error) => error instanceof SurfaceConformerValidationError
      && error.code === 'SURFACE_CONFORMER_DEADLINE_EXCEEDED',
  );
  assert.ok(Date.now() - startedAt < 4000);
});

test('holes, left-right splits, and missing rows disable panel warp and stay byte-identical to the disabled export', () => {
  const baseInput = {
    source: largeSource(),
    design: gradientDesign(192, 128),
    garment: alphaPlane(128, 128, 255),
    clip: insetAlpha(128, 128, 16, 255),
  };

  const holeClip = profileClip(128, 128, (y) => {
    if (y < 16 || y > 111) return [];
    if (y === 64) return [[16, 47], [80, 111]];
    return [[16, 111]];
  });
  const splitClip = profileClip(128, 128, (y) => {
    if (y < 16 || y > 111) return [];
    return [[16, 47], [80, 111]];
  });
  const gapClip = profileClip(128, 128, (y) => {
    if (y < 16 || y > 111) return [];
    if (y >= 56 && y <= 63) return [];
    return [[16, 111]];
  });

  for (const clip of [holeClip, splitClip, gapClip]) {
    const enabled = conformSurface({ ...baseInput, clip });
    const disabled = conformSurfaceWithoutPanelProfileWarp({ ...baseInput, clip });
    assert.equal(enabled.kind, 'success');
    assert.equal(disabled.kind, 'success');
    assert.equal(enabled.diagnostics.panelWarpApplied, false);
    assert.equal(enabled.diagnostics.maxPanelDisplacement, 0);
    assert.ok(byteIdentical(enabled.rgba, disabled.rgba));
  }
});

test('adaptive mesh mode tolerates short occlusions and follows the dominant printable panel', () => {
  const width = 192;
  const height = 192;
  const clip = profileClip(width, height, (y) => {
    if (y < 28 || y > 163) return [];
    if (y >= 82 && y <= 84) return [];
    const t = (y - 28) / 135;
    const center = 96 + Math.round((t - 0.5) * 24);
    const rowWidth = 122 + Math.round(10 * Math.sin(t * Math.PI));
    const left = Math.round(center - (rowWidth / 2));
    if (y === 72) return [[left - 42, left - 8], [left, left + rowWidth - 1]];
    return [[left, left + rowWidth - 1]];
  });
  const base = {
    source: largeSource(),
    design: gradientDesign(256, height),
    garment: alphaPlane(width, height, 255),
    clip,
  };
  const legacy = conformSurface(base);
  const adaptive = conformSurface({ ...base, surfaceWarpMode: 'adaptive' });
  const disabled = conformSurfaceWithoutPanelProfileWarp(base);

  assert.equal(legacy.kind, 'success');
  assert.equal(adaptive.kind, 'success');
  assert.equal(disabled.kind, 'success');
  assert.equal(legacy.diagnostics.panelWarpApplied, false);
  assert.equal(adaptive.diagnostics.surfaceWarpMode, 'adaptive');
  assert.equal(adaptive.diagnostics.panelWarpApplied, true);
  assert.ok(adaptive.diagnostics.panelProfileCoverage >= 0.72);
  assert.ok(adaptive.diagnostics.maxPanelDisplacement > 0);
  assert.ok(adaptive.diagnostics.panelVerticalDisplacement > 0);
  assert.ok(!byteIdentical(adaptive.rgba, disabled.rgba));
});

test('returns a freeze-safe success result for a centered visible design', () => {
  const input = conformerInput({
    design: rgbaPlane(DESIGN.width, DESIGN.height, [220, 110, 50, 0]),
    garment: alphaPlane(GARMENT.width, GARMENT.height, 255),
    clip: insetAlpha(GARMENT.width, GARMENT.height, 16, 255),
  });
  input.design = rgbaPlane(DESIGN.width, DESIGN.height, [220, 110, 50, 255]);
  const sourceClone = new Uint8ClampedArray(input.source.rgba);
  const designClone = new Uint8ClampedArray(input.design.rgba);

  const result = conformSurface(input);

  assert.equal(result.kind, 'success');
  assert.equal(result.rgba.length, GARMENT.width * GARMENT.height * 4);
  assert.equal(result.diagnostics.version, 'surface-conformer-diagnostics-v1');
  assert.equal(result.diagnostics.sourceTooSmall, false);
  assert.ok(result.diagnostics.effectiveDesignVisiblePixels >= 256);
  assert.ok(result.diagnostics.designVisiblePixels >= 256);
  assert.ok(result.diagnostics.surfaceVisiblePixels >= 256);
  assert.equal(result.diagnostics.surfaceTouchesFrame, false);
  assert.equal(result.diagnostics.maxDisplacement, 0);
  assert.equal(result.diagnostics.shadeMin, 1);
  assert.equal(result.diagnostics.shadeMax, 1);
  assert.equal(result.diagnostics.surfaceBounds.width, 96);
  assert.equal(result.diagnostics.surfaceBounds.height, 96);
  assert.doesNotThrow(() => Object.freeze(JSON.parse(JSON.stringify(result.diagnostics))));
  assert.deepEqual([...input.source.rgba], [...sourceClone]);
  assert.deepEqual([...input.design.rgba], [...designClone]);
  const centerIndex = ((64 * GARMENT.width) + 64) * 4;
  assert.deepEqual([...result.rgba.slice(centerIndex, centerIndex + 4)], [220, 110, 50, 255]);
  const edgeIndex = ((0 * GARMENT.width) + 0) * 4;
  assert.deepEqual([...result.rgba.slice(edgeIndex, edgeIndex + 4)], [0, 0, 0, 0]);
});

test('rejects sources below the fixed long-edge or short-edge gate', () => {
  const result = conformSurface({
    source: rgbaPlane(800, 600, [128, 128, 128, 255]),
    design: rgbaPlane(DESIGN.width, DESIGN.height, [220, 110, 50, 255]),
    garment: alphaPlane(GARMENT.width, GARMENT.height, 255),
    clip: alphaPlane(GARMENT.width, GARMENT.height, 255),
  });
  assert.equal(result.kind, 'ood');
  assert.equal(result.domain, 'SOURCE_TOO_SMALL');
});

test('rejects designs that stay invisible after conforming', () => {
  const result = conformSurface({
    source: largeSource(),
    design: rgbaPlane(DESIGN.width, DESIGN.height, [220, 110, 50, 0]),
    garment: alphaPlane(GARMENT.width, GARMENT.height, 255),
    clip: alphaPlane(GARMENT.width, GARMENT.height, 255),
  });
  assert.equal(result.kind, 'ood');
  assert.equal(result.domain, 'DESIGN_NOT_VISIBLE');
});

test('rejects garments that are too small even when the source is valid', () => {
  const result = conformSurface({
    source: largeSource(),
    design: rgbaPlane(96, 96, [220, 110, 50, 255]),
    garment: alphaPlane(90, 90, 255),
    clip: alphaPlane(90, 90, 255),
  });
  assert.equal(result.kind, 'ood');
  assert.equal(result.domain, 'SURFACE_TOO_SMALL');
});

test('rejects designs that touch the output frame', () => {
  const result = conformSurface({
    source: largeSource(),
    design: rgbaPlane(DESIGN.width, DESIGN.height, [220, 110, 50, 255]),
    garment: alphaPlane(GARMENT.width, GARMENT.height, 255),
    clip: alphaPlane(GARMENT.width, GARMENT.height, 255),
  });
  assert.equal(result.kind, 'ood');
  assert.equal(result.domain, 'SURFACE_TOUCHES_FRAME');
});

test('rejects clipped luminance overload before high-frequency overload', () => {
  const result = conformSurface({
    source: rgbaPlane(SOURCE.width, SOURCE.height, [0, 0, 0, 255]),
    design: rgbaPlane(DESIGN.width, DESIGN.height, [220, 110, 50, 255]),
    garment: alphaPlane(GARMENT.width, GARMENT.height, 255),
    clip: insetAlpha(GARMENT.width, GARMENT.height, 16, 255),
  });
  assert.equal(result.kind, 'ood');
  assert.equal(result.domain, 'LUMINANCE_CLIPPING_EXCESS');
});

test('rejects high-frequency sources when luminance clipping stays below threshold', () => {
  const source = rgbaPlane(SOURCE.width, SOURCE.height, [0, 0, 0, 255]);
  for (let y = 0; y < SOURCE.height; y += 1) {
    for (let x = 0; x < SOURCE.width; x += 1) {
      const index = ((y * SOURCE.width) + x) * 4;
      const value = ((x + y) % 2 === 0) ? 32 : 224;
      source.rgba[index] = value;
      source.rgba[index + 1] = value;
      source.rgba[index + 2] = value;
      source.rgba[index + 3] = 255;
    }
  }
  const result = conformSurface({
    source,
    design: rgbaPlane(DESIGN.width, DESIGN.height, [220, 110, 50, 255]),
    garment: alphaPlane(GARMENT.width, GARMENT.height, 255),
    clip: insetAlpha(GARMENT.width, GARMENT.height, 16, 255),
  });
  assert.equal(result.kind, 'ood');
  assert.equal(result.domain, 'HIGH_FREQUENCY_EXCESS');
});

test('honours partial alpha as round(designAlpha * clipAlpha / 255)', () => {
  const result = conformSurface({
    source: largeSource(),
    design: rgbaPlane(DESIGN.width, DESIGN.height, [120, 80, 40, 128]),
    garment: alphaPlane(GARMENT.width, GARMENT.height, 255),
    clip: insetAlpha(GARMENT.width, GARMENT.height, 16, 255),
  });
  assert.equal(result.kind, 'success');
  const centerIndex = ((64 * GARMENT.width) + 64) * 4;
  assert.equal(result.rgba[centerIndex + 3], 128);
});

test('occluder alpha removes the print while keeping the surrounding conformer output', () => {
  const occluder = alphaPlane(GARMENT.width, GARMENT.height, 0);
  const centerIndex = (64 * GARMENT.width) + 64;
  const partialIndex = (64 * GARMENT.width) + 65;
  occluder.alpha[centerIndex] = 255;
  occluder.alpha[partialIndex] = 128;
  const result = conformSurface({
    source: largeSource(),
    design: rgbaPlane(DESIGN.width, DESIGN.height, [120, 80, 40, 255]),
    garment: alphaPlane(GARMENT.width, GARMENT.height, 255),
    clip: insetAlpha(GARMENT.width, GARMENT.height, 16, 255),
    occluder,
  });
  assert.equal(result.kind, 'success');
  assert.equal(result.rgba[centerIndex * 4 + 3], 0);
  assert.equal(result.rgba[partialIndex * 4 + 3], 127);
  const visibleIndex = (64 * GARMENT.width) + 66;
  assert.equal(result.rgba[visibleIndex * 4 + 3], 255);
});

test('keeps identity inside an inset clip and zeroes outside the clip', () => {
  const result = conformSurface({
    source: largeSource(),
    design: rgbaPlane(DESIGN.width, DESIGN.height, [10, 20, 30, 255]),
    garment: alphaPlane(GARMENT.width, GARMENT.height, 255),
    clip: insetAlpha(GARMENT.width, GARMENT.height, 16, 255),
  });
  assert.equal(result.kind, 'success');
  const centerIndex = ((64 * GARMENT.width) + 64) * 4;
  const edgeIndex = ((0 * GARMENT.width) + 0) * 4;
  assert.deepEqual([...result.rgba.slice(centerIndex, centerIndex + 4)], [10, 20, 30, 255]);
  assert.deepEqual([...result.rgba.slice(edgeIndex, edgeIndex + 4)], [0, 0, 0, 0]);
});

test('tracks max displacement on a controlled source gradient', () => {
  const source = rgbaPlane(SOURCE.width, SOURCE.height, [0, 0, 0, 255]);
  for (let y = 0; y < SOURCE.height; y += 1) {
    for (let x = 0; x < SOURCE.width; x += 1) {
      const index = ((y * SOURCE.width) + x) * 4;
      const value = Math.round((x / (SOURCE.width - 1)) * 255);
      source.rgba[index] = value;
      source.rgba[index + 1] = value;
      source.rgba[index + 2] = value;
      source.rgba[index + 3] = 255;
    }
  }
  const result = conformSurface({
    source,
    design: rgbaPlane(DESIGN.width, DESIGN.height, [220, 110, 50, 255]),
    garment: alphaPlane(GARMENT.width, GARMENT.height, 255),
    clip: insetAlpha(GARMENT.width, GARMENT.height, 16, 255),
  });
  assert.equal(result.kind, 'success');
  assert.ok(result.diagnostics.maxDisplacement <= 2);
});

test('treats noisy inside-clip sources deterministically', () => {
  const source = largeSource();
  for (let i = 0; i < source.rgba.length; i += 4) {
    const value = ((i / 4) % 7) * 17;
    source.rgba[i] = value;
    source.rgba[i + 1] = 255 - value;
    source.rgba[i + 2] = value / 2;
    source.rgba[i + 3] = 255;
  }
  const input = {
    source,
    design: rgbaPlane(DESIGN.width, DESIGN.height, [220, 110, 50, 255]),
    garment: alphaPlane(GARMENT.width, GARMENT.height, 255),
    clip: insetAlpha(GARMENT.width, GARMENT.height, 16, 255),
  };
  const first = conformSurface(input);
  const second = conformSurface(input);
  assert.deepEqual(first, second);
});

test('registers frame-touching all-edge clips', () => {
  const result = conformSurface({
    source: largeSource(),
    design: rgbaPlane(DESIGN.width, DESIGN.height, [220, 110, 50, 255]),
    garment: alphaPlane(GARMENT.width, GARMENT.height, 255),
    clip: alphaPlane(GARMENT.width, GARMENT.height, 255),
  });
  assert.equal(result.kind, 'ood');
  assert.equal(result.domain, 'SURFACE_TOUCHES_FRAME');
  assert.ok(result.diagnostics.surfaceEdgeRatio > 0.02);
});

test('rejects malformed dimensions, oversized pixel budgets, bad lengths, and deadlines', () => {
  assert.throws(
    () => conformSurface({
      source: rgbaPlane(0, 512, [128, 128, 128, 255]),
      design: rgbaPlane(DESIGN.width, DESIGN.height, [220, 110, 50, 255]),
      garment: alphaPlane(GARMENT.width, GARMENT.height, 255),
      clip: alphaPlane(GARMENT.width, GARMENT.height, 255),
    }),
    (error) => error instanceof SurfaceConformerValidationError
      && error.code === 'SURFACE_CONFORMER_DIMENSION_INVALID',
  );

  assert.throws(
    () => conformSurface({
      source: rgbaPlane(4001, 4000, [128, 128, 128, 255]),
      design: rgbaPlane(DESIGN.width, DESIGN.height, [220, 110, 50, 255]),
      garment: alphaPlane(GARMENT.width, GARMENT.height, 255),
      clip: alphaPlane(GARMENT.width, GARMENT.height, 255),
    }),
    (error) => error instanceof SurfaceConformerValidationError
      && error.code === 'SURFACE_CONFORMER_PIXEL_LIMIT_EXCEEDED',
  );

  assert.throws(
    () => conformSurface({
      source: largeSource(),
      design: { width: DESIGN.width, height: DESIGN.height, rgba: new Uint8ClampedArray((DESIGN.width * DESIGN.height * 4) - 1) },
      garment: alphaPlane(GARMENT.width, GARMENT.height, 255),
      clip: alphaPlane(GARMENT.width, GARMENT.height, 255),
    }),
    (error) => error instanceof SurfaceConformerValidationError
      && error.code === 'SURFACE_CONFORMER_DESIGN_LENGTH_INVALID',
  );

  assert.throws(
    () => conformSurface({
      source: largeSource(),
      design: rgbaPlane(DESIGN.width, DESIGN.height, [220, 110, 50, 255]),
      garment: { width: GARMENT.width, height: GARMENT.height, alpha: new Uint8ClampedArray((GARMENT.width * GARMENT.height) - 1) },
      clip: alphaPlane(GARMENT.width, GARMENT.height, 255),
    }),
    (error) => error instanceof SurfaceConformerValidationError
      && error.code === 'SURFACE_CONFORMER_GARMENT_LENGTH_INVALID',
  );

  assert.throws(
    () => conformSurface({
      source: largeSource(),
      design: rgbaPlane(DESIGN.width, DESIGN.height, [220, 110, 50, 255]),
      garment: alphaPlane(GARMENT.width, GARMENT.height, 255),
      clip: { width: GARMENT.width, height: GARMENT.height, alpha: new Uint8ClampedArray((GARMENT.width * GARMENT.height) - 1) },
    }),
    (error) => error instanceof SurfaceConformerValidationError
      && error.code === 'SURFACE_CONFORMER_CLIP_LENGTH_INVALID',
  );

  assert.throws(
    () => conformSurface({
      source: largeSource(),
      design: rgbaPlane(DESIGN.width, DESIGN.height, [220, 110, 50, 255]),
      garment: alphaPlane(GARMENT.width, GARMENT.height, 255),
      clip: alphaPlane(GARMENT.width, GARMENT.height, 255),
      deadlineAtMs: -1,
    }),
    (error) => error instanceof SurfaceConformerValidationError
      && error.code === 'SURFACE_CONFORMER_DEADLINE_INVALID',
  );

  assert.throws(
    () => conformSurface({
      source: largeSource(),
      design: rgbaPlane(DESIGN.width, DESIGN.height, [220, 110, 50, 255]),
      garment: alphaPlane(GARMENT.width, GARMENT.height, 255),
      clip: alphaPlane(GARMENT.width, GARMENT.height, 255),
      deadlineAtMs: Date.now() - 1,
    }),
    (error) => error instanceof SurfaceConformerValidationError
      && error.code === 'SURFACE_CONFORMER_DEADLINE_EXCEEDED',
  );
});
