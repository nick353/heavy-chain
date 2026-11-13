// Page side of the super-resolution: reads the image, hands its pixels to the worker and turns the result into a PNG.
import { upscaleImage } from './clientImageOps.ts';
import { canSuperResolve, type SrModelUrls } from './superResolution.ts';

/** Our own copies (public/assets), never a CDN: Real-ESRGAN realesr-animevideov3 v0.2.5.0 (BSD-3-Clause) + 2×2 average. */
export const SR_MODELS: SrModelUrls = { fp16: '/assets/realesr-animevideov3-x2-fp16.onnx', fp32: '/assets/realesr-animevideov3-x2.onnx' };
/** Past this the page gives up and the caller falls back to the plain enlargement. */
const SR_TIMEOUT_MS = 240_000;

type Reply =
  | { requestId: number; progress: number }
  | { requestId: number; ok: true; rgba: ArrayBuffer; width: number; height: number; model: string; ms: number }
  | { requestId: number; ok: false; error?: string };

export type SuperResolveResult = { url: string; width: number; height: number; model: string; ms: number };

let worker: Worker | null = null;
let nextRequestId = 1;

const getWorker = () => (worker ??= new Worker(new URL('./superResolution.worker.ts', import.meta.url), { type: 'module', name: 'heavy-chain-super-resolution' }));
// Cancelling or timing out stops the GPU work at once; the next request starts a new worker (the model loads again, ~1 s).
const dropWorker = () => { worker?.terminate(); worker = null; };

async function readPixels(url: string) {
  const response = await fetch(url, { credentials: 'omit' });
  if (!response.ok) throw new Error('super_resolution_source_unavailable');
  const bitmap = await createImageBitmap(await response.blob());
  try {
    if (!canSuperResolve(bitmap.width, bitmap.height)) throw new Error('super_resolution_too_large');
    const canvas = document.createElement('canvas');
    canvas.width = bitmap.width; canvas.height = bitmap.height;
    const context = canvas.getContext('2d', { willReadFrequently: true });
    if (!context) throw new Error('super_resolution_canvas_unavailable');
    context.drawImage(bitmap, 0, 0);
    return context.getImageData(0, 0, canvas.width, canvas.height);
  } finally { bitmap.close(); }
}

async function toPngUrl(rgba: ArrayBuffer, width: number, height: number) {
  const canvas = document.createElement('canvas');
  canvas.width = width; canvas.height = height;
  const context = canvas.getContext('2d');
  if (!context) throw new Error('super_resolution_canvas_unavailable');
  context.putImageData(new ImageData(new Uint8ClampedArray(rgba), width, height), 0, 0);
  const blob = await new Promise<Blob | null>((resolve) => canvas.toBlob(resolve, 'image/png'));
  canvas.width = 0; canvas.height = 0;
  if (!blob) throw new Error('super_resolution_encode_failed');
  return URL.createObjectURL(blob);
}

const abortError = () => new DOMException('super_resolution_cancelled', 'AbortError');

/**
 * Enlarges an image 2× with Real-ESRGAN in a worker. Resolves to a blob: URL of a PNG (the caller revokes it). Rejects
 * with an AbortError when `signal` aborts, and with an Error on anything else, so the caller can fall back.
 */
export async function superResolveImageUrl(url: string, options: { signal?: AbortSignal; onProgress?: (progress: number) => void } = {}): Promise<SuperResolveResult> {
  const { signal, onProgress } = options;
  if (signal?.aborted) throw abortError();
  const pixels = await readPixels(url);
  if (signal?.aborted) throw abortError();
  const requestId = nextRequestId++;
  const current = getWorker();
  const reply = await new Promise<Extract<Reply, { ok: true }>>((resolve, reject) => {
    const finish = () => { window.clearTimeout(timer); current.removeEventListener('message', onMessage); current.removeEventListener('error', onError); signal?.removeEventListener('abort', onAbort); };
    const fail = (error: Error) => { finish(); dropWorker(); reject(error); };
    const onMessage = (event: MessageEvent<Reply>) => {
      const data = event.data;
      if (data.requestId !== requestId) return;
      if ('progress' in data) { onProgress?.(data.progress); return; }
      if (data.ok) { finish(); resolve(data); return; }
      fail(new Error(data.error || 'super_resolution_failed'));
    };
    const onError = () => fail(new Error('super_resolution_worker_failed'));
    const onAbort = () => fail(abortError());
    const timer = window.setTimeout(() => fail(new Error('super_resolution_timeout')), SR_TIMEOUT_MS);
    current.addEventListener('message', onMessage);
    current.addEventListener('error', onError);
    signal?.addEventListener('abort', onAbort, { once: true });
    const rgba = pixels.data.buffer;
    current.postMessage({ requestId, rgba, width: pixels.width, height: pixels.height, models: SR_MODELS }, [rgba]);
  });
  return { url: await toPngUrl(reply.rgba, reply.width, reply.height), width: reply.width, height: reply.height, model: reply.model, ms: reply.ms };
}

type DoubleSizeDeps = {
  superResolve: typeof superResolveImageUrl;
  plain: (url: string) => Promise<string>;
};

/**
 * 「2倍の大きさ」: super-resolution first; on any failure other than the user's cancel (no WebGPU, the model did not
 * load, the timeout, a too-large image) the plain enlargement, so the download still happens. `method` says which ran.
 */
export async function doubleSizeImageUrl(url: string, options: { signal?: AbortSignal; onProgress?: (progress: number) => void; maxEdge: number },
  deps: DoubleSizeDeps = { superResolve: superResolveImageUrl, plain: (source) => upscaleImage(source, { scale: 2, sharpness: 40, denoiseLevel: 0, maxEdge: options.maxEdge }) },
): Promise<{ url: string; method: 'super-resolution' | 'plain' }> {
  try {
    return { url: (await deps.superResolve(url, options)).url, method: 'super-resolution' };
  } catch (error) {
    if (options.signal?.aborted || (error instanceof DOMException && error.name === 'AbortError')) throw error;
    console.warn('Super-resolution unavailable; using the plain enlargement.', error);
    return { url: await deps.plain(url), method: 'plain' };
  }
}
