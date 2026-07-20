/// <reference lib="webworker" />

import * as ort from 'onnxruntime-web';

const EFFICIENT_SAM_REVISION = 'd525f622e6f640acf5a0fc37c7ca1f243da5bde0';
const DEFAULT_ENCODER_URL = `https://raw.githubusercontent.com/yformer/EfficientSAM/${EFFICIENT_SAM_REVISION}/weights/efficient_sam_vitt_encoder.onnx`;
const DEFAULT_DECODER_URL = `https://raw.githubusercontent.com/yformer/EfficientSAM/${EFFICIENT_SAM_REVISION}/weights/efficient_sam_vitt_decoder.onnx`;
const pointPromptEnv = import.meta.env ?? {};
const encoderUrl = String(pointPromptEnv.VITE_EFFICIENT_SAM_ENCODER_URL || DEFAULT_ENCODER_URL).trim();
const decoderUrl = String(pointPromptEnv.VITE_EFFICIENT_SAM_DECODER_URL || DEFAULT_DECODER_URL).trim();

type PreparedEmbedding = {
  id: number;
  width: number;
  height: number;
  tensor: ort.Tensor;
};

type WorkerRequest = {
  requestId: number;
  type: 'prepare' | 'predict';
  width?: number;
  height?: number;
  rgba?: ArrayBuffer;
  preparationId?: number;
  point?: { x: number; y: number };
};

let sessionsPromise: Promise<{ encoder: ort.InferenceSession; decoder: ort.InferenceSession }> | null = null;
let nextPreparationId = 1;
let preparedEmbedding: PreparedEmbedding | null = null;

const loadSessions = () => {
  if (sessionsPromise) return sessionsPromise;
  // This file is emitted by Vite as a real module worker. Do not enable ORT's
  // Blob-backed proxy worker inside it; inference is already off the UI thread.
  ort.env.wasm.proxy = false;
  ort.env.wasm.numThreads = 1;
  sessionsPromise = Promise.all([
    ort.InferenceSession.create(encoderUrl, { executionProviders: ['wasm'] }),
    ort.InferenceSession.create(decoderUrl, { executionProviders: ['wasm'] }),
  ])
    .then(([encoder, decoder]) => ({ encoder, decoder }))
    .catch((error) => {
      sessionsPromise = null;
      throw error;
    });
  return sessionsPromise;
};

const toNchwFloat = (data: Uint8ClampedArray, width: number, height: number) => {
  const planeSize = width * height;
  const output = new Float32Array(planeSize * 3);
  for (let pixel = 0; pixel < planeSize; pixel += 1) {
    const source = pixel * 4;
    output[pixel] = data[source] / 255;
    output[planeSize + pixel] = data[source + 1] / 255;
    output[(planeSize * 2) + pixel] = data[source + 2] / 255;
  }
  return output;
};

const replyError = (requestId: number, error: unknown) => {
  const message = error instanceof Error ? error.message : String(error);
  self.postMessage({ requestId, ok: false, error: message });
};

self.addEventListener('message', (event: MessageEvent<WorkerRequest>) => {
  const request = event.data;
  void (async () => {
    if (request.type === 'prepare') {
      const { width, height, rgba } = request;
      if (!width || !height || !rgba || rgba.byteLength !== width * height * 4) {
        throw new Error('point_prompt_image_invalid');
      }
      const { encoder } = await loadSessions();
      const encoded = await encoder.run({
        batched_images: new ort.Tensor(
          'float32',
          toNchwFloat(new Uint8ClampedArray(rgba), width, height),
          [1, 3, height, width],
        ),
      });
      const tensor = encoded.image_embeddings;
      if (!tensor) throw new Error('point_prompt_embedding_missing');
      const id = nextPreparationId;
      nextPreparationId += 1;
      preparedEmbedding = { id, width, height, tensor };
      self.postMessage({ requestId: request.requestId, ok: true, preparationId: id });
      return;
    }

    const { preparationId, point } = request;
    const prepared = preparedEmbedding;
    if (!prepared || prepared.id !== preparationId) throw new Error('point_prompt_preparation_stale');
    if (!point || !Number.isFinite(point.x) || !Number.isFinite(point.y)) {
      throw new Error('point_prompt_point_invalid');
    }
    const { decoder } = await loadSessions();
    const decoded = await decoder.run({
      image_embeddings: prepared.tensor,
      batched_point_coords: new ort.Tensor('float32', new Float32Array([point.x, point.y]), [1, 1, 1, 2]),
      batched_point_labels: new ort.Tensor('float32', new Float32Array([1]), [1, 1, 1]),
      orig_im_size: new ort.Tensor(
        'int64',
        new BigInt64Array([BigInt(prepared.height), BigInt(prepared.width)]),
        [2],
      ),
    });
    const logits = decoded.output_masks?.data;
    const iouPredictions = decoded.iou_predictions?.data;
    if (!(logits instanceof Float32Array) || !(iouPredictions instanceof Float32Array)) {
      throw new Error('point_prompt_output_invalid');
    }
    self.postMessage(
      {
        requestId: request.requestId,
        ok: true,
        logits: logits.buffer,
        iouPredictions: iouPredictions.buffer,
      },
      [logits.buffer, iouPredictions.buffer],
    );
  })().catch((error) => replyError(request.requestId, error));
});

export {};
