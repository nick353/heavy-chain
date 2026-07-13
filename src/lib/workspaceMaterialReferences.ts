import type { Json } from '../types/database';

import { newSession, remove, rembgConfig } from '@bunnio/rembg-web';

export type MaterialReferenceState = {
  imageUrl: string;
  fileName: string;
  materialKind: string;
  maskMode: 'auto' | 'manual' | 'keep';
  activeLayer: string;
  placement: string;
  scale: number;
  note: string;
  maskCandidates?: string[];
  selectedMaskCandidate?: string | null;
  extractedLayerReady?: boolean;
  extractedImageUrl?: string | null;
  cutoutBounds?: MaterialCutoutBounds | null;
  cutoutOutputSize?: { width: number; height: number } | null;
  cutoutDataUrlBytes?: number | null;
  cutoutMaxDataUrlBytes?: number | null;
  cutoutStoragePolicy?: MaterialCutoutResult['storagePolicy'] | null;
  maskEngine?: string | null;
  nextStepReady?: boolean;
};

export type MaterialCutoutBounds = {
  x: number;
  y: number;
  width: number;
  height: number;
};

export type MaterialCutoutResult = {
  dataUrl: string;
  bounds: MaterialCutoutBounds;
  sourceSize: { width: number; height: number };
  outputSize: { width: number; height: number };
  dataUrlBytes: number;
  storagePolicy: 'bounded-local-canvas-data-url-v1' | 'bounded-local-ai-cutout-data-url-v1';
  engine:
    | 'browser-canvas-geometric-mask-v1'
    | 'browser-canvas-background-flood-cutout-v2'
    | 'browser-ai-isnet-general-use-v1'
    | 'browser-local-white-background-garment-cutout-v1';
  hasTransparentPixels: boolean;
};

export type MaterialReferenceMetadata = Record<string, Json | undefined> & {
  hasImage: boolean;
  imageUrl: string | null;
  fileName: string | null;
  materialKind: string;
  maskMode: MaterialReferenceState['maskMode'];
  activeLayer: string;
  placement: string;
  scale: number;
  note: string;
  maskCandidates?: string[];
  selectedMaskCandidate?: string | null;
  extractedLayerReady?: boolean;
  extractedImageUrl?: string | null;
  cutoutBounds?: MaterialCutoutBounds | null;
  cutoutOutputSize?: { width: number; height: number } | null;
  cutoutDataUrlBytes?: number | null;
  cutoutMaxDataUrlBytes?: number | null;
  cutoutStoragePolicy?: MaterialCutoutResult['storagePolicy'] | null;
  maskEngine?: string | null;
  nextStepReady?: boolean;
};

export const readWorkspaceImageAsDataUrl = (file: File): Promise<string> => {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => {
      if (typeof reader.result === 'string') {
        resolve(reader.result);
        return;
      }
      reject(new Error('画像を読み込めませんでした。'));
    };
    reader.onerror = () => reject(new Error('画像を読み込めませんでした。'));
    reader.readAsDataURL(file);
  });
};

export const buildMaterialReferenceMetadata = (
  state: MaterialReferenceState,
): MaterialReferenceMetadata => ({
  hasImage: Boolean(state.imageUrl),
  imageUrl: state.imageUrl || null,
  fileName: state.fileName || null,
  materialKind: state.materialKind,
  maskMode: state.maskMode,
  activeLayer: state.activeLayer,
  placement: state.placement,
  scale: state.scale,
  note: state.note,
  maskCandidates: state.maskCandidates ?? [],
  selectedMaskCandidate: state.selectedMaskCandidate ?? null,
  extractedLayerReady: Boolean(state.extractedLayerReady),
  extractedImageUrl: state.extractedImageUrl ?? null,
  cutoutBounds: state.cutoutBounds ?? null,
  cutoutOutputSize: state.cutoutOutputSize ?? null,
  cutoutDataUrlBytes: state.cutoutDataUrlBytes ?? null,
  cutoutMaxDataUrlBytes: state.cutoutMaxDataUrlBytes ?? null,
  cutoutStoragePolicy: state.cutoutStoragePolicy ?? null,
  maskEngine: state.maskEngine ?? null,
  nextStepReady: Boolean(state.nextStepReady),
});

