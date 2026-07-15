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
};

const MAX_ANALYSIS_EDGE = 280;
const MIN_REGION_RATIO = 0.0025;
const MAX_REGION_RATIO = 0.9;
const MIN_SELECTION_EDGE = 16;

type Rgb = { r: number; g: number; b: number };

const clamp = (value: number, min: number, max: number) => Math.max(min, Math.min(max, value));

const pixelOffset = (x: number, y: number, width: number) => (y * width + x) * 4;

const readRgb = (data: Uint8ClampedArray, width: number, x: number, y: number): Rgb => {
  const offset = pixelOffset(x, y, width);
  return { r: data[offset], g: data[offset + 1], b: data[offset + 2] };
};

const colorDistance = (left: Rgb, right: Rgb) => Math.hypot(
  left.r - right.r,
  left.g - right.g,
  left.b - right.b,
);

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

  return { minX, minY, maxX, maxY, selectedPixels, touchesFrame };
};

const fallbackSelection = ({ width, height, point }: Pick<PointGuidedSelectionInput, 'width' | 'height' | 'point'>): PointGuidedSelection => {
  const selectionWidth = Math.max(MIN_SELECTION_EDGE, width * 0.66);
  const selectionHeight = Math.max(MIN_SELECTION_EDGE, height * 0.66);
  return {
    x: clamp(point.x - selectionWidth / 2, 0, Math.max(0, width - selectionWidth)),
    y: clamp(point.y - selectionHeight / 2, 0, Math.max(0, height - selectionHeight)),
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
  const thresholds = [34, 48, 64, 82];
  let accepted: ReturnType<typeof floodRegion> | null = null;
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
  if (!accepted) return fallbackSelection({ width, height, point });

  const padding = Math.max(2, Math.round(Math.min(analysis.width, analysis.height) * 0.035));
  const x = Math.max(0, accepted.minX - padding) / analysis.scale;
  const y = Math.max(0, accepted.minY - padding) / analysis.scale;
  const right = Math.min(analysis.width - 1, accepted.maxX + padding + 1) / analysis.scale;
  const bottom = Math.min(analysis.height - 1, accepted.maxY + padding + 1) / analysis.scale;
  const selectionWidth = Math.max(MIN_SELECTION_EDGE, right - x);
  const selectionHeight = Math.max(MIN_SELECTION_EDGE, bottom - y);
  const ratio = accepted.selectedPixels / analysisArea;
  const confidence = clamp(0.64 + Math.min(0.24, ratio * 1.8), 0.64, 0.92);
  return {
    x: clamp(x, 0, Math.max(0, width - selectionWidth)),
    y: clamp(y, 0, Math.max(0, height - selectionHeight)),
    width: Math.min(selectionWidth, width),
    height: Math.min(selectionHeight, height),
    confidence,
    source: 'color-region',
    selectedPixels: accepted.selectedPixels,
    touchesFrame: accepted.touchesFrame,
  };
};
