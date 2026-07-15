import {
  conformSurface,
  SURFACE_CONFORMER_MAX_PIXELS,
  type SurfaceConformerDiagnostics,
  type SurfaceConformerDomain,
  type SurfaceConformerInput,
  type SurfaceConformerResult,
} from './surfaceConformer.ts';

const ROI_HALO_PX = 16;
const ROI_MIN_WIDTH_CAP = 600;

export type BoundedSurfaceConformerRoiErrorCode =
  | 'BOUNDED_SURFACE_CONFORMER_DIMENSION_INVALID'
  | 'BOUNDED_SURFACE_CONFORMER_PIXEL_LIMIT_EXCEEDED'
  | 'BOUNDED_SURFACE_CONFORMER_SOURCE_LENGTH_INVALID'
  | 'BOUNDED_SURFACE_CONFORMER_DESIGN_LENGTH_INVALID'
  | 'BOUNDED_SURFACE_CONFORMER_GARMENT_LENGTH_INVALID'
  | 'BOUNDED_SURFACE_CONFORMER_CLIP_LENGTH_INVALID'
  | 'BOUNDED_SURFACE_CONFORMER_OCCLUDER_LENGTH_INVALID'
  | 'BOUNDED_SURFACE_CONFORMER_ROI_TOO_LARGE'
  | 'BOUNDED_SURFACE_CONFORMER_DEADLINE_INVALID'
  | 'BOUNDED_SURFACE_CONFORMER_DEADLINE_EXCEEDED';

export class BoundedSurfaceConformerRoiValidationError extends Error {
  readonly code: BoundedSurfaceConformerRoiErrorCode;

  constructor(code: BoundedSurfaceConformerRoiErrorCode) {
    super(code);
    this.name = 'BoundedSurfaceConformerRoiValidationError';
    this.code = code;
  }
}

export type BoundedSurfaceConformerRoiBounds = Readonly<{
  left: number;
  top: number;
  right: number;
  bottom: number;
  width: number;
  height: number;
}>;

export type BoundedSurfaceConformerRoiVisibleBounds = Readonly<{
  alphaGt0: BoundedSurfaceConformerRoiBounds | null;
  alphaGte8: BoundedSurfaceConformerRoiBounds | null;
  edgeCounts: Readonly<{ top: number; bottom: number; left: number; right: number }>;
}>;

export type BoundedSurfaceConformerRoiDiagnostics = Readonly<{
  version: 'bounded-surface-conformer-roi-diagnostics-v1';
  fullStageSize: Readonly<{ width: number; height: number; pixels: number }>;
  roiBounds: BoundedSurfaceConformerRoiBounds;
  stageSurfaceBounds: Readonly<{
    local: SurfaceConformerDiagnostics['surfaceBounds'];
    offsetFromInnerLocalBounds: Readonly<{ left: number; top: number }>;
    fullStage: BoundedSurfaceConformerRoiBounds;
  }>;
  visibleBounds: BoundedSurfaceConformerRoiVisibleBounds;
  inner: SurfaceConformerDiagnostics;
}>;

export type BoundedSurfaceConformerRoiSuccess = Readonly<{
  kind: 'success';
  rgba: Uint8ClampedArray;
  diagnostics: BoundedSurfaceConformerRoiDiagnostics;
}>;

export type BoundedSurfaceConformerRoiOod = Readonly<{
  kind: 'ood';
  domain: SurfaceConformerDomain;
  diagnostics: BoundedSurfaceConformerRoiDiagnostics;
}>;

export type BoundedSurfaceConformerRoiResult = BoundedSurfaceConformerRoiSuccess | BoundedSurfaceConformerRoiOod;

export type BoundedSurfaceConformerRoiInput = SurfaceConformerInput & {
  forceRoi?: boolean;
};

type Bounds = BoundedSurfaceConformerRoiBounds;