const loadImageElement = (imageUrl: string): Promise<HTMLImageElement> => {
  return new Promise((resolve, reject) => {
    const image = new Image();
    image.onload = () => resolve(image);
    image.onerror = () => reject(new Error('カット用の画像処理に失敗しました'));
    image.src = imageUrl;
  });
};

const estimateDataUrlBytes = (dataUrl: string) => Math.ceil(dataUrl.length * 0.75);

const blobToDataUrl = (blob: Blob): Promise<string> => new Promise((resolve, reject) => {
  const reader = new FileReader();
  reader.onload = () => {
    if (typeof reader.result === 'string') {
      resolve(reader.result);
      return;
    }
    reject(new Error('AI切り抜き結果を読み込めませんでした'));
  };
  reader.onerror = () => reject(new Error('AI切り抜き結果を読み込めませんでした'));
  reader.readAsDataURL(blob);
});

const dataUrlToBlob = async (dataUrl: string) => {
  const response = await fetch(dataUrl);
  return response.blob();
};

const getAlphaBounds = (imageData: ImageData): { bounds: MaterialCutoutBounds; hasTransparentPixels: boolean } | null => {
  const { data, width, height } = imageData;
  let minX = width;
  let minY = height;
  let maxX = -1;
  let maxY = -1;
  let hasTransparentPixels = false;

  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) {
      const alpha = data[(y * width + x) * 4 + 3];
      if (alpha > 4) {
        minX = Math.min(minX, x);
        minY = Math.min(minY, y);
        maxX = Math.max(maxX, x);
        maxY = Math.max(maxY, y);
      }
      if (alpha < 250) hasTransparentPixels = true;
    }
  }

  if (maxX < minX || maxY < minY) return null;
  return {
    bounds: {
      x: minX,
      y: minY,
      width: maxX - minX + 1,
      height: maxY - minY + 1,
    },
    hasTransparentPixels,
  };
};

const calculateOpaqueBorderRatio = (imageData: ImageData, bounds: MaterialCutoutBounds) => {
  const { data, width, height } = imageData;
  const x1 = Math.max(0, bounds.x);
  const y1 = Math.max(0, bounds.y);
  const x2 = Math.min(width - 1, bounds.x + bounds.width - 1);
  const y2 = Math.min(height - 1, bounds.y + bounds.height - 1);
  let borderSamples = 0;
  let opaqueSamples = 0;

  const sample = (x: number, y: number) => {
    borderSamples += 1;
    if (data[(y * width + x) * 4 + 3] > 220) opaqueSamples += 1;
  };

  for (let x = x1; x <= x2; x += 1) {
    sample(x, y1);
    if (y2 !== y1) sample(x, y2);
  }
  for (let y = y1 + 1; y < y2; y += 1) {
    sample(x1, y);
    if (x2 !== x1) sample(x2, y);
  }

  return borderSamples > 0 ? opaqueSamples / borderSamples : 0;
};

const calculateNeutralBackgroundRisk = (imageData: ImageData) => {
  const { data, width, height } = imageData;
  let opaquePixels = 0;
  let flatNeutralPixels = 0;

  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) {
      const index = (y * width + x) * 4;
      const alpha = data[index + 3];
      if (alpha <= 120) continue;
      opaquePixels += 1;
      const r = data[index];
      const g = data[index + 1];
      const b = data[index + 2];
      const channelSpread = Math.max(r, g, b) - Math.min(r, g, b);
      const isFlatNeutral = channelSpread <= 10 && r >= 120 && r <= 235 && g >= 120 && g <= 235 && b >= 120 && b <= 235;
      if (isFlatNeutral) flatNeutralPixels += 1;
    }
  }

  return opaquePixels > 0 ? flatNeutralPixels / opaquePixels : 0;
};

const canvasToPngDataUrl = (canvas: HTMLCanvasElement) => canvas.toDataURL('image/png');

