export const PRINT_ARTWORK_BACKGROUND_MAX_SAMPLE_SPREAD = 55;
export const PRINT_ARTWORK_BACKGROUND_COLOR_DISTANCE = 34;
export const PRINT_ARTWORK_LIGHT_BACKGROUND_MAX_SAMPLE_SPREAD = 110;
export const PRINT_ARTWORK_LIGHT_BACKGROUND_COLOR_DISTANCE = 72;
export const PRINT_ARTWORK_LIGHT_BACKGROUND_MAX_CHROMA = 18;
export const PRINT_ARTWORK_MIN_REMOVED_RATIO = 0.02;
export const PRINT_ARTWORK_MAX_REMOVED_RATIO = 0.92;
export const PRINT_ARTWORK_MIN_RETAINED_RATIO = 0.08;

type Rgb = { r: number; g: number; b: number };

export type PrintArtworkBackgroundEstimate = Rgb & {
  sampleSpread: number;
  sampleCount: number;
  lightNeutralSampleRatio: number;
};

export type PrintArtworkBackgroundCutout = {
  rgba: Uint8ClampedArray;
  accepted: boolean;
  estimate: PrintArtworkBackgroundEstimate | null;
  removedRatio: number;
  retainedRatio: number;
};

const readRgb = (rgba: Uint8ClampedArray, index: number): Rgb => ({
  r: rgba[index],
  g: rgba[index + 1],
  b: rgba[index + 2],
});

const colorDistance = (a: Rgb, b: Rgb) => Math.hypot(a.r - b.r, a.g - b.g, a.b - b.b);
const isNearWhiteBackground = (color: Rgb) => {
  const luminance = (0.2126 * color.r) + (0.7152 * color.g) + (0.0722 * color.b);
  const chroma = Math.max(color.r, color.g, color.b) - Math.min(color.r, color.g, color.b);
  return luminance >= 189.5 && chroma <= PRINT_ARTWORK_LIGHT_BACKGROUND_MAX_CHROMA;
};

export const estimatePrintArtworkBackground = (
  rgba: Uint8ClampedArray,
  width: number,
  height: number,
): PrintArtworkBackgroundEstimate | null => {
  if (width <= 0 || height <= 0 || rgba.length !== width * height * 4) return null;
  const samples: Rgb[] = [];
  const inset = Math.min(Math.max(0, Math.floor(Math.min(width, height) * 0.035)), Math.max(0, Math.floor(Math.min(width, height) / 2) - 1));
  const step = Math.max(8, Math.floor(Math.min(width, height) / 18));
  const addSample = (x: number, y: number) => {
    const index = ((y * width) + x) * 4;
    if (rgba[index + 3] > 4) samples.push(readRgb(rgba, index));
  };

  for (let x = inset; x < width - inset; x += step) {
    addSample(x, inset);
    addSample(x, height - 1 - inset);
  }
  for (let y = inset; y < height - inset; y += step) {
    addSample(inset, y);
    addSample(width - 1 - inset, y);
  }
  if (samples.length < 4) return null;

  const median = (channel: keyof Rgb) => {
    const values = samples.map((sample) => sample[channel]).sort((a, b) => a - b);
    return values[Math.floor(values.length / 2)];
  };
  const background = { r: median('r'), g: median('g'), b: median('b') };
  const sampleSpread = Math.max(...samples.map((sample) => colorDistance(sample, background)));
  const lightNeutralSampleRatio = samples.filter(isNearWhiteBackground).length / samples.length;
  return { ...background, sampleSpread, sampleCount: samples.length, lightNeutralSampleRatio };
};

export const isPrintArtworkBackgroundCutoutAcceptable = ({
  sampleSpread,
  removedRatio,
  retainedRatio,
}: {
  sampleSpread: number;
  removedRatio: number;
  retainedRatio: number;
}) => (
  sampleSpread <= PRINT_ARTWORK_BACKGROUND_MAX_SAMPLE_SPREAD
  && removedRatio >= PRINT_ARTWORK_MIN_REMOVED_RATIO
  && removedRatio <= PRINT_ARTWORK_MAX_REMOVED_RATIO
  && retainedRatio >= PRINT_ARTWORK_MIN_RETAINED_RATIO
);

/**
 * Remove only pixels connected to the outer border through a conservative,
 * four-neighbour background-color flood. RGB bytes are never changed.
 */