const isValidDimension = (value: number) => Number.isSafeInteger(value) && value > 0;
const clamp = (value: number, min: number, max: number) => Math.min(max, Math.max(min, value));

const makeBounds = (left: number, top: number, right: number, bottom: number): Bounds => ({
  left,
  top,
  right,
  bottom,
  width: right - left + 1,
  height: bottom - top + 1,
});

const throwRoiValidationError = (code: BoundedSurfaceConformerRoiErrorCode): never => {
  throw new BoundedSurfaceConformerRoiValidationError(code);
};

const validateDeadline = (deadlineAtMs?: number) => {
  if (deadlineAtMs === undefined) return;
  if (!Number.isSafeInteger(deadlineAtMs) || deadlineAtMs <= 0) {
    throwRoiValidationError('BOUNDED_SURFACE_CONFORMER_DEADLINE_INVALID');
  }
  if (Date.now() > deadlineAtMs) {
    throwRoiValidationError('BOUNDED_SURFACE_CONFORMER_DEADLINE_EXCEEDED');
  }
};

const validatePlane = (
  width: number,
  height: number,
  length: number,
  code: BoundedSurfaceConformerRoiErrorCode,
) => {
  if (!isValidDimension(width) || !isValidDimension(height)) {
    throwRoiValidationError('BOUNDED_SURFACE_CONFORMER_DIMENSION_INVALID');
  }
  const pixels = width * height;
  if (length !== pixels) {
    throwRoiValidationError(code);
  }
  return pixels;
};

const validateInput = (input: BoundedSurfaceConformerRoiInput) => {
  validateDeadline(input.deadlineAtMs);
  if (input.source.rgba.length % 4 !== 0) {
    throwRoiValidationError('BOUNDED_SURFACE_CONFORMER_SOURCE_LENGTH_INVALID');
  }
  if (input.design.rgba.length % 4 !== 0) {
    throwRoiValidationError('BOUNDED_SURFACE_CONFORMER_DESIGN_LENGTH_INVALID');
  }

  const sourcePixels = validatePlane(
    input.source.width,
    input.source.height,
    input.source.rgba.length / 4,
    'BOUNDED_SURFACE_CONFORMER_SOURCE_LENGTH_INVALID',
  );
  const designPixels = validatePlane(
    input.design.width,
    input.design.height,
    input.design.rgba.length / 4,
    'BOUNDED_SURFACE_CONFORMER_DESIGN_LENGTH_INVALID',
  );
  const garmentPixels = validatePlane(
    input.garment.width,
    input.garment.height,
    input.garment.alpha.length,
    'BOUNDED_SURFACE_CONFORMER_GARMENT_LENGTH_INVALID',
  );
  const clipPixels = validatePlane(
    input.clip.width,
    input.clip.height,
    input.clip.alpha.length,
    'BOUNDED_SURFACE_CONFORMER_CLIP_LENGTH_INVALID',
  );
  const occluderPixels = input.occluder
    ? validatePlane(
      input.occluder.width,
      input.occluder.height,
      input.occluder.alpha.length,
      'BOUNDED_SURFACE_CONFORMER_OCCLUDER_LENGTH_INVALID',
    )
    : undefined;

  if (
    input.source.width !== input.design.width
    || input.source.height !== input.design.height
    || input.source.width !== input.garment.width
    || input.source.height !== input.garment.height
    || input.source.width !== input.clip.width
    || input.source.height !== input.clip.height
    || (input.occluder && (
      input.source.width !== input.occluder.width
      || input.source.height !== input.occluder.height
    ))
  ) {
    throwRoiValidationError('BOUNDED_SURFACE_CONFORMER_DIMENSION_INVALID');
  }

  return {
    fullStageSize: {
      width: input.source.width,
      height: input.source.height,
      pixels: sourcePixels,
    },
    sourcePixels,
    designPixels,
    garmentPixels,
    clipPixels,
    occluderPixels,
  };
};

