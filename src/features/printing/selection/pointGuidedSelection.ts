export type PointGuidedSelectionInput = {
  width: number;
  height: number;
  data: Uint8ClampedArray;
  point: { x: number; y: number };
};

export type PointGuidedSelection = {
  x: number;
  y: number;
  width: number;
  height: number;
  confidence: number;
  source: 'color-region' | 'tap-neighborhood';
  selectedPixels: number;
  touchesFrame: boolean;
  /**
   * A low-resolution bounded alpha mask. It is shown as the blue preview and
   * is applied to the exported PNG only after explicit user confirmation.
   */
  mask?: {
    width: number;
    height: number;
    data: Uint8Array;
  };
};

const MAX_ANALYSIS_EDGE = 280;
const MIN_REGION_RATIO = 0.0025;
const MAX_REGION_RATIO = 0.9;
const MIN_SELECTION_EDGE = 16;
const UNIFORM_BACKGROUND_MAX_SPREAD = 36;
const BACKGROUND_DISTANCE_THRESHOLD = 22;
const BORDER_BACKGROUND_MAX_SPREAD = 42;
const BACKGROUND_FLOOD_MAX_DISTANCE = 48;
const TRANSPARENT_BACKGROUND_MAX_ALPHA = 16;

type Rgb = { r: number; g: number; b: number };

const clamp = (value: number, min: number, max: number) => Math.max(min, Math.min(max, value));

const pixelOffset = (x: number, y: number, width: number) => (y * width + x) * 4;

const isTransparentPixel = (data: Uint8ClampedArray, width: number, x: number, y: number) => (
  data[pixelOffset(x, y, width) + 3] <= TRANSPARENT_BACKGROUND_MAX_ALPHA
);

const readRgb = (data: Uint8ClampedArray, width: number, x: number, y: number): Rgb => {
  const offset = pixelOffset(x, y, width);
  return { r: data[offset], g: data[offset + 1], b: data[offset + 2] };
};

const colorDistance = (left: Rgb, right: Rgb) => Math.hypot(
  left.r - right.r,
  left.g - right.g,
  left.b - right.b,
);

const estimateBorderBackground = ({
  width,
  height,
  data,
}: {
  width: number;
  height: number;
  data: Uint8ClampedArray;
}) => {
  const border = Math.max(1, Math.round(Math.min(width, height) * 0.04));
  const samples: Rgb[] = [];
  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) {
      if (x < border || y < border || x >= width - border || y >= height - border) {
        samples.push(readRgb(data, width, x, y));
      }
    }
  }
  if (samples.length < 8) return null;
  const total = samples.reduce(
    (sum, sample) => ({ r: sum.r + sample.r, g: sum.g + sample.g, b: sum.b + sample.b }),
    { r: 0, g: 0, b: 0 },
  );
  const average = {
    r: total.r / samples.length,
    g: total.g / samples.length,
    b: total.b / samples.length,
  };
  const spread = Math.max(...samples.map((sample) => colorDistance(sample, average)));
  return { color: average, spread };
};

