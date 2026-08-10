export type GuidedMaskRasterizationInput = {
  mask: Uint8Array;
  maskWidth: number;
  maskHeight: number;
  outputWidth: number;
  outputHeight: number;
  sourceImageWidth: number;
  sourceImageHeight: number;
  context: {
    x: number;
    y: number;
    width: number;
    height: number;
  };
  samplesPerPixel?: 2 | 4;
};

const clamp = (value: number, min: number, max: number) => Math.max(min, Math.min(max, value));

const validate = ({
  mask,
  maskWidth,
  maskHeight,
  outputWidth,
  outputHeight,
  sourceImageWidth,
  sourceImageHeight,
  context,
}: GuidedMaskRasterizationInput) => {
  if (
    mask.length !== maskWidth * maskHeight
    || !Number.isSafeInteger(maskWidth)
    || !Number.isSafeInteger(maskHeight)
    || maskWidth <= 0
    || maskHeight <= 0
    || !Number.isSafeInteger(outputWidth)
    || !Number.isSafeInteger(outputHeight)
    || outputWidth <= 0
    || outputHeight <= 0
    || !Number.isFinite(sourceImageWidth)
    || !Number.isFinite(sourceImageHeight)
    || sourceImageWidth <= 0
    || sourceImageHeight <= 0
    || !Number.isFinite(context.x)
    || !Number.isFinite(context.y)
    || !Number.isFinite(context.width)
    || !Number.isFinite(context.height)
    || context.width <= 0
    || context.height <= 0
  ) {
    throw new Error('GUIDED_MASK_RASTERIZATION_INVALID_INPUT');
  }
};

/**
 * Rasterizes a binary guided mask with sub-pixel coverage instead of nearest
 * neighbour 0/255 sampling. Only the one-pixel contour band becomes partial
 * alpha; fully selected and fully excluded regions remain exact.
 */
export const rasterizeGuidedMaskAlpha = (input: GuidedMaskRasterizationInput) => {
  validate(input);
  const samplesPerPixel = input.samplesPerPixel ?? 4;
  const alpha = new Uint8ClampedArray(input.outputWidth * input.outputHeight);
  const totalSamples = samplesPerPixel * samplesPerPixel;

  for (let y = 0; y < input.outputHeight; y += 1) {
    for (let x = 0; x < input.outputWidth; x += 1) {
      let selectedSamples = 0;
      for (let sampleY = 0; sampleY < samplesPerPixel; sampleY += 1) {
        const sourceY = input.context.y + ((y + ((sampleY + 0.5) / samplesPerPixel)) / input.outputHeight) * input.context.height;
        const normalizedY = clamp(sourceY / input.sourceImageHeight, 0, 1 - Number.EPSILON);
        const maskY = Math.min(input.maskHeight - 1, Math.floor(normalizedY * input.maskHeight));
        for (let sampleX = 0; sampleX < samplesPerPixel; sampleX += 1) {
          const sourceX = input.context.x + ((x + ((sampleX + 0.5) / samplesPerPixel)) / input.outputWidth) * input.context.width;
          const normalizedX = clamp(sourceX / input.sourceImageWidth, 0, 1 - Number.EPSILON);
          const maskX = Math.min(input.maskWidth - 1, Math.floor(normalizedX * input.maskWidth));
          selectedSamples += input.mask[(maskY * input.maskWidth) + maskX] === 1 ? 1 : 0;
        }
      }
      alpha[(y * input.outputWidth) + x] = Math.round((selectedSamples / totalSamples) * 255);
    }
  }

  return alpha;
};
