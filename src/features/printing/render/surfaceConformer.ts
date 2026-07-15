export const SURFACE_CONFORMER_MAX_PIXELS = 1_000_000;
const GAUSSIAN_KERNEL = [1, 4, 6, 4, 1] as const;
const MAX_EDGE_RATIO = 0.02;
const MAX_CLIPPED_LUMA_RATIO = 0.15;
const MAX_VISIBLE_HIGH_FREQ_MEAN = 18;
const MAX_VISIBLE_HIGH_FREQ_P95 = 48;

export type SurfaceConformerDomain =
  | 'SOURCE_TOO_SMALL'
  | 'DESIGN_NOT_VISIBLE'
  | 'SURFACE_TOO_SMALL'
  | 'SURFACE_TOUCHES_FRAME'
  | 'LUMINANCE_CLIPPING_EXCESS'
  | 'HIGH_FREQUENCY_EXCESS';

export type SurfaceConformerErrorCode =
  | 'SURFACE_CONFORMER_DIMENSION_INVALID'
  | 'SURFACE_CONFORMER_PIXEL_LIMIT_EXCEEDED'
  | 'SURFACE_CONFORMER_SOURCE_LENGTH_INVALID'
  | 'SURFACE_CONFORMER_DESIGN_LENGTH_INVALID'
  | 'SURFACE_CONFORMER_GARMENT_LENGTH_INVALID'
  | 'SURFACE_CONFORMER_CLIP_LENGTH_INVALID'
  | 'SURFACE_CONFORMER_OCCLUDER_LENGTH_INVALID'
  | 'SURFACE_CONFORMER_FRAME_CONTACT_REFERENCE_INVALID'
  | 'SURFACE_CONFORMER_DEADLINE_INVALID'
  | 'SURFACE_CONFORMER_DEADLINE_EXCEEDED';

export class SurfaceConformerValidationError extends Error {
  readonly code: SurfaceConformerErrorCode;

  constructor(code: SurfaceConformerErrorCode) {
    super(code);
    this.name = 'SurfaceConformerValidationError';
    this.code = code;
  }
}

export type SurfaceConformerRgbaPlane = {
  width: number;
  height: number;
  rgba: Uint8ClampedArray;
};

export type SurfaceConformerAlphaPlane = {
  width: number;
  height: number;
  alpha: Uint8ClampedArray;
};

export type SurfaceConformerFrameContactReference = Readonly<{
  fullStageSize: Readonly<{ width: number; height: number }>;
  edgeCounts: Readonly<{ top: number; bottom: number; left: number; right: number }>;
}>;

export type SurfaceConformerInput = {
  source: SurfaceConformerRgbaPlane;
  sourceReferenceSize?: { width: number; height: number };
  design: SurfaceConformerRgbaPlane;
  garment: SurfaceConformerAlphaPlane;
  clip: SurfaceConformerAlphaPlane;
  /** Optional occluder plane. 255 removes the print while preserving the
   * garment surface for a later occluder re-composition pass. */
  occluder?: SurfaceConformerAlphaPlane;
  frameContactReference?: SurfaceConformerFrameContactReference;
  deadlineAtMs?: number;
};

export type SurfaceConformerDiagnostics = Readonly<{
  version: 'surface-conformer-diagnostics-v1';
  source: Readonly<{ width: number; height: number; pixels: number }>;
  design: Readonly<{ width: number; height: number; pixels: number }>;
  garment: Readonly<{ width: number; height: number; pixels: number }>;
  clip: Readonly<{ width: number; height: number; pixels: number }>;
  surfaceBounds: Readonly<{ left: number; top: number; right: number; bottom: number; width: number; height: number }>;
  sourceTooSmall: boolean;
  effectiveDesignVisiblePixels: number;
  designVisiblePixels: number;
  surfaceVisiblePixels: number;
  surfaceTouchesFrame: boolean;
  surfaceEdgeRatio: number;
  clippedLumaRatio: number;
  meanAbsHigh: number;
  p95AbsHigh: number;
  maxDisplacement: number;
  panelWarpApplied: boolean;
  panelProfileCoverage: number;
  panelWidthVariation: number;
  maxPanelDisplacement: number;
  shadeMin: number;
  shadeMax: number;
}>;

export type SurfaceConformerSuccess = Readonly<{
  kind: 'success';
  rgba: Uint8ClampedArray;
  diagnostics: SurfaceConformerDiagnostics;
}>;

export type SurfaceConformerOod = Readonly<{
  kind: 'ood';
  domain: SurfaceConformerDomain;
  diagnostics: SurfaceConformerDiagnostics;
}>;

export type SurfaceConformerResult = SurfaceConformerSuccess | SurfaceConformerOod;

const clampByte = (value: number) => Math.round(Math.min(255, Math.max(0, value)));
const clamp01 = (value: number) => Math.min(1, Math.max(0, value));
const clampSigned = (value: number) => Math.max(-1, Math.min(1, value));
const clampRange = (value: number, min: number, max: number) => Math.min(max, Math.max(min, value));
const isValidDimension = (value: number) => Number.isSafeInteger(value) && value > 0;

