export const EDGE_REFINEMENT_MAX_PIXELS = 16_000_000;
export const EDGE_REFINEMENT_PIXEL_LIMIT_EXCEEDED = 'EDGE_REFINEMENT_PIXEL_LIMIT_EXCEEDED';

const clampByte = (value: number) => Math.round(Math.min(255, Math.max(0, value)));

const validate = (rgba: Uint8ClampedArray, width: number, height: number) => {
  if (!Number.isSafeInteger(width) || !Number.isSafeInteger(height) || width <= 0 || height <= 0) {
    throw new Error('EDGE_REFINEMENT_INVALID_INPUT');
  }
  if (width > EDGE_REFINEMENT_MAX_PIXELS / height) throw new Error(EDGE_REFINEMENT_PIXEL_LIMIT_EXCEEDED);
  if (rgba.length !== width * height * 4) throw new Error('EDGE_REFINEMENT_INVALID_INPUT');
};

/**
 * Deterministic 3x3 source-resolution alpha refinement. Only partial-alpha
 * pixels (8..247) change; opaque interior and transparent exterior stay exact.
 */
export const refineAlphaEdge = ({
  rgba,
  width,
  height,
}: {
  rgba: Uint8ClampedArray;
  width: number;
  height: number;
}) => {
  validate(rgba, width, height);
  const output = new Uint8ClampedArray(rgba);
  const spatial = [1, 2, 1] as const;
  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) {
      const center = ((y * width) + x) * 4;
      const centerAlpha = rgba[center + 3];
      if (centerAlpha < 8 || centerAlpha > 247) continue;
      let weightedAlpha = 0;
      let totalWeight = 0;
      for (let oy = -1; oy <= 1; oy += 1) {
        for (let ox = -1; ox <= 1; ox += 1) {
          const sampleX = Math.min(width - 1, Math.max(0, x + ox));
          const sampleY = Math.min(height - 1, Math.max(0, y + oy));
          const sample = ((sampleY * width) + sampleX) * 4;
          const guideDistance = Math.max(
            Math.abs(rgba[center] - rgba[sample]),
            Math.abs(rgba[center + 1] - rgba[sample + 1]),
            Math.abs(rgba[center + 2] - rgba[sample + 2]),
          );
          if (guideDistance > 32) continue;
          const guideWeight = 33 - guideDistance;
          const weight = spatial[ox + 1] * spatial[oy + 1] * guideWeight;
          weightedAlpha += rgba[sample + 3] * weight;
          totalWeight += weight;
        }
      }
      output[center + 3] = clampByte(weightedAlpha / Math.max(1, totalWeight));
    }
  }
  return output;
};

/** Removes a known background contribution from partial-alpha boundary RGB. */
export const decontaminateRefinedEdge = ({
  rgba,
  width,
  height,
  background,
}: {
  rgba: Uint8ClampedArray;
  width: number;
  height: number;
  background: { r: number; g: number; b: number };
}) => {
  validate(rgba, width, height);
  const output = new Uint8ClampedArray(rgba);
  for (let index = 0; index < output.length; index += 4) {
    const alphaByte = output[index + 3];
    if (alphaByte < 8 || alphaByte > 247) continue;
    const alpha = alphaByte / 255;
    output[index] = clampByte((output[index] - ((1 - alpha) * background.r)) / alpha);
    output[index + 1] = clampByte((output[index + 1] - ((1 - alpha) * background.g)) / alpha);
    output[index + 2] = clampByte((output[index + 2] - ((1 - alpha) * background.b)) / alpha);
  }
  return output;
};
