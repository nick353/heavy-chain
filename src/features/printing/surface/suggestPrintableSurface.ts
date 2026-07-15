const SUGGESTION_MAX_PIXELS = 16_000_000;
const FOREGROUND_ALPHA = 64;
const MAX_COMPONENT_SPANS = 1_000_000;

export type PrintableSurfaceSuggestionFallbackReason =
  | 'EMPTY_GARMENT'
  | 'FRAME_CROPPED'
  | 'MULTIPLE_COMPONENTS'
  | 'CENTERLINE_GAP'
  | 'PROFILE_UNSTABLE'
  | 'PRINTABLE_AREA_TOO_SMALL';

export type PrintableSurfaceSuggestionErrorCode =
  | 'SUGGESTION_DIMENSIONS_INVALID'
  | 'SUGGESTION_PIXEL_LIMIT_EXCEEDED'
  | 'SUGGESTION_ALPHA_LENGTH_INVALID';

export class PrintableSurfaceSuggestionValidationError extends Error {
  readonly code: PrintableSurfaceSuggestionErrorCode;

  constructor(code: PrintableSurfaceSuggestionErrorCode) {
    super(code);
    this.name = 'PrintableSurfaceSuggestionValidationError';
    this.code = code;
  }
}

export type PrintableSurfaceSuggestionDiagnostics = {
  garmentBounds: { x: number; y: number; width: number; height: number } | null;
  foregroundPixels: number;
  mainComponentRatio: number;
  centerlineCoverage: number;
  profileVariation: number;
  printablePixels: number;
  printableToGarmentRatio: number;
  confidence: number;
};

export type PrintableSurfaceSuggestion =
  | {
      kind: 'success';
      provenance: 'deterministic-central-panel-suggestion';
      width: number;
      height: number;
      alpha: Uint8ClampedArray;
      diagnostics: PrintableSurfaceSuggestionDiagnostics;
    }
  | {
      kind: 'fallback-required';
      reason: PrintableSurfaceSuggestionFallbackReason;
      width: number;
      height: number;
      diagnostics: PrintableSurfaceSuggestionDiagnostics;
    };

const emptyDiagnostics = (): PrintableSurfaceSuggestionDiagnostics => ({
  garmentBounds: null,
  foregroundPixels: 0,
  mainComponentRatio: 0,
  centerlineCoverage: 0,
  profileVariation: 1,
  printablePixels: 0,
  printableToGarmentRatio: 0,
  confidence: 0,
});

const clamp01 = (value: number) => Math.min(1, Math.max(0, value));

const median = (values: number[]) => {
  if (values.length === 0) return 0;
  const sorted = [...values].sort((left, right) => left - right);
  const middle = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 0 ? (sorted[middle - 1] + sorted[middle]) / 2 : sorted[middle];
};

const quantile = (values: number[], fraction: number) => {
  if (values.length === 0) return 0;
  const sorted = [...values].sort((left, right) => left - right);
  return sorted[Math.min(sorted.length - 1, Math.max(0, Math.round((sorted.length - 1) * fraction)))];
};

