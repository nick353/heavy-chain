export type GarmentMaskRefinementInput = {
  mask: Uint8ClampedArray;
  source: Uint8ClampedArray;
  width: number;
  height: number;
  modelBounds: { left: number; top: number; right: number; bottom: number };
};

export type GarmentMaskRefinementResult = {
  alpha: Uint8ClampedArray;
  coarseMaskWasRectangular: boolean;
  refined: boolean;
};

type Bounds = { left: number; top: number; right: number; bottom: number };

const clamp = (value: number, min: number, max: number) => Math.min(max, Math.max(min, value));
const pixelIndex = (x: number, y: number, width: number) => (y * width) + x;

const median = (values: number[]) => {
  if (values.length === 0) return 0;
  const sorted = [...values].sort((a, b) => a - b);
  return sorted[Math.floor(sorted.length / 2)] ?? 0;
};

const colorDistance = (source: Uint8ClampedArray, offset: number, target: { r: number; g: number; b: number }) => (
  Math.hypot(
    source[offset] - target.r,
    source[offset + 1] - target.g,
    source[offset + 2] - target.b,
  )
);

const findBounds = (alpha: Uint8ClampedArray, width: number, height: number, threshold = 24): Bounds | null => {
  let left = width;
  let top = height;
  let right = -1;
  let bottom = -1;
  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) {
      if (alpha[pixelIndex(x, y, width)] < threshold) continue;
      left = Math.min(left, x);
      top = Math.min(top, y);
      right = Math.max(right, x);
      bottom = Math.max(bottom, y);
    }
  }
  return right < left || bottom < top ? null : { left, top, right, bottom };
};

const isRectangularMask = (alpha: Uint8ClampedArray, width: number, height: number): { rectangular: boolean; bounds: Bounds | null } => {
  const bounds = findBounds(alpha, width, height);
  if (!bounds) return { rectangular: false, bounds: null };
  const boxWidth = bounds.right - bounds.left + 1;
  const boxHeight = bounds.bottom - bounds.top + 1;
  const boxArea = boxWidth * boxHeight;
  let visible = 0;
  let activeRows = 0;
  let solidRows = 0;
  let activeColumns = 0;
  let solidColumns = 0;
  for (let y = bounds.top; y <= bounds.bottom; y += 1) {
    let rowVisible = 0;
    for (let x = bounds.left; x <= bounds.right; x += 1) {
      if (alpha[pixelIndex(x, y, width)] < 24) continue;
      visible += 1;
      rowVisible += 1;
    }
    if (rowVisible > 0) activeRows += 1;
    if (rowVisible / boxWidth >= 0.92) solidRows += 1;
  }
  for (let x = bounds.left; x <= bounds.right; x += 1) {
    let columnVisible = 0;
    for (let y = bounds.top; y <= bounds.bottom; y += 1) {
      if (alpha[pixelIndex(x, y, width)] >= 24) columnVisible += 1;
    }
    if (columnVisible > 0) activeColumns += 1;
    if (columnVisible / boxHeight >= 0.92) solidColumns += 1;
  }
  const coverage = visible / boxArea;
  const rectangular = coverage >= 0.68
    && activeRows > 0
    && activeColumns > 0
    && solidRows / activeRows >= 0.72
    && solidColumns / activeColumns >= 0.72;
  return { rectangular, bounds };
};

const fillEnclosedHoles = (candidate: Uint8Array, width: number, height: number) => {
  const outside = new Uint8Array(candidate.length);
  const queue = new Int32Array(candidate.length);
  let queueHead = 0;
  let queueTail = 0;
  const enqueue = (index: number) => {
    if (candidate[index] || outside[index]) return;
    outside[index] = 1;
    queue[queueTail++] = index;
  };
  for (let x = 0; x < width; x += 1) {
    enqueue(x);
    enqueue(((height - 1) * width) + x);
  }
  for (let y = 0; y < height; y += 1) {
    enqueue(y * width);
    enqueue((y * width) + width - 1);
  }
  while (queueHead < queueTail) {
    const current = queue[queueHead++];
    const x = current % width;
    const y = Math.floor(current / width);
    const neighbours = [
      x > 0 ? current - 1 : -1,
      x < width - 1 ? current + 1 : -1,
      y > 0 ? current - width : -1,
      y < height - 1 ? current + width : -1,
    ];
    for (const next of neighbours) {
      if (next >= 0) enqueue(next);
    }
  }
  const filled = new Uint8Array(candidate);
  for (let index = 0; index < filled.length; index += 1) {
    if (!filled[index] && !outside[index]) filled[index] = 1;
  }
  return filled;
};