export const buildPrintArtworkBackgroundCutoutRgba = ({
  rgba,
  width,
  height,
  allowLightBackgroundFallback = false,
}: {
  rgba: Uint8ClampedArray;
  width: number;
  height: number;
  allowLightBackgroundFallback?: boolean;
}): PrintArtworkBackgroundCutout => {
  if (width <= 0 || height <= 0 || rgba.length !== width * height * 4) {
    throw new Error('invalid_print_artwork_mask_input');
  }
  const estimate = estimatePrintArtworkBackground(rgba, width, height);
  const output = new Uint8ClampedArray(rgba);
  const canUseLightBackgroundFallback = Boolean(
    allowLightBackgroundFallback
    && estimate
    && isNearWhiteBackground(estimate)
    && estimate.lightNeutralSampleRatio >= 0.75
    && estimate.sampleSpread <= PRINT_ARTWORK_LIGHT_BACKGROUND_MAX_SAMPLE_SPREAD,
  );
  if (!estimate || (
    estimate.sampleSpread > PRINT_ARTWORK_BACKGROUND_MAX_SAMPLE_SPREAD
    && !canUseLightBackgroundFallback
  )) {
    return { rgba: output, accepted: false, estimate, removedRatio: 0, retainedRatio: 1 };
  }
  const visited = new Uint8Array(width * height);
  const queue: number[] = [];
  const enqueue = (x: number, y: number, previousPixelIndex?: number) => {
    if (x < 0 || x >= width || y < 0 || y >= height) return;
    const pixelIndex = (y * width) + x;
    if (visited[pixelIndex]) return;
    const rgbaIndex = pixelIndex * 4;
    const transparent = rgba[rgbaIndex + 3] <= 4;
    const color = readRgb(rgba, rgbaIndex);
    const matchesBackground = canUseLightBackgroundFallback
      ? isNearWhiteBackground(color) && (
        previousPixelIndex === undefined
        || colorDistance(color, readRgb(rgba, previousPixelIndex * 4)) <= 36
      )
      : colorDistance(color, estimate) <= PRINT_ARTWORK_BACKGROUND_COLOR_DISTANCE;
    if (!transparent && !matchesBackground) return;
    visited[pixelIndex] = 1;
    queue.push(pixelIndex);
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
    enqueue(x + 1, y, pixelIndex);
    enqueue(x - 1, y, pixelIndex);
    enqueue(x, y + 1, pixelIndex);
    enqueue(x, y - 1, pixelIndex);
  }

  let opaquePixels = 0;
  let removedOpaquePixels = 0;
  for (let pixelIndex = 0; pixelIndex < width * height; pixelIndex += 1) {
    const alphaIndex = (pixelIndex * 4) + 3;
    if (rgba[alphaIndex] > 4) opaquePixels += 1;
    if (visited[pixelIndex]) {
      if (rgba[alphaIndex] > 4) removedOpaquePixels += 1;
      output[alphaIndex] = 0;
    }
  }
  const removedRatio = opaquePixels > 0 ? removedOpaquePixels / opaquePixels : 0;
  const retainedRatio = opaquePixels > 0 ? (opaquePixels - removedOpaquePixels) / opaquePixels : 0;
  const accepted = isPrintArtworkBackgroundCutoutAcceptable({
    sampleSpread: canUseLightBackgroundFallback
      ? Math.min(estimate.sampleSpread, PRINT_ARTWORK_BACKGROUND_MAX_SAMPLE_SPREAD)
      : estimate.sampleSpread,
    removedRatio,
    retainedRatio,
  });
  return {
    rgba: accepted ? output : new Uint8ClampedArray(rgba),
    accepted,
    estimate,
    removedRatio,
    retainedRatio,
  };
};

export type PrintMaskBrushMode = 'keep' | 'remove';

export const paintPrintMaskAlpha = ({
  alpha,
  sourceAlpha,
  width,
  height,
  centerX,
  centerY,
  radius,
  mode,
}: {
  alpha: Uint8ClampedArray;
  sourceAlpha: Uint8ClampedArray;
  width: number;
  height: number;
  centerX: number;
  centerY: number;
  radius: number;
  mode: PrintMaskBrushMode;
}) => {
  if (alpha.length !== width * height || sourceAlpha.length !== width * height) {
    throw new Error('invalid_print_mask_brush_input');
  }
  const output = new Uint8ClampedArray(alpha);
  const safeRadius = Math.max(1, radius);
  const minX = Math.max(0, Math.floor(centerX - safeRadius));
  const maxX = Math.min(width - 1, Math.ceil(centerX + safeRadius));
  const minY = Math.max(0, Math.floor(centerY - safeRadius));
  const maxY = Math.min(height - 1, Math.ceil(centerY + safeRadius));
  for (let y = minY; y <= maxY; y += 1) {
    for (let x = minX; x <= maxX; x += 1) {
      if (((x - centerX) ** 2) + ((y - centerY) ** 2) > safeRadius ** 2) continue;
      const index = (y * width) + x;
      output[index] = mode === 'keep' ? sourceAlpha[index] : 0;
    }
  }
  return output;
};

export const mergePrintMaskAlpha = (
  sourceRgba: Uint8ClampedArray,
  alpha: Uint8ClampedArray,
) => {
  if (sourceRgba.length !== alpha.length * 4) throw new Error('invalid_print_mask_merge_input');
  const output = new Uint8ClampedArray(sourceRgba);
  for (let index = 0; index < alpha.length; index += 1) output[(index * 4) + 3] = alpha[index];
  return output;
};

export const mapPrintMaskPointerToImage = ({
  clientX,
  clientY,
  rectLeft,
  rectTop,
  rectWidth,
  rectHeight,
  imageWidth,
  imageHeight,
}: {
  clientX: number;
  clientY: number;
  rectLeft: number;
  rectTop: number;
  rectWidth: number;
  rectHeight: number;
  imageWidth: number;
  imageHeight: number;
}) => ({
  x: ((clientX - rectLeft) / Math.max(1, rectWidth)) * imageWidth,
  y: ((clientY - rectTop) / Math.max(1, rectHeight)) * imageHeight,
});