const exactAlphaComponents = ({
  alpha,
  width,
  height,
}: {
  alpha: Uint8Array | Uint8ClampedArray;
  width: number;
  height: number;
}) => {
  const pixelCount = width * height;
  const visited = new Uint8Array(Math.ceil(pixelCount / 8));
  const isVisited = (index: number) => (visited[index >> 3] & (1 << (index & 7))) !== 0;
  const markVisited = (index: number) => {
    visited[index >> 3] |= 1 << (index & 7);
  };
  const componentSizes: number[] = [];
  for (let start = 0; start < pixelCount; start += 1) {
    if (alpha[start] < FOREGROUND_ALPHA || isVisited(start)) continue;
    const stack = [start];
    let size = 0;
    while (stack.length > 0) {
      const seed = stack.pop()!;
      if (isVisited(seed) || alpha[seed] < FOREGROUND_ALPHA) continue;
      const y = Math.floor(seed / width);
      const seedX = seed - (y * width);
      let left = seedX;
      let right = seedX;
      while (left > 0) {
        const index = (y * width) + left - 1;
        if (isVisited(index) || alpha[index] < FOREGROUND_ALPHA) break;
        left -= 1;
      }
      while (right + 1 < width) {
        const index = (y * width) + right + 1;
        if (isVisited(index) || alpha[index] < FOREGROUND_ALPHA) break;
        right += 1;
      }
      for (let x = left; x <= right; x += 1) {
        markVisited((y * width) + x);
        size += 1;
      }
      for (const neighbourY of [y - 1, y + 1]) {
        if (neighbourY < 0 || neighbourY >= height) continue;
        let insideSegment = false;
        for (let x = left; x <= right; x += 1) {
          const index = (neighbourY * width) + x;
          const eligible = !isVisited(index) && alpha[index] >= FOREGROUND_ALPHA;
          if (eligible && !insideSegment) {
            if (stack.length >= MAX_COMPONENT_SPANS) {
              return { mainComponentRatio: 0, secondaryComponentRatio: 1 };
            }
            stack.push(index);
          }
          insideSegment = eligible;
        }
      }
    }
    componentSizes.push(size);
  }
  componentSizes.sort((left, right) => right - left);
  const occupiedCount = componentSizes.reduce((sum, value) => sum + value, 0);
  return {
    mainComponentRatio: occupiedCount > 0 ? (componentSizes[0] ?? 0) / occupiedCount : 0,
    secondaryComponentRatio: occupiedCount > 0 ? (componentSizes[1] ?? 0) / occupiedCount : 0,
  };
};

const fallback = (
  reason: PrintableSurfaceSuggestionFallbackReason,
  width: number,
  height: number,
  diagnostics: PrintableSurfaceSuggestionDiagnostics,
): PrintableSurfaceSuggestion => ({ kind: 'fallback-required', reason, width, height, diagnostics });

/**
 * Produces a conservative central-panel suggestion from an existing garment
 * alpha. It does not recognize garment parts and never reports semantic-ready.
 */
