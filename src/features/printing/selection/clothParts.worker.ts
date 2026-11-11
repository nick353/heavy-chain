/// <reference lib="webworker" />

import * as ort from 'onnxruntime-web';
import { CLOTH_PARTS_INPUT_SIDE, clothPartsClassMap, clothPartsInputTensorData } from './clothPartsMath';

/**
 * Light's AIマスク認識 analyses the garment on its server in about three seconds and lists only the parts it found.
 * Heavy runs the same cloth model (rembg u2net_cloth_seg) here, off the UI thread: one inference returns every part
 * (1 = トップス, 2 = ボトムス, 3 = 全身), so the editor can list the found parts and apply one instantly.
 * Before 2026-11-11 the model ran on the page thread, was downloaded again for every request (bypassModelCache)
 * and ran once per part; the page froze for about a minute on each AIマスク認識.
 */

const CACHE_NAME = 'heavy-cloth-parts-model-v1';

type Request = {
  requestId: number;
  modelUrl: string;
  modelSha256: string;
  /** RGBA of the garment already resized to CLOTH_PARTS_INPUT_SIDE square on the page. */
  rgba: ArrayBuffer;
};

let sessionPromise: Promise<ort.InferenceSession> | null = null;
let sessionKey = '';

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
  const key = `${modelUrl}#${sha256}`;
  if (sessionPromise && sessionKey === key) return sessionPromise;
  // Emitted by Vite as a module worker: inference is already off the UI thread, so no ORT proxy worker.
  ort.env.wasm.proxy = false;
  ort.env.wasm.numThreads = 1;
  sessionKey = key;
  sessionPromise = loadModelBytes(modelUrl, sha256)
    .then((bytes) => ort.InferenceSession.create(new Uint8Array(bytes), { executionProviders: ['wasm'] }))
    .catch((error) => { sessionPromise = null; sessionKey = ''; throw error; });
  return sessionPromise;
};

self.addEventListener('message', (event: MessageEvent<Request>) => {
  const request = event.data;
  void (async () => {
    const rgba = new Uint8ClampedArray(request.rgba);
    const session = await loadSession(request.modelUrl, request.modelSha256);
    const input = new ort.Tensor('float32', clothPartsInputTensorData(rgba), [1, 3, CLOTH_PARTS_INPUT_SIDE, CLOTH_PARTS_INPUT_SIDE]);
    const outputs = await session.run({ [session.inputNames[0]]: input });
    const output = outputs[session.outputNames[0]];
    if (!output || !(output.data instanceof Float32Array) || output.dims.length !== 4) throw new Error('cloth_parts_output_invalid');
    const map = clothPartsClassMap(output.data, Number(output.dims[1]));
    self.postMessage({ requestId: request.requestId, ok: true, classMap: map.buffer }, [map.buffer]);
  })().catch((error) => {
    self.postMessage({ requestId: request.requestId, ok: false, error: error instanceof Error ? error.message : String(error) });
  });
});

export {};
