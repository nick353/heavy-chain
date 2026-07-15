import { refineAlphaEdge } from '../features/printing/matte/refineAlphaEdge.ts';

export type PrintGarmentMaskCandidateId = 'auto' | 'refined' | 'detail' | 'strict' | 'manual';
export type AutomaticPrintGarmentMaskCandidateId = Exclude<PrintGarmentMaskCandidateId, 'manual'>;

export type RgbColor = { r: number; g: number; b: number };

export const PRINT_CUTOUT_MAX_DATA_URL_BYTES = 750_000;

export const estimatePrintMaskDataUrlBytes = (dataUrl: string) => {
  const base64 = dataUrl.split(',', 2)[1] ?? '';
  return Math.max(0, Math.floor((base64.length * 3) / 4));
};

export const isOversizedManualPrintMask = (dataUrl: string) => (
  estimatePrintMaskDataUrlBytes(dataUrl) > PRINT_CUTOUT_MAX_DATA_URL_BYTES
);

export const nextPrintMaskDownscaleSize = ({ width, height }: { width: number; height: number }) => {
  if (!Number.isSafeInteger(width) || !Number.isSafeInteger(height) || width <= 0 || height <= 0) {
    throw new Error('invalid_print_mask_downscale_size');
  }
  return {
    width: Math.max(1, Math.floor(width * 0.85)),
    height: Math.max(1, Math.floor(height * 0.85)),
  };
};

export const withManualPrintMaskResult = <T extends {
  dataUrl: string;
  dataUrlBytes: number;
  outputSize: { width: number; height: number };
  refinement?: unknown;
}>(
  result: T,
  dataUrl: string,
  outputSize: { width: number; height: number },
): T => {
  const { refinement: _removedRefinement, ...resultWithoutRefinement } = result;
  return {
    ...resultWithoutRefinement,
    dataUrl,
    dataUrlBytes: estimatePrintMaskDataUrlBytes(dataUrl),
    outputSize,
  } as T;
};

export const PRINT_GARMENT_MASK_CANDIDATE_ORDER: readonly PrintGarmentMaskCandidateId[] = [
  'auto',
  'refined',
  'detail',
  'strict',
  'manual',
] as const;

export const mergePrintMaskCandidatesById = <T extends { candidateId: string }>(
  currentCandidates: readonly T[],
  derivedCandidates: readonly T[],
) => {
  const mergedCandidates = [...currentCandidates];
  const seenCandidateIds = new Set(currentCandidates.map((candidate) => candidate.candidateId));
  for (const candidate of derivedCandidates) {
    if (seenCandidateIds.has(candidate.candidateId)) continue;
    seenCandidateIds.add(candidate.candidateId);
    mergedCandidates.push(candidate);
  }
  const order = new Map(PRINT_GARMENT_MASK_CANDIDATE_ORDER.map((id, index) => [id, index]));
  return mergedCandidates
    .map((candidate, index) => ({ candidate, index }))
    .sort((left, right) => (
      (order.get(left.candidate.candidateId as PrintGarmentMaskCandidateId) ?? Number.MAX_SAFE_INTEGER)
      - (order.get(right.candidate.candidateId as PrintGarmentMaskCandidateId) ?? Number.MAX_SAFE_INTEGER)
      || left.index - right.index
    ))
    .map(({ candidate }) => candidate);
};

export const resolvePrintMaskCandidateId = <T extends { candidateId: string }>(
  candidates: readonly T[],
  selectedCandidateId: string,
) => candidates.some((candidate) => candidate.candidateId === selectedCandidateId)
  ? selectedCandidateId
  : candidates[0]?.candidateId ?? selectedCandidateId;

export type PrintGarmentMaskCandidateDefinition = {
  id: AutomaticPrintGarmentMaskCandidateId;
  label: string;
  description: string;
};

