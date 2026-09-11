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
  mode: 'source-protected-outside-mask-v1' | 'source-protected-native-frame-v1';
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

/** Map the selected cutout's frame back onto the original photograph. The
 * print layout and garment mask must use this same mapping, including crops. */
export function resolveGarmentCutoutSourcePlacement(
  sourceSize: { width: number; height: number },
  garmentCutout: Pick<MaterialCutoutResult, 'sourceFrameSize' | 'sourceSize' | 'outputSize' | 'bounds'>,
) {
  const frame = garmentCutout.sourceFrameSize ?? garmentCutout.sourceSize;
  if (![sourceSize.width, sourceSize.height, frame.width, frame.height,
    garmentCutout.outputSize.width, garmentCutout.outputSize.height]
    .every(value => Number.isFinite(value) && value > 0)) {
    throw new Error('provider_mask_source_frame_missing');
  }
  if (garmentCutout.outputSize.width === frame.width && garmentCutout.outputSize.height === frame.height) {
    return { x: 0, y: 0, width: sourceSize.width, height: sourceSize.height };
  }
  const bounds = garmentCutout.bounds;
  if (![bounds.x, bounds.y, bounds.width, bounds.height].every(Number.isFinite)
    || bounds.x < 0 || bounds.y < 0 || bounds.width <= 0 || bounds.height <= 0
    || bounds.x + bounds.width > frame.width || bounds.y + bounds.height > frame.height) {
    throw new Error('provider_mask_bounds_invalid');
  }
  return {
    x: bounds.x / frame.width * sourceSize.width,
    y: bounds.y / frame.height * sourceSize.height,
    width: bounds.width / frame.width * sourceSize.width,
    height: bounds.height / frame.height * sourceSize.height,
  };
}

/** A model reference, not a native inpainting mask: white means editable,
 * black protected. Alpha is the authoritative mask channel in our existing UI. */
export function providerMaskGuidePixels(mask: Uint8ClampedArray) {
  if (!mask.length || mask.length % 4) throw new Error('provider_mask_rgba_length_invalid');
  const guide = new Uint8ClampedArray(mask.length); let editable = 0;
  for (let at = 0; at < mask.length; at += 4) {
    const amount = 255 - mask[at + 3]; editable += amount / 255;
    guide[at] = guide[at + 1] = guide[at + 2] = amount; guide[at + 3] = 255;
  }
  if (editable === 0) throw new Error('provider_mask_has_no_editable_pixels');
  return { rgba:guide,coveragePercent:editable / (mask.length / 4) * 100 };
}

/** Preserve all four decoded source channels at protected pixels, including
 * transparent backgrounds. Source-over alone lets the provider leak through
 * a transparent protected source. Feathered edges blend premultiplied alpha. */
export function blendProviderProtectedPixels(source: Uint8ClampedArray, provider: Uint8ClampedArray, mask: Uint8ClampedArray) {
  if (!source.length || source.length % 4 || source.length !== provider.length || source.length !== mask.length) throw new Error('provider_protected_pixel_dimensions_mismatch');
  const result = new Uint8ClampedArray(source.length);
  for (let at = 0; at < source.length; at += 4) {
    const keep = mask[at + 3] / 255;
    if (keep === 1 || keep === 0) {
      const input = keep === 1 ? source : provider;
      for (let channel = 0; channel < 4; channel++) result[at + channel] = input[at + channel];
      continue;
    }
    const sourceAlpha = source[at + 3] / 255 * keep;
    const providerAlpha = provider[at + 3] / 255 * (1 - keep); const alpha = sourceAlpha + providerAlpha;
    for (let channel = 0; channel < 3; channel++) result[at + channel] = alpha ? Math.round((source[at + channel] * sourceAlpha + provider[at + channel] * providerAlpha) / alpha) : 0;
    result[at + 3] = Math.round(alpha * 255);
  }
  return result;
}

