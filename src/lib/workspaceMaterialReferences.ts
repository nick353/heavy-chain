import type { Json } from '../types/database';
import type { EncodedAlphaPlane, SurfaceMapIdentity } from '../features/printing/domain/types';
import {
  buildManualPrintableSurface,
  type ManualPrintableSurfaceIdentity,
} from '../features/printing/surface/manualPrintableSurface';
import {
  type SurfaceConformerDomain,
} from '../features/printing/render/surfaceConformer';
import {
  conformBoundedSurfaceRoi,
  type BoundedSurfaceConformerRoiDiagnostics,
  type BoundedSurfaceConformerRoiResult,
} from '../features/printing/render/boundedSurfaceConformerRoi';
import {
  enforcePrintableSuggestionCapacity,
  preparePrintableSurfaceSuggestion,
  type PrintableSurfaceAdapterFallbackReason,
} from '../features/printing/surface/printableSurfaceSuggestionAdapter';

import { newSession, remove, rembgConfig } from '@bunnio/rembg-web';
import {
  applyFabricLuminanceModulation,
  assemblePrintGarmentMaskCandidates,
  buildPrintRequestSignatureValue,
  buildRefinedPrintMaskCandidateRgba,
  buildPrintMaskCandidateRgba,
  decontaminateBoundaryRgb,
  estimatePrintMaskDataUrlBytes,
  PRINT_CUTOUT_MAX_DATA_URL_BYTES,
  summarizePrintEdgeRefinement,
  type PrintEdgeRefinementMetadata,
  type PrintRequestSignatureValueInput,
  type PrintGarmentMaskCandidateId,
} from './printMaskCandidateStrategy';
import { buildPrintArtworkBackgroundCutoutRgba } from './printArtworkMaskStrategy';
import { getContainedStageBounds, getInnerContainedBounds, getIntegerStageScale, scaleStageBounds } from './printingStageGeometry';
import {
  resolveGarmentCutoutModel,
  type GarmentCutoutModel,
  type GarmentSelectionSource,
} from '../features/printing/selection/garmentSegmentationPolicy';

export type MaterialReferenceState = {
  imageUrl: string;
  fileName: string;
  materialKind: string;
  maskMode: 'auto' | 'manual' | 'keep';
  activeLayer: string;
  placement: string;
  scale: number;
  note: string;
  maskCandidates?: string[];
  selectedMaskCandidate?: string | null;
  extractedLayerReady?: boolean;
  extractedImageUrl?: string | null;
  cutoutBounds?: MaterialCutoutBounds | null;
  cutoutOutputSize?: { width: number; height: number } | null;
  cutoutDataUrlBytes?: number | null;
  cutoutMaxDataUrlBytes?: number | null;
  cutoutStoragePolicy?: MaterialCutoutResult['storagePolicy'] | null;
  maskEngine?: string | null;
  nextStepReady?: boolean;
};

export type MaterialCutoutBounds = {
  x: number;
  y: number;
  width: number;
  height: number;
};

export type MaterialCutoutResult = {
  dataUrl: string;
  bounds: MaterialCutoutBounds;
  sourceSize: { width: number; height: number };
  outputSize: { width: number; height: number };
  dataUrlBytes: number;
  storagePolicy: 'bounded-local-canvas-data-url-v1' | 'bounded-local-ai-cutout-data-url-v1';
  engine:
    | 'browser-canvas-geometric-mask-v1'
    | 'browser-canvas-background-flood-cutout-v2'
    | `browser-ai-${string}-v1`
    | 'browser-existing-transparent-garment-v1'
    | 'browser-local-white-background-garment-cutout-v1'
    | 'browser-canvas-artwork-background-cutout-v1';
  hasTransparentPixels: boolean;
  refinement?: PrintEdgeRefinementMetadata;
};

export type PrintGarmentMaskCandidate = {
  candidateId: PrintGarmentMaskCandidateId;
  label: string;
  description: string;
  result: MaterialCutoutResult;
};

export type MaterialReferenceMetadata = Record<string, Json | undefined> & {
  hasImage: boolean;
  imageUrl: string | null;
  fileName: string | null;
  materialKind: string;
  maskMode: MaterialReferenceState['maskMode'];
  activeLayer: string;
  placement: string;
  scale: number;
  note: string;
  maskCandidates?: string[];
  selectedMaskCandidate?: string | null;
  extractedLayerReady?: boolean;
  extractedImageUrl?: string | null;
  cutoutBounds?: MaterialCutoutBounds | null;
  cutoutOutputSize?: { width: number; height: number } | null;
  cutoutDataUrlBytes?: number | null;
  cutoutMaxDataUrlBytes?: number | null;
  cutoutStoragePolicy?: MaterialCutoutResult['storagePolicy'] | null;
  maskEngine?: string | null;
  nextStepReady?: boolean;
};

export type PrintStageSize = {
  width: number;
  height: number;
};

export type EncodedManualPrintableSurface = {
  provenance: 'manual-printable-area';
  plane: EncodedAlphaPlane;
  identity: ManualPrintableSurfaceIdentity;
};

export type PrintableSurfaceErrorCode =
  | 'PRINTABLE_SURFACE_CAPACITY_EXCEEDED'
  | 'PRINTABLE_SURFACE_DIMENSION_MISMATCH'
  | 'PRINTABLE_SURFACE_HASH_MISMATCH'
  | 'PRINTABLE_SURFACE_MISSING'
  | 'PRINTABLE_SURFACE_RGB_INVALID'
  | 'PRINTABLE_SURFACE_SOURCE_HASH_MISMATCH';

export class PrintableSurfaceError extends Error {
  readonly code: PrintableSurfaceErrorCode;

  constructor(code: PrintableSurfaceErrorCode) {
    super(code);
    this.name = 'PrintableSurfaceError';
    this.code = code;
  }
}

export type PrintDesignSnapshotLayer = {
  id: string;
  sourceUrl: string;
  maskRevision: number;
  sourceSize: { width: number; height: number };
  transform: {
    x: number;
    y: number;
    scale: number;
    rotation: number;
    opacity: number;
  };
  box: {
    x: number;
    y: number;
    width: number;
    height: number;
    rotation: number;
    opacity: number;
  };
};

export type PrintRequestSnapshot = {
  revision: number;
  signature: string;
  brandId: string;
  brandName: string;
  stageSize: PrintStageSize;
  garment: {
    sourceUrl: string;
    maskCandidateId: PrintGarmentMaskCandidateId;
    maskRevision: number;
    sourceSize: { width: number; height: number };
    outputSize: { width: number; height: number };
    bounds: MaterialCutoutBounds;
    containBounds: MaterialCutoutBounds;
    mask: {
      kind: 'occupancy';
      url: string;
    };
  };
  surfaceIdentity?: SurfaceMapIdentity;
  printableSurface?: EncodedManualPrintableSurface & {
    stageMask: {
      kind: 'printable';
      url: string;
    };
  };
  designs: PrintDesignSnapshotLayer[];
};

export type PrintRequestSignatureInput = PrintRequestSignatureValueInput;

export type PrintableSurfaceDataUrlSuggestion =
  | {
      kind: 'success';
      width: number;
      height: number;
      dataUrl: string;
      diagnostics: import('../features/printing/surface/suggestPrintableSurface').PrintableSurfaceSuggestionDiagnostics;
      provenance: 'deterministic-alpha-structure-v1';
    }
  | {
      kind: 'fallback-required';
      reason: PrintableSurfaceAdapterFallbackReason;
      width: number;
      height: number;
      diagnostics?: import('../features/printing/surface/suggestPrintableSurface').PrintableSurfaceSuggestionDiagnostics;
    };

export const readWorkspaceImageAsDataUrl = (file: File): Promise<string> => {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => {
      if (typeof reader.result === 'string') {
        resolve(reader.result);
        return;
      }
      reject(new Error('画像を読み込めませんでした。'));
    };
    reader.onerror = () => reject(new Error('画像を読み込めませんでした。'));
    reader.readAsDataURL(file);
  });
};

const createDeepReadonlySnapshot = <T,>(value: T): T => {
  if (!value || typeof value !== 'object') return value;
  Object.freeze(value);
  for (const nestedValue of Object.values(value as Record<string, unknown>)) {
    if (nestedValue && typeof nestedValue === 'object' && !Object.isFrozen(nestedValue)) {
      createDeepReadonlySnapshot(nestedValue);
    }
  }
  return value;
};

export const stageContainBounds = getContainedStageBounds;

const designBaseWidth = (stageSize: PrintStageSize) => Math.min(320, Math.max(140, stageSize.width * 0.38));
const PRINT_BASE_STAGE_SIZE = { width: 720, height: 900 } as const;

export const buildPrintRequestSignature = buildPrintRequestSignatureValue;

const imageSizeFromUrl = async (imageUrl: string) => {
  const image = await loadImageElement(imageUrl);
  return {
    width: image.naturalWidth || image.width,
    height: image.naturalHeight || image.height,
  };
};

const drawContainedImage = (
  context: CanvasRenderingContext2D,
  image: CanvasImageSource,
  bounds: MaterialCutoutBounds,
  sourceSize: { width: number; height: number },
  opacity = 1,
  geometryScale = 1,
) => {
  const innerBounds = getInnerContainedBounds(bounds, sourceSize, geometryScale);
  context.save();
  context.globalAlpha = opacity;
  context.drawImage(image, innerBounds.x, innerBounds.y, innerBounds.width, innerBounds.height);
  context.restore();
};

