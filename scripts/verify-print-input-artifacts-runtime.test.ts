import assert from 'node:assert/strict';
import test from 'node:test';
import { persistPrintInputState, restorePrintInputState, printInputScopeKey, validatePrintInputEditorState, type PrintInputEditorState } from '../src/lib/printInputPersistence.ts';

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
  records() { return [...this.stores.values()].flatMap(store => [...store.values()]); }
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
  records() { return [...this.databases.values()].flatMap(database => database.records()); }
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

const withStorage = async (run: (storage: Map<string, string>, db: FakeIndexedDb, browser: { localStorage: { getItem: (key: string) => string | null; setItem: (key: string, value: string) => void } }) => Promise<void>) => {
  const previous = { indexedDB: globalThis.indexedDB, window: globalThis.window, FileReader: globalThis.FileReader };
  const storage = new Map<string, string>(), db = new FakeIndexedDb();
  const browser = { localStorage: { getItem: (key: string) => storage.get(key) ?? null,
    setItem: (key: string, value: string) => { storage.set(key, value); } } };
  Object.assign(globalThis, { indexedDB: db, window: browser, FileReader: FakeFileReader });
  try { await run(storage, db, browser); }
  finally { for (const [key, value] of Object.entries(previous)) {
    if (value === undefined) delete (globalThis as Record<string, unknown>)[key];
    else (globalThis as Record<string, unknown>)[key] = value;
  } }
};
const scope = { origin: 'https://print-api.test', userId: 'owner' }, brandId = 'same-brand';
const editor: PrintInputEditorState = { version: 1, coverageMode: 'spot', outputScale: 2, placementConfirmed: true, printableSurfaceEnabled: false,
  layers: [4, 2, 0, 5, 1, 3].map((designIndex, order) => ({ designIndex, layerId: `print-design-${designIndex + 1}`,
    transform: { x: 30 + order * 5, y: 42 + order * 3, scale: 0.45 + order / 10, rotation: order * 17 - 24, opacity: 0.5 + order / 10, flipX: order % 2 === 0, flipY: order % 3 === 0 } })) };
const designs = Array.from({ length: 6 }, (_, index) => ({ url: `data:text/plain;base64,${Buffer.from('design-' + index).toString('base64')}`, referenceType: 'pattern' as const }));
const processedState = { garment: { processedUrl, processedResult: cutoutResult, maskRevision: 3 },
  designs: designs.map(() => ({ processedUrl, processedResult: cutoutResult, maskRevision: 7 })) };

test('Cloudflare scoped snapshot restores all six transformed layers and never adopts brand-only or foreign data', () => withStorage(async storage => {
  await persistPrintInputState(brandId, { url: sourceUrl, referenceType: 'base' }, [], processedState);
  assert.deepEqual(await restorePrintInputState(brandId, { scope }), { garment: null, designs: [] });
  await persistPrintInputState(brandId, { url: sourceUrl, referenceType: 'base' }, designs, processedState, { scope, editorState: editor });
  const restored = await restorePrintInputState(brandId, { scope });
  assert.deepEqual(restored.editorState, editor);
  assert.deepEqual(restored.designs.map(design => design.url), designs.map(design => design.url));
  assert.equal(restored.garment?.processedResult?.dataUrl, processedUrl);
  assert(restored.designs.every(design => design.maskRevision === 7));
  assert.deepEqual(await restorePrintInputState(brandId, { scope: { ...scope, userId: 'foreign' } }), { garment: null, designs: [] });
  assert.deepEqual(await restorePrintInputState(brandId, { scope: { ...scope, origin: 'https://other-api.test' } }), { garment: null, designs: [] });
  assert.deepEqual(await restorePrintInputState('foreign-brand', { scope }), { garment: null, designs: [] });
  const raw = storage.get('heavy-chain-print-inputs:v1:' + printInputScopeKey(brandId, scope))!;
  assert.doesNotMatch(raw, /data:|cHJvY2Vzc2Vk|c291cmNl/);
  assert(storage.has('heavy-chain-print-inputs:v1:' + brandId), 'legacy metadata was not removed');
}));