const buildBoundedPngFromCanvas = ({
  canvas,
  sourceWidth,
  sourceHeight,
  maxDataUrlBytes,
  storagePolicy,
  engine,
}: {
  canvas: HTMLCanvasElement;
  sourceWidth: number;
  sourceHeight: number;
  maxDataUrlBytes: number;
  storagePolicy: MaterialCutoutResult['storagePolicy'];
  engine: MaterialCutoutResult['engine'];
}): MaterialCutoutResult => {
  const context = canvas.getContext('2d', { willReadFrequently: true });
  if (!context) throw new Error('Canvasを初期化できませんでした');

  const imageData = context.getImageData(0, 0, canvas.width, canvas.height);
  const alphaBounds = getAlphaBounds(imageData);
  if (!alphaBounds?.hasTransparentPixels) {
    throw new Error('背景を十分に分離できませんでした。白い背景や平置き写真で再試行してください。');
  }
  const opaqueBorderRatio = calculateOpaqueBorderRatio(imageData, alphaBounds.bounds);
  const neutralBackgroundRisk = calculateNeutralBackgroundRisk(imageData);
  if (opaqueBorderRatio > 0.58 || (opaqueBorderRatio > 0.22 && neutralBackgroundRisk > 0.55)) {
    throw new Error('背景の四角い範囲が残っています。服だけを分離できる写真で再試行してください。');
  }

  const padding = Math.round(Math.max(canvas.width, canvas.height) * 0.025);
  const cropX = Math.max(0, alphaBounds.bounds.x - padding);
  const cropY = Math.max(0, alphaBounds.bounds.y - padding);
  const cropRight = Math.min(canvas.width, alphaBounds.bounds.x + alphaBounds.bounds.width - 1 + padding);
  const cropBottom = Math.min(canvas.height, alphaBounds.bounds.y + alphaBounds.bounds.height - 1 + padding);
  let cropWidth = Math.max(1, cropRight - cropX + 1);
  let cropHeight = Math.max(1, cropBottom - cropY + 1);
  let scale = 1;
  let lastDataUrl = '';
  let lastOutputSize = { width: cropWidth, height: cropHeight };

  for (let attempt = 0; attempt < 5; attempt += 1) {
    const outputWidth = Math.max(1, Math.round(cropWidth * scale));
    const outputHeight = Math.max(1, Math.round(cropHeight * scale));
    const outputCanvas = document.createElement('canvas');
    outputCanvas.width = outputWidth;
    outputCanvas.height = outputHeight;
    const outputContext = outputCanvas.getContext('2d');
    if (!outputContext) throw new Error('Canvasを初期化できませんでした');
    outputContext.imageSmoothingEnabled = true;
    outputContext.imageSmoothingQuality = 'high';
    outputContext.drawImage(canvas, cropX, cropY, cropWidth, cropHeight, 0, 0, outputWidth, outputHeight);
    lastDataUrl = canvasToPngDataUrl(outputCanvas);
    lastOutputSize = { width: outputWidth, height: outputHeight };
    if (estimateDataUrlBytes(lastDataUrl) <= maxDataUrlBytes) {
      return {
        dataUrl: lastDataUrl,
        bounds: { x: cropX, y: cropY, width: cropWidth, height: cropHeight },
        sourceSize: { width: sourceWidth, height: sourceHeight },
        outputSize: lastOutputSize,
        dataUrlBytes: estimateDataUrlBytes(lastDataUrl),
        storagePolicy,
        engine,
        hasTransparentPixels: true,
      };
    }
    scale *= 0.72;
  }

  cropWidth = Math.max(1, cropWidth);
  cropHeight = Math.max(1, cropHeight);
  throw new Error(`透明PNGが保存上限を超えています。画像を小さくして再試行してください。${estimateDataUrlBytes(lastDataUrl)}/${maxDataUrlBytes} bytes`);
};

type Rgb = { r: number; g: number; b: number };
type BackgroundEstimate = Rgb & { sampleSpread: number };

const colorDistance = (a: Rgb, b: Rgb) => Math.hypot(a.r - b.r, a.g - b.g, a.b - b.b);
const luminance = ({ r, g, b }: Rgb) => (0.2126 * r) + (0.7152 * g) + (0.0722 * b);