const buildStageAlphaMaskDataUrl = async (
  stageSize: PrintStageSize,
  sourceUrl: string,
  sourceSize: { width: number; height: number },
  containBounds: MaterialCutoutBounds,
  preserveAlpha = false,
) => {
  const image = await loadImageElement(sourceUrl);
  const canvas = document.createElement('canvas');
  canvas.width = stageSize.width;
  canvas.height = stageSize.height;
  const context = canvas.getContext('2d', { willReadFrequently: true });
  if (!context) throw new Error('Canvasを初期化できませんでした');
  context.clearRect(0, 0, canvas.width, canvas.height);
  drawContainedImage(
    context,
    image,
    containBounds,
    sourceSize,
    1,
    getIntegerStageScale(stageSize, PRINT_BASE_STAGE_SIZE),
  );
  const imageData = context.getImageData(0, 0, canvas.width, canvas.height);
  for (let index = 0; index < imageData.data.length; index += 4) {
    const sourceAlpha = imageData.data[index + 3];
    imageData.data[index] = 255;
    imageData.data[index + 1] = 255;
    imageData.data[index + 2] = 255;
    imageData.data[index + 3] = preserveAlpha ? sourceAlpha : sourceAlpha > 4 ? 255 : 0;
  }
  context.putImageData(imageData, 0, 0);
  return canvas.toDataURL('image/png');
};

const readImageRgba = async (imageUrl: string) => {
  const image = await loadImageElement(imageUrl);
  const width = image.naturalWidth || image.width;
  const height = image.naturalHeight || image.height;
  const canvas = document.createElement('canvas');
  canvas.width = width;
  canvas.height = height;
  const context = canvas.getContext('2d', { willReadFrequently: true });
  if (!context) throw new Error('Canvasを初期化できませんでした');
  context.drawImage(image, 0, 0, width, height);
  return { width, height, rgba: context.getImageData(0, 0, width, height).data };
};

const rgbaToPngDataUrl = (width: number, height: number, rgba: Uint8ClampedArray) => {
  const canvas = document.createElement('canvas');
  canvas.width = width;
  canvas.height = height;
  const context = canvas.getContext('2d', { willReadFrequently: true });
  if (!context) throw new Error('Canvasを初期化できませんでした');
  context.putImageData(new ImageData(new Uint8ClampedArray(rgba), width, height), 0, 0);
  return canvas.toDataURL('image/png');
};

const readAlpha = (rgba: Uint8ClampedArray) => {
  const alpha = new Uint8ClampedArray(rgba.length / 4);
  for (let index = 0; index < alpha.length; index += 1) alpha[index] = rgba[(index * 4) + 3];
  return alpha;
};

export async function suggestPrintableSurfaceDataUrl({
  garmentUrl,
  expectedSize,
  maxDataUrlBytes,
  sourceAlphaAlreadyRefined = false,
}: {
  garmentUrl: string;
  expectedSize: { width: number; height: number };
  maxDataUrlBytes: number;
  sourceAlphaAlreadyRefined?: boolean;
}): Promise<PrintableSurfaceDataUrlSuggestion> {
  const decoded = await readImageRgba(garmentUrl);
  const prepared = preparePrintableSurfaceSuggestion({
    expectedSize,
    decoded,
    sourceAlphaAlreadyRefined,
  });
  if (prepared.kind === 'fallback-required') return prepared;
  const dataUrl = rgbaToPngDataUrl(prepared.width, prepared.height, prepared.rgba);
  return enforcePrintableSuggestionCapacity({
    dataUrl,
    dataUrlBytes: estimatePrintMaskDataUrlBytes(dataUrl),
    maxDataUrlBytes,
    suggestion: prepared,
  });
}

export async function buildEncodedManualPrintableSurface({
  garmentUrl,
  editedMaskUrl,
  manualRevision,
}: {
  garmentUrl: string;
  editedMaskUrl: string;
  manualRevision: number;
}): Promise<EncodedManualPrintableSurface> {
  const [garment, edited] = await Promise.all([readImageRgba(garmentUrl), readImageRgba(editedMaskUrl)]);
  if (garment.width !== edited.width || garment.height !== edited.height) {
    throw new PrintableSurfaceError('PRINTABLE_SURFACE_DIMENSION_MISMATCH');
  }
  const runtimeSurface = await buildManualPrintableSurface({
    garment,
    editedAlpha: readAlpha(edited.rgba),
    manualRevision,
  });
  const dataUrl = rgbaToPngDataUrl(runtimeSurface.plane.width, runtimeSurface.plane.height, runtimeSurface.plane.rgba);
  if (estimatePrintMaskDataUrlBytes(dataUrl) > PRINT_CUTOUT_MAX_DATA_URL_BYTES) {
    throw new PrintableSurfaceError('PRINTABLE_SURFACE_CAPACITY_EXCEEDED');
  }
  return {
    provenance: runtimeSurface.provenance,
    plane: {
      encoding: 'png-alpha-v1',
      width: runtimeSurface.plane.width,
      height: runtimeSurface.plane.height,
      dataUrl,
      contentHash: runtimeSurface.plane.contentHash,
    },
    identity: runtimeSurface.identity,
  };
}

export async function validateEncodedManualPrintableSurface(
  surface: EncodedManualPrintableSurface,
  garmentUrl: string,
) {
  const [garment, encodedPlane] = await Promise.all([
    readImageRgba(garmentUrl),
    readImageRgba(surface.plane.dataUrl),
  ]);
  if (
    garment.width !== surface.plane.width
    || garment.height !== surface.plane.height
    || encodedPlane.width !== surface.plane.width
    || encodedPlane.height !== surface.plane.height
  ) {
    throw new PrintableSurfaceError('PRINTABLE_SURFACE_DIMENSION_MISMATCH');
  }
  for (let index = 0; index < encodedPlane.rgba.length; index += 4) {
    if (
      encodedPlane.rgba[index + 3] > 0
      && (encodedPlane.rgba[index] !== 255 || encodedPlane.rgba[index + 1] !== 255 || encodedPlane.rgba[index + 2] !== 255)
    ) {
      throw new PrintableSurfaceError('PRINTABLE_SURFACE_RGB_INVALID');
    }
  }
  const recalculated = await buildManualPrintableSurface({
    garment,
    editedAlpha: readAlpha(encodedPlane.rgba),
    manualRevision: surface.identity.manualRevision,
  });
  if (
    recalculated.plane.contentHash !== surface.plane.contentHash
    || recalculated.identity.contentHash !== surface.identity.contentHash
  ) {
    throw new PrintableSurfaceError('PRINTABLE_SURFACE_HASH_MISMATCH');
  }
  if (recalculated.identity.sourceHash !== surface.identity.sourceHash) {
    throw new PrintableSurfaceError('PRINTABLE_SURFACE_SOURCE_HASH_MISMATCH');
  }
  return surface;
}

export async function buildPrintableSurfaceStageMaskDataUrl({
  surface,
  garmentUrl,
  stageSize,
}: {
  surface: EncodedManualPrintableSurface;
  garmentUrl: string;
  stageSize: PrintStageSize;
}) {
  const validated = await validateEncodedManualPrintableSurface(surface, garmentUrl);
  const sourceSize = { width: validated.plane.width, height: validated.plane.height };
  return buildStageAlphaMaskDataUrl(
    stageSize,
    validated.plane.dataUrl,
    sourceSize,
    stageContainBounds(stageSize, sourceSize),
    true,
  );
}

export async function buildPrintRequestSnapshot({
  revision,
  brandId,
  brandName,
  garmentUrl,
  garmentReferenceType,
  garmentMaskCandidateId,
  garmentMaskRevision,
  surfaceIdentity,
  printableSurface,
  designs,
  stageSize = { width: 720, height: 900 },
}: {
  revision: number;
  brandId: string;
  brandName: string;
  garmentUrl: string;
  garmentReferenceType: string | null;
  garmentMaskCandidateId: PrintGarmentMaskCandidateId;
  garmentMaskRevision: number;
  surfaceIdentity?: SurfaceMapIdentity;
  printableSurface?: EncodedManualPrintableSurface;
  designs: Array<{ id: string; sourceUrl: string; maskRevision: number; transform: PrintDesignSnapshotLayer['transform'] }>;
  stageSize?: PrintStageSize;
}): Promise<PrintRequestSnapshot> {
  if (
    (surfaceIdentity?.status === 'manual-ready' || surfaceIdentity?.status === 'semantic-ready')
    && !printableSurface
  ) {
    throw new PrintableSurfaceError('PRINTABLE_SURFACE_MISSING');
  }
  const garmentSize = await imageSizeFromUrl(garmentUrl);
  const geometryScale = getIntegerStageScale(stageSize, PRINT_BASE_STAGE_SIZE);
  const geometryStageSize = geometryScale > 1 ? PRINT_BASE_STAGE_SIZE : stageSize;
  const containBounds = scaleStageBounds(
    stageContainBounds(geometryStageSize, garmentSize),
    geometryScale,
  );
  const validatedPrintableSurface = printableSurface
    ? await validateEncodedManualPrintableSurface(printableSurface, garmentUrl)
    : undefined;
  const effectiveSurfaceIdentity = validatedPrintableSurface?.identity ?? surfaceIdentity;
  const signature = buildPrintRequestSignature({
    brandId,
    brandName,
    stageSize,
    garment: {
      sourceUrl: garmentUrl,
      referenceType: garmentReferenceType,
      maskCandidateId: garmentMaskCandidateId,
      maskRevision: garmentMaskRevision,
    },
    surfaceIdentity: effectiveSurfaceIdentity,
    designs: designs.map((design) => ({
      id: design.id,
      sourceUrl: design.sourceUrl,
      maskRevision: design.maskRevision,
      transform: design.transform,
    })),
  });
  const garmentSnapshot = {
    sourceUrl: garmentUrl,
    maskCandidateId: garmentMaskCandidateId,
    maskRevision: garmentMaskRevision,
    sourceSize: garmentSize,
    outputSize: garmentSize,
    bounds: { x: 0, y: 0, width: stageSize.width, height: stageSize.height },
    containBounds,
    mask: {
      kind: 'occupancy' as const,
      url: await buildStageAlphaMaskDataUrl(stageSize, garmentUrl, garmentSize, containBounds),
    },
  };

  const designSnapshots: PrintDesignSnapshotLayer[] = [];
  for (const design of designs) {
    const sourceSize = await imageSizeFromUrl(design.sourceUrl);
    const baseWidth = designBaseWidth(geometryStageSize);
    const width = Math.max(1, Math.round(baseWidth * design.transform.scale)) * geometryScale;
    const height = width;
    designSnapshots.push({
      id: design.id,
      sourceUrl: design.sourceUrl,
      maskRevision: design.maskRevision,
      sourceSize,
      transform: { ...design.transform },
      box: {
        x: Math.round((design.transform.x / 100) * geometryStageSize.width) * geometryScale,
        y: Math.round((design.transform.y / 100) * geometryStageSize.height) * geometryScale,
        width,
        height,
        rotation: design.transform.rotation,
        opacity: design.transform.opacity,
      },
    });
  }

  return createDeepReadonlySnapshot({
    revision,
    signature,
    brandId,
    brandName,
    stageSize,
    garment: garmentSnapshot,
    ...(effectiveSurfaceIdentity ? { surfaceIdentity: { ...effectiveSurfaceIdentity } } : {}),
    ...(validatedPrintableSurface ? {
      printableSurface: {
        provenance: validatedPrintableSurface.provenance,
        plane: { ...validatedPrintableSurface.plane },
        identity: { ...validatedPrintableSurface.identity },
        stageMask: {
          kind: 'printable' as const,
          url: await buildStageAlphaMaskDataUrl(
            stageSize,
            validatedPrintableSurface.plane.dataUrl,
            garmentSize,
            containBounds,
            true,
          ),
        },
      },
    } : {}),
    designs: designSnapshots,
  });
}

