// Browser side of the vector tracing: reads the image, hands its pixels to the worker and saves the SVG.
import { isLineArt } from './rasterToSvg.ts';
import { traceSide, type VectorTraceOptions, type VectorTraceResult } from './vectorTrace.ts';

type Reply = { requestId: number; ok: true; result: VectorTraceResult } | { requestId: number; ok: false; fatal?: boolean; error?: string };

const TRACE_TIMEOUT_MS = 90_000;
let worker: Worker | null = null;
let nextRequestId = 1;
const pending = new Map<number, { resolve: (result: VectorTraceResult) => void; reject: (error: Error) => void; timer: number }>();

const dropWorker = (reason: string) => {
  worker?.terminate();
  worker = null;
  for (const entry of pending.values()) { window.clearTimeout(entry.timer); entry.reject(new Error(reason)); }
  pending.clear();
};

const getWorker = () => {
  if (worker) return worker;
  const created = new Worker(new URL('./vectorTrace.worker.ts', import.meta.url), { type: 'module', name: 'heavy-chain-vector-trace' });
  created.addEventListener('message', (event: MessageEvent<Reply>) => {
    const reply = event.data;
    const entry = pending.get(reply.requestId);
    if (!entry) return;
    pending.delete(reply.requestId);
    window.clearTimeout(entry.timer);
    if (reply.ok) { entry.resolve(reply.result); return; }
    entry.reject(new Error(reply.error || 'vector_trace_failed'));
    if (reply.fatal && worker === created) dropWorker('vector_trace_worker_reset');
  });
  created.addEventListener('error', () => { if (worker === created) dropWorker('vector_trace_worker_failed'); });
  worker = created;
  return created;
};

/** The image's pixels with the long edge at most `side` (fetched, so another origin's image never taints the canvas). */
async function readImagePixels(url: string, side: number) {
  const response = await fetch(url, { credentials: 'omit' });
  if (!response.ok) throw new Error('vector_trace_source_unavailable');
  const bitmap = await createImageBitmap(await response.blob());
  try {
    const scale = Math.min(1, side / Math.max(bitmap.width, bitmap.height));
    const canvas = document.createElement('canvas');
    canvas.width = Math.max(1, Math.round(bitmap.width * scale));
    canvas.height = Math.max(1, Math.round(bitmap.height * scale));
    const context = canvas.getContext('2d', { willReadFrequently: true });
    if (!context) throw new Error('vector_trace_canvas_unavailable');
    context.imageSmoothingEnabled = true; context.imageSmoothingQuality = 'high';
    context.drawImage(bitmap, 0, 0, canvas.width, canvas.height);
    return { image: context.getImageData(0, 0, canvas.width, canvas.height), size: { width: bitmap.width, height: bitmap.height } };
  } finally { bitmap.close(); }
}

/**
 * Traces an image into a vector SVG. `lineArt` left out means "decide from the image" (the ベクター化 tools get 平絵 as
 * well as colour prints); the AIグラフィックデザイン results pass false.
 */
export async function traceImageUrlToVector(url: string, options: Omit<VectorTraceOptions, 'lineArt'> & { lineArt?: boolean }): Promise<VectorTraceResult> {
  let read = await readImagePixels(url, traceSide({ ...options, lineArt: false }));
  const lineArt = options.lineArt ?? isLineArt(read.image);
  if (lineArt && traceSide({ ...options, lineArt }) > Math.max(read.image.width, read.image.height) && Math.max(read.size.width, read.size.height) > Math.max(read.image.width, read.image.height)) read = await readImagePixels(url, traceSide({ ...options, lineArt }));
  const pixels = read.image;
  const requestId = nextRequestId++;
  return await new Promise<VectorTraceResult>((resolve, reject) => {
    const timer = window.setTimeout(() => { if (pending.delete(requestId)) { reject(new Error('vector_trace_timeout')); dropWorker('vector_trace_timeout'); } }, TRACE_TIMEOUT_MS);
    pending.set(requestId, { resolve, reject, timer });
    const rgba = pixels.data.buffer;
    getWorker().postMessage({ requestId, rgba, width: pixels.width, height: pixels.height, options: { colors: options.colors, detail: options.detail, lineArt }, size: read.size }, [rgba]);
  });
}

/** Saves an SVG as a file (kept as vector data: the image download path would turn it into a PNG). */
export function saveSvgFile(svg: string, fileName: string) {
  const url = URL.createObjectURL(new Blob([svg], { type: 'image/svg+xml' }));
  const anchor = document.createElement('a');
  anchor.href = url;
  anchor.download = fileName.endsWith('.svg') ? fileName : `${fileName}.svg`;
  document.body.appendChild(anchor);
  try { anchor.click(); } finally {
    anchor.remove();
    window.setTimeout(() => URL.revokeObjectURL(url), 5000);
  }
}