const floodForegroundFromBorderBackground = ({
  width,
  height,
  data,
  seedX,
  seedY,
  background,
}: {
  width: number;
  height: number;
  data: Uint8ClampedArray;
  seedX: number;
  seedY: number;
  background: { color: Rgb; spread: number };
}) => {
  const backgroundDistance = Math.max(
    BACKGROUND_DISTANCE_THRESHOLD,
    Math.min(BACKGROUND_FLOOD_MAX_DISTANCE, background.spread + 8),
  );
  const isBackground = (x: number, y: number) => (
    isTransparentPixel(data, width, x, y)
    || colorDistance(readRgb(data, width, x, y), background.color) <= backgroundDistance
  );

  const backgroundVisited = new Uint8Array(width * height);
  const backgroundQueue = new Int32Array(width * height);
  let backgroundQueueStart = 0;
  let backgroundQueueEnd = 0;
  const enqueueBackground = (x: number, y: number) => {
    const index = y * width + x;
    if (backgroundVisited[index] || !isBackground(x, y)) return;
    backgroundVisited[index] = 1;
    backgroundQueue[backgroundQueueEnd] = index;
    backgroundQueueEnd += 1;
  };
  for (let x = 0; x < width; x += 1) {
    enqueueBackground(x, 0);
    enqueueBackground(x, height - 1);
  }
  for (let y = 1; y < height - 1; y += 1) {
    enqueueBackground(0, y);
    enqueueBackground(width - 1, y);
  }
  while (backgroundQueueStart < backgroundQueueEnd) {
    const index = backgroundQueue[backgroundQueueStart];
    backgroundQueueStart += 1;
    const x = index % width;
    const y = Math.floor(index / width);
    const neighbors = [
      [x - 1, y],
      [x + 1, y],
      [x, y - 1],
      [x, y + 1],
    ];
    for (const [nextX, nextY] of neighbors) {
      if (nextX < 0 || nextY < 0 || nextX >= width || nextY >= height) continue;
      enqueueBackground(nextX, nextY);
    }
  }

  const seedIndex = seedY * width + seedX;
  if (backgroundVisited[seedIndex]) return null;

  const visited = new Uint8Array(width * height);
  const queue = new Int32Array(width * height);
  let queueStart = 0;
  let queueEnd = 0;
  queue[queueEnd] = seedIndex;
  queueEnd += 1;
  visited[seedIndex] = 1;
  let minX = seedX;
  let minY = seedY;
  let maxX = seedX;
  let maxY = seedY;
  let touchesFrame = false;

  while (queueStart < queueEnd) {
    const index = queue[queueStart];
    queueStart += 1;
    const x = index % width;
    const y = Math.floor(index / width);
    minX = Math.min(minX, x);
    minY = Math.min(minY, y);
    maxX = Math.max(maxX, x);
    maxY = Math.max(maxY, y);
    if (x === 0 || y === 0 || x === width - 1 || y === height - 1) touchesFrame = true;

    const neighbors = [
      [x - 1, y],
      [x + 1, y],
      [x, y - 1],
      [x, y + 1],
    ];
    for (const [nextX, nextY] of neighbors) {
      if (nextX < 0 || nextY < 0 || nextX >= width || nextY >= height) continue;
      const nextIndex = nextY * width + nextX;
      if (visited[nextIndex]) continue;
      if (backgroundVisited[nextIndex]) continue;
      visited[nextIndex] = 1;
      queue[queueEnd] = nextIndex;
      queueEnd += 1;
    }
  }

  // Keep disconnected texture islands inside the selected garment bounds. A
  // printed logo can be separated from the base cloth at analysis resolution,
  // but it is still foreground when it is not connected to the outer
  // background. Background-connected collar/opening pixels remain excluded.
  const boundedForeground = new Uint8Array(visited);
  for (let y = minY; y <= maxY; y += 1) {
    for (let x = minX; x <= maxX; x += 1) {
      const index = (y * width) + x;
      if (!backgroundVisited[index]) boundedForeground[index] = 1;
    }
  }
  let boundedSelectedPixels = 0;
  for (const pixel of boundedForeground) boundedSelectedPixels += pixel;
  return {
    minX,
    minY,
    maxX,
    maxY,
    selectedPixels: boundedSelectedPixels,
    touchesFrame,
    mask: boundedForeground,
  };
};

const hasTransparentBorder = ({
  width,
  height,
  data,
}: {
  width: number;
  height: number;
  data: Uint8ClampedArray;
}) => {
  const border = Math.max(1, Math.round(Math.min(width, height) * 0.04));
  let transparent = 0;
  let total = 0;
  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) {
      if (x >= border && x < width - border && y >= border && y < height - border) continue;
      total += 1;
      if (isTransparentPixel(data, width, x, y)) transparent += 1;
    }
  }
  return total > 0 && transparent / total >= 0.6;
};

const averageSeedColor = (data: Uint8ClampedArray, width: number, height: number, x: number, y: number): Rgb => {
  let r = 0;
  let g = 0;
  let b = 0;
  let count = 0;
  for (let offsetY = -2; offsetY <= 2; offsetY += 1) {
    for (let offsetX = -2; offsetX <= 2; offsetX += 1) {
      const sampleX = clamp(x + offsetX, 0, width - 1);
      const sampleY = clamp(y + offsetY, 0, height - 1);
      const sample = readRgb(data, width, sampleX, sampleY);
      r += sample.r;
      g += sample.g;
      b += sample.b;
      count += 1;
    }
  }
  return { r: r / count, g: g / count, b: b / count };
};