const readRgb = (data: Uint8ClampedArray, index: number): Rgb => ({
  r: data[index],
  g: data[index + 1],
  b: data[index + 2],
});

const estimateBackgroundColor = (data: Uint8ClampedArray, width: number, height: number): BackgroundEstimate => {
  const samples: Rgb[] = [];
  const inset = Math.max(1, Math.floor(Math.min(width, height) * 0.035));
  const step = Math.max(8, Math.floor(Math.min(width, height) / 18));
  for (let x = inset; x < width - inset; x += step) {
    samples.push(readRgb(data, (inset * width + x) * 4));
    samples.push(readRgb(data, ((height - 1 - inset) * width + x) * 4));
  }
  for (let y = inset; y < height - inset; y += step) {
    samples.push(readRgb(data, (y * width + inset) * 4));
    samples.push(readRgb(data, (y * width + (width - 1 - inset)) * 4));
  }
  const neutralBrightSamples = samples.filter((color) => {
    const spread = Math.max(color.r, color.g, color.b) - Math.min(color.r, color.g, color.b);
    return luminance(color) >= 130 && spread <= 55;
  });
  const usableSamples = neutralBrightSamples.length >= 6 ? neutralBrightSamples : samples;
  const medianChannel = (channel: keyof Rgb) => {
    const values = usableSamples.map((color) => color[channel]).sort((a, b) => a - b);
    return values[Math.floor(values.length / 2)] ?? 255;
  };

  const background = {
    r: medianChannel('r'),
    g: medianChannel('g'),
    b: medianChannel('b'),
  };
  const sampleSpread = Math.max(...usableSamples.map((color) => colorDistance(color, background)));
  return { ...background, sampleSpread };
};

const buildEdgeConnectedBackgroundMask = (
  data: Uint8ClampedArray,
  width: number,
  height: number,
  background: Rgb,
) => {
  const visited = new Uint8Array(width * height);
  const queue: number[] = [];
  const backgroundLum = luminance(background);
  const threshold = backgroundLum > 185 ? 34 : 46;
  const shouldTreatAsBackground = (color: Rgb) => {
    const lum = luminance(color);
    if (backgroundLum > 185 && lum < 70) return true;
    if (backgroundLum > 185 && lum > backgroundLum + 10) return false;
    return colorDistance(color, background) <= threshold;
  };
  const enqueue = (x: number, y: number) => {
    if (x < 0 || x >= width || y < 0 || y >= height) return;
    const pixelIndex = y * width + x;
    if (visited[pixelIndex]) return;
    const rgbaIndex = pixelIndex * 4;
    if (data[rgbaIndex + 3] <= 4 || shouldTreatAsBackground(readRgb(data, rgbaIndex))) {
      visited[pixelIndex] = 1;
      queue.push(pixelIndex);
    }
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
    enqueue(x + 1, y);
    enqueue(x - 1, y);
    enqueue(x, y + 1);
    enqueue(x, y - 1);
  }

  return visited;
};

const hasBackgroundNeighbor = (mask: Uint8Array, x: number, y: number, width: number, height: number) => {
  for (let offsetY = -1; offsetY <= 1; offsetY += 1) {
    for (let offsetX = -1; offsetX <= 1; offsetX += 1) {
      if (offsetX === 0 && offsetY === 0) continue;
      const nx = x + offsetX;
      const ny = y + offsetY;
      if (nx < 0 || nx >= width || ny < 0 || ny >= height) continue;
      if (mask[ny * width + nx]) return true;
    }
  }
  return false;
};

const countMaskPixels = (mask: Uint8Array) => mask.reduce((sum, value) => sum + value, 0);

const isProtectedCutoutCenter = (x: number, y: number, width: number, height: number) => {
  const nx = (x / width - 0.5) * 2;
  const ny = (y / height - 0.5) * 2;
  return (nx / 0.42) ** 2 + ((ny + 0.02) / 0.54) ** 2 <= 1;
};