const applyMaskToCanvas = async (canvas: HTMLCanvasElement, maskUrl: string) => {
  const maskImage = await loadImageElement(maskUrl);
  const context = canvas.getContext('2d');
  if (!context) throw new Error('Canvasを初期化できませんでした');
  context.save();
  context.globalCompositeOperation = 'destination-in';
  context.drawImage(maskImage, 0, 0, canvas.width, canvas.height);
  context.restore();
};

export type PrintCompositionMode = 'exact' | 'fabric';

export async function renderPrintRequestComposition(
  snapshot: PrintRequestSnapshot,
  mode: PrintCompositionMode = 'exact',
) {
  if (
    (snapshot.surfaceIdentity?.status === 'manual-ready' || snapshot.surfaceIdentity?.status === 'semantic-ready')
    && !snapshot.printableSurface
  ) {
    throw new PrintableSurfaceError('PRINTABLE_SURFACE_MISSING');
  }
  const canvas = document.createElement('canvas');
  canvas.width = snapshot.stageSize.width;
  canvas.height = snapshot.stageSize.height;
  const context = canvas.getContext('2d', { willReadFrequently: true });
  if (!context) throw new Error('Canvasを初期化できませんでした');
  context.clearRect(0, 0, canvas.width, canvas.height);
  const geometryScale = getIntegerStageScale(snapshot.stageSize, PRINT_BASE_STAGE_SIZE);

  const garmentImage = await loadImageElement(snapshot.garment.sourceUrl);
  drawContainedImage(
    context,
    garmentImage,
    snapshot.garment.containBounds,
    snapshot.garment.sourceSize,
    1,
    geometryScale,
  );

  const clippedDesignCanvas = document.createElement('canvas');
  clippedDesignCanvas.width = canvas.width;
  clippedDesignCanvas.height = canvas.height;
  const clippedDesignContext = clippedDesignCanvas.getContext('2d', { willReadFrequently: true });
  if (!clippedDesignContext) throw new Error('Canvasを初期化できませんでした');
  for (const design of snapshot.designs) {
    const designImage = await loadImageElement(design.sourceUrl);
    clippedDesignContext.save();
    clippedDesignContext.translate(design.box.x, design.box.y);
    clippedDesignContext.rotate((design.box.rotation * Math.PI) / 180);
    drawContainedImage(
      clippedDesignContext,
      designImage,
      {
        x: -design.box.width / 2,
        y: -design.box.height / 2,
        width: design.box.width,
        height: design.box.height,
      },
      design.sourceSize,
      design.box.opacity,
      geometryScale,
    );
    clippedDesignContext.restore();
  }
  await applyMaskToCanvas(
    clippedDesignCanvas,
    snapshot.printableSurface?.stageMask.url ?? snapshot.garment.mask.url,
  );
  if (mode === 'fabric') {
    const designData = clippedDesignContext.getImageData(0, 0, clippedDesignCanvas.width, clippedDesignCanvas.height);
    const garmentData = context.getImageData(0, 0, canvas.width, canvas.height);
    designData.data.set(applyFabricLuminanceModulation({
      designRgba: designData.data,
      garmentRgba: garmentData.data,
    }));
    clippedDesignContext.putImageData(designData, 0, 0);
  }
  context.drawImage(clippedDesignCanvas, 0, 0);
  return canvas.toDataURL('image/png');
}

export type ExperimentalSurfaceCompositionResult =
  | {
      kind: 'success';
      dataUrl: string;
      diagnostics: BoundedSurfaceConformerRoiDiagnostics;
    }
  | {
      kind: 'ood';
      domain: SurfaceConformerDomain;
      diagnostics: BoundedSurfaceConformerRoiDiagnostics;
    };

export async function renderExperimentalSurfaceComposition(
  snapshot: PrintRequestSnapshot,
  { deadlineAtMs = Date.now() + 10_000 }: { deadlineAtMs?: number } = {},
): Promise<ExperimentalSurfaceCompositionResult> {
  if (!snapshot.printableSurface || snapshot.surfaceIdentity?.status !== 'manual-ready') {
    throw new PrintableSurfaceError('PRINTABLE_SURFACE_MISSING');
  }

  const garmentCanvas = document.createElement('canvas');
  garmentCanvas.width = snapshot.stageSize.width;
  garmentCanvas.height = snapshot.stageSize.height;
  const garmentContext = garmentCanvas.getContext('2d', { willReadFrequently: true });
  if (!garmentContext) throw new Error('Canvasを初期化できませんでした');
  const geometryScale = getIntegerStageScale(snapshot.stageSize, PRINT_BASE_STAGE_SIZE);
  const garmentImage = await loadImageElement(snapshot.garment.sourceUrl);
  drawContainedImage(
    garmentContext,
    garmentImage,
    snapshot.garment.containBounds,
    snapshot.garment.sourceSize,
    1,
    geometryScale,
  );

  const designCanvas = document.createElement('canvas');
  designCanvas.width = snapshot.stageSize.width;
  designCanvas.height = snapshot.stageSize.height;
  const designContext = designCanvas.getContext('2d', { willReadFrequently: true });
  if (!designContext) throw new Error('Canvasを初期化できませんでした');
  for (const design of snapshot.designs) {
    const designImage = await loadImageElement(design.sourceUrl);
    designContext.save();
    designContext.translate(design.box.x, design.box.y);
    designContext.rotate((design.box.rotation * Math.PI) / 180);
    drawContainedImage(
      designContext,
      designImage,
      {
        x: -design.box.width / 2,
        y: -design.box.height / 2,
        width: design.box.width,
        height: design.box.height,
      },
      design.sourceSize,
      design.box.opacity,
      geometryScale,
    );
    designContext.restore();
  }

  const clipImage = await loadImageElement(snapshot.printableSurface.stageMask.url);
  const clipCanvas = document.createElement('canvas');
  clipCanvas.width = snapshot.stageSize.width;
  clipCanvas.height = snapshot.stageSize.height;
  const clipContext = clipCanvas.getContext('2d', { willReadFrequently: true });
  if (!clipContext) throw new Error('Canvasを初期化できませんでした');
  clipContext.drawImage(clipImage, 0, 0, clipCanvas.width, clipCanvas.height);

  const garmentData = garmentContext.getImageData(0, 0, garmentCanvas.width, garmentCanvas.height);
  const designData = designContext.getImageData(0, 0, designCanvas.width, designCanvas.height);
  const clipData = clipContext.getImageData(0, 0, clipCanvas.width, clipCanvas.height);
  const conformed: BoundedSurfaceConformerRoiResult = conformBoundedSurfaceRoi({
    source: { width: garmentCanvas.width, height: garmentCanvas.height, rgba: garmentData.data },
    sourceReferenceSize: snapshot.garment.sourceSize,
    design: { width: designCanvas.width, height: designCanvas.height, rgba: designData.data },
    garment: { width: garmentCanvas.width, height: garmentCanvas.height, alpha: readAlpha(garmentData.data) },
    clip: { width: clipCanvas.width, height: clipCanvas.height, alpha: readAlpha(clipData.data) },
    deadlineAtMs,
  });
  if (conformed.kind === 'ood') return conformed;

  designData.data.set(conformed.rgba);
  designContext.putImageData(designData, 0, 0);
  garmentContext.drawImage(designCanvas, 0, 0);
  return {
    kind: 'success',
    dataUrl: garmentCanvas.toDataURL('image/png'),
    diagnostics: conformed.diagnostics,
  };
}