const estimateUniformBackground = ({
  width,
  height,
  data,
  minX,
  minY,
  maxX,
  maxY,
}: {
  width: number;
  height: number;
  data: Uint8ClampedArray;
  minX: number;
  minY: number;
  maxX: number;
  maxY: number;
}) => {
  const ringWidth = Math.max(2, Math.round(Math.min(width, height) * 0.025));
  const outerMinX = Math.max(0, minX - ringWidth);
  const outerMinY = Math.max(0, minY - ringWidth);
  const outerMaxX = Math.min(width - 1, maxX + ringWidth);
  const outerMaxY = Math.min(height - 1, maxY + ringWidth);
  const samples: Rgb[] = [];
  for (let y = outerMinY; y <= outerMaxY; y += 1) {
    for (let x = outerMinX; x <= outerMaxX; x += 1) {
      if (x >= minX && x <= maxX && y >= minY && y <= maxY) continue;
      samples.push(readRgb(data, width, x, y));
    }
  }
  if (samples.length < 8) return null;
  const background = samples.reduce(
    (sum, sample) => ({ r: sum.r + sample.r, g: sum.g + sample.g, b: sum.b + sample.b }),
    { r: 0, g: 0, b: 0 },
  );
  const average = {
    r: background.r / samples.length,
    g: background.g / samples.length,
    b: background.b / samples.length,
  };
  const spread = Math.max(...samples.map((sample) => colorDistance(sample, average)));
  return { color: average, spread };
};

const preserveGarmentTexture = ({
  width,
  height,
  data,
  mask,
  minX,
  minY,
  maxX,
  maxY,
  padding,
}: {
  width: number;
  height: number;
  data: Uint8ClampedArray;
  mask: Uint8Array;
  minX: number;
  minY: number;
  maxX: number;
  maxY: number;
  padding: number;
}) => {
  const bounds = {
    minX: Math.max(0, minX - padding),
    minY: Math.max(0, minY - padding),
    maxX: Math.min(width - 1, maxX + padding),
    maxY: Math.min(height - 1, maxY + padding),
  };
  const background = estimateUniformBackground({ width, height, data, ...bounds });
  if (!background || background.spread > UNIFORM_BACKGROUND_MAX_SPREAD) return mask;

  const preserved = new Uint8Array(mask);
  for (let y = bounds.minY; y <= bounds.maxY; y += 1) {
    for (let x = bounds.minX; x <= bounds.maxX; x += 1) {
      if (colorDistance(readRgb(data, width, x, y), background.color) > BACKGROUND_DISTANCE_THRESHOLD) {
        preserved[(y * width) + x] = 1;
      }
    }
  }
  return preserved;
};

const buildAnalysisImage = ({ width, height, data }: PointGuidedSelectionInput) => {
  const scale = Math.min(1, MAX_ANALYSIS_EDGE / Math.max(width, height));
  const analysisWidth = Math.max(1, Math.round(width * scale));
  const analysisHeight = Math.max(1, Math.round(height * scale));
  const analysisData = new Uint8ClampedArray(analysisWidth * analysisHeight * 4);
  for (let y = 0; y < analysisHeight; y += 1) {
    const sourceY = Math.min(height - 1, Math.floor(y / scale));
    for (let x = 0; x < analysisWidth; x += 1) {
      const sourceX = Math.min(width - 1, Math.floor(x / scale));
      const sourceOffset = pixelOffset(sourceX, sourceY, width);
      const targetOffset = pixelOffset(x, y, analysisWidth);
      analysisData[targetOffset] = data[sourceOffset];
      analysisData[targetOffset + 1] = data[sourceOffset + 1];
      analysisData[targetOffset + 2] = data[sourceOffset + 2];
      analysisData[targetOffset + 3] = data[sourceOffset + 3];
    }
  }
  return { width: analysisWidth, height: analysisHeight, data: analysisData, scale };
};

const floodRegion = ({
  width,
  height,
  data,
  seedX,
  seedY,
  seedColor,
  threshold,
}: {
  width: number;
  height: number;
  data: Uint8ClampedArray;
  seedX: number;
  seedY: number;
  seedColor: Rgb;
  threshold: number;
}) => {
  const visited = new Uint8Array(width * height);
  const queue = new Int32Array(width * height);
  let queueStart = 0;
  let queueEnd = 0;
  const seedIndex = seedY * width + seedX;
  queue[queueEnd] = seedIndex;
  queueEnd += 1;
  visited[seedIndex] = 1;
  let selectedPixels = 0;
  let minX = seedX;
  let minY = seedY;
  let maxX = seedX;
  let maxY = seedY;
  let touchesFrame = false;

  while (queueStart < queueEnd) {
    const index = queue[queueStart];
    queueStart += 1;
    const x = index % width;
    const y = Math.floor(index / width);
    selectedPixels += 1;
    minX = Math.min(minX, x);
    minY = Math.min(minY, y);
    maxX = Math.max(maxX, x);
    maxY = Math.max(maxY, y);
    if (x === 0 || y === 0 || x === width - 1 || y === height - 1) touchesFrame = true;

    const currentColor = readRgb(data, width, x, y);
    const neighbors = [
      [x - 1, y],
      [x + 1, y],
      [x, y - 1],
      [x, y + 1],
    ];
    for (const [nextX, nextY] of neighbors) {
      if (nextX < 0 || nextY < 0 || nextX >= width || nextY >= height) continue;
      const nextIndex = nextY * width + nextX;
      if (visited[nextIndex]) continue;
      const nextColor = readRgb(data, width, nextX, nextY);
      const distanceFromSeed = colorDistance(nextColor, seedColor);
      const distanceFromCurrent = colorDistance(nextColor, currentColor);
      if (distanceFromSeed > threshold && distanceFromCurrent > threshold * 0.58) continue;
      visited[nextIndex] = 1;
      queue[queueEnd] = nextIndex;
      queueEnd += 1;
    }
  }

  return { minX, minY, maxX, maxY, selectedPixels, touchesFrame, mask: visited };
};