const shouldUseBackgroundMask = ({
  mask,
  background,
  width,
  height,
}: {
  mask: Uint8Array;
  background: BackgroundEstimate;
  width: number;
  height: number;
}) => {
  const totalPixels = width * height;
  const backgroundRatio = countMaskPixels(mask) / totalPixels;
  let protectedCenterPixels = 0;
  let maskedProtectedCenterPixels = 0;

  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) {
      if (!isProtectedCutoutCenter(x, y, width, height)) continue;
      protectedCenterPixels += 1;
      if (mask[y * width + x]) maskedProtectedCenterPixels += 1;
    }
  }

  const centerMaskRatio = protectedCenterPixels > 0 ? maskedProtectedCenterPixels / protectedCenterPixels : 1;
  return (
    background.sampleSpread <= 70
    && backgroundRatio >= 0.05
    && backgroundRatio <= 0.96
    && centerMaskRatio <= 0.55
  );
};

const getMaskAlpha = ({
  x,
  y,
  width,
  height,
  mode,
  candidate,
}: {
  x: number;
  y: number;
  width: number;
  height: number;
  mode: MaterialReferenceState['maskMode'];
  candidate?: string | null;
}) => {
  if (mode === 'keep') return 255;

  const nx = (x / width - 0.5) * 2;
  const ny = (y / height - 0.5) * 2;
  const label = candidate ?? '';
  const isPattern = label.includes('柄');
  const isPlain = label.includes('無地');
  const isManual = mode === 'manual' || label.includes('手動');

  if (isPattern) {
    const inside = Math.abs(nx) <= 0.52 && Math.abs(ny) <= 0.44;
    const feather = Math.max(Math.abs(nx) - 0.52, Math.abs(ny) - 0.44);
    if (inside) return 255;
    return Math.max(0, Math.round(255 * (1 - feather / 0.12)));
  }

  if (isManual || isPlain) {
    const rx = isPlain ? 0.66 : 0.76;
    const ry = isPlain ? 0.72 : 0.86;
    const inside = Math.abs(nx) <= rx && Math.abs(ny) <= ry;
    const feather = Math.max(Math.abs(nx) - rx, Math.abs(ny) - ry);
    if (inside) return 255;
    return Math.max(0, Math.round(255 * (1 - feather / 0.1)));
  }

  const distance = (nx / 0.72) ** 2 + ((ny + 0.02) / 0.9) ** 2;
  if (distance <= 1) return 255;
  return Math.max(0, Math.round(255 * (1 - (distance - 1) / 0.18)));
};

export async function buildMaterialCutoutDataUrl({
  imageUrl,
  mode,
  candidate,
  maxSize = 720,
  maxDataUrlBytes = 750_000,
}: {
  imageUrl: string;
  mode: MaterialReferenceState['maskMode'];
  candidate?: string | null;
  maxSize?: number;
  maxDataUrlBytes?: number;
}): Promise<MaterialCutoutResult> {
  const storagePolicy = 'bounded-local-canvas-data-url-v1' as const;
  if (mode === 'keep') {
    const image = await loadImageElement(imageUrl);
    const sourceWidth = image.naturalWidth || image.width;
    const sourceHeight = image.naturalHeight || image.height;
    const dataUrlBytes = estimateDataUrlBytes(imageUrl);
    if (dataUrlBytes > maxDataUrlBytes) {
      throw new Error(`画像が保存上限を超えています。画像を小さくして再試行してください。${dataUrlBytes}/${maxDataUrlBytes} bytes`);
    }
    return {
      dataUrl: imageUrl,
      bounds: { x: 0, y: 0, width: sourceWidth, height: sourceHeight },
      sourceSize: { width: sourceWidth, height: sourceHeight },
      outputSize: { width: sourceWidth, height: sourceHeight },
      dataUrlBytes,
      storagePolicy,
      engine: 'browser-canvas-geometric-mask-v1',
      hasTransparentPixels: false,
    };
  }

  const image = await loadImageElement(imageUrl);
  const sourceWidth = image.naturalWidth || image.width;
  const sourceHeight = image.naturalHeight || image.height;
  let targetMaxSize = Math.max(240, maxSize);
  let lastResult: MaterialCutoutResult | null = null;

  for (let attempt = 0; attempt < 5; attempt += 1) {
    const result = buildCutoutFromImage({
      image,
      sourceWidth,
      sourceHeight,
      mode,
      candidate,
      maxSize: targetMaxSize,
      storagePolicy,
    });
    lastResult = result;
    if (result.dataUrlBytes <= maxDataUrlBytes) return result;
    targetMaxSize = Math.max(240, Math.floor(targetMaxSize * 0.72));
  }

  if (lastResult) {
    throw new Error(`透明PNGが保存上限を超えています。画像を小さくして再試行してください。${lastResult.dataUrlBytes}/${maxDataUrlBytes} bytes`);
  }
  throw new Error('透明PNGの抽出に失敗しました');
}

