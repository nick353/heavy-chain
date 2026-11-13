import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import * as ort from 'onnxruntime-web';
import { canSuperResolve, edgeIndex, pickSrModel, readTileInput, seamlessAxes, SR_MODEL_SCALE, SR_OUTPUT_SCALE, tilePlan, writeTileOutput, type SrWrap } from '../src/lib/superResolution.ts';
import { doubleSizeImageUrl, SR_MODELS } from '../src/lib/superResolutionClient.ts';

// AIグラフィックデザイン's 「2倍の大きさ」 was a canvas resample plus sharpening (2026-11-13: edges soft, JPEG halos enlarged).
// Now Real-ESRGAN (realesr-animevideov3, BSD-3-Clause) runs tile by tile in a worker on WebGPU. Here the same graph
// runs on the CPU (onnxruntime-web's WASM backend) with small tiles, so the tiling itself is what is tested.

ort.env.wasm.numThreads = 1;
const FP32 = 'public/assets/realesr-animevideov3-x2.onnx';
const FP16 = 'public/assets/realesr-animevideov3-x2-fp16.onnx';
const sessions = new Map<string, Promise<ort.InferenceSession>>();
const session = (file: string) => {
  if (!sessions.has(file)) sessions.set(file, ort.InferenceSession.create(new Uint8Array(readFileSync(file)), { executionProviders: ['wasm'] }));
  return sessions.get(file)!;
};

/** A soft periodic pattern (wraps on both axes): blobs of colour on a light ground. */
function periodic(width: number, height: number) {
  const data = new Uint8ClampedArray(width * height * 4);
  for (let y = 0; y < height; y++) for (let x = 0; x < width; x++) {
    const a = Math.sin((2 * Math.PI * x) / width * 2) * Math.cos((2 * Math.PI * y) / height * 3);
    const b = Math.sin(2 * Math.PI * ((3 * x) / width + (2 * y) / height));
    const i = (y * width + x) * 4;
    data[i] = 200 + 50 * a; data[i + 1] = 150 + 90 * b; data[i + 2] = a > 0.4 ? 60 : 230; data[i + 3] = 255;
  }
  return data;
}

/** A pattern that does not wrap: a ramp with a hard stripe. */
function ramp(width: number, height: number) {
  const data = new Uint8ClampedArray(width * height * 4);
  for (let y = 0; y < height; y++) for (let x = 0; x < width; x++) {
    const i = (y * width + x) * 4;
    data[i] = (x * 255) / width; data[i + 1] = (y * 255) / height; data[i + 2] = x % 40 < 6 ? 20 : 220; data[i + 3] = 255;
  }
  return data;
}

async function superResolveTiled(file: string, data: Uint8ClampedArray, width: number, height: number, side: number, pad: number, wrap: SrWrap) {
  const model = await session(file);
  const outWidth = width * SR_OUTPUT_SCALE;
  const out = new Uint8ClampedArray(outWidth * height * SR_OUTPUT_SCALE * 4);
  for (const tile of tilePlan(width, height, side)) {
    const size = side + pad * 2;
    const result = await model.run({ [model.inputNames[0]]: new ort.Tensor('float32', readTileInput(data, width, height, tile, wrap, side, pad), [1, 3, size, size]) });
    const output = result[model.outputNames[0]];
    assert.deepEqual(output.dims, [1, 3, size * SR_MODEL_SCALE, size * SR_MODEL_SCALE]);
    writeTileOutput(output.data as Float32Array, size * SR_MODEL_SCALE, out, outWidth, tile, pad);
  }
  return out;
}

const pixelDiff = (a: Uint8ClampedArray, i: number, j: number) => Math.abs(a[i] - a[j]) + Math.abs(a[i + 1] - a[j + 1]) + Math.abs(a[i + 2] - a[j + 2]);

test('the model files are our own copies, pinned, and the page never loads a model from another site', () => {
  const sha = (file: string) => createHash('sha256').update(readFileSync(file)).digest('hex');
  assert.equal(sha(FP32), '87d99db1c9912c43265196433137466de32b4e80aa410544fa4748876bbafec8');
  assert.equal(sha(FP16), '3f24fbded73c878b3a66018181796e6b088aaa33935ab79e2ce0339cb1ab3bd7');
  assert.deepEqual(SR_MODELS, { fp16: '/assets/realesr-animevideov3-x2-fp16.onnx', fp32: '/assets/realesr-animevideov3-x2.onnx' });
  for (const file of ['src/lib/superResolution.ts', 'src/lib/superResolution.worker.ts', 'src/lib/superResolutionClient.ts']) {
    assert.doesNotMatch(readFileSync(file, 'utf8'), /https?:\/\/(?!127\.)/, file);
  }
  assert.equal(pickSrModel(SR_MODELS, true), SR_MODELS.fp16);
  assert.equal(pickSrModel(SR_MODELS, false), SR_MODELS.fp32);
});

test('the graph doubles the size, and half precision matches full precision', async () => {
  const width = 48; const height = 48;
  const data = ramp(width, height);
  const input = readTileInput(data, width, height, { x: 0, y: 0, width, height }, { x: false, y: false }, width, 0);
  const run = async (file: string) => {
    const model = await session(file);
    const output = (await model.run({ [model.inputNames[0]]: new ort.Tensor('float32', input, [1, 3, height, width]) }))[model.outputNames[0]];
    assert.deepEqual(output.dims, [1, 3, height * 2, width * 2]);
    return output.data as Float32Array;
  };
  const full = await run(FP32); const half = await run(FP16);
  let max = 0;
  for (let i = 0; i < full.length; i++) max = Math.max(max, Math.abs(full[i] - half[i]));
  assert.ok(max < 0.01, `fp16 differs by ${max}`);
});

