/// <reference lib="webworker" />

// The WebGPU build (it includes the WASM backend too): the default bundle ran WebGPU requests at WASM speed (50 s, 2026-11-11).
import * as ort from 'onnxruntime-web/webgpu';
import { CLOTH_PARTS_INPUT_SIDE, clothPartsClassMap, clothPartsInputTensorData } from './clothPartsMath';

/**
 * Light's AIマスク認識 analyses the garment on its server in about three seconds and lists only the parts it found.
 * Heavy runs the same cloth model (rembg u2net_cloth_seg) here, off the UI thread: one inference returns every part
 * (1 = トップス, 2 = ボトムス, 3 = 全身), so the editor can list the found parts and apply one instantly.
 * Before 2026-11-11 the model ran on the page thread, was downloaded again for every request (bypassModelCache)
 * and ran once per part; the page froze for about a minute on each AIマスク認識.
 * Measured on heavychain.app the same day: in this worker the single-threaded WASM backend took over 75 s per
 * inference (119 s for the first request), WebGPU 6 s warm and about 24 s cold, so WebGPU runs first and WASM is the
 * fallback when the browser has no WebGPU or the GPU run fails.
 */

const CACHE_NAME = 'heavy-cloth-parts-model-v1';

type Request = {
  requestId: number;
  modelUrl: string;
  modelSha256: string;
  /** RGBA of the garment already resized to CLOTH_PARTS_INPUT_SIDE square on the page; absent for a warm-up. */
  rgba?: ArrayBuffer;
  /** Build the session and compile the GPU kernels now (one blank inference), so the first real request is fast. */
  warm?: boolean;
};

let sessionPromise: Promise<ort.InferenceSession> | null = null;
let sessionKey = '';
/** Set once a WebGPU session failed to build or run; later requests go straight to WASM. */
let gpuFailed = false;
const hasWebGpu = () => !gpuFailed && typeof navigator !== 'undefined' && 'gpu' in navigator && Boolean((navigator as Navigator & { gpu?: unknown }).gpu);

const hex = (buffer: ArrayBuffer) => Array.from(new Uint8Array(buffer), (byte) => byte.toString(16).padStart(2, '0')).join('');
const verified = async (bytes: ArrayBuffer, sha256: string) => hex(await crypto.subtle.digest('SHA-256', bytes)) === sha256;

/** The model is fetched once and kept in Cache Storage; every read is checked against the pinned SHA-256. */
const loadModelBytes = async (modelUrl: string, sha256: string) => {
  let cache: Cache | null = null;
  try { cache = await caches.open(CACHE_NAME); } catch { cache = null; }
  const cached = cache ? await cache.match(modelUrl) : undefined;
  if (cached) {
    const bytes = await cached.arrayBuffer();
    if (await verified(bytes, sha256)) return bytes;
    await cache?.delete(modelUrl);
  }
  const response = await fetch(modelUrl);
  if (!response.ok) throw new Error(`cloth_parts_model_fetch_failed:${response.status}`);
  const bytes = await response.arrayBuffer();
  if (!(await verified(bytes, sha256))) throw new Error('cloth_parts_model_hash_mismatch');
  try { await cache?.put(modelUrl, new Response(bytes.slice(0), { headers: { 'content-type': 'application/octet-stream' } })); } catch { /* storage full: keep working without the cache */ }
  return bytes;
};

const loadSession = (modelUrl: string, sha256: string) => {
  const gpu = hasWebGpu();
  const key = `${modelUrl}#${sha256}#${gpu ? 'webgpu' : 'wasm'}`;
  if (sessionPromise && sessionKey === key) return sessionPromise;
  // Emitted by Vite as a module worker: inference is already off the UI thread, so no ORT proxy worker.
  ort.env.wasm.proxy = false;
  ort.env.wasm.numThreads = 1;
  sessionKey = key;
  sessionPromise = loadModelBytes(modelUrl, sha256)
    .then(async (bytes) => {
      if (gpu) {
        try { return await ort.InferenceSession.create(new Uint8Array(bytes), { executionProviders: ['webgpu'] }); }
        catch { gpuFailed = true; sessionKey = `${modelUrl}#${sha256}#wasm`; }
      }
      return ort.InferenceSession.create(new Uint8Array(bytes), { executionProviders: ['wasm'] });
    })
    .catch((error) => { sessionPromise = null; sessionKey = ''; throw error; });
  return sessionPromise;
};

/** One inference at a time: the warm-up and a real request can arrive together, and a session runs one call at once. */
let runQueue: Promise<unknown> = Promise.resolve();
const classMapFor = (request: Request, rgba: Uint8ClampedArray) => {
  const run = runQueue.then(() => classMapNow(request, rgba));
  runQueue = run.catch(() => undefined);
  return run;
};
const classMapNow = async (request: Request, rgba: Uint8ClampedArray) => {
  const session = await loadSession(request.modelUrl, request.modelSha256);
  const input = new ort.Tensor('float32', clothPartsInputTensorData(rgba), [1, 3, CLOTH_PARTS_INPUT_SIDE, CLOTH_PARTS_INPUT_SIDE]);
  const outputs = await session.run({ [session.inputNames[0]]: input });
  const output = outputs[session.outputNames[0]];
  if (!output || !(output.data instanceof Float32Array) || output.dims.length !== 4) throw new Error('cloth_parts_output_invalid');
  return clothPartsClassMap(output.data, Number(output.dims[1]));
};

/**
 * Light answers AIマスク認識 in about three seconds from its server. Here the first WebGPU inference compiles its kernels
 * (about 18 s measured 2026-11-11) and later ones take about 5 s, so the print page warms the session up when it opens.
 * Only on WebGPU: a WASM warm-up would keep a phone's CPU busy for a minute for an editor that may never open.
 */
const warmUp = async (request: Request) => {
  if (!hasWebGpu()) return;
  await classMapFor(request, new Uint8ClampedArray(CLOTH_PARTS_INPUT_SIDE * CLOTH_PARTS_INPUT_SIDE * 4));
};

self.addEventListener('message', (event: MessageEvent<Request>) => {
  const request = event.data;
  if (request.warm) {
    void warmUp(request).then(
      () => self.postMessage({ requestId: request.requestId, ok: true }),
      () => self.postMessage({ requestId: request.requestId, ok: true, warmFailed: true }),
    );
    return;
  }
  void (async () => {
    if (!request.rgba) throw new Error('cloth_parts_input_missing');
    const rgba = new Uint8ClampedArray(request.rgba);
    let map: Uint8Array;
    try { map = await classMapFor(request, rgba); }
    catch (error) {
      // A GPU run can fail after the session was built (lost device, unsupported kernel): retry once on WASM.
      if (!sessionKey.endsWith('#webgpu')) throw error;
      gpuFailed = true; sessionPromise = null; sessionKey = '';
      map = await classMapFor(request, rgba);
    }
    self.postMessage({ requestId: request.requestId, ok: true, classMap: map.buffer }, [map.buffer]);
  })().catch((error) => {
    self.postMessage({ requestId: request.requestId, ok: false, error: error instanceof Error ? error.message : String(error) });
  });
});

export {};
