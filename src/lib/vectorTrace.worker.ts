/// <reference lib="webworker" />
// Traces in a worker so a 1600px pattern (a few seconds) never freezes the page.
import initVtracer, { to_svg } from 'vtracer-wasm';
import vtracerWasmUrl from 'vtracer-wasm/vtracer.wasm?url';
import { traceWithVtracer, type VectorTraceOptions } from './vectorTrace.ts';

type Request = { requestId: number; rgba: ArrayBuffer; width: number; height: number; options: VectorTraceOptions; size: { width: number; height: number } };

// vtracer-wasm's default looks for vtracer_bg.wasm, which the package does not ship, so the URL is always given.
let ready: Promise<unknown> | null = null;
// A failed download is tried again on the next request instead of failing every later one.
const load = () => (ready ??= initVtracer({ module_or_path: vtracerWasmUrl }).catch((error) => { ready = null; throw error; }));

self.addEventListener('message', async (event: MessageEvent<Request>) => {
  const { requestId, rgba, width, height, options, size } = event.data;
  try {
    await load();
    const result = traceWithVtracer(to_svg, { width, height, data: new Uint8ClampedArray(rgba) }, options, size);
    self.postMessage({ requestId, ok: true, result });
  } catch (error) {
    // A Rust panic leaves the WebAssembly instance unusable; `fatal` makes the page start a new worker next time.
    const fatal = error instanceof WebAssembly.RuntimeError;
    self.postMessage({ requestId, ok: false, fatal, error: error instanceof Error ? error.message : 'vector_trace_failed' });
  }
});