export async function restorePrintResultToStageDataUrl({
  imageUrl,
  snapshot,
}: {
  imageUrl: string;
  snapshot: Pick<PrintRequestSnapshot, 'garment' | 'stageSize'>;
}) {
  const resultImage = await loadImageElement(imageUrl);
  const resultCanvas = document.createElement('canvas');
  resultCanvas.width = snapshot.stageSize.width;
  resultCanvas.height = snapshot.stageSize.height;
  const context = resultCanvas.getContext('2d', { willReadFrequently: true });
  if (!context) throw new Error('Canvasを初期化できませんでした');
  context.clearRect(0, 0, resultCanvas.width, resultCanvas.height);

  const drawWidth = resultImage.naturalWidth || resultImage.width;
  const drawHeight = resultImage.naturalHeight || resultImage.height;
  if (drawWidth === snapshot.stageSize.width && drawHeight === snapshot.stageSize.height) {
    context.drawImage(resultImage, 0, 0, snapshot.stageSize.width, snapshot.stageSize.height);
  } else {
    context.drawImage(resultImage, 0, 0, drawWidth, drawHeight, 0, 0, snapshot.stageSize.width, snapshot.stageSize.height);
  }
  await applyMaskToCanvas(resultCanvas, snapshot.garment.mask.url);
  return resultCanvas.toDataURL('image/png');
}

export const buildMaterialReferenceMetadata = (
  state: MaterialReferenceState,
): MaterialReferenceMetadata => ({
  hasImage: Boolean(state.imageUrl),
  imageUrl: state.imageUrl || null,
  fileName: state.fileName || null,
  materialKind: state.materialKind,
  maskMode: state.maskMode,
  activeLayer: state.activeLayer,
  placement: state.placement,
  scale: state.scale,
  note: state.note,
  maskCandidates: state.maskCandidates ?? [],
  selectedMaskCandidate: state.selectedMaskCandidate ?? null,
  extractedLayerReady: Boolean(state.extractedLayerReady),
  extractedImageUrl: state.extractedImageUrl ?? null,
  cutoutBounds: state.cutoutBounds ?? null,
  cutoutOutputSize: state.cutoutOutputSize ?? null,
  cutoutDataUrlBytes: state.cutoutDataUrlBytes ?? null,
  cutoutMaxDataUrlBytes: state.cutoutMaxDataUrlBytes ?? null,
  cutoutStoragePolicy: state.cutoutStoragePolicy ?? null,
  maskEngine: state.maskEngine ?? null,
  nextStepReady: Boolean(state.nextStepReady),
});

const IMAGE_LOAD_TIMEOUT_MS = 20_000;

const loadImageElement = (imageUrl: string): Promise<HTMLImageElement> => {
  return new Promise((resolve, reject) => {
    const image = new Image();
    let settled = false;
    const timeoutId = window.setTimeout(() => {
      if (settled) return;
      settled = true;
      image.onload = null;
      image.onerror = null;
      image.src = '';
      reject(new Error('画像の読み込みがタイムアウトしました。画像を確認して再試行してください'));
    }, IMAGE_LOAD_TIMEOUT_MS);
    const settle = (callback: () => void) => {
      if (settled) return;
      settled = true;
      window.clearTimeout(timeoutId);
      callback();
    };
    if (/^https?:\/\//i.test(imageUrl)) {
      image.crossOrigin = 'anonymous';
    }
    image.onload = () => settle(() => resolve(image));
    image.onerror = () => settle(() => reject(new Error('カット用の画像処理に失敗しました')));
    image.src = imageUrl;
  });
};

const estimateDataUrlBytes = (dataUrl: string) => Math.ceil(dataUrl.length * 0.75);

const blobToDataUrl = (blob: Blob): Promise<string> => new Promise((resolve, reject) => {
  const reader = new FileReader();
  reader.onload = () => {
    if (typeof reader.result === 'string') {
      resolve(reader.result);
      return;
    }
    reject(new Error('AI切り抜き結果を読み込めませんでした'));
  };
  reader.onerror = () => reject(new Error('AI切り抜き結果を読み込めませんでした'));
  reader.readAsDataURL(blob);
});

const dataUrlToBlob = async (dataUrl: string) => {
  const response = await fetch(dataUrl);
  return response.blob();
};

const getAlphaBounds = (imageData: ImageData): { bounds: MaterialCutoutBounds; hasTransparentPixels: boolean } | null => {
  const { data, width, height } = imageData;
  let minX = width;
  let minY = height;
  let maxX = -1;
  let maxY = -1;
  let hasTransparentPixels = false;

  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) {
      const alpha = data[(y * width + x) * 4 + 3];
      if (alpha > 4) {
        minX = Math.min(minX, x);
        minY = Math.min(minY, y);
        maxX = Math.max(maxX, x);
        maxY = Math.max(maxY, y);
      }
      if (alpha < 250) hasTransparentPixels = true;
    }
  }

  if (maxX < minX || maxY < minY) return null;
  return {
    bounds: {
      x: minX,
      y: minY,
      width: maxX - minX + 1,
      height: maxY - minY + 1,
    },
    hasTransparentPixels,
  };
};

const calculateOpaqueBorderRatio = (imageData: ImageData, bounds: MaterialCutoutBounds) => {
  const { data, width, height } = imageData;
  const x1 = Math.max(0, bounds.x);
  const y1 = Math.max(0, bounds.y);
  const x2 = Math.min(width - 1, bounds.x + bounds.width - 1);
  const y2 = Math.min(height - 1, bounds.y + bounds.height - 1);
  let borderSamples = 0;
  let opaqueSamples = 0;

  const sample = (x: number, y: number) => {
    borderSamples += 1;
    if (data[(y * width + x) * 4 + 3] > 220) opaqueSamples += 1;
  };

  for (let x = x1; x <= x2; x += 1) {
    sample(x, y1);
    if (y2 !== y1) sample(x, y2);
  }
  for (let y = y1 + 1; y < y2; y += 1) {
    sample(x1, y);
    if (x2 !== x1) sample(x2, y);
  }

  return borderSamples > 0 ? opaqueSamples / borderSamples : 0;
};

const calculateNeutralBackgroundRisk = (imageData: ImageData) => {
  const { data, width, height } = imageData;
  let opaquePixels = 0;
  let flatNeutralPixels = 0;

  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) {
      const index = (y * width + x) * 4;
      const alpha = data[index + 3];
      if (alpha <= 120) continue;
      opaquePixels += 1;
      const r = data[index];
      const g = data[index + 1];
      const b = data[index + 2];
      const channelSpread = Math.max(r, g, b) - Math.min(r, g, b);
      const isFlatNeutral = channelSpread <= 10 && r >= 120 && r <= 235 && g >= 120 && g <= 235 && b >= 120 && b <= 235;
      if (isFlatNeutral) flatNeutralPixels += 1;
    }
  }

  return opaquePixels > 0 ? flatNeutralPixels / opaquePixels : 0;
};

/**
 * A single transparent pixel is not evidence that an image was actually cut
 * out. Require a meaningful transparent area and a subject that does not
 * occupy the entire source frame before a print asset is allowed through.
 */
const hasMeaningfulTransparentSubject = (imageData: ImageData, bounds: MaterialCutoutBounds) => {
  const { data, width, height } = imageData;
  const totalPixels = width * height;
  if (totalPixels <= 0) return false;

  let transparentPixels = 0;
  for (let index = 3; index < data.length; index += 4) {
    if (data[index] < 250) transparentPixels += 1;
  }
  const transparentRatio = transparentPixels / totalPixels;
  const boundsRatio = (bounds.width * bounds.height) / totalPixels;
  const opaqueBorderRatio = calculateOpaqueBorderRatio(imageData, bounds);
  const neutralBackgroundRisk = calculateNeutralBackgroundRisk(imageData);

  if (transparentRatio < 0.01 || boundsRatio > 0.985) return false;
  if (opaqueBorderRatio > 0.92) return false;
  if (opaqueBorderRatio > 0.22 && neutralBackgroundRisk > 0.55) return false;
  return true;
};

const canvasToPngDataUrl = (canvas: HTMLCanvasElement) => canvas.toDataURL('image/png');