test('tiles meet without a seam: the tiled result matches one run over the whole image away from its edge', async () => {
  const width = 160; const height = 96;
  const data = ramp(width, height);
  const wrap = { x: false, y: false };
  const tiled = await superResolveTiled(FP32, data, width, height, 64, 16, wrap);
  const whole = await superResolveTiled(FP32, data, width, height, 160, 16, wrap); // one tile covers it all
  const outWidth = width * 2;
  let boundary = 0; let count = 0;
  for (let y = 8; y < height * 2 - 8; y++) for (const x of [127, 128, 255, 256]) { // output columns at the input tile edges 64 and 128
    const i = (y * outWidth + x) * 4;
    boundary = Math.max(boundary, Math.abs(tiled[i] - whole[i]) + Math.abs(tiled[i + 1] - whole[i + 1]) + Math.abs(tiled[i + 2] - whole[i + 2]));
    count++;
  }
  assert.ok(count > 0);
  assert.ok(boundary <= 6, `tile edge differs from the untiled run by ${boundary}`);
});

test('a repeat (総柄) stays a repeat after enlarging: the context wraps around instead of mirroring', async () => {
  const width = 128; const height = 96;
  const data = periodic(width, height);
  assert.deepEqual(seamlessAxes(data, width, height), { x: true, y: true });
  assert.deepEqual(seamlessAxes(ramp(width, height), width, height), { x: false, y: false });
  const seam = (out: Uint8ClampedArray) => {
    const w = width * 2; const h = height * 2;
    let across = 0; let inner = 0;
    for (let y = 0; y < h; y++) { across += pixelDiff(out, (y * w + w - 1) * 4, y * w * 4); inner += pixelDiff(out, (y * w + w / 2 - 1) * 4, (y * w + w / 2) * 4); }
    return { across: across / h, inner: inner / h };
  };
  const wrapped = seam(await superResolveTiled(FP32, data, width, height, 64, 16, { x: true, y: true }));
  assert.ok(wrapped.across <= wrapped.inner * 1.5 + 3, `wrapped seam ${JSON.stringify(wrapped)}`);
  const mirrored = seam(await superResolveTiled(FP32, data, width, height, 64, 16, { x: false, y: false }));
  assert.ok(mirrored.across > wrapped.across, `mirroring should not beat wrapping: ${JSON.stringify({ wrapped, mirrored })}`);
});

test('edge pixels are mirrored or wrapped, tiles cover the image once, and a 4× output is averaged down to 2×', () => {
  assert.deepEqual([-2, -1, 0, 4, 5, 6].map((i) => edgeIndex(i, 5, false)), [2, 1, 0, 4, 3, 2]);
  assert.deepEqual([-2, -1, 0, 4, 5, 6].map((i) => edgeIndex(i, 5, true)), [3, 4, 0, 4, 0, 1]);
  const tiles = tilePlan(300, 130, 128);
  assert.equal(tiles.reduce((sum, tile) => sum + tile.width * tile.height, 0), 300 * 130);
  assert.deepEqual(tiles.at(-1), { x: 256, y: 128, width: 44, height: 2 });
  // One 1×1 tile, no padding, a 4× model: the 4×4 output block becomes a 2×2 block of 2×2 averages.
  const outSide = 4; const plane = outSide * outSide;
  const output = new Float32Array(plane * 3);
  for (let i = 0; i < plane; i++) { output[i] = (i % 4) < 2 ? 0 : 1; output[plane + i] = 0.5; output[plane * 2 + i] = i < 8 ? 1 : 0; }
  const out = new Uint8ClampedArray(2 * 2 * 4);
  writeTileOutput(output, outSide, out, 2, { x: 0, y: 0, width: 1, height: 1 }, 0, 4);
  assert.deepEqual(Array.from(out), [0, 128, 255, 255, 255, 128, 255, 255, 0, 128, 0, 255, 255, 128, 0, 255]);
  assert.equal(canSuperResolve(1696, 2528), true);
  assert.equal(canSuperResolve(3392, 5056), false);
});

test('「2倍の大きさ」 falls back to the plain enlargement on a failure, but not when the user cancels', async () => {
  const calls: string[] = [];
  const plain = async (url: string) => { calls.push(`plain:${url}`); return 'data:plain'; };
  const ok = await doubleSizeImageUrl('a.png', { maxEdge: 6144 }, { superResolve: async () => ({ url: 'blob:sr', width: 2, height: 2, model: 'm', ms: 1 }), plain });
  assert.deepEqual(ok, { url: 'blob:sr', method: 'super-resolution' });
  const failed = await doubleSizeImageUrl('b.png', { maxEdge: 6144 }, { superResolve: async () => { throw new Error('super_resolution_webgpu_unavailable'); }, plain });
  assert.deepEqual(failed, { url: 'data:plain', method: 'plain' });
  const controller = new AbortController(); controller.abort();
  await assert.rejects(doubleSizeImageUrl('c.png', { maxEdge: 6144, signal: controller.signal }, { superResolve: async () => { throw new DOMException('super_resolution_cancelled', 'AbortError'); }, plain }), { name: 'AbortError' });
  assert.deepEqual(calls, ['plain:b.png']);
});

test('the result view saves 2倍 through the super-resolution with a progress count and a cancel', () => {
  const view = readFileSync('src/components/lightchain/GraphicResultView.tsx', 'utf8');
  assert.match(view, /doubleSizeImageUrl\(selected\.image_url/);
  assert.match(view, /高画質で2倍に \{Math\.round\(doubleProgress \* 100\)\}%/);
  assert.match(view, /doubleAbort\.current\?\.abort\(\)\}[^>]*>取り消す</);
  assert.doesNotMatch(view, /upscaleImage\(/);
});