export const PRINT_GARMENT_MASK_CANDIDATES: readonly PrintGarmentMaskCandidateDefinition[] = [
  {
    id: 'auto',
    label: '自動（推奨）',
    description: 'AIの切り抜きをそのまま使います',
  },
  {
    id: 'refined',
    label: '高精度エッジ（試験）',
    description: '元の大きさで半透明の輪郭だけを再計算します',
  },
  {
    id: 'detail',
    label: '細部を残す',
    description: 'ドレスの裾など半透明の細い輪郭を強めます',
  },
  {
    id: 'strict',
    label: '背景を除去',
    description: '輪郭の背景にじみを1px内側へ抑えます',
  },
] as const;

const clampByte = (value: number) => Math.round(Math.min(255, Math.max(0, value)));
const colorDistance = (rgba: Uint8ClampedArray, index: number, background: RgbColor) => Math.hypot(
  rgba[index] - background.r,
  rgba[index + 1] - background.g,
  rgba[index + 2] - background.b,
);

const median = (values: number[]) => {
  if (!values.length) return 255;
  const sorted = [...values].sort((a, b) => a - b);
  return sorted[Math.floor(sorted.length / 2)];
};

const estimateBorderBackground = (rgba: Uint8ClampedArray, width: number, height: number) => {
  const sampleIndices = new Set<number>();
  for (let x = 0; x < width; x += 1) {
    sampleIndices.add(x);
    sampleIndices.add(((height - 1) * width) + x);
  }
  for (let y = 1; y < height - 1; y += 1) {
    sampleIndices.add(y * width);
    sampleIndices.add((y * width) + width - 1);
  }
  const samples = [...sampleIndices].map((pixelIndex) => pixelIndex * 4);
  const background = {
    r: median(samples.map((index) => rgba[index])),
    g: median(samples.map((index) => rgba[index + 1])),
    b: median(samples.map((index) => rgba[index + 2])),
  };
  const spread = samples.length
    ? Math.max(...samples.map((index) => colorDistance(rgba, index, background)))
    : 255;
  return { background, spread };
};

export const decontaminateBoundaryRgb = ({
  rgba,
  background,
}: {
  rgba: Uint8ClampedArray;
  background: RgbColor;
}) => {
  const output = new Uint8ClampedArray(rgba);
  for (let index = 0; index < output.length; index += 4) {
    const alphaByte = output[index + 3];
    if (alphaByte <= 0 || alphaByte >= 255) continue;
    const alpha = alphaByte / 255;
    output[index] = clampByte((output[index] - (background.r * (1 - alpha))) / alpha);
    output[index + 1] = clampByte((output[index + 1] - (background.g * (1 - alpha))) / alpha);
    output[index + 2] = clampByte((output[index + 2] - (background.b * (1 - alpha))) / alpha);
  }
  return output;
};

/**
 * Builds a soft alpha matte only from pixels connected to the image border.
 * Enclosed white foreground therefore survives, while white/solid canvas
 * background and its anti-aliased spill are removed.
 */