const buildBoundedPngFromCanvas = ({
  canvas,
  sourceWidth,
  sourceHeight,
  maxDataUrlBytes,
  storagePolicy,
  engine,
  validateSubjectShape = true,
}: {
  canvas: HTMLCanvasElement;
  sourceWidth: number;
  sourceHeight: number;
  maxDataUrlBytes: number;
  storagePolicy: MaterialCutoutResult['storagePolicy'];
  engine: MaterialCutoutResult['engine'];
  validateSubjectShape?: boolean;
}): MaterialCutoutResult => {
  const context = canvas.getContext('2d', { willReadFrequently: true });
  if (!context) throw new Error('Canvasを初期化できませんでした');

  const imageData = context.getImageData(0, 0, canvas.width, canvas.height);
  const alphaBounds = getAlphaBounds(imageData);
  if (!alphaBounds?.hasTransparentPixels) {
    throw new Error('背景を十分に分離できませんでした。白い背景や平置き写真で再試行してください。');
  }
  if (validateSubjectShape) {
    if (!hasMeaningfulTransparentSubject(imageData, alphaBounds.bounds)) {
      throw new Error('背景の四角い範囲が残っています。服だけを分離できる写真で再試行してください。');
    }
  }

  const padding = Math.round(Math.max(canvas.width, canvas.height) * 0.025);
  const cropX = Math.max(0, alphaBounds.bounds.x - padding);
  const cropY = Math.max(0, alphaBounds.bounds.y - padding);
  const cropRight = Math.min(canvas.width, alphaBounds.bounds.x + alphaBounds.bounds.width - 1 + padding);
  const cropBottom = Math.min(canvas.height, alphaBounds.bounds.y + alphaBounds.bounds.height - 1 + padding);
  let cropWidth = Math.max(1, cropRight - cropX + 1);
  let cropHeight = Math.max(1, cropBottom - cropY + 1);
  let scale = 1;
  let lastDataUrl = '';
  let lastOutputSize = { width: cropWidth, height: cropHeight };

  for (let attempt = 0; attempt < 5; attempt += 1) {
    const outputWidth = Math.max(1, Math.round(cropWidth * scale));
    const outputHeight = Math.max(1, Math.round(cropHeight * scale));
    const outputCanvas = document.createElement('canvas');
    outputCanvas.width = outputWidth;
    outputCanvas.height = outputHeight;
    const outputContext = outputCanvas.getContext('2d');
    if (!outputContext) throw new Error('Canvasを初期化できませんでした');
    outputContext.imageSmoothingEnabled = true;
    outputContext.imageSmoothingQuality = 'high';
    outputContext.drawImage(canvas, cropX, cropY, cropWidth, cropHeight, 0, 0, outputWidth, outputHeight);
    lastDataUrl = canvasToPngDataUrl(outputCanvas);
    lastOutputSize = { width: outputWidth, height: outputHeight };
    if (estimateDataUrlBytes(lastDataUrl) <= maxDataUrlBytes) {
      return {
        dataUrl: lastDataUrl,
        bounds: { x: cropX, y: cropY, width: cropWidth, height: cropHeight },
        sourceSize: { width: sourceWidth, height: sourceHeight },
        outputSize: lastOutputSize,
        dataUrlBytes: estimateDataUrlBytes(lastDataUrl),
        storagePolicy,
        engine,
        hasTransparentPixels: true,
      };
    }
    scale *= 0.72;
  }

  cropWidth = Math.max(1, cropWidth);
  cropHeight = Math.max(1, cropHeight);
  throw new Error(`透明PNGが保存上限を超えています。画像を小さくして再試行してください。${estimateDataUrlBytes(lastDataUrl)}/${maxDataUrlBytes} bytes`);
};

const assertPrintCutoutQuality = async (result: MaterialCutoutResult, label: string) => {
  const sourceArea = result.sourceSize.width * result.sourceSize.height;
  const boundsArea = result.bounds.width * result.bounds.height;
  const boundsRatio = sourceArea > 0 ? boundsArea / sourceArea : 1;
  if (
    result.engine === 'browser-canvas-geometric-mask-v1'
    || !result.hasTransparentPixels
    || boundsRatio > 0.985
  ) {
    throw new Error(`${label}の背景を十分に分離できませんでした。元画像の背景が単色で、被写体の外周が写っている画像で再試行してください。`);
  }
  const outputImage = await loadImageElement(result.dataUrl);
  const outputCanvas = document.createElement('canvas');
  outputCanvas.width = outputImage.naturalWidth || outputImage.width;
  outputCanvas.height = outputImage.naturalHeight || outputImage.height;
  const outputContext = outputCanvas.getContext('2d', { willReadFrequently: true });
  if (!outputContext) throw new Error('Canvasを初期化できませんでした');
  outputContext.drawImage(outputImage, 0, 0, outputCanvas.width, outputCanvas.height);
  const outputAlphaBounds = getAlphaBounds(outputContext.getImageData(0, 0, outputCanvas.width, outputCanvas.height));
  if (!outputAlphaBounds?.hasTransparentPixels || !hasMeaningfulTransparentSubject(outputContext.getImageData(0, 0, outputCanvas.width, outputCanvas.height), outputAlphaBounds.bounds)) {
    throw new Error(`${label}の透明領域を確認できませんでした。背景が残っている画像は使用できません。`);
  }
  return result;
};

type Rgb = { r: number; g: number; b: number };
type BackgroundEstimate = Rgb & { sampleSpread: number };

const colorDistance = (a: Rgb, b: Rgb) => Math.hypot(a.r - b.r, a.g - b.g, a.b - b.b);
const luminance = ({ r, g, b }: Rgb) => (0.2126 * r) + (0.7152 * g) + (0.0722 * b);

const readRgb = (data: Uint8ClampedArray, index: number): Rgb => ({
  r: data[index],
  g: data[index + 1],
  b: data[index + 2],
});

const estimateBackgroundColor = (data: Uint8ClampedArray, width: number, height: number): BackgroundEstimate => {
  const samples: Rgb[] = [];
  const inset = Math.max(1, Math.floor(Math.min(width, height) * 0.035));
  const step = Math.max(8, Math.floor(Math.min(width, height) / 18));
  for (let x = inset; x < width - inset; x += step) {
    samples.push(readRgb(data, (inset * width + x) * 4));
    samples.push(readRgb(data, ((height - 1 - inset) * width + x) * 4));
  }
  for (let y = inset; y < height - inset; y += step) {
    samples.push(readRgb(data, (y * width + inset) * 4));
    samples.push(readRgb(data, (y * width + (width - 1 - inset)) * 4));
  }
  const neutralBrightSamples = samples.filter((color) => {
    const spread = Math.max(color.r, color.g, color.b) - Math.min(color.r, color.g, color.b);
    return luminance(color) >= 130 && spread <= 55;
  });
  const usableSamples = neutralBrightSamples.length >= 6 ? neutralBrightSamples : samples;
  const medianChannel = (channel: keyof Rgb) => {
    const values = usableSamples.map((color) => color[channel]).sort((a, b) => a - b);
    return values[Math.floor(values.length / 2)] ?? 255;
  };

  const background = {
    r: medianChannel('r'),
    g: medianChannel('g'),
    b: medianChannel('b'),
  };
  const sampleSpread = Math.max(...usableSamples.map((color) => colorDistance(color, background)));
  return { ...background, sampleSpread };
};

const buildEdgeConnectedBackgroundMask = (
  data: Uint8ClampedArray,
  width: number,
  height: number,
  background: Rgb,
) => {
  const visited = new Uint8Array(width * height);
  const queue: number[] = [];
  const backgroundLum = luminance(background);
  const threshold = backgroundLum > 185 ? 34 : 46;
  const shouldTreatAsBackground = (color: Rgb) => {
    const lum = luminance(color);
    if (backgroundLum > 185 && lum < 70) return true;
    if (backgroundLum > 185 && lum > backgroundLum + 10) return false;
    return colorDistance(color, background) <= threshold;
  };
  const enqueue = (x: number, y: number) => {
    if (x < 0 || x >= width || y < 0 || y >= height) return;
    const pixelIndex = y * width + x;
    if (visited[pixelIndex]) return;
    const rgbaIndex = pixelIndex * 4;
    if (data[rgbaIndex + 3] <= 4 || shouldTreatAsBackground(readRgb(data, rgbaIndex))) {
      visited[pixelIndex] = 1;
      queue.push(pixelIndex);
    }
  };

  for (let x = 0; x < width; x += 1) {
    enqueue(x, 0);
    enqueue(x, height - 1);
  }
  for (let y = 1; y < height - 1; y += 1) {
    enqueue(0, y);
    enqueue(width - 1, y);
  }

  for (let cursor = 0; cursor < queue.length; cursor += 1) {
    const pixelIndex = queue[cursor];
    const x = pixelIndex % width;
    const y = Math.floor(pixelIndex / width);
    enqueue(x + 1, y);
    enqueue(x - 1, y);
    enqueue(x, y + 1);
    enqueue(x, y - 1);
  }

  return visited;
};

const hasBackgroundNeighbor = (mask: Uint8Array, x: number, y: number, width: number, height: number) => {
  for (let offsetY = -1; offsetY <= 1; offsetY += 1) {
    for (let offsetX = -1; offsetX <= 1; offsetX += 1) {
      if (offsetX === 0 && offsetY === 0) continue;
      const nx = x + offsetX;
      const ny = y + offsetY;
      if (nx < 0 || nx >= width || ny < 0 || ny >= height) continue;
      if (mask[ny * width + nx]) return true;
    }
  }
  return false;
};

const countMaskPixels = (mask: Uint8Array) => mask.reduce((sum, value) => sum + value, 0);

const isProtectedCutoutCenter = (x: number, y: number, width: number, height: number) => {
  const nx = (x / width - 0.5) * 2;
  const ny = (y / height - 0.5) * 2;
  return (nx / 0.42) ** 2 + ((ny + 0.02) / 0.54) ** 2 <= 1;
};

const shouldUseBackgroundMask = ({
  mask,
  background,
  width,
  height,
}: {
  mask: Uint8Array;
  background: BackgroundEstimate;
  width: number;
  height: number;
}) => {
  const totalPixels = width * height;
  const backgroundRatio = countMaskPixels(mask) / totalPixels;
  let protectedCenterPixels = 0;
  let maskedProtectedCenterPixels = 0;

  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) {
      if (!isProtectedCutoutCenter(x, y, width, height)) continue;
      protectedCenterPixels += 1;
      if (mask[y * width + x]) maskedProtectedCenterPixels += 1;
    }
  }

  const centerMaskRatio = protectedCenterPixels > 0 ? maskedProtectedCenterPixels / protectedCenterPixels : 1;
  return (
    background.sampleSpread <= 70
    && backgroundRatio >= 0.05
    && backgroundRatio <= 0.96
    && centerMaskRatio <= 0.55
  );
};

