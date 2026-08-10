/// <reference lib="webworker" />

import * as ort from 'onnxruntime-web';

import { BEN2_ONNX_PRODUCTION_MODEL_URL } from './ben2MattingRuntimeContract';

const MODEL_URL = String(
  (import.meta.env ?? {}).VITE_BEN2_ONNX_MODEL_URL || BEN2_ONNX_PRODUCTION_MODEL_URL,
).trim();
const MODEL_EDGE = 1024;

type MatteRequest = {
  requestId: number;
  width?: number;
  height?: number;
  rgba?: ArrayBuffer;
};

let sessionPromise: Promise<ort.InferenceSession> | null = null;

const createSession = async () => {
  ort.env.wasm.proxy = false;
  ort.env.wasm.numThreads = 1;
  try {
    return await ort.InferenceSession.create(MODEL_URL, {
      executionProviders: ['webgpu', 'wasm'],
    });
  } catch (webGpuError) {
    console.warn('BEN2 WebGPU session unavailable; using WASM.', webGpuError);
    return ort.InferenceSession.create(MODEL_URL, { executionProviders: ['wasm'] });
  }
};

const loadSession = () => {
  if (sessionPromise) return sessionPromise;
  sessionPromise = createSession().catch((error) => {
    sessionPromise = null;
    throw error;
  });
  return sessionPromise;
};

const clamp = (value: number, min: number, max: number) => Math.max(min, Math.min(max, value));

const resizeToNchwFloat = (rgba: Uint8ClampedArray, width: number, height: number) => {
  const planeSize = MODEL_EDGE * MODEL_EDGE;
  const output = new Float32Array(planeSize * 3);
  for (let y = 0; y < MODEL_EDGE; y += 1) {
    const sourceY = clamp(((y + 0.5) * height / MODEL_EDGE) - 0.5, 0, height - 1);
    const y0 = Math.floor(sourceY);
    const y1 = Math.min(height - 1, y0 + 1);
    const yWeight = sourceY - y0;
    for (let x = 0; x < MODEL_EDGE; x += 1) {
      const sourceX = clamp(((x + 0.5) * width / MODEL_EDGE) - 0.5, 0, width - 1);
      const x0 = Math.floor(sourceX);
      const x1 = Math.min(width - 1, x0 + 1);
      const xWeight = sourceX - x0;
      const topLeft = (y0 * width + x0) * 4;
      const topRight = (y0 * width + x1) * 4;
      const bottomLeft = (y1 * width + x0) * 4;
      const bottomRight = (y1 * width + x1) * 4;
      const pixel = y * MODEL_EDGE + x;
      for (let channel = 0; channel < 3; channel += 1) {
        const top = rgba[topLeft + channel] * (1 - xWeight) + rgba[topRight + channel] * xWeight;
        const bottom = rgba[bottomLeft + channel] * (1 - xWeight) + rgba[bottomRight + channel] * xWeight;
        output[(channel * planeSize) + pixel] = (top * (1 - yWeight) + bottom * yWeight) / 255;
      }
    }
  }
  return output;
};

const readAlpha = (tensor: ort.Tensor, width: number, height: number) => {
  const values = tensor.data;
  if (!(values instanceof Float32Array) || values.length < 1) throw new Error('ben2_alpha_output_invalid');
  let min = Number.POSITIVE_INFINITY;
  let max = Number.NEGATIVE_INFINITY;
  for (const value of values) {
    min = Math.min(min, value);
    max = Math.max(max, value);
  }
  const range = max - min;
  const normalized = (value: number) => range > 1e-6 ? (value - min) / range : value > min ? 1 : 0;
  const sourceHeight = Number(tensor.dims.at(-2) || MODEL_EDGE);
  const sourceWidth = Number(tensor.dims.at(-1) || MODEL_EDGE);
  const source = new Float32Array(sourceWidth * sourceHeight);
  for (let y = 0; y < sourceHeight; y += 1) {
    for (let x = 0; x < sourceWidth; x += 1) {
      source[(y * sourceWidth) + x] = normalized(values[(y * sourceWidth) + x] ?? 0);
    }
  }
  const alpha = new Uint8Array(width * height);
  for (let y = 0; y < height; y += 1) {
    const sourceY = clamp(((y + 0.5) * sourceHeight / height) - 0.5, 0, sourceHeight - 1);
    const y0 = Math.floor(sourceY);
    const y1 = Math.min(sourceHeight - 1, y0 + 1);
    const yWeight = sourceY - y0;
    for (let x = 0; x < width; x += 1) {
      const sourceX = clamp(((x + 0.5) * sourceWidth / width) - 0.5, 0, sourceWidth - 1);
      const x0 = Math.floor(sourceX);
      const x1 = Math.min(sourceWidth - 1, x0 + 1);
      const xWeight = sourceX - x0;
      const top = source[(y0 * sourceWidth) + x0] * (1 - xWeight)
        + source[(y0 * sourceWidth) + x1] * xWeight;
      const bottom = source[(y1 * sourceWidth) + x0] * (1 - xWeight)
        + source[(y1 * sourceWidth) + x1] * xWeight;
      alpha[(y * width) + x] = Math.round(255 * (top * (1 - yWeight) + bottom * yWeight));
    }
  }
  return alpha;
};

const replyError = (requestId: number, error: unknown) => {
  const message = error instanceof Error ? error.message : String(error);
  self.postMessage({ requestId, ok: false, error: message });
};

self.addEventListener('message', (event: MessageEvent<MatteRequest>) => {
  const request = event.data;
  void (async () => {
    if (!request.width || !request.height || !request.rgba) throw new Error('ben2_image_invalid');
    if (request.rgba.byteLength !== request.width * request.height * 4) throw new Error('ben2_image_shape_invalid');
    const session = await loadSession();
    const inputName = session.inputNames[0];
    if (!inputName) throw new Error('ben2_input_missing');
    const result = await session.run({
      [inputName]: new ort.Tensor(
        'float32',
        resizeToNchwFloat(new Uint8ClampedArray(request.rgba), request.width, request.height),
        [1, 3, MODEL_EDGE, MODEL_EDGE],
      ),
    });
    const output = result[session.outputNames[0]];
    if (!output) throw new Error('ben2_output_missing');
    const alpha = readAlpha(output, request.width, request.height);
    self.postMessage({ requestId: request.requestId, ok: true, alpha: alpha.buffer }, [alpha.buffer]);
  })().catch((error) => replyError(request.requestId, error));
});

export {};
