/// <reference lib="webworker" />
// Runs Real-ESRGAN tile by tile in a worker so a 1696×2528 proposal never freezes the page. See superResolution.ts.
import * as ort from 'onnxruntime-web';
import { pickSrModel, readTileInput, seamlessAxes, SR_MODEL_SCALE, SR_OUTPUT_SCALE, SR_PAD, SR_TILE, tilePlan, writeTileOutput, type SrModelUrls } from './superResolution.ts';

type Request = { requestId: number; rgba: ArrayBuffer; width: number; height: number; models: SrModelUrls };
type Gpu = { requestAdapter: () => Promise<{ features: { has: (feature: string) => boolean } } | null> };

let session: Promise<{ session: ort.InferenceSession; model: string }> | null = null;

// WebGPU only: on the CPU (WASM) a 1696×2528 proposal would take minutes, so without a GPU the page keeps the plain
// enlargement instead.
const createSession = async (models: SrModelUrls) => {
  const adapter = await (navigator as Navigator & { gpu?: Gpu }).gpu?.requestAdapter();
  if (!adapter) throw new Error('super_resolution_webgpu_unavailable');
  const model = pickSrModel(models, adapter.features.has('shader-f16'));
  ort.env.wasm.proxy = false;
  ort.env.wasm.numThreads = 1;
  return { session: await ort.InferenceSession.create(model, { executionProviders: ['webgpu'] }), model };
};

// A failed load is tried again on the next request instead of failing every later one.
const load = (models: SrModelUrls) => (session ??= createSession(models).catch((error) => { session = null; throw error; }));

self.addEventListener('message', async (event: MessageEvent<Request>) => {
  const { requestId, rgba, width, height, models } = event.data;
  try {
    const { session: model, model: modelUrl } = await load(models);
    const data = new Uint8ClampedArray(rgba);
    const wrap = seamlessAxes(data, width, height);
    const outWidth = width * SR_OUTPUT_SCALE;
    const out = new Uint8ClampedArray(outWidth * height * SR_OUTPUT_SCALE * 4);
    const tiles = tilePlan(width, height);
    const side = SR_TILE + SR_PAD * 2;
    const started = performance.now();
    for (let index = 0; index < tiles.length; index++) {
      const input = new ort.Tensor('float32', readTileInput(data, width, height, tiles[index], wrap), [1, 3, side, side]);
      const result = await model.run({ [model.inputNames[0]]: input });
      const output = result[model.outputNames[0]];
      writeTileOutput(output.data as Float32Array, side * SR_MODEL_SCALE, out, outWidth, tiles[index]);
      input.dispose(); output.dispose();
      self.postMessage({ requestId, progress: (index + 1) / tiles.length });
    }
    self.postMessage({ requestId, ok: true, rgba: out.buffer, width: outWidth, height: height * SR_OUTPUT_SCALE, model: modelUrl, wrap, ms: Math.round(performance.now() - started) }, [out.buffer]);
  } catch (error) {
    self.postMessage({ requestId, ok: false, error: error instanceof Error ? error.message : 'super_resolution_failed' });
  }
});
