import type {
  RuntimeAlphaPlane,
  SemanticSurfacePlanes,
  SurfaceMapStatus,
} from '../domain/types';

const SURFACE_MAP_MAX_PIXELS = 16_000_000;

export class SurfaceMapValidationError extends Error {
  readonly code: 'SURFACE_DIMENSION_MISMATCH' | 'SURFACE_PLANE_INVALID';

  constructor(code: 'SURFACE_DIMENSION_MISMATCH' | 'SURFACE_PLANE_INVALID') {
    super(code);
    this.name = 'SurfaceMapValidationError';
    this.code = code;
  }
}

export type ComposedPrintableSurface = {
  width: number;
  height: number;
  printableAlpha: Uint8ClampedArray;
  occluderAlpha: Uint8ClampedArray;
  status: SurfaceMapStatus;
  confidence: number;
  fallbackReason?: string;
};

const assertPlane = (plane: RuntimeAlphaPlane, width: number, height: number) => {
  if (
    !Number.isSafeInteger(plane.width)
    || !Number.isSafeInteger(plane.height)
    || plane.width <= 0
    || plane.height <= 0
    || plane.width !== width
    || plane.height !== height
  ) {
    throw new SurfaceMapValidationError('SURFACE_DIMENSION_MISMATCH');
  }
  if (width > SURFACE_MAP_MAX_PIXELS / height) {
    throw new SurfaceMapValidationError('SURFACE_PLANE_INVALID');
  }
  if (plane.alpha.length !== width * height) {
    throw new SurfaceMapValidationError('SURFACE_PLANE_INVALID');
  }
};

/**
 * Composes supplied semantic planes in source-pixel space. Priority is:
 * occluder > forbidden > conditional > printable > garment.
 */
export const composePrintableSurface = ({
  planes,
  allowConditional = false,
  confidence = 1,
}: {
  planes: SemanticSurfacePlanes;
  allowConditional?: boolean;
  confidence?: number;
}): ComposedPrintableSurface => {
  const { width, height } = planes.garment;
  assertPlane(planes.garment, width, height);
  for (const plane of [planes.printable, planes.conditional, planes.forbidden, planes.occluder]) {
    if (plane) assertPlane(plane, width, height);
  }

  const printableAlpha = new Uint8ClampedArray(width * height);
  const occluderAlpha = planes.occluder
    ? new Uint8ClampedArray(planes.occluder.alpha)
    : new Uint8ClampedArray(width * height);
  for (let index = 0; index < printableAlpha.length; index += 1) {
    const garment = planes.garment.alpha[index];
    const explicitPrintable = planes.printable?.alpha[index] ?? garment;
    const conditional = planes.conditional?.alpha[index] ?? 0;
    const policyPrintable = allowConditional
      ? Math.max(explicitPrintable, conditional)
      : Math.min(explicitPrintable, 255 - conditional);
    const candidate = Math.min(garment, policyPrintable);
    const forbidden = planes.forbidden?.alpha[index] ?? 0;
    const occluder = occluderAlpha[index];
    printableAlpha[index] = Math.min(candidate, 255 - Math.max(forbidden, occluder));
  }

  return {
    width,
    height,
    printableAlpha,
    occluderAlpha,
    status: 'semantic-ready',
    confidence: Math.min(1, Math.max(0, confidence)),
  };
};

export const buildLegacyWholeGarmentFallback = ({
  garment,
  fallbackReason,
}: {
  garment: RuntimeAlphaPlane;
  fallbackReason: string;
}): ComposedPrintableSurface => {
  assertPlane(garment, garment.width, garment.height);
  if (!fallbackReason.trim()) throw new SurfaceMapValidationError('SURFACE_PLANE_INVALID');
  return {
    width: garment.width,
    height: garment.height,
    printableAlpha: new Uint8ClampedArray(garment.alpha),
    occluderAlpha: new Uint8ClampedArray(garment.width * garment.height),
    status: 'fallback-required',
    confidence: 0,
    fallbackReason,
  };
};
