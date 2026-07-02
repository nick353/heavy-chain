import type { Json } from '../types/database';

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
  storagePolicy: 'bounded-local-canvas-data-url-v1';
  engine: 'browser-canvas-geometric-mask-v1' | 'browser-canvas-background-flood-cutout-v2';
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

type Rgb = { r: number; g: number; b: number };
type BackgroundEstimate = Rgb & { sampleSpread: number };

const colorDistance = (a: Rgb, b: Rgb) => Math.hypot(a.r - b.r, a.g - b.g, a.b - b.b);

const readRgb = (data: Uint8ClampedArray, index: number): Rgb => ({
  r: data[index],
  g: data[index + 1],
  b: data[index + 2],
});

const estimateBackgroundColor = (data: Uint8ClampedArray, width: number, height: number): BackgroundEstimate => {
  const samples: Rgb[] = [];
  const insetX = Math.max(1, Math.floor(width * 0.06));
  const insetY = Math.max(1, Math.floor(height * 0.06));
  const samplePoints = [
    [insetX, insetY],
    [width - 1 - insetX, insetY],
    [insetX, height - 1 - insetY],
    [width - 1 - insetX, height - 1 - insetY],
    [Math.floor(width / 2), insetY],
    [Math.floor(width / 2), height - 1 - insetY],
    [insetX, Math.floor(height / 2)],
    [width - 1 - insetX, Math.floor(height / 2)],
  ];

  for (const [x, y] of samplePoints) {
    const clampedX = Math.min(width - 1, Math.max(0, x));
    const clampedY = Math.min(height - 1, Math.max(0, y));
    samples.push(readRgb(data, (clampedY * width + clampedX) * 4));
  }

  const background = {
    r: Math.round(samples.reduce((sum, color) => sum + color.r, 0) / samples.length),
    g: Math.round(samples.reduce((sum, color) => sum + color.g, 0) / samples.length),
    b: Math.round(samples.reduce((sum, color) => sum + color.b, 0) / samples.length),
  };
  const sampleSpread = Math.max(...samples.map((color) => colorDistance(color, background)));
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
  const threshold = 46;
  const enqueue = (x: number, y: number) => {
    if (x < 0 || x >= width || y < 0 || y >= height) return;
    const pixelIndex = y * width + x;
    if (visited[pixelIndex]) return;
    const rgbaIndex = pixelIndex * 4;
    if (data[rgbaIndex + 3] <= 4 || colorDistance(readRgb(data, rgbaIndex), background) <= threshold) {
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
  const backgroundMask = candidateBackgroundMask && shouldUseBackgroundMask({
    mask: candidateBackgroundMask,
    background,
    width,
    height,
  })
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
          ? Math.max(48, Math.min(210, Math.round((backgroundDistance - 34) * 8)))
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
