import type { MaterialCutoutResult } from '../../lib/workspaceMaterialReferences';

export const PROVIDER_GARMENT_MASK_ORIENTATION = 'transparent-garment-edit-v1' as const;

export type ProviderGarmentMask = {
  dataUrl: string;
  width: number;
  height: number;
  /** Percentage of pixels that are transparent/editable for the provider. */
  coveragePercent: number;
  orientation: typeof PROVIDER_GARMENT_MASK_ORIENTATION;
  sourceEngine: MaterialCutoutResult['engine'];
};

export type ProviderProtectedComposite = {
  dataUrl: string;
  width: number;
  height: number;
  sourceFramePlacement: {
    x: number;
    y: number;
    width: number;
    height: number;
  };
  mode: 'source-protected-outside-mask-v1';
};

export function resolveContainedImagePlacement({
  sourceWidth,
  sourceHeight,
  outputWidth,
  outputHeight,
}: {
  sourceWidth: number;
  sourceHeight: number;
  outputWidth: number;
  outputHeight: number;
}) {
  if (![sourceWidth, sourceHeight, outputWidth, outputHeight].every((value) => Number.isFinite(value) && value > 0)) {
    throw new Error('provider_protected_composite_dimensions_invalid');
  }
  const scale = Math.min(outputWidth / sourceWidth, outputHeight / sourceHeight);
  return {
    x: (outputWidth - (sourceWidth * scale)) / 2,
    y: (outputHeight - (sourceHeight * scale)) / 2,
    width: sourceWidth * scale,
    height: sourceHeight * scale,
  };
}

export function invertGarmentAlphaToProviderMaskRgba(garmentRgba: Uint8ClampedArray) {
  if (garmentRgba.length === 0 || garmentRgba.length % 4 !== 0) {
    throw new Error('provider_mask_rgba_length_invalid');
  }
  const maskRgba = new Uint8ClampedArray(garmentRgba.length);
  let editablePixels = 0;
  for (let offset = 0; offset < garmentRgba.length; offset += 4) {
    const garmentAlpha = garmentRgba[offset + 3];
    maskRgba[offset] = 255;
    maskRgba[offset + 1] = 255;
    maskRgba[offset + 2] = 255;
    maskRgba[offset + 3] = 255 - garmentAlpha;
    if (maskRgba[offset + 3] < 128) editablePixels += 1;
  }
  return {
    rgba: maskRgba,
    editablePixels,
    totalPixels: garmentRgba.length / 4,
  };
}