const buildWhiteBackgroundFallbackCutout = async ({
  imageUrl,
  maxDataUrlBytes,
}: {
  imageUrl: string;
  maxDataUrlBytes: number;
}): Promise<MaterialCutoutResult> => {
  const result = await buildMaterialCutoutDataUrl({
    imageUrl,
    mode: 'auto',
    candidate: 'トップス',
    maxSize: 840,
    maxDataUrlBytes,
  });
  const sourceArea = result.sourceSize.width * result.sourceSize.height;
  const boundsArea = result.bounds.width * result.bounds.height;
  const boundsRatio = sourceArea > 0 ? boundsArea / sourceArea : 1;
  if (result.engine !== 'browser-canvas-background-flood-cutout-v2' || !result.hasTransparentPixels || boundsRatio > 0.92) {
    throw new Error('白背景から服だけを分離できませんでした。服の外周が背景と重ならない写真で再試行してください。');
  }
  return {
    ...result,
    storagePolicy: 'bounded-local-ai-cutout-data-url-v1',
    engine: 'browser-local-white-background-garment-cutout-v1',
  };
};

const REMBG_OPERATION_TIMEOUT_MS = 30_000;

const withRembgOperationTimeout = async <T>(promise: Promise<T>, label: string): Promise<T> => {
  let timeoutId: number | undefined;
  const timeout = new Promise<never>((_, reject) => {
    timeoutId = window.setTimeout(() => reject(new Error(`rembg_timeout:${label}`)), REMBG_OPERATION_TIMEOUT_MS);
  });
  try {
    return await Promise.race([promise, timeout]);
  } finally {
    if (timeoutId !== undefined) window.clearTimeout(timeoutId);
  }
};

const isRembgModelLoadError = (error: unknown) => {
  const message = error instanceof Error ? error.message : String(error);
  return [
    'Failed to download model',
    'HTTP error',
    'Failed to create session',
    'no available backend found',
    'backend not found',
    'rembg_timeout',
  ].some((fragment) => message.includes(fragment));
};

const canUseBrowserWebGlBackend = () => {
  try {
    const canvas = document.createElement('canvas');
    return Boolean(canvas.getContext('webgl2') || canvas.getContext('webgl'));
  } catch {
    return false;
  }
};

const aiGarmentCutoutSessions = new Map<string, Awaited<ReturnType<typeof newSession>> | null>();

const rembgModelBaseUrl = String(import.meta.env.VITE_REMBG_MODEL_BASE_URL || '/models').replace(/\/$/, '');
const rembgIsnetGeneralUseModelUrl = String(
  import.meta.env.VITE_REMBG_ISNET_GENERAL_USE_MODEL_URL
  || 'https://huggingface.co/briaai/RMBG-1.4/resolve/main/onnx/model.onnx',
).trim();

