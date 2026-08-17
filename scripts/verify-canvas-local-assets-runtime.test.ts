import test from 'node:test';
import assert from 'node:assert/strict';
import {
  buildLocalCanvasAssetReference,
  hasLocalCanvasAsset,
  putLocalCanvasAsset,
} from '../src/lib/canvasLocalAssets.ts';

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
  private readonly onOperationComplete: () => void;

  constructor(records: Map<string, RecordValue>, onOperationComplete: () => void) {
    this.records = records;
    this.onOperationComplete = onOperationComplete;
  }

  put(value: RecordValue) {
    this.records.set(value.key, value);
    this.onOperationComplete();
    return undefined;
  }

  get(key: string) {
    const request = new FakeRequest<RecordValue | undefined>();
    queueMicrotask(() => {
      request.result = this.records.get(key);
      request.onsuccess?.({ target: request });
      this.onOperationComplete();
    });
    return request;
  }

  delete(key: string) {
    this.records.delete(key);
    this.onOperationComplete();
    return undefined;
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
    return new FakeObjectStore(this.records, () => this.complete());
  }

  complete() {
    queueMicrotask(() => this.oncomplete?.());
  }
}

class FakeDatabase {
  private readonly stores = new Map<string, Map<string, RecordValue>>();
  readonly objectStoreNames = {
    contains: (name: string) => this.stores.has(name),
  };

  createObjectStore(name: string) {
    const records = new Map<string, RecordValue>();
    this.stores.set(name, records);
    return new FakeObjectStore(records);
  }

  transaction(name: string) {
    const records = this.stores.get(name);
    if (!records) throw new Error(`fake_indexeddb_missing_store:${name}`);
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

test('local Canvas Blob survives a fresh module load and is resolved again after reload', async () => {
  const previousIndexedDb = (globalThis as { indexedDB?: unknown }).indexedDB;
  const previousCreateObjectUrl = URL.createObjectURL;
  const previousRevokeObjectUrl = URL.revokeObjectURL;
  const createdUrls: string[] = [];
  const revokedUrls: string[] = [];

  (globalThis as { indexedDB?: unknown }).indexedDB = new FakeIndexedDb();
  URL.createObjectURL = ((blob: Blob) => {
    assert.ok(blob instanceof Blob);
    const url = `blob:canvas-test-${createdUrls.length + 1}`;
    createdUrls.push(url);
    return url;
  }) as typeof URL.createObjectURL;
  URL.revokeObjectURL = ((url: string) => {
    revokedUrls.push(url);
  }) as typeof URL.revokeObjectURL;

  try {
    const revision = `sha256:${'a'.repeat(64)}`;
    const reference = buildLocalCanvasAssetReference(revision);
    await putLocalCanvasAsset(revision, new Blob([new Uint8Array([1, 2, 3])], { type: 'image/png' }));

    assert.equal(hasLocalCanvasAsset(revision), true, 'the active upload should be read back before the object is added');

    // A cache-busted import models a fresh page/module lifecycle. The new
    // module has an empty in-memory set but must still restore from IndexedDB.
    const freshModule = await import(`${new URL('../src/lib/canvasLocalAssets.ts', import.meta.url).href}?reload=${Date.now()}`);
    assert.equal(freshModule.hasLocalCanvasAsset(revision), false);

    const restored = await freshModule.resolveLocalCanvasAsset(reference);
    assert.ok(restored, 'the persisted Blob should resolve after a reload');
    assert.equal(restored.source, 'blob:canvas-test-1');
    restored.release();
    assert.deepEqual(revokedUrls, ['blob:canvas-test-1']);
    assert.deepEqual(createdUrls, ['blob:canvas-test-1']);
  } finally {
    if (previousIndexedDb === undefined) delete (globalThis as { indexedDB?: unknown }).indexedDB;
    else (globalThis as { indexedDB?: unknown }).indexedDB = previousIndexedDb;
    URL.createObjectURL = previousCreateObjectUrl;
    URL.revokeObjectURL = previousRevokeObjectUrl;
  }
});