const validateDeadline = (deadlineAtMs?: number) => {
  if (deadlineAtMs === undefined) return;
  if (!Number.isSafeInteger(deadlineAtMs)) {
    throw new SurfaceConformerValidationError('SURFACE_CONFORMER_DEADLINE_INVALID');
  }
  if (deadlineAtMs <= 0) {
    throw new SurfaceConformerValidationError('SURFACE_CONFORMER_DEADLINE_INVALID');
  }
  if (Date.now() > deadlineAtMs) {
    throw new SurfaceConformerValidationError('SURFACE_CONFORMER_DEADLINE_EXCEEDED');
  }
};

const validatePlane = (
  width: number,
  height: number,
  length: number,
  code: SurfaceConformerErrorCode,
) => {
  if (!isValidDimension(width) || !isValidDimension(height)) {
    throw new SurfaceConformerValidationError('SURFACE_CONFORMER_DIMENSION_INVALID');
  }
  if (width > SURFACE_CONFORMER_MAX_PIXELS / height) {
    throw new SurfaceConformerValidationError('SURFACE_CONFORMER_PIXEL_LIMIT_EXCEEDED');
  }
  const pixels = width * height;
  if (length !== pixels) {
    throw new SurfaceConformerValidationError(code);
  }
  return pixels;
};

const validateSurfaceDimensions = (
  source: SurfaceConformerRgbaPlane,
  design: SurfaceConformerRgbaPlane,
  garment: SurfaceConformerAlphaPlane,
  clip: SurfaceConformerAlphaPlane,
  occluder?: SurfaceConformerAlphaPlane,
) => {
  if (source.rgba.length % 4 !== 0) {
    throw new SurfaceConformerValidationError('SURFACE_CONFORMER_SOURCE_LENGTH_INVALID');
  }
  if (design.rgba.length % 4 !== 0) {
    throw new SurfaceConformerValidationError('SURFACE_CONFORMER_DESIGN_LENGTH_INVALID');
  }
  const sourcePixels = validatePlane(source.width, source.height, source.rgba.length / 4, 'SURFACE_CONFORMER_SOURCE_LENGTH_INVALID');
  const designPixels = validatePlane(design.width, design.height, design.rgba.length / 4, 'SURFACE_CONFORMER_DESIGN_LENGTH_INVALID');
  const garmentPixels = validatePlane(garment.width, garment.height, garment.alpha.length, 'SURFACE_CONFORMER_GARMENT_LENGTH_INVALID');
  const clipPixels = validatePlane(clip.width, clip.height, clip.alpha.length, 'SURFACE_CONFORMER_CLIP_LENGTH_INVALID');
  const occluderPixels = occluder
    ? validatePlane(occluder.width, occluder.height, occluder.alpha.length, 'SURFACE_CONFORMER_OCCLUDER_LENGTH_INVALID')
    : undefined;
  if (
    garment.width !== clip.width
    || garment.height !== clip.height
    || (occluder && (garment.width !== occluder.width || garment.height !== occluder.height))
  ) {
    throw new SurfaceConformerValidationError('SURFACE_CONFORMER_DIMENSION_INVALID');
  }
  return { sourcePixels, designPixels, garmentPixels, clipPixels, occluderPixels };
};

const validateFrameContactReference = (reference?: SurfaceConformerFrameContactReference) => {
  if (!reference) return undefined;
  const { fullStageSize, edgeCounts } = reference;
  if (
    !isValidDimension(fullStageSize.width)
    || !isValidDimension(fullStageSize.height)
    || !Number.isSafeInteger(edgeCounts.top)
    || !Number.isSafeInteger(edgeCounts.bottom)
    || !Number.isSafeInteger(edgeCounts.left)
    || !Number.isSafeInteger(edgeCounts.right)
    || edgeCounts.top < 0
    || edgeCounts.bottom < 0
    || edgeCounts.left < 0
    || edgeCounts.right < 0
    || edgeCounts.top > fullStageSize.width
    || edgeCounts.bottom > fullStageSize.width
    || edgeCounts.left > fullStageSize.height
    || edgeCounts.right > fullStageSize.height
  ) {
    throw new SurfaceConformerValidationError('SURFACE_CONFORMER_FRAME_CONTACT_REFERENCE_INVALID');
  }
  return reference;
};

const sampleScalarBilinear = (values: Float32Array, width: number, height: number, x: number, y: number) => {
  const clampedX = clamp01(width <= 1 ? 0 : x / (width - 1)) * (width - 1);
  const clampedY = clamp01(height <= 1 ? 0 : y / (height - 1)) * (height - 1);
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
  const i00 = (y0 * width) + x0;
  const i10 = (y0 * width) + x1;
  const i01 = (y1 * width) + x0;
  const i11 = (y1 * width) + x1;
  return (
    (values[i00] * w00)
    + (values[i10] * w10)
    + (values[i01] * w01)
    + (values[i11] * w11)
  );
};