const refineRectangularMask = (
  coarseAlpha: Uint8ClampedArray,
  source: Uint8ClampedArray,
  width: number,
  height: number,
  bounds: Bounds,
  modelBounds: Bounds,
) => {
  const boxWidth = bounds.right - bounds.left + 1;
  const boxHeight = bounds.bottom - bounds.top + 1;
  const searchBounds: Bounds = {
    left: clamp(bounds.left - Math.floor(boxWidth * 0.45), Math.floor(modelBounds.left), Math.ceil(modelBounds.right)),
    top: clamp(bounds.top - Math.floor(boxHeight * 0.85), Math.floor(modelBounds.top), Math.ceil(modelBounds.bottom)),
    right: clamp(bounds.right + Math.floor(boxWidth * 0.45), Math.floor(modelBounds.left), Math.ceil(modelBounds.right)),
    bottom: clamp(bounds.bottom + Math.floor(boxHeight * 0.18), Math.floor(modelBounds.top), Math.ceil(modelBounds.bottom)),
  };
  const sampleLeft = bounds.left + Math.floor(boxWidth * 0.28);
  const sampleRight = bounds.left + Math.ceil(boxWidth * 0.72);
  const sampleTop = bounds.top + Math.floor(boxHeight * 0.32);
  const sampleBottom = bounds.top + Math.ceil(boxHeight * 0.84);
  const red: number[] = [];
  const green: number[] = [];
  const blue: number[] = [];
  for (let y = sampleTop; y <= sampleBottom; y += 1) {
    for (let x = sampleLeft; x <= sampleRight; x += 1) {
      const index = pixelIndex(x, y, width);
      if (coarseAlpha[index] < 24) continue;
      const offset = index * 4;
      red.push(source[offset]);
      green.push(source[offset + 1]);
      blue.push(source[offset + 2]);
    }
  }
  if (red.length < 32) return null;
  const target = { r: median(red), g: median(green), b: median(blue) };
  const neutralGarment = target.r - target.g < 28 && target.g - target.b < 42;
  const distances: number[] = [];
  for (let y = sampleTop; y <= sampleBottom; y += 1) {
    for (let x = sampleLeft; x <= sampleRight; x += 1) {
      const index = pixelIndex(x, y, width);
      if (coarseAlpha[index] < 24) continue;
      distances.push(colorDistance(source, index * 4, target));
    }
  }
  const threshold = clamp(median(distances) * 2.25 + 18, 32, 92);
  const candidate = new Uint8Array(width * height);
  let candidatePixels = 0;
  for (let y = searchBounds.top; y <= searchBounds.bottom; y += 1) {
    for (let x = searchBounds.left; x <= searchBounds.right; x += 1) {
      const index = pixelIndex(x, y, width);
      const sourceOffset = index * 4;
      const skinLike = neutralGarment
        && y <= bounds.top + Math.floor(boxHeight * 0.24)
        && x >= bounds.left + Math.floor(boxWidth * 0.28)
        && x <= bounds.left + Math.ceil(boxWidth * 0.72)
        && source[sourceOffset] - source[sourceOffset + 1] > 24
        && source[sourceOffset + 1] - source[sourceOffset + 2] > 5;
      if (skinLike || colorDistance(source, sourceOffset, target) > threshold) continue;
      candidate[index] = 1;
      candidatePixels += 1;
    }
  }
  if (candidatePixels < Math.max(32, Math.floor(boxWidth * boxHeight * 0.06))) return null;

  const visited = new Uint8Array(candidate.length);
  const componentId = new Int32Array(candidate.length);
  componentId.fill(-1);
  const componentSizes: number[] = [];
  const componentCenters: Array<{ x: number; y: number }> = [];
  const queue = new Int32Array(candidate.length);
  for (let start = 0; start < candidate.length; start += 1) {
    if (!candidate[start] || visited[start]) continue;
    const currentId = componentSizes.length;
    let head = 0;
    let tail = 0;
    let sumX = 0;
    let sumY = 0;
    queue[tail++] = start;
    visited[start] = 1;
    while (head < tail) {
      const current = queue[head++];
      componentId[current] = currentId;
      const x = current % width;
      const y = Math.floor(current / width);
      sumX += x;
      sumY += y;
      for (const [nextX, nextY] of [
        [x - 1, y - 1], [x, y - 1], [x + 1, y - 1],
        [x - 1, y],                 [x + 1, y],
        [x - 1, y + 1], [x, y + 1], [x + 1, y + 1],
      ] as const) {
        if (nextX < searchBounds.left || nextY < searchBounds.top || nextX > searchBounds.right || nextY > searchBounds.bottom) continue;
        const next = pixelIndex(nextX, nextY, width);
        if (!candidate[next] || visited[next]) continue;
        visited[next] = 1;
        queue[tail++] = next;
      }
    }
    componentSizes.push(tail);
    componentCenters.push({ x: sumX / tail, y: sumY / tail });
  }
  if (componentSizes.length === 0) return null;
  const centerX = (bounds.left + bounds.right) / 2;
  const centerY = bounds.top + boxHeight * 0.5;
  const largest = Math.max(...componentSizes);
  const chosen = new Uint8Array(candidate.length);
  let chosenPixels = 0;
  for (let index = 0; index < candidate.length; index += 1) {
    const currentId = componentId[index];
    if (currentId < 0) continue;
    const componentSize = componentSizes[currentId];
    const componentCenter = componentCenters[currentId];
    const centrality = 1 / (1 + Math.hypot(componentCenter.x - centerX, componentCenter.y - centerY) / Math.max(boxWidth, boxHeight));
    const keep = componentId[index] === componentSizes.indexOf(largest)
      || (componentSize >= Math.max(24, Math.floor(largest * 0.08)) && centrality >= 0.42);
    if (!keep) continue;
    chosen[index] = 1;
    chosenPixels += 1;
  }
  if (chosenPixels < Math.max(32, Math.floor(boxWidth * boxHeight * 0.06))) return null;
  const filled = fillEnclosedHoles(chosen, width, height);
  const refined = new Uint8ClampedArray(width * height);
  let refinedPixels = 0;
  for (let index = 0; index < filled.length; index += 1) {
    if (!filled[index]) continue;
    refined[index] = 255;
    refinedPixels += 1;
  }
  const searchArea = (searchBounds.right - searchBounds.left + 1) * (searchBounds.bottom - searchBounds.top + 1);
  const refinedCoverage = refinedPixels / searchArea;
  if (refinedCoverage < 0.08 || refinedCoverage > 0.88) return null;
  return refined;
};

