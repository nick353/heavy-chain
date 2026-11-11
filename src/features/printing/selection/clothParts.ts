import { REMBG_CLOTH_SEG_MODEL_SHA256, resolveRembgClothSegModelUrl } from './clothModelRuntimeContract';
import { CLOTH_PARTS, CLOTH_PARTS_INPUT_SIDE, clothPartMaskRgba, foundClothParts, type ClothPartLabel } from './clothPartsMath';

export type { ClothPartLabel } from './clothPartsMath';

export type ClothPartsAnalysis = {
  /** Parts found in the garment, in Light's order (トップス, ボトムス, 全身). */
  found: ClothPartLabel[];
  /** The part as a mask canvas of the given size: opaque where the part is, soft at the edge. */
  maskFor(label: ClothPartLabel, size: { width: number; height: number }): HTMLCanvasElement;
};

type Reply = { requestId: number; ok: boolean; error?: string; classMap?: ArrayBuffer };

const modelUrl = () => resolveRembgClothSegModelUrl({
  configuredUrl: import.meta.env?.VITE_REMBG_CLOTH_SEG_MODEL_URL,
  isProduction: Boolean(import.meta.env?.PROD),
});

export const isClothPartsModelConfigured = () => Boolean(modelUrl());

let worker: Worker | null = null;
let nextRequestId = 1;
const pending = new Map<number, { resolve: (reply: Reply) => void; reject: (error: Error) => void }>();

const getWorker = () => {
  if (worker) return worker;
  const created = new Worker(new URL('./clothParts.worker.ts', import.meta.url), { type: 'module', name: 'heavy-chain-cloth-parts' });
  created.addEventListener('message', (event: MessageEvent<Reply>) => {
    const entry = pending.get(event.data.requestId);
    if (!entry) return;
    pending.delete(event.data.requestId);
    if (event.data.ok) entry.resolve(event.data); else entry.reject(new Error(event.data.error || 'cloth_parts_failed'));
  });
  created.addEventListener('error', () => {
    for (const entry of pending.values()) entry.reject(new Error('cloth_parts_worker_failed'));
    pending.clear();
    created.terminate();
    if (worker === created) worker = null;
  });
  worker = created;
  return created;
};

const loadImage = (url: string) => new Promise<HTMLImageElement>((resolve, reject) => {
  const image = new Image();
  if (/^https?:\/\//i.test(url)) image.crossOrigin = 'anonymous';
  image.onload = () => resolve(image);
  image.onerror = () => reject(new Error('cloth_parts_image_load_failed'));
  image.src = url;
});

const canvasOf = (width: number, height: number) => {
  const canvas = document.createElement('canvas');
  canvas.width = width; canvas.height = height;
  const context = canvas.getContext('2d', { willReadFrequently: true });
  if (!context) throw new Error('cloth_parts_canvas_unavailable');
  context.imageSmoothingEnabled = true; context.imageSmoothingQuality = 'high';
  return { canvas, context };
};

const analyses = new Map<string, Promise<ClothPartsAnalysis>>();

/**
 * Runs the cloth model once per garment image (cached by URL) in a worker. The editor starts this as soon as it
 * opens, so AIマスク認識 can list the found parts at once, like Light.
 */
export function analyzeClothParts(imageUrl: string): Promise<ClothPartsAnalysis> {
  const cached = analyses.get(imageUrl);
  if (cached) return cached;
  const run = (async (): Promise<ClothPartsAnalysis> => {
    const url = modelUrl();
    if (!url) throw new Error('cloth_parts_model_unconfigured');
    const image = await loadImage(imageUrl);
    const input = canvasOf(CLOTH_PARTS_INPUT_SIDE, CLOTH_PARTS_INPUT_SIDE);
    input.context.drawImage(image, 0, 0, CLOTH_PARTS_INPUT_SIDE, CLOTH_PARTS_INPUT_SIDE);
    const rgba = input.context.getImageData(0, 0, CLOTH_PARTS_INPUT_SIDE, CLOTH_PARTS_INPUT_SIDE).data;
    const requestId = nextRequestId++;
    const reply = await new Promise<Reply>((resolve, reject) => {
      pending.set(requestId, { resolve, reject });
      getWorker().postMessage({ requestId, modelUrl: url, modelSha256: REMBG_CLOTH_SEG_MODEL_SHA256, rgba: rgba.buffer }, [rgba.buffer]);
    });
    if (!reply.classMap) throw new Error('cloth_parts_output_invalid');
    const classMap = new Uint8Array(reply.classMap);
    const found = foundClothParts(classMap);
    const small = new Map<ClothPartLabel, HTMLCanvasElement>();
    const partCanvas = (label: ClothPartLabel) => {
      const existing = small.get(label);
      if (existing) return existing;
      const part = CLOTH_PARTS.find((item) => item.label === label);
      if (!part) throw new Error('cloth_parts_label_unknown');
      const target = canvasOf(CLOTH_PARTS_INPUT_SIDE, CLOTH_PARTS_INPUT_SIDE);
      target.context.putImageData(new ImageData(clothPartMaskRgba(classMap, part.classIndex), CLOTH_PARTS_INPUT_SIDE, CLOTH_PARTS_INPUT_SIDE), 0, 0);
      small.set(label, target.canvas);
      return target.canvas;
    };
    return {
      found,
      maskFor(label, size) {
        const out = canvasOf(size.width, size.height);
        out.context.drawImage(partCanvas(label), 0, 0, size.width, size.height);
        return out.canvas;
      },
    };
  })();
  analyses.set(imageUrl, run);
  run.catch(() => { if (analyses.get(imageUrl) === run) analyses.delete(imageUrl); });
  return run;
}