/**
 * Fill only holes enclosed by the accepted garment component. This is
 * deliberately topology-based rather than color-based: a printed mark can
 * have the same RGB value as the photo background, but it is still garment
 * content when the surrounding accepted pixels fully enclose it. Openings
 * such as a collar remain transparent because they reach the component
 * bounds.
 */
const fillEnclosedMaskHoles = ({
  width,
  height,
  mask,
  minX,
  minY,
  maxX,
  maxY,
}: {
  width: number;
  height: number;
  mask: Uint8Array;
  minX: number;
  minY: number;
  maxX: number;
  maxY: number;
}) => {
  const bounds = {
    minX: clamp(minX, 0, width - 1),
    minY: clamp(minY, 0, height - 1),
    maxX: clamp(maxX, 0, width - 1),
    maxY: clamp(maxY, 0, height - 1),
  };
  const outsideVisited = new Uint8Array(width * height);
  const queue = new Int32Array(width * height);
  let queueStart = 0;
  let queueEnd = 0;
  const enqueueOutside = (x: number, y: number) => {
    if (x < bounds.minX || x > bounds.maxX || y < bounds.minY || y > bounds.maxY) return;
    const index = (y * width) + x;
    if (mask[index] === 1 || outsideVisited[index] === 1) return;
    outsideVisited[index] = 1;
    queue[queueEnd] = index;
    queueEnd += 1;
  };

  for (let x = bounds.minX; x <= bounds.maxX; x += 1) {
    enqueueOutside(x, bounds.minY);
    enqueueOutside(x, bounds.maxY);
  }
  for (let y = bounds.minY + 1; y < bounds.maxY; y += 1) {
    enqueueOutside(bounds.minX, y);
    enqueueOutside(bounds.maxX, y);
  }

  while (queueStart < queueEnd) {
    const index = queue[queueStart];
    queueStart += 1;
    const x = index % width;
    const y = Math.floor(index / width);
    enqueueOutside(x - 1, y);
    enqueueOutside(x + 1, y);
    enqueueOutside(x, y - 1);
    enqueueOutside(x, y + 1);
  }

  const filled = new Uint8Array(mask);
  for (let y = bounds.minY; y <= bounds.maxY; y += 1) {
    for (let x = bounds.minX; x <= bounds.maxX; x += 1) {
      const index = (y * width) + x;
      if (filled[index] === 0 && outsideVisited[index] === 0) filled[index] = 1;
    }
  }
  return filled;
};

const fallbackSelection = ({ width, height, point }: Pick<PointGuidedSelectionInput, 'width' | 'height' | 'point'>): PointGuidedSelection => {
  // Keep the low-confidence fallback focused on the tapped garment area. A
  // large centered crop tends to reintroduce the model's head/hands and makes
  // the following segmentation look like a person cutout instead of clothing.
  const selectionWidth = Math.max(MIN_SELECTION_EDGE, width * 0.58);
  // A failed flood often means the photo has a textured background. Keep the
  // fallback narrow and torso-biased so the next AI pass does not receive a
  // head-and-hands person crop while still leaving context around the tap.
  const selectionHeight = Math.max(MIN_SELECTION_EDGE, height * 0.36);
  const centerY = clamp(point.y + selectionHeight * 0.34, selectionHeight / 2, height - selectionHeight / 2);
  return {
    x: clamp(point.x - selectionWidth / 2, 0, Math.max(0, width - selectionWidth)),
    y: clamp(centerY - selectionHeight / 2, 0, Math.max(0, height - selectionHeight)),
    width: selectionWidth,
    height: selectionHeight,
    confidence: 0.28,
    source: 'tap-neighborhood',
    selectedPixels: 0,
    touchesFrame: false,
  };
};

