const clampByte = (value: number) => Math.round(Math.min(255, Math.max(0, value)));

const pixelOffset = (x: number, y: number, width: number) => ((y * width) + x) * 4;

const validate = (rgba: Uint8ClampedArray, width: number, height: number) => {
  if (
    !Number.isSafeInteger(width)
    || !Number.isSafeInteger(height)
    || width <= 0
    || height <= 0
    || rgba.length !== width * height * 4
  ) {
    throw new Error('CUTOUT_ALPHA_POLISH_INVALID_INPUT');
  }
};

const pruneTinyComponents = (rgba: Uint8ClampedArray, width: number, height: number) => {
  const pixelCount = width * height;
  const visible = new Uint8Array(pixelCount);
  let visiblePixels = 0;
  for (let index = 0; index < pixelCount; index += 1) {
    if (rgba[(index * 4) + 3] < 16) continue;
    visible[index] = 1;
    visiblePixels += 1;
  }
  if (visiblePixels === 0) return new Uint8ClampedArray(rgba);

  const minimumComponentPixels = Math.max(24, Math.floor(visiblePixels * 0.0002));
  const componentId = new Int32Array(pixelCount);
  componentId.fill(-1);
  const componentSizes: number[] = [];
  const output = new Uint8ClampedArray(rgba);
  const queue = new Int32Array(pixelCount);
  for (let start = 0; start < pixelCount; start += 1) {
    if (!visible[start] || componentId[start] >= 0) continue;
    const currentComponentId = componentSizes.length;
    let queueStart = 0;
    let queueEnd = 0;
    queue[queueEnd] = start;
    queueEnd += 1;
    componentId[start] = currentComponentId;
    while (queueStart < queueEnd) {
      const index = queue[queueStart];
      queueStart += 1;
      const x = index % width;
      const y = Math.floor(index / width);
      for (const [nextX, nextY] of [
        [x - 1, y - 1], [x, y - 1], [x + 1, y - 1],
        [x - 1, y],                 [x + 1, y],
        [x - 1, y + 1], [x, y + 1], [x + 1, y + 1],
      ] as const) {
        if (nextX < 0 || nextY < 0 || nextX >= width || nextY >= height) continue;
        const nextIndex = (nextY * width) + nextX;
        if (!visible[nextIndex] || componentId[nextIndex] >= 0) continue;
        componentId[nextIndex] = currentComponentId;
        queue[queueEnd] = nextIndex;
        queueEnd += 1;
      }
    }
    componentSizes.push(queueEnd);
  }
  const largestComponentSize = Math.max(...componentSizes);
  for (let index = 0; index < pixelCount; index += 1) {
    const currentComponentId = componentId[index];
    if (
      currentComponentId >= 0
      && componentSizes[currentComponentId] < minimumComponentPixels
      && componentSizes[currentComponentId] < largestComponentSize
    ) {
      output[(index * 4) + 3] = 0;
    }
  }
  return output;
};

/**
 * Removes only tiny disconnected alpha islands, then softens the binary
 * contour by one pixel. This is intentionally bounded: garment interiors and
 * large connected regions keep their original alpha and RGB values.
 */
export const polishCutoutAlpha = ({
  rgba,
  width,
  height,
}: {
  rgba: Uint8ClampedArray;
  width: number;
  height: number;
}) => {
  validate(rgba, width, height);
  const cleaned = pruneTinyComponents(rgba, width, height);
  const output = new Uint8ClampedArray(cleaned);
  const neighborOffsets = [
    [-1, -1, 1], [0, -1, 2], [1, -1, 1],
    [-1, 0, 2],             [1, 0, 2],
    [-1, 1, 1],  [0, 1, 2],  [1, 1, 1],
  ] as const;

  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) {
      const center = pixelOffset(x, y, width);
      const centerAlpha = cleaned[center + 3];
      if (centerAlpha !== 0 && centerAlpha !== 255) continue;
      let sawTransparent = centerAlpha === 0;
      let sawOpaque = centerAlpha === 255;
      let weightedAlpha = centerAlpha * 4;
      let totalWeight = 4;
      let red = cleaned[center] * 4;
      let green = cleaned[center + 1] * 4;
      let blue = cleaned[center + 2] * 4;
      let foregroundWeight = centerAlpha >= 200 ? 4 : 0;

      for (const [offsetX, offsetY, weight] of neighborOffsets) {
        const nextX = x + offsetX;
        const nextY = y + offsetY;
        if (nextX < 0 || nextY < 0 || nextX >= width || nextY >= height) continue;
        const next = pixelOffset(nextX, nextY, width);
        const nextAlpha = cleaned[next + 3];
        sawTransparent ||= nextAlpha === 0;
        sawOpaque ||= nextAlpha === 255;
        weightedAlpha += nextAlpha * weight;
        totalWeight += weight;
        if (nextAlpha >= 200) {
          red += cleaned[next] * weight;
          green += cleaned[next + 1] * weight;
          blue += cleaned[next + 2] * weight;
          foregroundWeight += weight;
        }
      }
      if (!sawTransparent || !sawOpaque) continue;

      output[center + 3] = clampByte(weightedAlpha / totalWeight);
      if (foregroundWeight > 0) {
        output[center] = clampByte(red / foregroundWeight);
        output[center + 1] = clampByte(green / foregroundWeight);
        output[center + 2] = clampByte(blue / foregroundWeight);
      }
    }
  }
  return output;
};