const getMaskAlpha = ({
  x,
  y,
  width,
  height,
  mode,
  candidate,
}: {
  x: number;
  y: number;
  width: number;
  height: number;
  mode: MaterialReferenceState['maskMode'];
  candidate?: string | null;
}) => {
  if (mode === 'keep') return 255;

  const nx = (x / width - 0.5) * 2;
  const ny = (y / height - 0.5) * 2;
  const label = candidate ?? '';
  const isPattern = label.includes('柄');
  const isPlain = label.includes('無地');
  const isManual = mode === 'manual' || label.includes('手動');

  if (isPattern) {
    const inside = Math.abs(nx) <= 0.52 && Math.abs(ny) <= 0.44;
    const feather = Math.max(Math.abs(nx) - 0.52, Math.abs(ny) - 0.44);
    if (inside) return 255;
    return Math.max(0, Math.round(255 * (1 - feather / 0.12)));
  }

  if (isManual || isPlain) {
    const rx = isPlain ? 0.66 : 0.76;
    const ry = isPlain ? 0.72 : 0.86;
    const inside = Math.abs(nx) <= rx && Math.abs(ny) <= ry;
    const feather = Math.max(Math.abs(nx) - rx, Math.abs(ny) - ry);
    if (inside) return 255;
    return Math.max(0, Math.round(255 * (1 - feather / 0.1)));
  }

  const distance = (nx / 0.72) ** 2 + ((ny + 0.02) / 0.9) ** 2;
  if (distance <= 1) return 255;
  return Math.max(0, Math.round(255 * (1 - (distance - 1) / 0.18)));
};

export async function buildMaterialCutoutDataUrl({
  imageUrl,
  mode,
  candidate,
  maxSize = 720,
  maxDataUrlBytes = PRINT_CUTOUT_MAX_DATA_URL_BYTES,
}: {
  imageUrl: string;
  mode: MaterialReferenceState['maskMode'];
  candidate?: string | null;
  maxSize?: number;
  maxDataUrlBytes?: number;
}): Promise<MaterialCutoutResult> {
  const storagePolicy = 'bounded-local-canvas-data-url-v1' as const;
  if (mode === 'keep') {
    const image = await loadImageElement(imageUrl);
    const sourceWidth = image.naturalWidth || image.width;
    const sourceHeight = image.naturalHeight || image.height;
    const dataUrlBytes = estimateDataUrlBytes(imageUrl);
    if (dataUrlBytes > maxDataUrlBytes) {
      throw new Error(`画像が保存上限を超えています。画像を小さくして再試行してください。${dataUrlBytes}/${maxDataUrlBytes} bytes`);
    }
    return {
      dataUrl: imageUrl,
      bounds: { x: 0, y: 0, width: sourceWidth, height: sourceHeight },
      sourceSize: { width: sourceWidth, height: sourceHeight },
      outputSize: { width: sourceWidth, height: sourceHeight },
      dataUrlBytes,
      storagePolicy,
      engine: 'browser-canvas-geometric-mask-v1',
      hasTransparentPixels: false,
    };
  }

  const image = await loadImageElement(imageUrl);
  const sourceWidth = image.naturalWidth || image.width;
  const sourceHeight = image.naturalHeight || image.height;
  let targetMaxSize = Math.max(240, maxSize);
  let lastResult: MaterialCutoutResult | null = null;

  for (let attempt = 0; attempt < 5; attempt += 1) {
    const result = buildCutoutFromImage({
      image,
      sourceWidth,
      sourceHeight,
      mode,
      candidate,
      maxSize: targetMaxSize,
      storagePolicy,
    });
    lastResult = result;
    if (result.dataUrlBytes <= maxDataUrlBytes) return result;
    targetMaxSize = Math.max(240, Math.floor(targetMaxSize * 0.72));
  }

  if (lastResult) {
    throw new Error(`透明PNGが保存上限を超えています。画像を小さくして再試行してください。${lastResult.dataUrlBytes}/${maxDataUrlBytes} bytes`);
  }
  throw new Error('透明PNGの抽出に失敗しました');
}

const buildWhiteBackgroundFallbackCutout = async ({
  imageUrl,
  maxDataUrlBytes,
}: {
  imageUrl: string;
  maxDataUrlBytes: number;
}): Promise<MaterialCutoutResult> => {
  const result = await buildMaterialCutoutDataUrl({
    imageUrl,
    mode: 'auto',
    candidate: 'トップス',
    maxSize: 1_400,
    maxDataUrlBytes,
  });
  const sourceArea = result.sourceSize.width * result.sourceSize.height;
  const boundsArea = result.bounds.width * result.bounds.height;
  const boundsRatio = sourceArea > 0 ? boundsArea / sourceArea : 1;
  if (result.engine !== 'browser-canvas-background-flood-cutout-v2' || !result.hasTransparentPixels || boundsRatio > 0.92) {
    throw new Error('白背景から服だけを分離できませんでした。服の外周が背景と重ならない写真で再試行してください。');
  }
  return {
    ...result,
    storagePolicy: 'bounded-local-ai-cutout-data-url-v1',
    engine: 'browser-local-white-background-garment-cutout-v1',
  };
};

const REMBG_OPERATION_TIMEOUT_MS = 30_000;
const PRINT_FAST_UNIFORM_BACKGROUND_MAX_SPREAD = 36;
const PRINT_CUTOUT_MAX_OUTPUT_DIMENSION = 1_400;

const withRembgOperationTimeout = async <T>(promise: Promise<T>, label: string): Promise<T> => {
  let timeoutId: number | undefined;
  const timeout = new Promise<never>((_, reject) => {
    timeoutId = window.setTimeout(() => reject(new Error(`rembg_timeout:${label}`)), REMBG_OPERATION_TIMEOUT_MS);
  });
  try {
    return await Promise.race([promise, timeout]);
  } finally {
    if (timeoutId !== undefined) window.clearTimeout(timeoutId);
  }
};

const isRembgModelLoadError = (error: unknown) => {
  const message = error instanceof Error ? error.message : String(error);
  return [
    'Failed to download model',
    'HTTP error',
    'Failed to create session',
    'no available backend found',
    'backend not found',
    'rembg_timeout',
  ].some((fragment) => message.includes(fragment));
};

const canUseBrowserWebGlBackend = () => {
  try {
    const canvas = document.createElement('canvas');
    return Boolean(canvas.getContext('webgl2') || canvas.getContext('webgl'));
  } catch {
    return false;
  }
};

const aiGarmentCutoutSessions = new Map<string, Awaited<ReturnType<typeof newSession>> | null>();

const rembgModelBaseUrl = String(import.meta.env.VITE_REMBG_MODEL_BASE_URL || '/models').replace(/\/$/, '');
const rembgSiluetaModelUrl = String(
  import.meta.env.VITE_REMBG_SILUETA_MODEL_URL
  || '/models/silueta.onnx',
).trim();
const rembgIsnetGeneralUseModelUrl = String(
  import.meta.env.VITE_REMBG_ISNET_GENERAL_USE_MODEL_URL
  || '',
).trim();
const rembgClothSegModelUrl = String(
  import.meta.env.VITE_REMBG_CLOTH_SEG_MODEL_URL
  || '',
).trim();

export const isPrintGarmentClothModelConfigured = () => Boolean(rembgClothSegModelUrl);

export const resolvePrintGarmentCutoutModel = ({
  selectionSource,
}: {
  selectionSource: GarmentSelectionSource;
}): GarmentCutoutModel => resolveGarmentCutoutModel({
  selectionSource,
  clothModelConfigured: isPrintGarmentClothModelConfigured(),
});

