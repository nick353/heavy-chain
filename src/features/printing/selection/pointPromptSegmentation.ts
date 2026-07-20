export type PointPromptMaskCandidate = {
  index: number;
  predictedIou: number;
  mask: Uint8Array;
  selectedPixels: number;
  touchesFrame: boolean;
  bbox: { x: number; y: number; width: number; height: number } | null;
};

export type PreparedPointPromptSegmentation = {
  width: number;
  height: number;
  predict: (point: { x: number; y: number }) => Promise<PointPromptMaskCandidate>;
};

const MASK_LOGIT_THRESHOLD = -1;
const MIN_PREDICTED_IOU = 0.45;
const MAX_PREDICTED_IOU_GAP = 0.35;

type WorkerReply = {
  requestId: number;
  ok: boolean;
  error?: string;
  preparationId?: number;
  logits?: ArrayBuffer;
  iouPredictions?: ArrayBuffer;
};

type PendingWorkerRequest = {
  resolve: (reply: WorkerReply) => void;
  reject: (error: Error) => void;
};

let pointPromptWorker: Worker | null = null;
let nextWorkerRequestId = 1;
const pendingWorkerRequests = new Map<number, PendingWorkerRequest>();

const rejectPendingWorkerRequests = (error: Error) => {
  for (const pending of pendingWorkerRequests.values()) pending.reject(error);
  pendingWorkerRequests.clear();
};

const getPointPromptWorker = () => {
  if (pointPromptWorker) return pointPromptWorker;
  const worker = new Worker(new URL('./pointPromptSegmentation.worker.ts', import.meta.url), {
    type: 'module',
    name: 'heavy-chain-point-prompt-segmentation',
  });
  worker.addEventListener('message', (event: MessageEvent<WorkerReply>) => {
    const reply = event.data;
    const pending = pendingWorkerRequests.get(reply.requestId);
    if (!pending) return;
    pendingWorkerRequests.delete(reply.requestId);
    if (!reply.ok) {
      pending.reject(new Error(reply.error || 'point_prompt_worker_failed'));
      return;
    }
    pending.resolve(reply);
  });
  worker.addEventListener('error', () => {
    const error = new Error('point_prompt_worker_bootstrap_failed');
    rejectPendingWorkerRequests(error);
    worker.terminate();
    if (pointPromptWorker === worker) pointPromptWorker = null;
  });
  pointPromptWorker = worker;
  return worker;
};

const requestPointPromptWorker = (
  message: Record<string, unknown>,
  transfer: Transferable[] = [],
) => {
  const worker = getPointPromptWorker();
  const requestId = nextWorkerRequestId;
  nextWorkerRequestId += 1;
  return new Promise<WorkerReply>((resolve, reject) => {
    pendingWorkerRequests.set(requestId, { resolve, reject });
    worker.postMessage({ ...message, requestId }, transfer);
  });
};

export const fillEnclosedPointPromptMaskHoles = (
  mask: Uint8Array,
  width: number,
  height: number,
) => {
  if (width <= 0 || height <= 0 || mask.length !== width * height) {
    throw new Error('point_prompt_mask_shape_invalid');
  }
  const exterior = new Uint8Array(mask.length);
  const queue = new Int32Array(mask.length);
  let head = 0;
  let tail = 0;
  const addExterior = (x: number, y: number) => {
    const pixel = (y * width) + x;
    if (mask[pixel] || exterior[pixel]) return;
    exterior[pixel] = 1;
    queue[tail] = pixel;
    tail += 1;
  };
  for (let x = 0; x < width; x += 1) {
    addExterior(x, 0);
    addExterior(x, height - 1);
  }
  for (let y = 0; y < height; y += 1) {
    addExterior(0, y);
    addExterior(width - 1, y);
  }
  while (head < tail) {
    const pixel = queue[head];
    head += 1;
    const x = pixel % width;
    const y = Math.floor(pixel / width);
    if (x > 0) addExterior(x - 1, y);
    if (x + 1 < width) addExterior(x + 1, y);
    if (y > 0) addExterior(x, y - 1);
    if (y + 1 < height) addExterior(x, y + 1);
  }
  const filled = new Uint8Array(mask);
  for (let pixel = 0; pixel < filled.length; pixel += 1) {
    if (!mask[pixel] && !exterior[pixel]) filled[pixel] = 1;
  }
  return filled;
};