const sampleAlphaBilinear = (alpha: Uint8ClampedArray, width: number, height: number, x: number, y: number) => {
  const clampedX = clamp01(width <= 1 ? 0 : x / (width - 1)) * (width - 1);
  const clampedY = clamp01(height <= 1 ? 0 : y / (height - 1)) * (height - 1);
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
  const i00 = (y0 * width) + x0;
  const i10 = (y0 * width) + x1;
  const i01 = (y1 * width) + x0;
  const i11 = (y1 * width) + x1;
  return (
    (alpha[i00] * w00)
    + (alpha[i10] * w10)
    + (alpha[i01] * w01)
    + (alpha[i11] * w11)
  );
};

const samplePremultipliedRgba = (rgba: Uint8ClampedArray, width: number, height: number, x: number, y: number) => {
  const clampedX = clamp01(width <= 1 ? 0 : x / (width - 1)) * (width - 1);
  const clampedY = clamp01(height <= 1 ? 0 : y / (height - 1)) * (height - 1);
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

  let pr = 0;
  let pg = 0;
  let pb = 0;
  let pa = 0;

  for (const [sampleX, sampleY, weight] of [
    [x0, y0, w00],
    [x1, y0, w10],
    [x0, y1, w01],
    [x1, y1, w11],
  ] as const) {
    const index = ((sampleY * width) + sampleX) * 4;
    const a = rgba[index + 3] / 255;
    const weightedAlpha = a * weight;
    pr += rgba[index] * weightedAlpha;
    pg += rgba[index + 1] * weightedAlpha;
    pb += rgba[index + 2] * weightedAlpha;
    pa += weightedAlpha;
  }

  if (pa <= 0) {
    return { r: 0, g: 0, b: 0, a: 0 };
  }

  return {
    r: pr / pa,
    g: pg / pa,
    b: pb / pa,
    a: pa * 255,
  };
};

const rec709Luma = (r: number, g: number, b: number) => ((0.2126 * r) + (0.7152 * g) + (0.0722 * b));

const freezeDiagnostics = (diagnostics: SurfaceConformerDiagnostics): SurfaceConformerDiagnostics => Object.freeze({
  ...diagnostics,
  source: Object.freeze({ ...diagnostics.source }),
  design: Object.freeze({ ...diagnostics.design }),
  garment: Object.freeze({ ...diagnostics.garment }),
  clip: Object.freeze({ ...diagnostics.clip }),
});

const buildMaskedGaussianBlur = (
  values: Float32Array,
  weights: Float32Array,
  width: number,
  height: number,
  deadlineAtMs?: number,
) => {
  const pixelCount = width * height;
  let roiWeightSum = 0;
  let roiWeightedValueSum = 0;
  let roiValueSum = 0;

  for (let index = 0; index < pixelCount; index += 1) {
    const weight = weights[index];
    const value = values[index];
    roiValueSum += value;
    if (weight > 0) {
      roiWeightSum += weight;
      roiWeightedValueSum += value * weight;
    }
  }

  const roiMean = roiWeightSum > 0 ? roiWeightedValueSum / roiWeightSum : roiValueSum / Math.max(1, pixelCount);
  const pass1Numerator = new Float32Array(pixelCount);
  const pass1Denominator = new Float32Array(pixelCount);
  const pass2Values = new Float32Array(pixelCount);
  const pass2Denominator = new Float32Array(pixelCount);

  for (let y = 0; y < height; y += 1) {
    if (deadlineAtMs !== undefined && Date.now() > deadlineAtMs) {
      throw new SurfaceConformerValidationError('SURFACE_CONFORMER_DEADLINE_EXCEEDED');
    }
    const row = y * width;
    for (let x = 0; x < width; x += 1) {
      let numerator = 0;
      let denominator = 0;
      for (let offset = -2; offset <= 2; offset += 1) {
        const sampleX = Math.min(width - 1, Math.max(0, x + offset));
        const sampleIndex = row + sampleX;
        const kernel = GAUSSIAN_KERNEL[offset + 2];
        numerator += values[sampleIndex] * weights[sampleIndex] * kernel;
        denominator += weights[sampleIndex] * kernel;
      }
      const index = row + x;
      pass1Numerator[index] = numerator;
      pass1Denominator[index] = denominator;
    }
  }

  for (let y = 0; y < height; y += 1) {
    if (deadlineAtMs !== undefined && Date.now() > deadlineAtMs) {
      throw new SurfaceConformerValidationError('SURFACE_CONFORMER_DEADLINE_EXCEEDED');
    }
    for (let x = 0; x < width; x += 1) {
      let numerator = 0;
      let denominator = 0;
      for (let offset = -2; offset <= 2; offset += 1) {
        const sampleY = Math.min(height - 1, Math.max(0, y + offset));
        const sampleIndex = (sampleY * width) + x;
        const kernel = GAUSSIAN_KERNEL[offset + 2];
        numerator += pass1Numerator[sampleIndex] * kernel;
        denominator += pass1Denominator[sampleIndex] * kernel;
      }
      const index = (y * width) + x;
      pass2Values[index] = denominator > 0 ? numerator / denominator : roiMean;
      pass2Denominator[index] = denominator;
    }
  }

  void pass2Denominator;
  return pass2Values;
};