export async function buildHighPrecisionMaterialCutoutDataUrl({
  imageUrl,
  maxDataUrlBytes = PRINT_CUTOUT_MAX_DATA_URL_BYTES,
  modelName = 'silueta',
  postProcessMask = true,
}: {
  imageUrl: string;
  maxDataUrlBytes?: number;
  modelName?: 'isnet-general-use' | 'u2net_cloth_seg' | 'u2net_human_seg' | 'u2net' | 'u2netp' | 'isnet-anime' | 'silueta';
  postProcessMask?: boolean;
}): Promise<MaterialCutoutResult> {
  if (!canUseBrowserWebGlBackend()) {
    console.warn('Falling back to local white-background garment cutout because WebGL is unavailable.');
    return buildWhiteBackgroundFallbackCutout({ imageUrl, maxDataUrlBytes });
  }

  rembgConfig.setBaseUrl(rembgModelBaseUrl);
  if (modelName === 'silueta') {
    rembgConfig.setCustomModelPath('silueta', rembgSiluetaModelUrl);
  }
  if (modelName === 'u2net_cloth_seg' && rembgClothSegModelUrl) {
    rembgConfig.setCustomModelPath('u2net_cloth_seg', rembgClothSegModelUrl);
  }
  if (modelName === 'isnet-general-use' && rembgIsnetGeneralUseModelUrl) {
    rembgConfig.setCustomModelPath('isnet-general-use', rembgIsnetGeneralUseModelUrl);
  }
  const image = await loadImageElement(imageUrl);
  const sourceWidth = image.naturalWidth || image.width;
  const sourceHeight = image.naturalHeight || image.height;
  try {
    const sessionKey = modelName;
    let session = aiGarmentCutoutSessions.get(sessionKey) ?? null;
    if (!session) {
      session = await withRembgOperationTimeout(
        newSession(modelName, undefined, { numThreads: 1 }),
        'new_session',
      );
      aiGarmentCutoutSessions.set(sessionKey, session);
    }
  } catch (error) {
    if (!isRembgModelLoadError(error)) throw error;
    console.warn('Falling back to local white-background garment cutout because rembg could not start.', {
      rembgModelBaseUrl,
      modelName,
      error,
    });
    return buildWhiteBackgroundFallbackCutout({ imageUrl, maxDataUrlBytes });
  }
  const aiGarmentCutoutSession = aiGarmentCutoutSessions.get(modelName) ?? undefined;
  const inputBlob = await dataUrlToBlob(imageUrl);
  let outputBlob: Blob;
  try {
    outputBlob = await withRembgOperationTimeout(
      remove(inputBlob, {
        session: aiGarmentCutoutSession,
        postProcessMask,
      }),
      'remove',
    );
  } catch (error) {
    if (!isRembgModelLoadError(error)) throw error;
    console.warn('Falling back to local white-background garment cutout because rembg failed during cutout.', {
      rembgModelBaseUrl,
      modelName,
      error,
    });
    aiGarmentCutoutSessions.set(modelName, null);
    return buildWhiteBackgroundFallbackCutout({ imageUrl, maxDataUrlBytes });
  }
  const outputDataUrl = await blobToDataUrl(outputBlob);
  const outputImage = await loadImageElement(outputDataUrl);
  const canvas = document.createElement('canvas');
  canvas.width = outputImage.naturalWidth || outputImage.width;
  canvas.height = outputImage.naturalHeight || outputImage.height;
  const context = canvas.getContext('2d', { willReadFrequently: true });
  if (!context) throw new Error('Canvasを初期化できませんでした');
  context.drawImage(outputImage, 0, 0, canvas.width, canvas.height);

  if (!postProcessMask) {
    const sourceCanvas = document.createElement('canvas');
    sourceCanvas.width = canvas.width;
    sourceCanvas.height = canvas.height;
    const sourceContext = sourceCanvas.getContext('2d', { willReadFrequently: true });
    if (!sourceContext) throw new Error('Canvasを初期化できませんでした');
    sourceContext.drawImage(image, 0, 0, canvas.width, canvas.height);
    const sourceData = sourceContext.getImageData(0, 0, canvas.width, canvas.height);
    const background = estimateBackgroundColor(sourceData.data, canvas.width, canvas.height);
    if (background.sampleSpread <= 72) {
      const outputData = context.getImageData(0, 0, canvas.width, canvas.height);
      outputData.data.set(decontaminateBoundaryRgb({
        rgba: outputData.data,
        background,
      }));
      context.putImageData(outputData, 0, 0);
    }
  }

  return buildBoundedPngFromCanvas({
    canvas,
    sourceWidth,
    sourceHeight,
    maxDataUrlBytes,
    storagePolicy: 'bounded-local-ai-cutout-data-url-v1',
    engine: `browser-ai-${modelName}-v1`,
  });
}

export async function buildPrintGarmentCutoutDataUrl({
  imageUrl,
  maxDataUrlBytes = PRINT_CUTOUT_MAX_DATA_URL_BYTES,
  modelName = 'silueta',
}: {
  imageUrl: string;
  maxDataUrlBytes?: number;
  modelName?: GarmentCutoutModel;
}): Promise<MaterialCutoutResult> {
  const finalizeResult = async (result: MaterialCutoutResult) => {
    const verified = await assertPrintCutoutQuality(result, '参考画像');
    const image = await loadImageElement(verified.dataUrl);
    const width = image.naturalWidth || image.width;
    const height = image.naturalHeight || image.height;
    const ratio = Math.min(1, PRINT_CUTOUT_MAX_OUTPUT_DIMENSION / Math.max(width, height));
    if (ratio >= 1) return verified;
    const outputWidth = Math.max(1, Math.round(width * ratio));
    const outputHeight = Math.max(1, Math.round(height * ratio));
    const outputCanvas = document.createElement('canvas');
    outputCanvas.width = outputWidth;
    outputCanvas.height = outputHeight;
    const outputContext = outputCanvas.getContext('2d');
    if (!outputContext) throw new Error('Canvasを初期化できませんでした');
    outputContext.imageSmoothingEnabled = true;
    outputContext.imageSmoothingQuality = 'high';
    outputContext.drawImage(image, 0, 0, width, height, 0, 0, outputWidth, outputHeight);
    const dataUrl = canvasToPngDataUrl(outputCanvas);
    return {
      ...verified,
      dataUrl,
      outputSize: { width: outputWidth, height: outputHeight },
      dataUrlBytes: estimateDataUrlBytes(dataUrl),
    };
  };
  const image = await loadImageElement(imageUrl);
  const sourceWidth = image.naturalWidth || image.width;
  const sourceHeight = image.naturalHeight || image.height;
  const canvas = document.createElement('canvas');
  canvas.width = sourceWidth;
  canvas.height = sourceHeight;
  const context = canvas.getContext('2d', { willReadFrequently: true });
  if (!context) throw new Error('Canvasを初期化できませんでした');
  context.drawImage(image, 0, 0, sourceWidth, sourceHeight);
  const sourceData = context.getImageData(0, 0, sourceWidth, sourceHeight);
  const alphaBounds = getAlphaBounds(sourceData);

  if (alphaBounds?.hasTransparentPixels) {
    return finalizeResult(buildBoundedPngFromCanvas({
      canvas,
      sourceWidth,
      sourceHeight,
      maxDataUrlBytes,
      storagePolicy: 'bounded-local-ai-cutout-data-url-v1',
      engine: 'browser-existing-transparent-garment-v1',
      validateSubjectShape: true,
    }));
  }

  const sourceBackground = estimateBackgroundColor(sourceData.data, sourceWidth, sourceHeight);
  // A tap is an explicit garment-selection intent. When the optional cloth
  // model is configured, do not let the fast uniform-background path silently
  // bypass it; the model must get the crop so it can distinguish garment
  // regions from head/hands and nearby objects. If the model cannot load or
  // run, buildHighPrecisionMaterialCutoutDataUrl still returns the existing
  // bounded fallback.
  const shouldPreferConfiguredClothModel = modelName === 'u2net_cloth_seg' && Boolean(rembgClothSegModelUrl);
  if (
    sourceBackground.sampleSpread <= PRINT_FAST_UNIFORM_BACKGROUND_MAX_SPREAD
    && !shouldPreferConfiguredClothModel
  ) {
    try {
      const fastResult = await buildWhiteBackgroundFallbackCutout({ imageUrl, maxDataUrlBytes });
      return await finalizeResult(fastResult);
    } catch (fastCutoutError) {
      console.warn('Fast uniform-background garment cutout was not usable; trying AI cutout.', {
        sourceBackground,
        fastCutoutError,
      });
    }
  }

  try {
    const result = await buildHighPrecisionMaterialCutoutDataUrl({
      imageUrl,
      maxDataUrlBytes,
      modelName,
      postProcessMask: false,
    });
      return await finalizeResult(result);
  } catch (highPrecisionError) {
    try {
      const fallback = await buildWhiteBackgroundFallbackCutout({ imageUrl, maxDataUrlBytes });
      return await finalizeResult(fallback);
    } catch (fallbackError) {
      const detail = fallbackError instanceof Error ? fallbackError.message : String(fallbackError);
      console.warn('Print garment cutout failed', { highPrecisionError, fallbackError });
      throw new Error(`参考画像の背景を透明化できませんでした。${detail}`);
    }
  }
}

const buildDerivedPrintGarmentMaskCandidate = async ({
  baseResult,
  candidateId,
  maxDataUrlBytes,
}: {
  baseResult: MaterialCutoutResult;
  candidateId: Exclude<PrintGarmentMaskCandidateId, 'auto' | 'manual'>;
  maxDataUrlBytes: number;
}): Promise<MaterialCutoutResult> => {
  const image = await loadImageElement(baseResult.dataUrl);
  const width = image.naturalWidth || image.width;
  const height = image.naturalHeight || image.height;
  const canvas = document.createElement('canvas');
  canvas.width = width;
  canvas.height = height;
  const context = canvas.getContext('2d', { willReadFrequently: true });
  if (!context) throw new Error('Canvasを初期化できませんでした');
  context.drawImage(image, 0, 0, width, height);
  const imageData = context.getImageData(0, 0, width, height);
  const candidateRgba = candidateId === 'refined'
    ? buildRefinedPrintMaskCandidateRgba({ rgba: imageData.data, width, height })
    : buildPrintMaskCandidateRgba({
      rgba: imageData.data,
      width,
      height,
      candidateId,
    });
  const refinement = candidateId === 'refined'
    ? summarizePrintEdgeRefinement({
      inputRgba: imageData.data,
      outputRgba: candidateRgba,
      width,
      height,
    })
    : undefined;
  imageData.data.set(candidateRgba);
  context.putImageData(imageData, 0, 0);
  const dataUrl = canvasToPngDataUrl(canvas);
  const dataUrlBytes = estimateDataUrlBytes(dataUrl);
  if (dataUrlBytes > maxDataUrlBytes) {
    throw new Error(`マスク候補が保存上限を超えています。画像を小さくして再試行してください。${dataUrlBytes}/${maxDataUrlBytes} bytes`);
  }
  return {
    ...baseResult,
    dataUrl,
    dataUrlBytes,
    outputSize: { width, height },
    ...(refinement ? { refinement } : {}),
  };
};

export async function buildDerivedPrintGarmentMaskCandidates({
  baseResult,
  maxDataUrlBytes = PRINT_CUTOUT_MAX_DATA_URL_BYTES,
}: {
  baseResult: MaterialCutoutResult;
  maxDataUrlBytes?: number;
}): Promise<PrintGarmentMaskCandidate[]> {
  return assemblePrintGarmentMaskCandidates({
    automaticResult: baseResult,
    deriveResult: (candidateId) => buildDerivedPrintGarmentMaskCandidate({
      baseResult,
      candidateId,
      maxDataUrlBytes,
    }),
    onOptionalFailure: (candidateId, error) => {
      console.warn(`Optional garment mask candidate failed: ${candidateId}`, error);
    },
  });
}