const scanVisibleBounds = (
  alpha: Uint8ClampedArray,
  width: number,
  height: number,
  deadlineAtMs?: number,
) => {
  let gt0Left = Number.POSITIVE_INFINITY;
  let gt0Top = Number.POSITIVE_INFINITY;
  let gt0Right = Number.NEGATIVE_INFINITY;
  let gt0Bottom = Number.NEGATIVE_INFINITY;
  let gte8Left = Number.POSITIVE_INFINITY;
  let gte8Top = Number.POSITIVE_INFINITY;
  let gte8Right = Number.NEGATIVE_INFINITY;
  let gte8Bottom = Number.NEGATIVE_INFINITY;
  const edgeCounts = { top: 0, bottom: 0, left: 0, right: 0 };

  for (let y = 0; y < height; y += 1) {
    if ((y & 15) === 0) {
      validateDeadline(deadlineAtMs);
    }
    const rowOffset = y * width;
    for (let x = 0; x < width; x += 1) {
      const value = alpha[rowOffset + x];
      if (value <= 0) continue;
      gt0Left = Math.min(gt0Left, x);
      gt0Top = Math.min(gt0Top, y);
      gt0Right = Math.max(gt0Right, x);
      gt0Bottom = Math.max(gt0Bottom, y);
      if (value < 8) continue;
      gte8Left = Math.min(gte8Left, x);
      gte8Top = Math.min(gte8Top, y);
      gte8Right = Math.max(gte8Right, x);
      gte8Bottom = Math.max(gte8Bottom, y);
      if (x === 0) edgeCounts.left += 1;
      if (x === width - 1) edgeCounts.right += 1;
      if (y === 0) edgeCounts.top += 1;
      if (y === height - 1) edgeCounts.bottom += 1;
    }
  }

  return {
    alphaGt0: Number.isFinite(gt0Left)
      ? makeBounds(gt0Left, gt0Top, gt0Right, gt0Bottom)
      : null,
    alphaGte8: Number.isFinite(gte8Left)
      ? makeBounds(gte8Left, gte8Top, gte8Right, gte8Bottom)
      : null,
    edgeCounts,
  };
};

const expandRoiBounds = (
  fullStageBounds: Bounds | null,
  fullStageSize: Readonly<{ width: number; height: number }>,
) => {
  const baseBounds = fullStageBounds ?? {
    left: 0,
    top: 0,
    right: 0,
    bottom: 0,
    width: 1,
    height: 1,
  };
  const haloLeft = Math.max(0, baseBounds.left - ROI_HALO_PX);
  const haloTop = Math.max(0, baseBounds.top - ROI_HALO_PX);
  const haloRight = Math.min(fullStageSize.width - 1, baseBounds.right + ROI_HALO_PX);
  const haloBottom = Math.min(fullStageSize.height - 1, baseBounds.bottom + ROI_HALO_PX);
  const haloWidth = Math.max(1, haloRight - haloLeft + 1);
  const haloHeight = Math.max(1, haloBottom - haloTop + 1);
  const minWidth = Math.min(fullStageSize.width, ROI_MIN_WIDTH_CAP);
  const width = clamp(Math.max(haloWidth, minWidth), 1, fullStageSize.width);
  const height = clamp(haloHeight, 1, fullStageSize.height);
  const centerX = (baseBounds.left + baseBounds.right) / 2;
  const centerY = (baseBounds.top + baseBounds.bottom) / 2;
  const left = clamp(Math.round(centerX - (width / 2)), 0, fullStageSize.width - width);
  const top = clamp(Math.round(centerY - (height / 2)), 0, fullStageSize.height - height);
  return makeBounds(left, top, left + width - 1, top + height - 1);
};