export const buildEdgeConnectedSoftAlphaMatte = ({
  rgba,
  width,
  height,
  background: suppliedBackground,
  lowThreshold = 8,
  highThreshold = 52,
}: {
  rgba: Uint8ClampedArray;
  width: number;
  height: number;
  background?: RgbColor;
  lowThreshold?: number;
  highThreshold?: number;
}) => {
  if (width <= 0 || height <= 0 || rgba.length !== width * height * 4 || highThreshold <= lowThreshold) {
    throw new Error('invalid_edge_connected_matte_input');
  }
  const estimate = estimateBorderBackground(rgba, width, height);
  const background = suppliedBackground ?? estimate.background;
  const connected = new Uint8Array(width * height);
  const queue = new Int32Array(width * height);
  let queueLength = 0;
  const enqueue = (x: number, y: number) => {
    if (x < 0 || x >= width || y < 0 || y >= height) return;
    const pixelIndex = (y * width) + x;
    if (connected[pixelIndex]) return;
    const rgbaIndex = pixelIndex * 4;
    if (rgba[rgbaIndex + 3] > 4 && colorDistance(rgba, rgbaIndex, background) > highThreshold) return;
    connected[pixelIndex] = 1;
    queue[queueLength] = pixelIndex;
    queueLength += 1;
  };
  for (let x = 0; x < width; x += 1) {
    enqueue(x, 0);
    enqueue(x, height - 1);
  }
  for (let y = 1; y < height - 1; y += 1) {
    enqueue(0, y);
    enqueue(width - 1, y);
  }
  for (let cursor = 0; cursor < queueLength; cursor += 1) {
    const pixelIndex = queue[cursor];
    const x = pixelIndex % width;
    const y = Math.floor(pixelIndex / width);
    enqueue(x + 1, y);
    enqueue(x - 1, y);
    enqueue(x, y + 1);
    enqueue(x, y - 1);
  }

  const output = new Uint8ClampedArray(rgba);
  let removedPixels = 0;
  let visiblePixels = 0;
  for (let pixelIndex = 0; pixelIndex < connected.length; pixelIndex += 1) {
    const index = pixelIndex * 4;
    if (rgba[index + 3] > 4) visiblePixels += 1;
    if (!connected[pixelIndex]) continue;
    const distance = colorDistance(rgba, index, background);
    const coverage = Math.min(1, Math.max(0, (distance - lowThreshold) / (highThreshold - lowThreshold)));
    const alpha = clampByte(rgba[index + 3] * coverage);
    if (alpha < rgba[index + 3]) removedPixels += 1;
    output[index + 3] = alpha;
  }
  const decontaminated = decontaminateBoundaryRgb({ rgba: output, background });
  const removedRatio = visiblePixels > 0 ? removedPixels / visiblePixels : 0;
  const uniformity = Math.min(1, Math.max(0, 1 - (estimate.spread / 96)));
  const ratioScore = removedRatio >= 0.02 && removedRatio <= 0.985 ? 1 : 0;
  const confidence = Number((uniformity * ratioScore).toFixed(3));
  return {
    rgba: decontaminated,
    background,
    borderSpread: estimate.spread,
    removedRatio,
    confidence,
    accepted: confidence >= 0.45,
  };
};

export const applyManualMaskBrushStroke = ({
  currentRgba,
  sourceRgba,
  width,
  height,
  centerX,
  centerY,
  radius,
  mode,
}: {
  currentRgba: Uint8ClampedArray;
  sourceRgba: Uint8ClampedArray;
  width: number;
  height: number;
  centerX: number;
  centerY: number;
  radius: number;
  mode: 'add' | 'erase';
}) => {
  if (currentRgba.length !== sourceRgba.length || currentRgba.length !== width * height * 4 || radius <= 0) {
    throw new Error('invalid_manual_mask_stroke_input');
  }
  const output = new Uint8ClampedArray(currentRgba);
  const x1 = Math.max(0, Math.floor(centerX - radius));
  const x2 = Math.min(width - 1, Math.ceil(centerX + radius));
  const y1 = Math.max(0, Math.floor(centerY - radius));
  const y2 = Math.min(height - 1, Math.ceil(centerY + radius));
  for (let y = y1; y <= y2; y += 1) {
    for (let x = x1; x <= x2; x += 1) {
      const distance = Math.hypot(x - centerX, y - centerY);
      if (distance > radius) continue;
      const featherStart = radius * 0.72;
      const strength = distance <= featherStart ? 1 : 1 - ((distance - featherStart) / Math.max(1, radius - featherStart));
      const index = ((y * width) + x) * 4;
      const currentAlpha = currentRgba[index + 3];
      output[index + 3] = clampByte(mode === 'add'
        ? currentAlpha + ((255 - currentAlpha) * strength)
        : currentAlpha * (1 - strength));
      if (mode === 'add') {
        output[index] = sourceRgba[index];
        output[index + 1] = sourceRgba[index + 1];
        output[index + 2] = sourceRgba[index + 2];
      }
    }
  }
  return output;
};