export async function buildPrintGarmentMaskCandidates({
  imageUrl,
  maxDataUrlBytes = PRINT_CUTOUT_MAX_DATA_URL_BYTES,
}: {
  imageUrl: string;
  maxDataUrlBytes?: number;
}): Promise<PrintGarmentMaskCandidate[]> {
  const automaticResult = await buildPrintGarmentCutoutDataUrl({ imageUrl, maxDataUrlBytes });
  return buildDerivedPrintGarmentMaskCandidates({ baseResult: automaticResult, maxDataUrlBytes });
}

/**
 * Build a transparent print-artwork asset. Print artwork is often a logo or
 * illustration rather than a garment, so first remove only a uniform
 * edge-connected background. Fall back to general segmentation when the
 * deterministic result is low-confidence.
 * Never return the original image: callers can then safely gate generation on
 * a successful transparent result instead of silently reintroducing a box.
 */
export async function buildPrintDesignCutoutDataUrl({
  imageUrl,
  maxDataUrlBytes = PRINT_CUTOUT_MAX_DATA_URL_BYTES,
}: {
  imageUrl: string;
  maxDataUrlBytes?: number;
}): Promise<MaterialCutoutResult> {
  const image = await loadImageElement(imageUrl);
  const sourceWidth = image.naturalWidth || image.width;
  const sourceHeight = image.naturalHeight || image.height;
  const canvas = document.createElement('canvas');
  canvas.width = sourceWidth;
  canvas.height = sourceHeight;
  const context = canvas.getContext('2d', { willReadFrequently: true });
  if (!context) throw new Error('Canvasを初期化できませんでした');
  context.drawImage(image, 0, 0, sourceWidth, sourceHeight);
  const alphaBounds = getAlphaBounds(context.getImageData(0, 0, sourceWidth, sourceHeight));

  if (alphaBounds?.hasTransparentPixels) {
    return await assertPrintCutoutQuality(buildBoundedPngFromCanvas({
      canvas,
      sourceWidth,
      sourceHeight,
      maxDataUrlBytes,
      storagePolicy: 'bounded-local-canvas-data-url-v1',
      engine: 'browser-existing-transparent-garment-v1',
      validateSubjectShape: true,
    }), 'プリント画像');
  }

  try {
    const imageData = context.getImageData(0, 0, sourceWidth, sourceHeight);
    const deterministicCutout = buildPrintArtworkBackgroundCutoutRgba({
      rgba: imageData.data,
      width: sourceWidth,
      height: sourceHeight,
    });
    if (!deterministicCutout.accepted) {
      throw new Error(`artwork_background_cutout_rejected:${deterministicCutout.estimate?.sampleSpread ?? 'no_estimate'}:${deterministicCutout.removedRatio}`);
    }
    imageData.data.set(deterministicCutout.rgba);
    context.putImageData(imageData, 0, 0);
    return await assertPrintCutoutQuality(buildBoundedPngFromCanvas({
      canvas,
      sourceWidth,
      sourceHeight,
      maxDataUrlBytes,
      storagePolicy: 'bounded-local-canvas-data-url-v1',
      engine: 'browser-canvas-artwork-background-cutout-v1',
      validateSubjectShape: true,
    }), 'プリント画像');
  } catch (deterministicError) {
    try {
      const highPrecisionResult = await buildHighPrecisionMaterialCutoutDataUrl({
        imageUrl,
        maxDataUrlBytes,
        modelName: 'silueta',
        postProcessMask: false,
      });
      return await assertPrintCutoutQuality(highPrecisionResult, 'プリント画像');
    } catch (highPrecisionError) {
      try {
        const fallback = await buildMaterialCutoutDataUrl({
          imageUrl,
          mode: 'auto',
          candidate: '柄',
          maxSize: 840,
          maxDataUrlBytes,
        });
        return await assertPrintCutoutQuality(fallback, 'プリント画像');
      } catch (fallbackError) {
        const detail = fallbackError instanceof Error ? fallbackError.message : String(fallbackError);
        console.warn('Print design cutout failed', { deterministicError, highPrecisionError, fallbackError });
        throw new Error(`プリント画像の背景を透明化できませんでした。${detail}`);
      }
    }
  }
}

function buildCutoutFromImage({
  image,
  sourceWidth,
  sourceHeight,
  mode,
  candidate,
  maxSize,
  storagePolicy,
}: {
  image: HTMLImageElement;
  sourceWidth: number;
  sourceHeight: number;
  mode: MaterialReferenceState['maskMode'];
  candidate?: string | null;
  maxSize: number;
  storagePolicy: MaterialCutoutResult['storagePolicy'];
}): MaterialCutoutResult {
  const ratio = Math.min(1, maxSize / Math.max(sourceWidth, sourceHeight));
  const width = Math.max(1, Math.round(sourceWidth * ratio));
  const height = Math.max(1, Math.round(sourceHeight * ratio));
  const canvas = document.createElement('canvas');
  canvas.width = width;
  canvas.height = height;
  const context = canvas.getContext('2d', { willReadFrequently: true });
  if (!context) throw new Error('Canvasを初期化できませんでした');

  context.clearRect(0, 0, width, height);
  context.drawImage(image, 0, 0, width, height);
  const imageData = context.getImageData(0, 0, width, height);
  const { data } = imageData;
  const background = estimateBackgroundColor(data, width, height);
  const candidateBackgroundMask = mode === 'auto' || candidate?.includes('無地') || candidate?.includes('トップス') || candidate?.includes('garment')
    ? buildEdgeConnectedBackgroundMask(data, width, height, background)
    : null;
  const garmentCandidate = Boolean(candidate?.includes('無地') || candidate?.includes('トップス') || candidate?.includes('garment') || candidate?.includes('服'));
  const backgroundMask = candidateBackgroundMask && shouldUseBackgroundMask({
    mask: candidateBackgroundMask,
    background,
    width,
    height,
  }) || (candidateBackgroundMask && garmentCandidate && background.sampleSpread <= 96)
    ? candidateBackgroundMask
    : null;
  let minX = width;
  let minY = height;
  let maxX = -1;
  let maxY = -1;
  let hasTransparentPixels = false;

  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) {
      const index = (y * width + x) * 4;
      const geometricAlpha = backgroundMask ? 255 : getMaskAlpha({ x, y, width, height, mode, candidate });
      const protectedCenter = isProtectedCutoutCenter(x, y, width, height);
      const backgroundPixel = !protectedCenter && backgroundMask?.[y * width + x] === 1;
      const nearBackgroundEdge = !protectedCenter && backgroundMask
        ? hasBackgroundNeighbor(backgroundMask, x, y, width, height)
        : false;
      const backgroundDistance = colorDistance(readRgb(data, index), background);
      const backgroundAlpha = backgroundPixel
        ? 0
        : nearBackgroundEdge && backgroundDistance < 66
          ? 0
          : 255;
      const alpha = Math.min(
        data[index + 3],
        geometricAlpha,
        backgroundAlpha,
      );
      data[index + 3] = alpha;
      if (alpha > 4) {
        minX = Math.min(minX, x);
        minY = Math.min(minY, y);
        maxX = Math.max(maxX, x);
        maxY = Math.max(maxY, y);
      }
      if (alpha < 250) hasTransparentPixels = true;
    }
  }

  context.putImageData(imageData, 0, 0);
  if (maxX < minX || maxY < minY) {
    const dataUrl = canvas.toDataURL('image/png');
    return {
      dataUrl,
      bounds: { x: 0, y: 0, width, height },
      sourceSize: { width: sourceWidth, height: sourceHeight },
      outputSize: { width, height },
      dataUrlBytes: estimateDataUrlBytes(dataUrl),
      storagePolicy,
      engine: backgroundMask ? 'browser-canvas-background-flood-cutout-v2' : 'browser-canvas-geometric-mask-v1',
      hasTransparentPixels,
    };
  }

  const padding = Math.round(Math.max(width, height) * 0.025);
  const cropX = Math.max(0, minX - padding);
  const cropY = Math.max(0, minY - padding);
  const cropRight = Math.min(width, maxX + padding);
  const cropBottom = Math.min(height, maxY + padding);
  const cropWidth = Math.max(1, cropRight - cropX + 1);
  const cropHeight = Math.max(1, cropBottom - cropY + 1);
  const cropCanvas = document.createElement('canvas');
  cropCanvas.width = cropWidth;
  cropCanvas.height = cropHeight;
  const cropContext = cropCanvas.getContext('2d');
  if (!cropContext) throw new Error('Canvasを初期化できませんでした');
  cropContext.drawImage(canvas, cropX, cropY, cropWidth, cropHeight, 0, 0, cropWidth, cropHeight);
  const dataUrl = cropCanvas.toDataURL('image/png');

  return {
    dataUrl,
    bounds: { x: cropX, y: cropY, width: cropWidth, height: cropHeight },
    sourceSize: { width: sourceWidth, height: sourceHeight },
    outputSize: { width: cropWidth, height: cropHeight },
    dataUrlBytes: estimateDataUrlBytes(dataUrl),
    storagePolicy,
    engine: backgroundMask ? 'browser-canvas-background-flood-cutout-v2' : 'browser-canvas-geometric-mask-v1',
    hasTransparentPixels,
  };
}