const mapToPlaneCoordinate = (coord: number, sourceSize: number, targetSize: number) => {
  if (sourceSize <= 1 || targetSize <= 1) return 0;
  return (coord * (sourceSize - 1)) / (targetSize - 1);
};

type PanelProfileRow = Readonly<{
  hasActive: boolean;
  runCount: number;
  left: number;
  right: number;
  width: number;
  center: number;
}>;

type PanelProfileWarpState = Readonly<{
  enabled: boolean;
  refCenter: number;
  refWidth: number;
  coverage: number;
  widthVariation: number;
  rowsByY: ReadonlyArray<PanelProfileRow>;
}>;

const PANEL_PROFILE_ALPHA_THRESHOLD = 64;
const PANEL_PROFILE_MIN_COVERAGE = 0.5;
const PANEL_PROFILE_MAX_WIDTH_VARIATION = 0.18;
const PANEL_PROFILE_ROW_SCALE_MIN = 0.8;
const PANEL_PROFILE_ROW_SCALE_MAX = 1.2;

const throwIfDeadlineExceeded = (deadlineAtMs?: number) => {
  if (deadlineAtMs !== undefined && Date.now() > deadlineAtMs) {
    throw new SurfaceConformerValidationError('SURFACE_CONFORMER_DEADLINE_EXCEEDED');
  }
};

const computeMedian = (values: number[], deadlineAtMs?: number) => {
  if (values.length === 0) return 0;
  throwIfDeadlineExceeded(deadlineAtMs);
  const sorted = [...values].sort((left, right) => left - right);
  throwIfDeadlineExceeded(deadlineAtMs);
  const middle = Math.floor(sorted.length / 2);
  if (sorted.length % 2 === 1) return sorted[middle];
  return (sorted[middle - 1] + sorted[middle]) / 2;
};

const computePercentile = (values: number[], percentile: number, deadlineAtMs?: number) => {
  if (values.length === 0) return 0;
  throwIfDeadlineExceeded(deadlineAtMs);
  const sorted = [...values].sort((left, right) => left - right);
  throwIfDeadlineExceeded(deadlineAtMs);
  const index = clampRange((sorted.length - 1) * percentile, 0, sorted.length - 1);
  const lower = Math.floor(index);
  const upper = Math.ceil(index);
  if (lower === upper) return sorted[lower];
  const weight = index - lower;
  return (sorted[lower] * (1 - weight)) + (sorted[upper] * weight);
};