export const refineCoarseGarmentMask = ({
  mask,
  source,
  width,
  height,
  modelBounds,
}: GarmentMaskRefinementInput): GarmentMaskRefinementResult => {
  if (width <= 0 || height <= 0 || mask.length !== width * height * 4 || source.length !== width * height * 4) {
    throw new Error('garment_mask_refinement_input_invalid');
  }
  const coarseAlpha = new Uint8ClampedArray(width * height);
  for (let index = 0; index < coarseAlpha.length; index += 1) {
    coarseAlpha[index] = mask[(index * 4) + 3];
  }
  const shape = isRectangularMask(coarseAlpha, width, height);
  if (!shape.rectangular || !shape.bounds) {
    return { alpha: coarseAlpha, coarseMaskWasRectangular: false, refined: false };
  }
  const clampedBounds: Bounds = {
    left: clamp(shape.bounds.left, Math.floor(modelBounds.left), Math.ceil(modelBounds.right)),
    top: clamp(shape.bounds.top, Math.floor(modelBounds.top), Math.ceil(modelBounds.bottom)),
    right: clamp(shape.bounds.right, Math.floor(modelBounds.left), Math.ceil(modelBounds.right)),
    bottom: clamp(shape.bounds.bottom, Math.floor(modelBounds.top), Math.ceil(modelBounds.bottom)),
  };
  const refined = refineRectangularMask(coarseAlpha, source, width, height, clampedBounds, {
    left: Math.floor(modelBounds.left),
    top: Math.floor(modelBounds.top),
    right: Math.ceil(modelBounds.right),
    bottom: Math.ceil(modelBounds.bottom),
  });
  if (!refined) return { alpha: coarseAlpha, coarseMaskWasRectangular: true, refined: false };
  return { alpha: refined, coarseMaskWasRectangular: true, refined: true };
};