const loadImage = async (url: string): Promise<HTMLImageElement> => await new Promise((resolve, reject) => {
  const image = new Image();
  if (/^https?:\/\//i.test(url)) image.crossOrigin = 'anonymous';
  image.onload = () => resolve(image);
  image.onerror = () => reject(new Error('provider_mask_image_load_failed'));
  image.src = url;
});

const dimensionsOf = (image: HTMLImageElement) => ({
  width: image.naturalWidth || image.width,
  height: image.naturalHeight || image.height,
});

/**
 * Convert a transparent garment cutout into the OpenAI edit-mask contract.
 * OpenAI treats transparent mask pixels as editable, so the garment alpha is
 * inverted: garment = transparent, background = opaque/preserved.
 *
 * The result is always rendered at the exact dimensions of the primary input;
 * this prevents a cropped local preview from becoming a dimension-mismatched
 * or spatially shifted provider mask.
 */
export async function buildProviderGarmentEditMask({
  sourceImageUrl,
  garmentCutout,
}: {
  sourceImageUrl: string;
  garmentCutout: MaterialCutoutResult;
}): Promise<ProviderGarmentMask> {
  const sourceImage = await loadImage(sourceImageUrl);
  const cutoutImage = await loadImage(garmentCutout.dataUrl);
  const sourceSize = dimensionsOf(sourceImage);
  const cutoutSize = dimensionsOf(cutoutImage);
  const frame = garmentCutout.sourceFrameSize ?? garmentCutout.sourceSize;
  if (!sourceSize.width || !sourceSize.height || !cutoutSize.width || !cutoutSize.height) {
    throw new Error('provider_mask_dimensions_missing');
  }
  if (!frame.width || !frame.height) throw new Error('provider_mask_source_frame_missing');

  const garmentCanvas = document.createElement('canvas');
  garmentCanvas.width = sourceSize.width;
  garmentCanvas.height = sourceSize.height;
  const garmentContext = garmentCanvas.getContext('2d', { willReadFrequently: true });
  if (!garmentContext) throw new Error('provider_mask_canvas_unavailable');
  garmentContext.clearRect(0, 0, sourceSize.width, sourceSize.height);
  garmentContext.imageSmoothingEnabled = true;
  garmentContext.imageSmoothingQuality = 'high';

  const isFullFrame = (
    garmentCutout.outputSize.width === frame.width
    && garmentCutout.outputSize.height === frame.height
  );
  if (isFullFrame) {
    garmentContext.drawImage(cutoutImage, 0, 0, sourceSize.width, sourceSize.height);
  } else {
    const bounds = garmentCutout.bounds;
    const x = (bounds.x / frame.width) * sourceSize.width;
    const y = (bounds.y / frame.height) * sourceSize.height;
    const width = (bounds.width / frame.width) * sourceSize.width;
    const height = (bounds.height / frame.height) * sourceSize.height;
    if (!(width > 0 && height > 0)) throw new Error('provider_mask_bounds_invalid');
    garmentContext.drawImage(cutoutImage, 0, 0, cutoutSize.width, cutoutSize.height, x, y, width, height);
  }

  const garmentPixels = garmentContext.getImageData(0, 0, sourceSize.width, sourceSize.height);
  const invertedMask = invertGarmentAlphaToProviderMaskRgba(garmentPixels.data);
  const maskPixels = new ImageData(invertedMask.rgba, sourceSize.width, sourceSize.height);
  const editablePixels = invertedMask.editablePixels;
  const totalPixels = invertedMask.totalPixels;
  const coveragePercent = totalPixels > 0 ? (editablePixels / totalPixels) * 100 : 0;
  if (coveragePercent < 0.1 || coveragePercent > 95) {
    throw new Error(`provider_mask_coverage_invalid:${coveragePercent.toFixed(2)}`);
  }

  const maskCanvas = document.createElement('canvas');
  maskCanvas.width = sourceSize.width;
  maskCanvas.height = sourceSize.height;
  const maskContext = maskCanvas.getContext('2d', { willReadFrequently: true });
  if (!maskContext) throw new Error('provider_mask_output_context_unavailable');
  maskContext.putImageData(maskPixels, 0, 0);
  return {
    dataUrl: maskCanvas.toDataURL('image/png'),
    width: sourceSize.width,
    height: sourceSize.height,
    coveragePercent: Number(coveragePercent.toFixed(4)),
    orientation: PROVIDER_GARMENT_MASK_ORIENTATION,
    sourceEngine: garmentCutout.engine,
  };
}

/**
 * Restore the source image everywhere the provider mask is opaque.
 *
 * GPT Image can still reinterpret a person or background while editing a
 * masked garment, especially when a second reference image is supplied. The
 * provider result remains the source of the garment edit, but the source is
 * authoritative outside the editable region. Both the source and mask use
 * the same contained placement so a provider output with a standard 2:3
 * canvas cannot shift the protected subject.
 */
export async function composeProviderProtectedResult({
  sourceImageUrl,
  providerImageUrl,
  maskDataUrl,
}: {
  sourceImageUrl: string;
  providerImageUrl: string;
  maskDataUrl: string;
}): Promise<ProviderProtectedComposite> {
  const [sourceImage, providerImage, maskImage] = await Promise.all([
    loadImage(sourceImageUrl),
    loadImage(providerImageUrl),
    loadImage(maskDataUrl),
  ]);
  const sourceSize = dimensionsOf(sourceImage);
  const providerSize = dimensionsOf(providerImage);
  const maskSize = dimensionsOf(maskImage);
  if (!sourceSize.width || !sourceSize.height || !providerSize.width || !providerSize.height) {
    throw new Error('provider_protected_composite_dimensions_missing');
  }
  if (maskSize.width !== sourceSize.width || maskSize.height !== sourceSize.height) {
    throw new Error('provider_protected_composite_mask_dimensions_mismatch');
  }

  const placement = resolveContainedImagePlacement({
    sourceWidth: sourceSize.width,
    sourceHeight: sourceSize.height,
    outputWidth: providerSize.width,
    outputHeight: providerSize.height,
  });

  const resultCanvas = document.createElement('canvas');
  resultCanvas.width = providerSize.width;
  resultCanvas.height = providerSize.height;
  const resultContext = resultCanvas.getContext('2d');
  if (!resultContext) throw new Error('provider_protected_composite_result_context_missing');
  resultContext.imageSmoothingEnabled = true;
  resultContext.imageSmoothingQuality = 'high';
  resultContext.drawImage(providerImage, 0, 0, providerSize.width, providerSize.height);

  const sourceCanvas = document.createElement('canvas');
  sourceCanvas.width = providerSize.width;
  sourceCanvas.height = providerSize.height;
  const sourceContext = sourceCanvas.getContext('2d');
  if (!sourceContext) throw new Error('provider_protected_composite_source_context_missing');
  sourceContext.imageSmoothingEnabled = true;
  sourceContext.imageSmoothingQuality = 'high';
  sourceContext.drawImage(sourceImage, placement.x, placement.y, placement.width, placement.height);
  sourceContext.globalCompositeOperation = 'destination-in';
  sourceContext.drawImage(maskImage, placement.x, placement.y, placement.width, placement.height);
  sourceContext.globalCompositeOperation = 'source-over';

  resultContext.drawImage(sourceCanvas, 0, 0, providerSize.width, providerSize.height);
  const dataUrl = resultCanvas.toDataURL('image/png');
  return {
    dataUrl,
    width: providerSize.width,
    height: providerSize.height,
    sourceFramePlacement: placement,
    mode: 'source-protected-outside-mask-v1',
  };
}