const buildPanelProfileWarpState = (
  clipAlpha: Uint8ClampedArray,
  width: number,
  height: number,
  enablePanelProfileWarp: boolean,
  deadlineAtMs?: number,
): PanelProfileWarpState => {
  if (!enablePanelProfileWarp || width < 96 || height < 96) {
    return {
      enabled: false,
      refCenter: 0,
      refWidth: 0,
      coverage: 0,
      widthVariation: 0,
      rowsByY: [],
    };
  }

  const rowsByY: PanelProfileRow[] = new Array(height);
  let firstActiveRow = -1;
  let lastActiveRow = -1;

  for (let y = 0; y < height; y += 1) {
    if ((y & 31) === 0) throwIfDeadlineExceeded(deadlineAtMs);
    const rowOffset = y * width;
    let runCount = 0;
    let left = -1;
    let right = -1;
    let hasActive = false;
    let inRun = false;

    for (let x = 0; x < width; x += 1) {
      const active = clipAlpha[rowOffset + x] >= PANEL_PROFILE_ALPHA_THRESHOLD;
      if (active) {
        hasActive = true;
        if (!inRun) {
          runCount += 1;
          if (runCount > 1) {
            break;
          }
          inRun = true;
          if (left === -1) {
            left = x;
          }
        }
        right = x;
      } else if (inRun) {
        inRun = false;
      }
    }

    const rowWidth = runCount === 1 ? (right - left + 1) : 0;
    const rowCenter = runCount === 1 ? (left + right) / 2 : 0;
    const row = Object.freeze({
      hasActive,
      runCount,
      left,
      right,
      width: rowWidth,
      center: rowCenter,
    });
    rowsByY[y] = row;
    if (hasActive) {
      if (firstActiveRow === -1) firstActiveRow = y;
      lastActiveRow = y;
    }
  }

  if (firstActiveRow === -1 || lastActiveRow === -1) {
    return {
      enabled: false,
      refCenter: 0,
      refWidth: 0,
      coverage: 0,
      widthVariation: 0,
      rowsByY,
    };
  }

  const spanRows = lastActiveRow - firstActiveRow + 1;
  const spanSingleRunRows = rowsByY.slice(firstActiveRow, lastActiveRow + 1).filter((row) => row.runCount === 1).length;

  for (let y = firstActiveRow; y <= lastActiveRow; y += 1) {
    throwIfDeadlineExceeded(deadlineAtMs);
    if (rowsByY[y].runCount !== 1) {
      return {
        enabled: false,
        refCenter: 0,
        refWidth: 0,
        coverage: spanSingleRunRows / Math.max(1, spanRows),
        widthVariation: 0,
        rowsByY,
      };
    }
  }

  const smoothedRows = rowsByY.map((row, index) => {
    throwIfDeadlineExceeded(deadlineAtMs);
    const start = Math.max(firstActiveRow, index - 2);
    const end = Math.min(lastActiveRow, index + 2);
    const windowRows = [] as PanelProfileRow[];
    for (let y = start; y <= end; y += 1) {
      throwIfDeadlineExceeded(deadlineAtMs);
      const windowRow = rowsByY[y];
      if (windowRow.runCount === 1) {
        windowRows.push(windowRow);
      }
    }
    if (row.runCount !== 1 || windowRows.length === 0) {
      return row;
    }
    return Object.freeze({
      hasActive: row.hasActive,
      runCount: row.runCount,
      left: computeMedian(windowRows.map((windowRow) => windowRow.left), deadlineAtMs),
      right: computeMedian(windowRows.map((windowRow) => windowRow.right), deadlineAtMs),
      width: computeMedian(windowRows.map((windowRow) => windowRow.width), deadlineAtMs),
      center: computeMedian(windowRows.map((windowRow) => windowRow.center), deadlineAtMs),
    });
  });
  const smoothedActiveRows = smoothedRows.filter((row) => row.runCount === 1);
  const middleStart = Math.floor(smoothedActiveRows.length * 0.2);
  const middleEnd = Math.ceil(smoothedActiveRows.length * 0.8);
  const middleRows = smoothedActiveRows.slice(middleStart, Math.max(middleStart + 1, middleEnd));
  const rowsForReference = middleRows.length > 0 ? middleRows : smoothedActiveRows;
  throwIfDeadlineExceeded(deadlineAtMs);
  const refCenter = computeMedian(rowsForReference.map((row) => row.center), deadlineAtMs);
  throwIfDeadlineExceeded(deadlineAtMs);
  const refWidth = computeMedian(rowsForReference.map((row) => row.width), deadlineAtMs);
  const widths = smoothedActiveRows.map((row) => row.width);
  throwIfDeadlineExceeded(deadlineAtMs);
  const widthVariation = refWidth > 0
    ? (computePercentile(widths, 0.9, deadlineAtMs) - computePercentile(widths, 0.1, deadlineAtMs)) / refWidth
    : Number.POSITIVE_INFINITY;
  const coverage = smoothedActiveRows.length / Math.max(1, spanRows);
  const enabled = coverage >= PANEL_PROFILE_MIN_COVERAGE
    && refWidth >= 96
    && widthVariation <= PANEL_PROFILE_MAX_WIDTH_VARIATION;

  return {
    enabled,
    refCenter,
    refWidth,
    coverage,
    widthVariation,
    rowsByY: smoothedRows,
  };
};

const evaluateDomain = (diagnostics: SurfaceConformerDiagnostics) => {
  if (diagnostics.sourceTooSmall) return 'SOURCE_TOO_SMALL' as const;
  if (diagnostics.designVisiblePixels < 256) {
    return 'DESIGN_NOT_VISIBLE' as const;
  }
  if (diagnostics.surfaceVisiblePixels < 4096 || diagnostics.surfaceBounds.width < 96 || diagnostics.surfaceBounds.height < 96) {
    return 'SURFACE_TOO_SMALL' as const;
  }
  if (diagnostics.surfaceTouchesFrame || diagnostics.surfaceEdgeRatio > MAX_EDGE_RATIO) {
    return 'SURFACE_TOUCHES_FRAME' as const;
  }
  if (diagnostics.clippedLumaRatio > MAX_CLIPPED_LUMA_RATIO) {
    return 'LUMINANCE_CLIPPING_EXCESS' as const;
  }
  if (diagnostics.meanAbsHigh > MAX_VISIBLE_HIGH_FREQ_MEAN || diagnostics.p95AbsHigh > MAX_VISIBLE_HIGH_FREQ_P95) {
    return 'HIGH_FREQUENCY_EXCESS' as const;
  }
  return null;
};

const computeSurfaceEdgeRatio = (
  counts: Readonly<{ top: number; bottom: number; left: number; right: number }>,
  fullStageSize: Readonly<{ width: number; height: number }>,
) => Math.max(
  fullStageSize.width > 0 ? counts.top / fullStageSize.width : 0,
  fullStageSize.width > 0 ? counts.bottom / fullStageSize.width : 0,
  fullStageSize.height > 0 ? counts.left / fullStageSize.height : 0,
  fullStageSize.height > 0 ? counts.right / fullStageSize.height : 0,
);