export async function buildHighPrecisionMaterialCutoutDataUrl({
  imageUrl,
  maxDataUrlBytes = 750_000,
  modelName = 'isnet-general-use',
}: {
  imageUrl: string;
  maxDataUrlBytes?: number;
  modelName?: 'isnet-general-use' | 'u2net_cloth_seg' | 'u2net_human_seg' | 'u2net' | 'u2netp' | 'isnet-anime' | 'silueta';
}): Promise<MaterialCutoutResult> {
  if (!canUseBrowserWebGlBackend()) {
    console.warn('Falling back to local white-background garment cutout because WebGL is unavailable.');
    return buildWhiteBackgroundFallbackCutout({ imageUrl, maxDataUrlBytes });
  }

  rembgConfig.setBaseUrl(rembgModelBaseUrl);
  if (modelName === 'isnet-general-use' && rembgIsnetGeneralUseModelUrl) {
    rembgConfig.setCustomModelPath('isnet-general-use', rembgIsnetGeneralUseModelUrl);
  }
  const image = await loadImageElement(imageUrl);
  const sourceWidth = image.naturalWidth || image.width;
  const sourceHeight = image.naturalHeight || image.height;
  try {
    const sessionKey = modelName;
    let session = aiGarmentCutoutSessions.get(sessionKey) ?? null;
    if (!session) {
      session = await withRembgOperationTimeout(
        newSession(modelName, undefined, { numThreads: 1 }),
        'new_session',
      );
      aiGarmentCutoutSessions.set(sessionKey, session);
    }
  } catch (error) {
    if (!isRembgModelLoadError(error)) throw error;
    console.warn('Falling back to local white-background garment cutout because rembg could not start.', {
      rembgModelBaseUrl,
      modelName,
      error,
    });
    return buildWhiteBackgroundFallbackCutout({ imageUrl, maxDataUrlBytes });
  }
  const aiGarmentCutoutSession = aiGarmentCutoutSessions.get(modelName) ?? undefined;
  const inputBlob = await dataUrlToBlob(imageUrl);
  let outputBlob: Blob;
  try {
    outputBlob = await withRembgOperationTimeout(
      remove(inputBlob, {
        session: aiGarmentCutoutSession,
        postProcessMask: true,
      }),
      'remove',
    );
  } catch (error) {
    if (!isRembgModelLoadError(error)) throw error;
    console.warn('Falling back to local white-background garment cutout because rembg failed during cutout.', {
      rembgModelBaseUrl,
      modelName,
      error,
    });
    aiGarmentCutoutSessions.set(modelName, null);
    return buildWhiteBackgroundFallbackCutout({ imageUrl, maxDataUrlBytes });
  }
  const outputDataUrl = await blobToDataUrl(outputBlob);
  const outputImage = await loadImageElement(outputDataUrl);
  const canvas = document.createElement('canvas');
  canvas.width = outputImage.naturalWidth || outputImage.width;
  canvas.height = outputImage.naturalHeight || outputImage.height;
  const context = canvas.getContext('2d', { willReadFrequently: true });
  if (!context) throw new Error('Canvasを初期化できませんでした');
  context.drawImage(outputImage, 0, 0, canvas.width, canvas.height);

  return buildBoundedPngFromCanvas({
    canvas,
    sourceWidth,
    sourceHeight,
    maxDataUrlBytes,
    storagePolicy: 'bounded-local-ai-cutout-data-url-v1',
    engine: 'browser-ai-isnet-general-use-v1',
  });
}

