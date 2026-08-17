import assert from 'node:assert/strict';
import test from 'node:test';
import { persistPrintInputState } from '../src/lib/printInputPersistence.ts';

type RecordValue = { key: string; blob: Blob; createdAt: string };

class FakeRequest<T = unknown> {
  result!: T;
  error: Error | null = null;
  onsuccess: ((event: unknown) => void) | null = null;
  onerror: ((event: unknown) => void) | null = null;
  onupgradeneeded: ((event: unknown) => void) | null = null;
}

class FakeObjectStore {
  private readonly records: Map<string, RecordValue>;
  private readonly complete: () => void;

  constructor(
    records: Map<string, RecordValue>,
    complete: () => void = () => undefined,
  ) {
    this.records = records;
    this.complete = complete;
  }

  put(value: RecordValue) {
    this.records.set(value.key, value);
    this.complete();
  }

  get(key: string) {
    const request = new FakeRequest<RecordValue | undefined>();
    queueMicrotask(() => {
      request.result = this.records.get(key);
      request.onsuccess?.({ target: request });
      this.complete();
    });
    return request;
  }

  delete(key: string) {
    this.records.delete(key);
    this.complete();
  }
}

class FakeTransaction {
  oncomplete: (() => void) | null = null;
  onerror: ((event: unknown) => void) | null = null;
  private readonly records: Map<string, RecordValue>;

  constructor(records: Map<string, RecordValue>) {
    this.records = records;
  }

  objectStore() {
    return new FakeObjectStore(this.records, () => queueMicrotask(() => this.oncomplete?.()));
  }
}

class FakeDatabase {
  private readonly stores = new Map<string, Map<string, RecordValue>>();
  readonly objectStoreNames = { contains: (name: string) => this.stores.has(name) };

  createObjectStore(name: string) {
    const records = new Map<string, RecordValue>();
    this.stores.set(name, records);
    return new FakeObjectStore(records);
  }

  transaction(name: string) {
    const records = this.stores.get(name);
    if (!records) throw new Error(`missing_store:${name}`);
    return new FakeTransaction(records);
  }

  close() {}
}

class FakeIndexedDb {
  private readonly databases = new Map<string, FakeDatabase>();

  open(name: string) {
    const request = new FakeRequest<FakeDatabase>();
    queueMicrotask(() => {
      let database = this.databases.get(name);
      if (!database) {
        database = new FakeDatabase();
        this.databases.set(name, database);
        request.result = database;
        request.onupgradeneeded?.({ target: request });
      } else {
        request.result = database;
      }
      request.onsuccess?.({ target: request });
    });
    return request;
  }
}

class FakeFileReader {
  result: string | null = null;
  onload: (() => void) | null = null;
  onerror: (() => void) | null = null;

  readAsDataURL(blob: Blob) {
    void blob.arrayBuffer().then((buffer) => {
      const bytes = Buffer.from(buffer).toString('base64');
      this.result = `data:${blob.type || 'application/octet-stream'};base64,${bytes}`;
      this.onload?.();
    }).catch(() => this.onerror?.());
  }
}

const sourceUrl = 'data:text/plain;base64,c291cmNl';
const processedUrl = 'data:text/plain;base64,cHJvY2Vzc2Vk';
const cutoutResult = {
  dataUrl: processedUrl,
  bounds: { x: 0, y: 0, width: 10, height: 10 },
  sourceSize: { width: 10, height: 10 },
  outputSize: { width: 10, height: 10 },
  dataUrlBytes: processedUrl.length,
  storagePolicy: 'bounded-local-canvas-data-url-v1' as const,
  engine: 'browser-canvas-geometric-mask-v1' as const,
  hasTransparentPixels: true,
};

test('print input cutouts and candidates survive a fresh module restore without localStorage image bytes', async () => {
  const previousIndexedDb = (globalThis as { indexedDB?: unknown }).indexedDB;
  const previousWindow = (globalThis as { window?: unknown }).window;
  const previousFileReader = (globalThis as { FileReader?: unknown }).FileReader;
  const localStorage = new Map<string, string>();
  (globalThis as { indexedDB?: unknown }).indexedDB = new FakeIndexedDb();
  (globalThis as { FileReader?: unknown }).FileReader = FakeFileReader;
  (globalThis as { window?: unknown }).window = {
    localStorage: {
      getItem: (key: string) => localStorage.get(key) ?? null,
      setItem: (key: string, value: string) => localStorage.set(key, value),
    },
  };
  try {
    await persistPrintInputState(
      'brand-runtime',
      { url: sourceUrl, referenceType: 'base' },
      [{ url: sourceUrl, referenceType: 'pattern' }],
      {
        garment: {
          processedUrl,
          processedResult: cutoutResult,
          maskCandidates: [{
            candidateId: 'auto',
            label: '自動（推奨）',
            description: 'runtime candidate',
            result: cutoutResult,
          }],
          selectedMaskCandidateId: 'auto',
          maskRevision: 2,
          maskExplicitlyConfirmed: true,
          selectionSource: 'automatic',
          segmentationTarget: 'upper',
        },
        designs: [{ processedUrl, processedResult: cutoutResult, maskRevision: 1 }],
      },
    );

    const metadata = localStorage.get('heavy-chain-print-inputs:v1:brand-runtime');
    assert.ok(metadata);
    assert.doesNotMatch(metadata, /cHJvY2Vzc2Vk/);

    const freshModule = await import(`${new URL('../src/lib/printInputPersistence.ts', import.meta.url).href}?reload=${Date.now()}`);
    const restored = await freshModule.restorePrintInputState('brand-runtime');
    assert.equal(restored.garment?.processedUrl, processedUrl);
    assert.equal(restored.garment?.processedResult?.dataUrl, processedUrl);
    assert.equal(restored.garment?.maskCandidates?.[0]?.result.dataUrl, processedUrl);
    assert.equal(restored.garment?.selectedMaskCandidateId, 'auto');
    assert.equal(restored.garment?.maskRevision, 2);
    assert.equal(restored.designs[0]?.processedUrl, processedUrl);
    assert.equal(restored.designs[0]?.processedResult?.dataUrl, processedUrl);
  } finally {
    if (previousIndexedDb === undefined) delete (globalThis as { indexedDB?: unknown }).indexedDB;
    else (globalThis as { indexedDB?: unknown }).indexedDB = previousIndexedDb;
    if (previousWindow === undefined) delete (globalThis as { window?: unknown }).window;
    else (globalThis as { window?: unknown }).window = previousWindow;
    if (previousFileReader === undefined) delete (globalThis as { FileReader?: unknown }).FileReader;
    else (globalThis as { FileReader?: unknown }).FileReader = previousFileReader;
  }
});