const conformSurfaceInternal = (
  input: SurfaceConformerInput,
  enablePanelProfileWarp: boolean,
): SurfaceConformerResult => {
  validateDeadline(input.deadlineAtMs);
  if (
    input.sourceReferenceSize
    && (!isValidDimension(input.sourceReferenceSize.width) || !isValidDimension(input.sourceReferenceSize.height))
  ) {
    throw new SurfaceConformerValidationError('SURFACE_CONFORMER_DIMENSION_INVALID');
  }
  const { sourcePixels, designPixels, garmentPixels, clipPixels } = validateSurfaceDimensions(
    input.source,
    input.design,
    input.garment,
    input.clip,
    input.occluder,
  );
  const frameContactReference = validateFrameContactReference(input.frameContactReference);

  const sourceSize = { width: input.source.width, height: input.source.height, pixels: sourcePixels };
  const designSize = { width: input.design.width, height: input.design.height, pixels: designPixels };
  const garmentSize = { width: input.garment.width, height: input.garment.height, pixels: garmentPixels };
  const clipSize = { width: input.clip.width, height: input.clip.height, pixels: clipPixels };

  const sourceLuma = new Float32Array(sourcePixels);
  const sourceWeights = new Float32Array(sourcePixels);
  for (let index = 0; index < sourcePixels; index += 1) {
    const rgbaIndex = index * 4;
    sourceLuma[index] = rec709Luma(
      input.source.rgba[rgbaIndex],
      input.source.rgba[rgbaIndex + 1],
      input.source.rgba[rgbaIndex + 2],
    );
    sourceWeights[index] = input.source.rgba[rgbaIndex + 3] / 255;
  }

  const sourceLowFirstPass = buildMaskedGaussianBlur(sourceLuma, sourceWeights, input.source.width, input.source.height, input.deadlineAtMs);
  const sourceLow = buildMaskedGaussianBlur(sourceLowFirstPass, sourceWeights, input.source.width, input.source.height, input.deadlineAtMs);
  const sourceHigh = new Float32Array(sourcePixels);
  for (let index = 0; index < sourcePixels; index += 1) {
    sourceHigh[index] = sourceLuma[index] - sourceLow[index];
  }

  const panelProfileWarp = buildPanelProfileWarpState(
    input.clip.alpha,
    garmentSize.width,
    garmentSize.height,
    enablePanelProfileWarp,
    input.deadlineAtMs,
  );

  let surfaceMuWeighted = 0;
  let surfaceMuWeight = 0;
  for (let y = 0; y < garmentSize.height; y += 1) {
    if (input.deadlineAtMs !== undefined && Date.now() > input.deadlineAtMs) {
      throw new SurfaceConformerValidationError('SURFACE_CONFORMER_DEADLINE_EXCEEDED');
    }
    for (let x = 0; x < garmentSize.width; x += 1) {
      const clipAlpha = input.clip.alpha[(y * garmentSize.width) + x];
      if (clipAlpha === 0) continue;
      const sourceX = mapToPlaneCoordinate(x, input.source.width, garmentSize.width);
      const sourceY = mapToPlaneCoordinate(y, input.source.height, garmentSize.height);
      const weight = clipAlpha / 255;
      surfaceMuWeighted += sampleScalarBilinear(sourceLow, input.source.width, input.source.height, sourceX, sourceY) * weight;
      surfaceMuWeight += weight;
    }
  }
  const surfaceMu = surfaceMuWeight > 0 ? surfaceMuWeighted / surfaceMuWeight : 0;

  const output = new Uint8ClampedArray(garmentPixels * 4);
  let effectiveDesignVisiblePixels = 0;
  let finalVisiblePixels = 0;
  let surfaceVisiblePixels = 0;
  let clippedLumaWeightSum = 0;
  let clippedLumaTotalWeight = 0;
  let absHighWeightedSum = 0;
  const absHighSamples: number[] = [];
  const visibleByEdge = {
    top: 0,
    bottom: 0,
    left: 0,
    right: 0,
  };
  let boundsLeft = Number.POSITIVE_INFINITY;
  let boundsTop = Number.POSITIVE_INFINITY;
  let boundsRight = Number.NEGATIVE_INFINITY;
  let boundsBottom = Number.NEGATIVE_INFINITY;
  let maxDisplacement = 0;
  let maxPanelDisplacement = 0;
  let shadeMin = Number.POSITIVE_INFINITY;
  let shadeMax = Number.NEGATIVE_INFINITY;

  for (let y = 0; y < garmentSize.height; y += 1) {
    if (input.deadlineAtMs !== undefined && Date.now() > input.deadlineAtMs) {
      throw new SurfaceConformerValidationError('SURFACE_CONFORMER_DEADLINE_EXCEEDED');
    }
    for (let x = 0; x < garmentSize.width; x += 1) {
      const sourceX = mapToPlaneCoordinate(x, input.source.width, garmentSize.width);
      const sourceY = mapToPlaneCoordinate(y, input.source.height, garmentSize.height);
      const designY = mapToPlaneCoordinate(y, input.design.height, garmentSize.height);

      const sourceLowValue = sampleScalarBilinear(sourceLow, input.source.width, input.source.height, sourceX, sourceY);
      const sourceHighValue = sampleScalarBilinear(sourceHigh, input.source.width, input.source.height, sourceX, sourceY);

      const lowGradX = (
        sampleScalarBilinear(sourceLow, input.source.width, input.source.height, sourceX + 1, sourceY)
        - sampleScalarBilinear(sourceLow, input.source.width, input.source.height, sourceX - 1, sourceY)
      ) / (2 * 255);
      const lowGradY = (
        sampleScalarBilinear(sourceLow, input.source.width, input.source.height, sourceX, sourceY + 1)
        - sampleScalarBilinear(sourceLow, input.source.width, input.source.height, sourceX, sourceY - 1)
      ) / (2 * 255);
      const highGradX = (
        sampleScalarBilinear(sourceHigh, input.source.width, input.source.height, sourceX + 1, sourceY)
        - sampleScalarBilinear(sourceHigh, input.source.width, input.source.height, sourceX - 1, sourceY)
      ) / (2 * 255);
      const highGradY = (
        sampleScalarBilinear(sourceHigh, input.source.width, input.source.height, sourceX, sourceY + 1)
        - sampleScalarBilinear(sourceHigh, input.source.width, input.source.height, sourceX, sourceY - 1)
      ) / (2 * 255);
      const vx0 = (6 * lowGradX) + (1.5 * highGradX);
      const vy0 = (6 * lowGradY) + (1.5 * highGradY);
      const vectorLength = Math.hypot(vx0, vy0);
      const vectorScale = vectorLength > 2 ? 2 / vectorLength : 1;
      const vx = vx0 * vectorScale;
      const vy = vy0 * vectorScale;
      const displacement = Math.hypot(vx, vy);
      maxDisplacement = Math.max(maxDisplacement, displacement);

      const panelRow = panelProfileWarp.enabled ? panelProfileWarp.rowsByY[y] : undefined;
      let panelStageDx = 0;
      if (panelProfileWarp.enabled && panelRow && panelRow.runCount === 1 && panelProfileWarp.refWidth > 0) {
        const rowScale = panelRow.width / panelProfileWarp.refWidth;
        const clampedRowScale = clampRange(rowScale, PANEL_PROFILE_ROW_SCALE_MIN, PANEL_PROFILE_ROW_SCALE_MAX);
        const sourceStageX = panelProfileWarp.refCenter + ((x - panelRow.center) / clampedRowScale);
        const panelLimit = Math.min(12, garmentSize.width * 0.02);
        panelStageDx = clampRange(sourceStageX - x, -panelLimit, panelLimit);
        maxPanelDisplacement = Math.max(maxPanelDisplacement, Math.abs(panelStageDx));
      }
      const panelDesignX = mapToPlaneCoordinate(x + panelStageDx, input.design.width, garmentSize.width);

      const designSample = samplePremultipliedRgba(
        input.design.rgba,
        input.design.width,
        input.design.height,
        panelDesignX - vx,
        designY - vy,
      );
      const garmentAlpha = sampleAlphaBilinear(input.garment.alpha, input.garment.width, input.garment.height, x, y);
      const clipAlpha = sampleAlphaBilinear(input.clip.alpha, input.clip.width, input.clip.height, x, y);
      const occluderAlpha = input.occluder
        ? sampleAlphaBilinear(input.occluder.alpha, input.occluder.width, input.occluder.height, x, y)
        : 0;
      const garmentClip = clampByte((garmentAlpha * clipAlpha) / 255);
      const effectiveClip = clampByte((garmentClip * (255 - occluderAlpha)) / 255);
      const designAlpha = clampByte((designSample.a * clipAlpha) / 255);
      const outputAlpha = clampByte((designSample.a * effectiveClip) / 255);
      const shade = 1
        + (0.08 * clampSigned((sourceLowValue - surfaceMu) / 64))
        + (0.04 * clampSigned(sourceHighValue / 32));
      const shadeClamped = Math.min(1.12, Math.max(0.88, shade));
      shadeMin = Math.min(shadeMin, shadeClamped);
      shadeMax = Math.max(shadeMax, shadeClamped);

      if (designAlpha >= 8) effectiveDesignVisiblePixels += 1;
      const clipVisible = clipAlpha >= 8;
      if (clipVisible) {
        surfaceVisiblePixels += 1;
        const clipWeight = clipAlpha / 255;
        clippedLumaTotalWeight += clipWeight;
        if (sourceLowValue <= 6 || sourceLowValue >= 249) {
          clippedLumaWeightSum += clipWeight;
        }
        const absHigh = Math.abs(sourceHighValue);
        absHighWeightedSum += absHigh * clipWeight;
        absHighSamples.push(absHigh);
        if (x === 0) visibleByEdge.left += 1;
        if (x === garmentSize.width - 1) visibleByEdge.right += 1;
        if (y === 0) visibleByEdge.top += 1;
        if (y === garmentSize.height - 1) visibleByEdge.bottom += 1;
        boundsLeft = Math.min(boundsLeft, x);
        boundsTop = Math.min(boundsTop, y);
        boundsRight = Math.max(boundsRight, x);
        boundsBottom = Math.max(boundsBottom, y);
      }

      const index = ((y * garmentSize.width) + x) * 4;
      if (outputAlpha <= 0) {
        output[index] = 0;
        output[index + 1] = 0;
        output[index + 2] = 0;
        output[index + 3] = 0;
        continue;
      }

      const shadedR = clampByte(designSample.r * shadeClamped);
      const shadedG = clampByte(designSample.g * shadeClamped);
      const shadedB = clampByte(designSample.b * shadeClamped);
      output[index] = shadedR;
      output[index + 1] = shadedG;
      output[index + 2] = shadedB;
      output[index + 3] = outputAlpha;

      const visible = outputAlpha >= 8;
      if (visible) finalVisiblePixels += 1;
    }
  }

  const topEdgeRatio = garmentSize.width > 0 ? visibleByEdge.top / garmentSize.width : 0;
  const bottomEdgeRatio = garmentSize.width > 0 ? visibleByEdge.bottom / garmentSize.width : 0;
  const leftEdgeRatio = garmentSize.height > 0 ? visibleByEdge.left / garmentSize.height : 0;
  const rightEdgeRatio = garmentSize.height > 0 ? visibleByEdge.right / garmentSize.height : 0;
  const surfaceEdgeRatio = frameContactReference
    ? computeSurfaceEdgeRatio(frameContactReference.edgeCounts, frameContactReference.fullStageSize)
    : Math.max(topEdgeRatio, bottomEdgeRatio, leftEdgeRatio, rightEdgeRatio);
  const surfaceBounds = {
    left: Number.isFinite(boundsLeft) ? boundsLeft : 0,
    top: Number.isFinite(boundsTop) ? boundsTop : 0,
    right: Number.isFinite(boundsRight) ? boundsRight : 0,
    bottom: Number.isFinite(boundsBottom) ? boundsBottom : 0,
    width: Number.isFinite(boundsLeft) ? (boundsRight - boundsLeft + 1) : 0,
    height: Number.isFinite(boundsTop) ? (boundsBottom - boundsTop + 1) : 0,
  };

  const clippedLumaRatio = clippedLumaTotalWeight > 0 ? clippedLumaWeightSum / clippedLumaTotalWeight : 0;
  const meanAbsHigh = clippedLumaTotalWeight > 0 ? absHighWeightedSum / clippedLumaTotalWeight : 0;
  const p95AbsHigh = absHighSamples.length > 0
    ? [...absHighSamples].sort((left, right) => left - right)[Math.ceil(absHighSamples.length * 0.95) - 1]
    : 0;
  const diagnostics = freezeDiagnostics({
    version: 'surface-conformer-diagnostics-v1',
    source: Object.freeze(sourceSize),
    design: Object.freeze(designSize),
    garment: Object.freeze(garmentSize),
    clip: Object.freeze(clipSize),
    surfaceBounds: Object.freeze(surfaceBounds),
    sourceTooSmall: Math.max(
      input.sourceReferenceSize?.width ?? input.source.width,
      input.sourceReferenceSize?.height ?? input.source.height,
    ) < 1024 || Math.min(
      input.sourceReferenceSize?.width ?? input.source.width,
      input.sourceReferenceSize?.height ?? input.source.height,
    ) < 512,
    effectiveDesignVisiblePixels,
    designVisiblePixels: finalVisiblePixels,
    surfaceVisiblePixels,
    surfaceTouchesFrame: surfaceEdgeRatio > MAX_EDGE_RATIO,
    surfaceEdgeRatio,
    clippedLumaRatio,
    meanAbsHigh,
    p95AbsHigh,
    maxDisplacement,
    panelWarpApplied: panelProfileWarp.enabled,
    panelProfileCoverage: panelProfileWarp.coverage,
    panelWidthVariation: panelProfileWarp.widthVariation,
    maxPanelDisplacement,
    shadeMin: Number.isFinite(shadeMin) ? shadeMin : 1,
    shadeMax: Number.isFinite(shadeMax) ? shadeMax : 1,
  });

  const domain = evaluateDomain(diagnostics);
  if (domain) {
    return Object.freeze({
      kind: 'ood',
      domain,
      diagnostics,
    });
  }

  return Object.freeze({
    kind: 'success',
    rgba: output,
    diagnostics,
  });
};

export const conformSurface = (input: SurfaceConformerInput): SurfaceConformerResult => conformSurfaceInternal(input, true);

export const conformSurfaceWithoutPanelProfileWarp = (input: SurfaceConformerInput): SurfaceConformerResult => conformSurfaceInternal(input, false);

export const buildSurfaceConformer = conformSurface;