const cropRgbaPlane = (
  rgba: Uint8ClampedArray,
  sourceWidth: number,
  roi: Bounds,
  deadlineAtMs?: number,
) => {
  validateDeadline(deadlineAtMs);
  const output = new Uint8ClampedArray(roi.width * roi.height * 4);
  for (let row = 0; row < roi.height; row += 1) {
    if ((row & 15) === 0) validateDeadline(deadlineAtMs);
    const sourceStart = (((roi.top + row) * sourceWidth) + roi.left) * 4;
    const sourceEnd = sourceStart + (roi.width * 4);
    output.set(rgba.subarray(sourceStart, sourceEnd), row * roi.width * 4);
  }
  return output;
};

const cropAlphaPlane = (
  alpha: Uint8ClampedArray,
  sourceWidth: number,
  roi: Bounds,
  deadlineAtMs?: number,
) => {
  validateDeadline(deadlineAtMs);
  const output = new Uint8ClampedArray(roi.width * roi.height);
  for (let row = 0; row < roi.height; row += 1) {
    if ((row & 15) === 0) validateDeadline(deadlineAtMs);
    const sourceStart = ((roi.top + row) * sourceWidth) + roi.left;
    const sourceEnd = sourceStart + roi.width;
    output.set(alpha.subarray(sourceStart, sourceEnd), row * roi.width);
  }
  return output;
};

const translateBounds = (bounds: Bounds, offsetLeft: number, offsetTop: number): Bounds => ({
  left: bounds.left + offsetLeft,
  top: bounds.top + offsetTop,
  right: bounds.right + offsetLeft,
  bottom: bounds.bottom + offsetTop,
  width: bounds.width,
  height: bounds.height,
});

const buildDiagnostics = ({
  fullStageSize,
  roiBounds,
  visibleBounds,
  innerDiagnostics,
}: {
  fullStageSize: Readonly<{ width: number; height: number; pixels: number }>;
  roiBounds: Bounds;
  visibleBounds: BoundedSurfaceConformerRoiVisibleBounds;
  innerDiagnostics: SurfaceConformerDiagnostics;
}): BoundedSurfaceConformerRoiDiagnostics => {
  const stageSurfaceBounds = translateBounds(innerDiagnostics.surfaceBounds, roiBounds.left, roiBounds.top);
  return Object.freeze({
    version: 'bounded-surface-conformer-roi-diagnostics-v1',
    fullStageSize: Object.freeze({ ...fullStageSize }),
    roiBounds: Object.freeze({ ...roiBounds }),
    stageSurfaceBounds: Object.freeze({
      local: Object.freeze({ ...innerDiagnostics.surfaceBounds }),
      offsetFromInnerLocalBounds: Object.freeze({ left: roiBounds.left, top: roiBounds.top }),
      fullStage: Object.freeze(stageSurfaceBounds),
    }),
    visibleBounds: Object.freeze({
      alphaGt0: visibleBounds.alphaGt0 ? Object.freeze({ ...visibleBounds.alphaGt0 }) : null,
      alphaGte8: visibleBounds.alphaGte8 ? Object.freeze({ ...visibleBounds.alphaGte8 }) : null,
      edgeCounts: Object.freeze({ ...visibleBounds.edgeCounts }),
    }),
    inner: innerDiagnostics,
  });
};

const blitRoiIntoFullStage = (
  roiRgba: Uint8ClampedArray,
  roiBounds: Bounds,
  fullStageSize: Readonly<{ width: number; height: number }>,
  deadlineAtMs?: number,
) => {
  validateDeadline(deadlineAtMs);
  const output = new Uint8ClampedArray(fullStageSize.width * fullStageSize.height * 4);
  for (let row = 0; row < roiBounds.height; row += 1) {
    if ((row & 15) === 0) validateDeadline(deadlineAtMs);
    const fullStageStart = (((roiBounds.top + row) * fullStageSize.width) + roiBounds.left) * 4;
    const roiStart = row * roiBounds.width * 4;
    output.set(roiRgba.subarray(roiStart, roiStart + roiBounds.width * 4), fullStageStart);
  }
  return output;
};