export async function buildProviderMaskGuide({ sourceImageUrl,maskDataUrl }: { sourceImageUrl: string; maskDataUrl: string }) {
  const [source,mask] = await Promise.all([loadImage(sourceImageUrl),loadImage(maskDataUrl)]);
  const size = dimensionsOf(source); const maskSize = dimensionsOf(mask);
  if (size.width < 1 || size.height < 1 || size.width > 4096 || size.height > 4096) throw new Error('provider_mask_source_exceeds_4096px');
  if (maskSize.width !== size.width || maskSize.height !== size.height) throw new Error('provider_protected_composite_mask_dimensions_mismatch');
  const canvas = document.createElement('canvas'); canvas.width = size.width; canvas.height = size.height;
  const context = canvas.getContext('2d',{ willReadFrequently:true }); if (!context) throw new Error('provider_mask_canvas_unavailable');
  context.drawImage(source,0,0); const sourceDataUrl = canvas.toDataURL('image/png');
  if (sourceDataUrl.length > Math.ceil(10 * 1024 * 1024 / 3) * 4 + 64) throw new Error('provider_mask_source_too_large');
  context.clearRect(0,0,size.width,size.height); context.drawImage(mask,0,0);
  const { rgba,coveragePercent } = providerMaskGuidePixels(context.getImageData(0,0,size.width,size.height).data);
  context.putImageData(new ImageData(rgba,size.width,size.height),0,0);
  return { sourceDataUrl,guideDataUrl:canvas.toDataURL('image/png'),width:size.width,height:size.height,coveragePercent };
}

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
  if (!sourceSize.width || !sourceSize.height || !cutoutSize.width || !cutoutSize.height) {
    throw new Error('provider_mask_dimensions_missing');
  }
  const placement = resolveGarmentCutoutSourcePlacement(sourceSize, garmentCutout);

  const garmentCanvas = document.createElement('canvas');
  garmentCanvas.width = sourceSize.width;
  garmentCanvas.height = sourceSize.height;
  const garmentContext = garmentCanvas.getContext('2d', { willReadFrequently: true });
  if (!garmentContext) throw new Error('provider_mask_canvas_unavailable');
  garmentContext.clearRect(0, 0, sourceSize.width, sourceSize.height);
  garmentContext.imageSmoothingEnabled = true;
  garmentContext.imageSmoothingQuality = 'high';

  garmentContext.drawImage(cutoutImage, 0, 0, cutoutSize.width, cutoutSize.height,
    placement.x, placement.y, placement.width, placement.height);

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
  preserveSourceDimensions = false,
}: {
  sourceImageUrl: string;
  providerImageUrl: string;
  maskDataUrl: string;
  /** Cloudflare guide editing restores the original frame, without resizing
   * protected source pixels to the model's bounded output dimensions. */
  preserveSourceDimensions?: boolean;
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

  if (preserveSourceDimensions) {
    if (sourceSize.width > 4096 || sourceSize.height > 4096) throw new Error('provider_mask_source_exceeds_4096px');
    const canvas = document.createElement('canvas'); canvas.width = sourceSize.width; canvas.height = sourceSize.height;
    const context = canvas.getContext('2d',{ willReadFrequently:true }); if (!context) throw new Error('provider_protected_composite_result_context_missing');
    context.drawImage(sourceImage,0,0); const source = context.getImageData(0,0,canvas.width,canvas.height).data;
    context.clearRect(0,0,canvas.width,canvas.height); context.drawImage(providerImage,0,0,canvas.width,canvas.height);
    const provider = context.getImageData(0,0,canvas.width,canvas.height).data;
    context.clearRect(0,0,canvas.width,canvas.height); context.drawImage(maskImage,0,0);
    const mask = context.getImageData(0,0,canvas.width,canvas.height).data;
    context.putImageData(new ImageData(blendProviderProtectedPixels(source,provider,mask),canvas.width,canvas.height),0,0);
    return { dataUrl:canvas.toDataURL('image/png'),width:canvas.width,height:canvas.height,
      sourceFramePlacement:{ x:0,y:0,width:canvas.width,height:canvas.height },mode:'source-protected-native-frame-v1' };
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
