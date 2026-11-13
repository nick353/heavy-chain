/**
 * Super-resolution for AIグラフィックデザイン's 「2倍の大きさ」, run in the browser. The model is Real-ESRGAN's compact
 * anime/illustration model (realesr-animevideov3, xinntao/Real-ESRGAN, BSD-3-Clause), exported to ONNX from the official
 * v0.2.5.0 weights and shipped from our own /assets (2.5 MB). The network enlarges 4×; a 2×2 AveragePool added to the
 * end of the graph brings it to 2×, which keeps the sharp edges, drops the model's own grain and reads back a quarter of
 * the pixels from the GPU. Half precision halves the time (Intel Iris Plus 655, 1696×2528: 75 s → 38 s).
 *
 * The image is processed in fixed-size tiles (one WebGPU shader compile, bounded memory, a progress count). Each tile
 * reads PAD extra pixels of context on every side so the tiles meet without seams. Past the image edge the context is
 * mirrored, or wrapped when the image already repeats on that axis (総柄): a repeat stays a repeat after enlarging.
 * Pure functions only; the worker and the page side live in superResolution.worker.ts / superResolutionClient.ts.
 */
/** How much the shipped graph enlarges (4× network + 2×2 average). */
export const SR_MODEL_SCALE = 2;
export const SR_OUTPUT_SCALE = 2;
export const SR_TILE = 256;
export const SR_PAD = 16;
/** Long edge the 2× result may reach (the same room 「2倍の大きさ」 had before: 1696×2528 → 3392×5056). */
export const SR_MAX_OUTPUT_EDGE = 6144;

export type SrWrap = { x: boolean; y: boolean };
/** The same graph twice: half precision (1.3 MB, twice as fast) for GPUs with shader-f16, full precision otherwise. */
export type SrModelUrls = { fp16: string; fp32: string };

export function pickSrModel(models: SrModelUrls, shaderF16: boolean): string {
  return shaderF16 ? models.fp16 : models.fp32;
}
export type SrTile = { x: number; y: number; width: number; height: number };

/** Whether the image can be enlarged here: it must double inside SR_MAX_OUTPUT_EDGE. */
export function canSuperResolve(width: number, height: number): boolean {
  return width > 0 && height > 0 && Math.max(width, height) * SR_OUTPUT_SCALE <= SR_MAX_OUTPUT_EDGE;
}

export function tilePlan(width: number, height: number, tile = SR_TILE): SrTile[] {
  const tiles: SrTile[] = [];
  for (let y = 0; y < height; y += tile) {
    for (let x = 0; x < width; x += tile) tiles.push({ x, y, width: Math.min(tile, width - x), height: Math.min(tile, height - y) });
  }
  return tiles;
}

/** Index into [0, n) for a coordinate past the edge: mirrored (without repeating the edge pixel) or wrapped. */
export function edgeIndex(i: number, n: number, wrap: boolean): number {
  if (n <= 1) return 0;
  if (wrap) return ((i % n) + n) % n;
  const period = 2 * (n - 1);
  const m = ((i % period) + period) % period;
  return m < n ? m : period - m;
}

const pixelDiff = (data: ArrayLike<number>, a: number, b: number) =>
  Math.abs(data[a] - data[b]) + Math.abs(data[a + 1] - data[b + 1]) + Math.abs(data[a + 2] - data[b + 2]);

/**
 * Which axes already repeat: the step across the wrap (last column → first column) is no bigger than an ordinary step
 * between neighbouring columns. A pattern on a plain ground passes too, which is harmless: wrapping plain ground into
 * plain ground looks the same as mirroring it.
 */
export function seamlessAxes(data: ArrayLike<number>, width: number, height: number): SrWrap {
  if (width < 4 || height < 4) return { x: false, y: false };
  let seamX = 0; let innerX = 0; let seamY = 0; let innerY = 0;
  for (let y = 0; y < height; y++) {
    const row = y * width * 4;
    seamX += pixelDiff(data, row, row + (width - 1) * 4);
    innerX += (pixelDiff(data, row, row + 4) + pixelDiff(data, row + (width - 2) * 4, row + (width - 1) * 4)) / 2;
  }
  for (let x = 0; x < width; x++) {
    const column = x * 4;
    seamY += pixelDiff(data, column, column + (height - 1) * width * 4);
    innerY += (pixelDiff(data, column, column + width * 4) + pixelDiff(data, column + (height - 2) * width * 4, column + (height - 1) * width * 4)) / 2;
  }
  // Per pixel, on the 0..765 scale: a seam within 1.5× the ordinary step plus a little JPEG noise counts as continuous.
  const continuous = (seam: number, inner: number, count: number) => seam / count <= (inner / count) * 1.5 + 6;
  return { x: continuous(seamX, innerX, height), y: continuous(seamY, innerY, width) };
}

/** The model input for one tile: RGB planes (NCHW, 0..1) of (tile + 2·pad)² pixels, padded past the image edge. */
export function readTileInput(data: ArrayLike<number>, width: number, height: number, tile: SrTile, wrap: SrWrap, side = SR_TILE, pad = SR_PAD): Float32Array {
  const size = side + pad * 2;
  const plane = size * size;
  const input = new Float32Array(plane * 3);
  for (let ty = 0; ty < size; ty++) {
    const sy = edgeIndex(tile.y - pad + ty, height, wrap.y);
    for (let tx = 0; tx < size; tx++) {
      const sx = edgeIndex(tile.x - pad + tx, width, wrap.x);
      const from = (sy * width + sx) * 4;
      const to = ty * size + tx;
      input[to] = data[from] / 255;
      input[plane + to] = data[from + 1] / 255;
      input[plane * 2 + to] = data[from + 2] / 255;
    }
  }
  return input;
}

/**
 * Writes one tile of the 2× result: the model's output (RGB planes of outSide² pixels, outSide = modelScale·(tile +
 * 2·pad)) is averaged down to 2× if the model enlarged more, its padding dropped, and copied into `out` (RGBA, 2·width
 * wide). Alpha is opaque: the proposals are.
 */
export function writeTileOutput(output: ArrayLike<number>, outSide: number, out: Uint8ClampedArray, outWidth: number, tile: SrTile, pad = SR_PAD, modelScale = SR_MODEL_SCALE) {
  const ratio = modelScale / SR_OUTPUT_SCALE;
  const plane = outSide * outSide;
  const offset = pad * modelScale;
  const tw = tile.width * SR_OUTPUT_SCALE;
  const th = tile.height * SR_OUTPUT_SCALE;
  for (let y = 0; y < th; y++) {
    const oy = offset + y * ratio;
    const target = ((tile.y * SR_OUTPUT_SCALE + y) * outWidth + tile.x * SR_OUTPUT_SCALE) * 4;
    for (let x = 0; x < tw; x++) {
      const ox = offset + x * ratio;
      const i = target + x * 4;
      for (let channel = 0; channel < 3; channel++) {
        const base = channel * plane;
        let sum = 0;
        for (let dy = 0; dy < ratio; dy++) for (let dx = 0; dx < ratio; dx++) sum += output[base + (oy + dy) * outSide + ox + dx];
        out[i + channel] = Math.round((sum / (ratio * ratio)) * 255);
      }
      out[i + 3] = 255;
    }
  }
}