function buildCutoutFromImage({
  image,
  sourceWidth,
  sourceHeight,
  mode,
  candidate,
  maxSize,
  storagePolicy,
}: {
  image: HTMLImageElement;
  sourceWidth: number;
  sourceHeight: number;
  mode: MaterialReferenceState['maskMode'];
  candidate?: string | null;
  maxSize: number;
  storagePolicy: MaterialCutoutResult['storagePolicy'];
}): MaterialCutoutResult {
  const ratio = Math.min(1, maxSize / Math.max(sourceWidth, sourceHeight));
  const width = Math.max(1, Math.round(sourceWidth * ratio));
  const height = Math.max(1, Math.round(sourceHeight * ratio));
  const canvas = document.createElement('canvas');
  canvas.width = width;
  canvas.height = height;
  const context = canvas.getContext('2d', { willReadFrequently: true });
  if (!context) throw new Error('Canvasを初期化できませんでした');

  context.clearRect(0, 0, width, height);
  context.drawImage(image, 0, 0, width, height);
  const imageData = context.getImageData(0, 0, width, height);
  const { data } = imageData;
  const background = estimateBackgroundColor(data, width, height);
  const candidateBackgroundMask = mode === 'auto' || candidate?.includes('無地') || candidate?.includes('トップス') || candidate?.includes('garment')
    ? buildEdgeConnectedBackgroundMask(data, width, height, background)
    : null;
  const garmentCandidate = Boolean(candidate?.includes('無地') || candidate?.includes('トップス') || candidate?.includes('garment') || candidate?.includes('服'));
  const backgroundMask = candidateBackgroundMask && shouldUseBackgroundMask({
    mask: candidateBackgroundMask,
    background,
    width,
    height,
  }) || (candidateBackgroundMask && garmentCandidate && background.sampleSpread <= 96)
    ? candidateBackgroundMask
    : null;
  let minX = width;
  let minY = height;
  let maxX = -1;
  let maxY = -1;
  let hasTransparentPixels = false;

  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) {
      const index = (y * width + x) * 4;
      const geometricAlpha = backgroundMask ? 255 : getMaskAlpha({ x, y, width, height, mode, candidate });
      const protectedCenter = isProtectedCutoutCenter(x, y, width, height);
      const backgroundPixel = !protectedCenter && backgroundMask?.[y * width + x] === 1;
      const nearBackgroundEdge = !protectedCenter && backgroundMask
        ? hasBackgroundNeighbor(backgroundMask, x, y, width, height)
        : false;
      const backgroundDistance = colorDistance(readRgb(data, index), background);
      const backgroundAlpha = backgroundPixel
        ? 0
        : nearBackgroundEdge && backgroundDistance < 66
          ? Math.max(0, Math.min(210, Math.round((backgroundDistance - 34) * 8)))
          : 255;
      const alpha = Math.min(
        data[index + 3],
        geometricAlpha,
        backgroundAlpha,
      );
      data[index + 3] = alpha;
      if (alpha > 4) {
        minX = Math.min(minX, x);
        minY = Math.min(minY, y);
        maxX = Math.max(maxX, x);
        maxY = Math.max(maxY, y);
      }
      if (alpha < 250) hasTransparentPixels = true;
    }
  }

  context.putImageData(imageData, 0, 0);
  if (maxX < minX || maxY < minY) {
    const dataUrl = canvas.toDataURL('image/png');
    return {
      dataUrl,
      bounds: { x: 0, y: 0, width, height },
      sourceSize: { width: sourceWidth, height: sourceHeight },
      outputSize: { width, height },
      dataUrlBytes: estimateDataUrlBytes(dataUrl),
      storagePolicy,
      engine: backgroundMask ? 'browser-canvas-background-flood-cutout-v2' : 'browser-canvas-geometric-mask-v1',
      hasTransparentPixels,
    };
  }

  const padding = Math.round(Math.max(width, height) * 0.025);
  const cropX = Math.max(0, minX - padding);
  const cropY = Math.max(0, minY - padding);
  const cropRight = Math.min(width, maxX + padding);
  const cropBottom = Math.min(height, maxY + padding);
  const cropWidth = Math.max(1, cropRight - cropX + 1);
  const cropHeight = Math.max(1, cropBottom - cropY + 1);
  const cropCanvas = document.createElement('canvas');
  cropCanvas.width = cropWidth;
  cropCanvas.height = cropHeight;
  const cropContext = cropCanvas.getContext('2d');
  if (!cropContext) throw new Error('Canvasを初期化できませんでした');
  cropContext.drawImage(canvas, cropX, cropY, cropWidth, cropHeight, 0, 0, cropWidth, cropHeight);
  const dataUrl = cropCanvas.toDataURL('image/png');

  return {
    dataUrl,
    bounds: { x: cropX, y: cropY, width: cropWidth, height: cropHeight },
    sourceSize: { width: sourceWidth, height: sourceHeight },
    outputSize: { width: cropWidth, height: cropHeight },
    dataUrlBytes: estimateDataUrlBytes(dataUrl),
    storagePolicy,
    engine: backgroundMask ? 'browser-canvas-background-flood-cutout-v2' : 'browser-canvas-geometric-mask-v1',
    hasTransparentPixels,
  };
}