test('failed context or localStorage commit leaves previous bytes and layout intact and removes only the uncommitted revision', () => withStorage(async (storage, db, browser) => {
  await persistPrintInputState(brandId, { url: sourceUrl, referenceType: 'base' }, designs, processedState, { scope, editorState: editor });
  const before = [...storage], keys = db.records().map(record => record.key).sort();
  let assertions = 0;
  await assert.rejects(persistPrintInputState(brandId, { url: processedUrl, referenceType: 'base' }, designs, processedState,
    { scope, editorState: { ...editor, outputScale: 1 }, assertContext: () => { if (++assertions === 3) throw new Error('fixture_context_changed'); } }), /fixture_context_changed/);
  assert.deepEqual([...storage], before);
  assert.deepEqual(db.records().map(record => record.key).sort(), keys);
  const put = browser.localStorage.setItem;
  browser.localStorage.setItem = () => { throw new Error('fixture_storage_quota'); };
  await assert.rejects(persistPrintInputState(brandId, null, designs, processedState, { scope, editorState: editor }), /fixture_storage_quota/);
  browser.localStorage.setItem = put;
  assert.deepEqual([...storage], before);
  assert.deepEqual(db.records().map(record => record.key).sort(), keys);
  assert.equal((await restorePrintInputState(brandId, { scope })).garment?.url, sourceUrl);
}));

test('tampered snapshot scope or foreign asset reference is rejected before any foreign bytes are restored or cleaned', () => withStorage(async (storage, db) => {
  await persistPrintInputState(brandId, { url: sourceUrl, referenceType: 'base' }, designs, processedState, { scope, editorState: editor });
  const key = 'heavy-chain-print-inputs:v1:' + printInputScopeKey(brandId, scope), raw = storage.get(key)!;
  const originalKeys = db.records().map(record => record.key).sort();
  storage.set(key, JSON.stringify({ ...JSON.parse(raw), scopeKey: 'foreign' }));
  await assert.rejects(restorePrintInputState(brandId, { scope }), /scope_mismatch/);
  await assert.rejects(persistPrintInputState(brandId, null, [], { designs: [] }, { scope }), /scope_mismatch/);
  const edited = JSON.parse(raw); edited.images[0].processed.result.dataUrlAssetRef = 'local-print-input://foreign%3Agarment%3A0';
  storage.set(key, JSON.stringify(edited));
  await assert.rejects(restorePrintInputState(brandId, { scope }), /snapshot_invalid/);
  assert.deepEqual(db.records().map(record => record.key).sort(), originalKeys);
  await persistPrintInputState(brandId, null, [], { designs: [] }, { scope, replaceUnreadableSnapshot: true });
  assert.deepEqual(await restorePrintInputState(brandId, { scope }), { garment: null, designs: [] });
  assert.deepEqual(db.records().map(record => record.key).sort(), originalKeys, 'explicit Clear does not guess corrupt asset targets');
}));

test('manual printable and occluder planes persist as native Blob assets, not localStorage data URLs', () => withStorage(async storage => {
  const plane = { width: 10, height: 10, format: 'png' as const, dataUrl: processedUrl, contentHash: 'sha256:plane' as const };
  const manual = { provenance: 'manual-printable-area' as const, plane, occluder: { ...plane, dataUrl: sourceUrl },
    identity: { version: 'garment-surface-map-v1' as const, sourceHash: 'sha256:source' as const, contentHash: 'sha256:plane' as const, manualRevision: 5, status: 'manual-ready' as const } };
  const value = { ...editor, printableSurfaceEnabled: true, manualPrintableSurface: manual } as PrintInputEditorState;
  await persistPrintInputState(brandId, { url: sourceUrl, referenceType: 'base' }, designs, processedState, { scope, editorState: value });
  assert.deepEqual((await restorePrintInputState(brandId, { scope })).editorState, value);
  assert([...storage.values()].every(raw => !raw.includes('data:')));
}));

test('layout validation rejects omissions, duplicate identities, invalid opacity and non-finite transforms', () => {
  assert.deepEqual(validatePrintInputEditorState(editor, 6), editor);
  assert.throws(() => validatePrintInputEditorState({ ...editor, layers: editor.layers.slice(1) }, 6), /editor_state_invalid/);
  assert.throws(() => validatePrintInputEditorState({ ...editor, layers: [...editor.layers.slice(1), editor.layers[1]] }, 6), /editor_state_invalid/);
  for (const transform of [{ opacity: -1 }, { x: NaN }, { scale: 0 }, { flipY: 'yes' }]) {
    const layers = editor.layers.map((layer, index) => index === 0 ? { ...layer, transform: { ...layer.transform, ...transform } } : layer) as typeof editor.layers;
    assert.throws(() => validatePrintInputEditorState({ ...editor, layers }, 6), /editor_state_invalid/);
  }
  assert.throws(() => printInputScopeKey(brandId, { ...scope, origin: 'https://user:pass@print-api.test' }), /scope_invalid/);
});
