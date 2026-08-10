export type Ben2MattingInput = {
  rgba: Uint8ClampedArray;
  width: number;
  height: number;
};

type WorkerReply = {
  requestId: number;
  ok: boolean;
  error?: string;
  alpha?: ArrayBuffer;
};

type Pending = {
  resolve: (reply: WorkerReply) => void;
  reject: (error: Error) => void;
};

let worker: Worker | null = null;
let nextRequestId = 1;
const pending = new Map<number, Pending>();

const rejectPending = (error: Error) => {
  for (const item of pending.values()) item.reject(error);
  pending.clear();
};

const getWorker = () => {
  if (worker) return worker;
  const nextWorker = new Worker(new URL('./ben2Matting.worker.ts', import.meta.url), {
    type: 'module',
    name: 'heavy-chain-ben2-matting',
  });
  nextWorker.addEventListener('message', (event: MessageEvent<WorkerReply>) => {
    const reply = event.data;
    const item = pending.get(reply.requestId);
    if (!item) return;
    pending.delete(reply.requestId);
    if (!reply.ok) {
      item.reject(new Error(reply.error || 'ben2_worker_failed'));
      return;
    }
    item.resolve(reply);
  });
  nextWorker.addEventListener('error', () => {
    const error = new Error('ben2_worker_bootstrap_failed');
    rejectPending(error);
    nextWorker.terminate();
    if (worker === nextWorker) worker = null;
  });
  worker = nextWorker;
  return nextWorker;
};

export const runBen2Matting = async ({ rgba, width, height }: Ben2MattingInput) => {
  if (!Number.isSafeInteger(width) || !Number.isSafeInteger(height) || width <= 0 || height <= 0) {
    throw new Error('ben2_image_dimensions_invalid');
  }
  if (rgba.length !== width * height * 4) throw new Error('ben2_image_rgba_invalid');
  const requestId = nextRequestId;
  nextRequestId += 1;
  const request = new Promise<WorkerReply>((resolve, reject) => {
    pending.set(requestId, { resolve, reject });
    getWorker().postMessage({ requestId, width, height, rgba: rgba.buffer }, [rgba.buffer]);
  });
  const reply = await request;
  if (!reply.alpha) throw new Error('ben2_alpha_missing');
  return new Uint8Array(reply.alpha);
};