const mapResult = (result: SurfaceConformerResult, diagnostics: BoundedSurfaceConformerRoiDiagnostics): BoundedSurfaceConformerRoiResult => {
  if (result.kind === 'ood') {
    return Object.freeze({
      kind: 'ood',
      domain: result.domain,
      diagnostics,
    });
  }
  return Object.freeze({
    kind: 'success',
    rgba: result.rgba,
    diagnostics,
  });
};

export const conformBoundedSurfaceRoi = (
  input: BoundedSurfaceConformerRoiInput,
): BoundedSurfaceConformerRoiResult => {
  const validated = validateInput(input);
  const visibleBounds = scanVisibleBounds(
    input.clip.alpha,
    validated.fullStageSize.width,
    validated.fullStageSize.height,
    input.deadlineAtMs,
  );
  const roiBounds = expandRoiBounds(visibleBounds.alphaGt0, validated.fullStageSize);
  const roiPixels = roiBounds.width * roiBounds.height;
  if (roiPixels > SURFACE_CONFORMER_MAX_PIXELS) {
    throwRoiValidationError('BOUNDED_SURFACE_CONFORMER_ROI_TOO_LARGE');
  }

  const directPath = !input.forceRoi && validated.fullStageSize.pixels <= SURFACE_CONFORMER_MAX_PIXELS;
  if (directPath) {
    const directResult = conformSurface(input);
    const diagnostics = buildDiagnostics({
      fullStageSize: validated.fullStageSize,
      roiBounds: makeBounds(0, 0, validated.fullStageSize.width - 1, validated.fullStageSize.height - 1),
      visibleBounds: {
        ...visibleBounds,
        edgeCounts: { ...visibleBounds.edgeCounts },
      },
      innerDiagnostics: directResult.diagnostics,
    });
    return mapResult(directResult, diagnostics);
  }

  const croppedResult = conformSurface({
    source: {
      width: roiBounds.width,
      height: roiBounds.height,
      rgba: cropRgbaPlane(input.source.rgba, validated.fullStageSize.width, roiBounds, input.deadlineAtMs),
    },
    sourceReferenceSize: input.sourceReferenceSize,
    design: {
      width: roiBounds.width,
      height: roiBounds.height,
      rgba: cropRgbaPlane(input.design.rgba, validated.fullStageSize.width, roiBounds, input.deadlineAtMs),
    },
    garment: {
      width: roiBounds.width,
      height: roiBounds.height,
      alpha: cropAlphaPlane(input.garment.alpha, validated.fullStageSize.width, roiBounds, input.deadlineAtMs),
    },
    clip: {
      width: roiBounds.width,
      height: roiBounds.height,
      alpha: cropAlphaPlane(input.clip.alpha, validated.fullStageSize.width, roiBounds, input.deadlineAtMs),
    },
    ...(input.occluder ? {
      occluder: {
        width: roiBounds.width,
        height: roiBounds.height,
        alpha: cropAlphaPlane(input.occluder.alpha, validated.fullStageSize.width, roiBounds, input.deadlineAtMs),
      },
    } : {}),
    ...(input.surfaceWarpMode ? { surfaceWarpMode: input.surfaceWarpMode } : {}),
    frameContactReference: {
      fullStageSize: validated.fullStageSize,
      edgeCounts: visibleBounds.edgeCounts,
    },
    deadlineAtMs: input.deadlineAtMs,
  });

  const diagnostics = buildDiagnostics({
    fullStageSize: validated.fullStageSize,
    roiBounds,
    visibleBounds,
    innerDiagnostics: croppedResult.diagnostics,
  });

  if (croppedResult.kind === 'ood') {
    return mapResult(croppedResult, diagnostics);
  }

  return Object.freeze({
    kind: 'success',
    rgba: blitRoiIntoFullStage(croppedResult.rgba, roiBounds, validated.fullStageSize, input.deadlineAtMs),
    diagnostics,
  });
};

export const buildBoundedSurfaceConformerRoi = conformBoundedSurfaceRoi;