export const suggestPrintableSurface = ({
  width,
  height,
  garmentAlpha,
}: {
  width: number;
  height: number;
  garmentAlpha: Uint8Array | Uint8ClampedArray;
}): PrintableSurfaceSuggestion => {
  if (!Number.isSafeInteger(width) || !Number.isSafeInteger(height) || width <= 0 || height <= 0) {
    throw new PrintableSurfaceSuggestionValidationError('SUGGESTION_DIMENSIONS_INVALID');
  }
  if (width > SUGGESTION_MAX_PIXELS / height) {
    throw new PrintableSurfaceSuggestionValidationError('SUGGESTION_PIXEL_LIMIT_EXCEEDED');
  }
  if (garmentAlpha.length !== width * height) {
    throw new PrintableSurfaceSuggestionValidationError('SUGGESTION_ALPHA_LENGTH_INVALID');
  }

  let minX = width;
  let minY = height;
  let maxX = -1;
  let maxY = -1;
  let foregroundPixels = 0;
  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) {
      if (garmentAlpha[(y * width) + x] < FOREGROUND_ALPHA) continue;
      foregroundPixels += 1;
      minX = Math.min(minX, x);
      minY = Math.min(minY, y);
      maxX = Math.max(maxX, x);
      maxY = Math.max(maxY, y);
    }
  }
  if (foregroundPixels === 0) return fallback('EMPTY_GARMENT', width, height, emptyDiagnostics());

  const bounds = { x: minX, y: minY, width: maxX - minX + 1, height: maxY - minY + 1 };
  const diagnostics = emptyDiagnostics();
  diagnostics.garmentBounds = bounds;
  diagnostics.foregroundPixels = foregroundPixels;
  const frameMargin = Math.max(1, Math.round(Math.min(width, height) * 0.005));
  if (minX <= frameMargin || minY <= frameMargin || maxX >= width - 1 - frameMargin || maxY >= height - 1 - frameMargin) {
    return fallback('FRAME_CROPPED', width, height, diagnostics);
  }

  const components = exactAlphaComponents({ alpha: garmentAlpha, width, height });
  diagnostics.mainComponentRatio = components.mainComponentRatio;
  if (components.mainComponentRatio < 0.9 || components.secondaryComponentRatio > 0.08) {
    return fallback('MULTIPLE_COMPONENTS', width, height, diagnostics);
  }

  const centerX = Math.round((minX + maxX) / 2);
  const candidateStartY = minY + Math.round(bounds.height * 0.27);
  const candidateEndY = minY + Math.round(bounds.height * 0.82);
  const rowRuns: Array<{ y: number; left: number; right: number; width: number }> = [];
  const expectedRows = Math.max(1, candidateEndY - candidateStartY + 1);
  for (let y = candidateStartY; y <= candidateEndY; y += 1) {
    let probeX = centerX;
    if (garmentAlpha[(y * width) + probeX] < FOREGROUND_ALPHA) {
      const searchRadius = Math.round(bounds.width * 0.08);
      let found = -1;
      for (let offset = 1; offset <= searchRadius; offset += 1) {
        if (probeX - offset >= minX && garmentAlpha[(y * width) + probeX - offset] >= FOREGROUND_ALPHA) {
          found = probeX - offset;
          break;
        }
        if (probeX + offset <= maxX && garmentAlpha[(y * width) + probeX + offset] >= FOREGROUND_ALPHA) {
          found = probeX + offset;
          break;
        }
      }
      if (found < 0) continue;
      probeX = found;
    }
    let left = probeX;
    let right = probeX;
    while (left > minX && garmentAlpha[(y * width) + left - 1] >= FOREGROUND_ALPHA) left -= 1;
    while (right < maxX && garmentAlpha[(y * width) + right + 1] >= FOREGROUND_ALPHA) right += 1;
    rowRuns.push({ y, left, right, width: right - left + 1 });
  }
  diagnostics.centerlineCoverage = rowRuns.length / expectedRows;
  if (diagnostics.centerlineCoverage < 0.88) return fallback('CENTERLINE_GAP', width, height, diagnostics);

  const baselineWidths = rowRuns
    .filter((row) => row.y >= minY + (bounds.height * 0.42) && row.y <= minY + (bounds.height * 0.76))
    .map((row) => row.width);
  const baselineWidth = median(baselineWidths);
  diagnostics.profileVariation = baselineWidth > 0
    ? (quantile(baselineWidths, 0.9) - quantile(baselineWidths, 0.1)) / baselineWidth
    : 1;
  if (baselineWidth < bounds.width * 0.28 || diagnostics.profileVariation > 0.22) {
    return fallback('PROFILE_UNSTABLE', width, height, diagnostics);
  }

  const output = new Uint8ClampedArray(width * height);
  const verticalFeather = Math.max(2, Math.round((candidateEndY - candidateStartY + 1) * 0.05));
  for (const row of rowRuns) {
    const runCenter = (row.left + row.right) / 2;
    const targetWidth = Math.max(1, Math.min(row.width * 0.58, baselineWidth * 0.62));
    const left = Math.max(row.left, Math.round(runCenter - (targetWidth / 2)));
    const right = Math.min(row.right, Math.round(runCenter + (targetWidth / 2)));
    const horizontalFeather = Math.max(2, Math.round((right - left + 1) * 0.06));
    const verticalWeight = Math.min(
      1,
      (row.y - candidateStartY + 1) / verticalFeather,
      (candidateEndY - row.y + 1) / verticalFeather,
    );
    for (let x = left; x <= right; x += 1) {
      const horizontalWeight = Math.min(1, (x - left + 1) / horizontalFeather, (right - x + 1) / horizontalFeather);
      const index = (row.y * width) + x;
      const weight = clamp01(Math.min(horizontalWeight, verticalWeight));
      output[index] = Math.round(garmentAlpha[index] * weight);
      if (output[index] > 0) diagnostics.printablePixels += 1;
    }
  }
  diagnostics.printableToGarmentRatio = diagnostics.printablePixels / foregroundPixels;
  diagnostics.confidence = clamp01(
    (diagnostics.mainComponentRatio * 0.3)
    + (diagnostics.centerlineCoverage * 0.3)
    + ((1 - Math.min(1, diagnostics.profileVariation / 0.22)) * 0.2)
    + (clamp01(diagnostics.printableToGarmentRatio / 0.18) * 0.2),
  );
  if (diagnostics.printablePixels < 256 || diagnostics.printableToGarmentRatio < 0.07) {
    return fallback('PRINTABLE_AREA_TOO_SMALL', width, height, diagnostics);
  }

  return {
    kind: 'success',
    provenance: 'deterministic-central-panel-suggestion',
    width,
    height,
    alpha: output,
    diagnostics,
  };
};