export const selectPointPromptCandidate = ({
  logits,
  iouPredictions,
  width,
  height,
  point,
}: {
  logits: Float32Array;
  iouPredictions: Float32Array;
  width: number;
  height: number;
  point: { x: number; y: number };
}): PointPromptMaskCandidate => {
  const planeSize = width * height;
  if (!planeSize || logits.length % planeSize !== 0) throw new Error('point_prompt_mask_shape_invalid');
  const candidateCount = logits.length / planeSize;
  const tapX = Math.max(0, Math.min(width - 1, Math.round(point.x)));
  const tapY = Math.max(0, Math.min(height - 1, Math.round(point.y)));
  const candidates: PointPromptMaskCandidate[] = [];

  for (let index = 0; index < candidateCount; index += 1) {
    const offset = index * planeSize;
    const mask = new Uint8Array(planeSize);
    let selectedPixels = 0;
    let framePixels = 0;
    let minX = width;
    let minY = height;
    let maxX = -1;
    let maxY = -1;
    for (let y = 0; y < height; y += 1) {
      for (let x = 0; x < width; x += 1) {
        const pixel = (y * width) + x;
        if (logits[offset + pixel] < MASK_LOGIT_THRESHOLD) continue;
        mask[pixel] = 1;
        selectedPixels += 1;
        minX = Math.min(minX, x);
        minY = Math.min(minY, y);
        maxX = Math.max(maxX, x);
        maxY = Math.max(maxY, y);
        if (x === 0 || y === 0 || x === width - 1 || y === height - 1) framePixels += 1;
      }
    }
    if (mask[(tapY * width) + tapX] !== 1) continue;
    candidates.push({
      index,
      predictedIou: Number(iouPredictions[index] ?? 0),
      mask,
      selectedPixels,
      touchesFrame: framePixels > 8,
      bbox: maxX >= minX && maxY >= minY
        ? { x: minX, y: minY, width: (maxX - minX) + 1, height: (maxY - minY) + 1 }
        : null,
    });
  }

  const safe = candidates.filter((candidate) => {
    const ratio = candidate.selectedPixels / planeSize;
    return ratio >= 0.02 && ratio <= 0.72 && !candidate.touchesFrame;
  });
  const credible = safe.filter((candidate) => candidate.predictedIou >= MIN_PREDICTED_IOU);
  const bestPredictedIou = Math.max(...credible.map((candidate) => candidate.predictedIou));
  // EfficientSAM emits nested alternatives. Prefer the most compact credible
  // instance within a bounded distance of the best score; this avoids a larger
  // person/pants mask winning over the tapped garment while still rejecting a
  // tiny low-score fragment.
  const selected = credible
    .filter((candidate) => bestPredictedIou - candidate.predictedIou <= MAX_PREDICTED_IOU_GAP)
    .sort((left, right) => (
      left.selectedPixels - right.selectedPixels
      || right.predictedIou - left.predictedIou
    ))[0];
  if (!selected) throw new Error(candidates.length
    ? 'point_prompt_mask_candidate_unsafe'
    : 'point_prompt_mask_candidate_missing');
  const filledMask = fillEnclosedPointPromptMaskHoles(selected.mask, width, height);
  const selectedPixels = filledMask.reduce((total, value) => total + value, 0);
  if (selectedPixels / planeSize > 0.72) throw new Error('point_prompt_mask_candidate_unsafe');
  return { ...selected, mask: filledMask, selectedPixels };
};

export const preparePointPromptSegmentation = async ({
  width,
  height,
  data,
}: {
  width: number;
  height: number;
  data: Uint8ClampedArray;
}): Promise<PreparedPointPromptSegmentation> => {
  if (width <= 0 || height <= 0 || data.length !== width * height * 4) {
    throw new Error('point_prompt_image_invalid');
  }
  const rgba = data.slice().buffer;
  const prepared = await requestPointPromptWorker({ type: 'prepare', width, height, rgba }, [rgba]);
  if (prepared.preparationId === undefined) throw new Error('point_prompt_preparation_missing');
  const preparationId = prepared.preparationId;

  return {
    width,
    height,
    predict: async (point) => {
      const decoded = await requestPointPromptWorker({
        type: 'predict',
        preparationId,
        point: { x: point.x, y: point.y },
      });
      if (!decoded.logits || !decoded.iouPredictions) {
        throw new Error('point_prompt_output_invalid');
      }
      return selectPointPromptCandidate({
        logits: new Float32Array(decoded.logits),
        iouPredictions: new Float32Array(decoded.iouPredictions),
        width,
        height,
        point,
      });
    },
  };
};