/**
 * Builds a bounded object proposal from a single tap. This is intentionally a
 * proposal, not a replacement for the AI cutout: the resulting rectangle is
 * passed to the existing high-precision/fallback mask pipeline. The flood
 * region keeps the interaction instant and still works when the optional
 * browser ML backend is unavailable.
 */
export const buildPointGuidedSelection = ({
  width,
  height,
  data,
  point,
}: PointGuidedSelectionInput): PointGuidedSelection => {
  if (width <= 0 || height <= 0 || data.length !== width * height * 4) {
    throw new Error('POINT_GUIDED_SELECTION_IMAGE_INVALID');
  }
  const analysis = buildAnalysisImage({ width, height, data, point });
  const seedX = clamp(Math.round(point.x * analysis.scale), 0, analysis.width - 1);
  const seedY = clamp(Math.round(point.y * analysis.scale), 0, analysis.height - 1);
  const seedColor = averageSeedColor(analysis.data, analysis.width, analysis.height, seedX, seedY);
  const analysisArea = analysis.width * analysis.height;
  const borderBackground = estimateBorderBackground(analysis);
  const transparentBorder = hasTransparentBorder(analysis);
  let accepted: ReturnType<typeof floodRegion> | null = null;
  if (borderBackground && (borderBackground.spread <= BORDER_BACKGROUND_MAX_SPREAD || transparentBorder)) {
    const foregroundCandidate = floodForegroundFromBorderBackground({
      width: analysis.width,
      height: analysis.height,
      data: analysis.data,
      seedX,
      seedY,
      background: borderBackground,
    });
    if (foregroundCandidate) {
      const ratio = foregroundCandidate.selectedPixels / analysisArea;
      if (ratio >= MIN_REGION_RATIO && ratio <= MAX_REGION_RATIO && !foregroundCandidate.touchesFrame) {
        accepted = foregroundCandidate;
      }
    }
  }
  const thresholds = [34, 48, 64, 82];
  if (!accepted) {
    for (const threshold of thresholds) {
      const candidate = floodRegion({
        width: analysis.width,
        height: analysis.height,
        data: analysis.data,
        seedX,
        seedY,
        seedColor,
        threshold,
      });
      const ratio = candidate.selectedPixels / analysisArea;
      if (ratio >= MIN_REGION_RATIO && ratio <= MAX_REGION_RATIO && !candidate.touchesFrame) {
        accepted = candidate;
        break;
      }
    }
  }
  if (!accepted) return fallbackSelection({ width, height, point });

  const padding = Math.max(2, Math.round(Math.min(analysis.width, analysis.height) * 0.035));
  const preservedMask = preserveGarmentTexture({
    width: analysis.width,
    height: analysis.height,
    data: analysis.data,
    mask: accepted.mask,
    minX: accepted.minX,
    minY: accepted.minY,
    maxX: accepted.maxX,
    maxY: accepted.maxY,
    padding,
  });
  const textureAwareMask = transparentBorder
    ? preservedMask
    : fillEnclosedMaskHoles({
      width: analysis.width,
      height: analysis.height,
      mask: preservedMask,
      minX: accepted.minX,
      minY: accepted.minY,
      maxX: accepted.maxX,
      maxY: accepted.maxY,
    });
  const x = Math.max(0, accepted.minX - padding) / analysis.scale;
  const y = Math.max(0, accepted.minY - padding) / analysis.scale;
  const right = Math.min(analysis.width - 1, accepted.maxX + padding + 1) / analysis.scale;
  const bottom = Math.min(analysis.height - 1, accepted.maxY + padding + 1) / analysis.scale;
  const selectionWidth = Math.max(MIN_SELECTION_EDGE, right - x);
  const selectionHeight = Math.max(MIN_SELECTION_EDGE, bottom - y);
  let selectedPixels = 0;
  for (const pixel of textureAwareMask) selectedPixels += pixel;
  const ratio = selectedPixels / analysisArea;
  const confidence = clamp(0.64 + Math.min(0.24, ratio * 1.8), 0.64, 0.92);
  return {
    x: clamp(x, 0, Math.max(0, width - selectionWidth)),
    y: clamp(y, 0, Math.max(0, height - selectionHeight)),
    width: Math.min(selectionWidth, width),
    height: Math.min(selectionHeight, height),
    confidence,
    source: 'color-region',
    selectedPixels,
    touchesFrame: accepted.touchesFrame,
    mask: {
      width: analysis.width,
      height: analysis.height,
      data: textureAwareMask,
    },
  };
};