export const applyFabricLuminanceModulation = ({
  designRgba,
  garmentRgba,
  width,
  height,
}: {
  designRgba: Uint8ClampedArray;
  garmentRgba: Uint8ClampedArray;
  /** Optional stage dimensions for bounded local fold shading. */
  width?: number;
  height?: number;
}) => {
  if (designRgba.length !== garmentRgba.length) throw new Error('invalid_fabric_modulation_input');
  const hasGrid = Number.isSafeInteger(width)
    && Number.isSafeInteger(height)
    && (width as number) > 0
    && (height as number) > 0
    && (width as number) * (height as number) * 4 === garmentRgba.length;
  const output = new Uint8ClampedArray(designRgba);
  for (let index = 0; index < output.length; index += 4) {
    if (output[index + 3] === 0) continue;
    const luminance = (0.2126 * garmentRgba[index]) + (0.7152 * garmentRgba[index + 1]) + (0.0722 * garmentRgba[index + 2]);
    let foldContrast = 0;
    if (hasGrid) {
      const pixel = index / 4;
      const x = pixel % (width as number);
      const y = Math.floor(pixel / (width as number));
      let neighbourSum = 0;
      let neighbourWeight = 0;
      for (const [offsetX, offsetY] of [[-1, 0], [1, 0], [0, -1], [0, 1]] as const) {
        const nextX = x + offsetX;
        const nextY = y + offsetY;
        if (nextX < 0 || nextX >= (width as number) || nextY < 0 || nextY >= (height as number)) continue;
        const neighbourIndex = ((nextY * (width as number)) + nextX) * 4;
        const neighbourAlpha = garmentRgba[neighbourIndex + 3];
        if (neighbourAlpha === 0) continue;
        neighbourSum += ((0.2126 * garmentRgba[neighbourIndex])
          + (0.7152 * garmentRgba[neighbourIndex + 1])
          + (0.0722 * garmentRgba[neighbourIndex + 2])) * (neighbourAlpha / 255);
        neighbourWeight += neighbourAlpha / 255;
      }
      if (neighbourWeight > 0) {
        foldContrast = Math.max(-1, Math.min(1, (luminance - (neighbourSum / neighbourWeight)) / 48));
      }
    }
    const factor = Math.min(1.08, Math.max(0.82, 0.82 + ((luminance / 255) * 0.26) + (foldContrast * 0.05)));
    output[index] = clampByte(output[index] * factor);
    output[index + 1] = clampByte(output[index + 1] * factor);
    output[index + 2] = clampByte(output[index + 2] * factor);
  }
  return output;
};

export const sourceOverRgbaPixel = (
  source: readonly [number, number, number, number],
  destination: readonly [number, number, number, number],
): [number, number, number, number] => {
  const sourceAlpha = source[3] / 255;
  const destinationAlpha = destination[3] / 255;
  const outputAlpha = sourceAlpha + (destinationAlpha * (1 - sourceAlpha));
  if (outputAlpha <= 0) return [0, 0, 0, 0];
  return [
    clampByte(((source[0] * sourceAlpha) + (destination[0] * destinationAlpha * (1 - sourceAlpha))) / outputAlpha),
    clampByte(((source[1] * sourceAlpha) + (destination[1] * destinationAlpha * (1 - sourceAlpha))) / outputAlpha),
    clampByte(((source[2] * sourceAlpha) + (destination[2] * destinationAlpha * (1 - sourceAlpha))) / outputAlpha),
    clampByte(outputAlpha * 255),
  ];
};

export const mergePrintResultHistory = <T>(
  nextResults: readonly T[],
  previousResults: readonly T[],
  maxResults = 8,
) => {
  if (!Number.isInteger(maxResults) || maxResults < 1) {
    throw new Error('invalid_print_result_history_limit');
  }
  return [...nextResults, ...previousResults].slice(0, maxResults);
};

export const mergeDelayedSurfaceResult = <T extends { id: string }>({
  currentResults,
  exactId,
  fabricId,
  surfaceResult,
  maxResults = 8,
}: {
  currentResults: readonly T[];
  exactId: string;
  fabricId: string;
  surfaceResult: T;
  maxResults?: number;
}) => {
  if (!Number.isInteger(maxResults) || maxResults < 3) {
    throw new Error('invalid_delayed_surface_result_history_limit');
  }
  if (currentResults[0]?.id !== exactId || currentResults[1]?.id !== fabricId) {
    return [...currentResults];
  }
  return [
    currentResults[0],
    currentResults[1],
    surfaceResult,
    ...currentResults.slice(2).filter((result) => result.id !== surfaceResult.id),
  ].slice(0, maxResults);
};

const readAlpha = (
  rgba: Uint8ClampedArray,
  width: number,
  height: number,
  x: number,
  y: number,
) => {
  if (x < 0 || x >= width || y < 0 || y >= height) return null;
  return rgba[((y * width) + x) * 4 + 3];
};

/**
 * Derive a selectable mask from an existing AI cutout without changing RGB.
 * `detail` strengthens existing non-zero edge alpha from its in-bounds 3x3
 * neighborhood without reviving transparent RGB; `strict` is a 3x3 erosion.
 */
export const buildPrintMaskCandidateRgba = ({
  rgba,
  width,
  height,
  candidateId,
}: {
  rgba: Uint8ClampedArray;
  width: number;
  height: number;
  candidateId: PrintGarmentMaskCandidateId;
}) => {
  if (width <= 0 || height <= 0 || rgba.length !== width * height * 4) {
    throw new Error('invalid_print_mask_candidate_input');
  }

  const output = new Uint8ClampedArray(rgba);
  if (candidateId === 'auto' || candidateId === 'manual') return output;
  if (candidateId === 'refined') throw new Error('refined_candidate_requires_edge_refinement');

  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) {
      let neighborhoodAlpha = candidateId === 'detail' ? 0 : 255;
      for (let offsetY = -1; offsetY <= 1; offsetY += 1) {
        for (let offsetX = -1; offsetX <= 1; offsetX += 1) {
          const alpha = readAlpha(rgba, width, height, x + offsetX, y + offsetY);
          if (alpha === null) continue;
          neighborhoodAlpha = candidateId === 'detail'
            ? Math.max(neighborhoodAlpha, alpha)
            : Math.min(neighborhoodAlpha, alpha);
        }
      }
      const currentAlpha = rgba[((y * width) + x) * 4 + 3];
      const alpha = candidateId === 'detail'
        ? (currentAlpha === 0 ? 0 : neighborhoodAlpha)
        : neighborhoodAlpha;
      output[((y * width) + x) * 4 + 3] = alpha;
    }
  }

  return output;
};

export const buildRefinedPrintMaskCandidateRgba = ({
  rgba,
  width,
  height,
}: {
  rgba: Uint8ClampedArray;
  width: number;
  height: number;
}) => refineAlphaEdge({ rgba, width, height });

export type PrintEdgeRefinementMetadata = {
  version: 'source-edge-refinement-v1';
  source: 'base-mask-alpha';
  inputSize: { width: number; height: number };
  partialAlphaPixels: number;
  changedAlphaPixels: number;
  maxAlphaDelta: number;
};

export const summarizePrintEdgeRefinement = ({
  inputRgba,
  outputRgba,
  width,
  height,
}: {
  inputRgba: Uint8ClampedArray;
  outputRgba: Uint8ClampedArray;
  width: number;
  height: number;
}): PrintEdgeRefinementMetadata => {
  if (inputRgba.length !== outputRgba.length || inputRgba.length !== width * height * 4) {
    throw new Error('invalid_print_edge_refinement_summary');
  }
  let partialAlphaPixels = 0;
  let changedAlphaPixels = 0;
  let maxAlphaDelta = 0;
  for (let index = 3; index < inputRgba.length; index += 4) {
    const inputAlpha = inputRgba[index];
    const outputAlpha = outputRgba[index];
    if (inputAlpha >= 8 && inputAlpha <= 247) partialAlphaPixels += 1;
    const delta = Math.abs(inputAlpha - outputAlpha);
    if (delta > 0) changedAlphaPixels += 1;
    maxAlphaDelta = Math.max(maxAlphaDelta, delta);
  }
  return {
    version: 'source-edge-refinement-v1',
    source: 'base-mask-alpha',
    inputSize: { width, height },
    partialAlphaPixels,
    changedAlphaPixels,
    maxAlphaDelta,
  };
};

export const assemblePrintGarmentMaskCandidates = async <T,>({
  automaticResult,
  deriveResult,
  onOptionalFailure,
}: {
  automaticResult: T;
  deriveResult: (candidateId: Exclude<AutomaticPrintGarmentMaskCandidateId, 'auto'>) => Promise<T>;
  onOptionalFailure?: (candidateId: Exclude<AutomaticPrintGarmentMaskCandidateId, 'auto'>, error: unknown) => void;
}) => {
  const results = new Map<AutomaticPrintGarmentMaskCandidateId, T>([['auto', automaticResult]]);
  const optionalCandidateIds = PRINT_GARMENT_MASK_CANDIDATES
    .map((candidate) => candidate.id)
    .filter((candidateId): candidateId is Exclude<AutomaticPrintGarmentMaskCandidateId, 'auto'> => candidateId !== 'auto');
  const settled = await Promise.all(optionalCandidateIds.map(async (candidateId) => {
    try {
      return { candidateId, result: await deriveResult(candidateId) } as const;
    } catch (error) {
      onOptionalFailure?.(candidateId, error);
      return null;
    }
  }));
  for (const item of settled) {
    if (item) results.set(item.candidateId, item.result);
  }

  return PRINT_GARMENT_MASK_CANDIDATES.flatMap((candidate) => {
    const result = results.get(candidate.id);
    return result ? [{
      candidateId: candidate.id,
      label: candidate.label,
      description: candidate.description,
      result,
    }] : [];
  });
};

export const selectPrintGarmentMaskCandidateValue = <T extends { candidateId: PrintGarmentMaskCandidateId; result: { dataUrl: string } }>(
  candidates: readonly T[],
  candidateId: PrintGarmentMaskCandidateId,
) => {
  const candidate = candidates.find((item) => item.candidateId === candidateId);
  if (!candidate) throw new Error(`print_mask_candidate_missing:${candidateId}`);
  return {
    candidateId: candidate.candidateId,
    dataUrl: candidate.result.dataUrl,
    candidate,
  };
};

export type PrintRequestSignatureValueInput = {
  brandId: string;
  brandName: string;
  stageSize: { width: number; height: number };
  garment: {
    sourceUrl: string;
    referenceType: string | null;
    maskCandidateId: PrintGarmentMaskCandidateId;
    maskRevision: number;
  };
  surfaceIdentity?: {
    version: string;
    sourceHash: string;
    contentHash: string;
    manualRevision: number;
    status: string;
  };
  designs: Array<{
    id: string;
    sourceUrl: string;
    maskRevision: number;
    transform: {
      x: number;
      y: number;
      scale: number;
      rotation: number;
      opacity: number;
    };
  }>;
};

export const buildPrintRequestSignatureValue = (input: PrintRequestSignatureValueInput) => JSON.stringify({
  brandId: input.brandId,
  brandName: input.brandName,
  stageSize: input.stageSize,
  garment: {
    sourceUrl: input.garment.sourceUrl,
    referenceType: input.garment.referenceType,
    maskCandidateId: input.garment.maskCandidateId,
    maskRevision: input.garment.maskRevision,
  },
  ...(input.surfaceIdentity ? { surfaceIdentity: input.surfaceIdentity } : {}),
  designs: input.designs.map((design) => ({
    id: design.id,
    sourceUrl: design.sourceUrl,
    maskRevision: design.maskRevision,
    transform: design.transform,
  })),
});
