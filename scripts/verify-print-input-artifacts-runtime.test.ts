import assert from 'node:assert/strict';
import test from 'node:test';
import { persistPrintInputState, restorePrintInputState, updatePrintInputCoverage, printInputScopeKey, validatePrintInputEditorState, createPrintDraftSafetyCopy, inspectPrintDraftSafetyCopy, restorePrintDraftSafetyCopy, type PrintInputEditorState } from '../src/lib/printInputPersistence.ts';

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

// Coverage is a metadata-only edit on the actual scoped persistence module.
test('coverage-only update keeps all six layers, processed sources, masks and manual surface Blob bytes',()=>withStorage(async(storage,db)=>{
 const plane={width:10,height:10,format:'png' as const,dataUrl:processedUrl,contentHash:'sha256:plane' as const};
 const manual={provenance:'manual-printable-area' as const,plane,occluder:{...plane,dataUrl:sourceUrl},identity:{version:'garment-surface-map-v1' as const,sourceHash:'sha256:source' as const,contentHash:'sha256:plane' as const,manualRevision:5,status:'manual-ready' as const}};
 const value={...editor,printableSurfaceEnabled:true,manualPrintableSurface:manual} as PrintInputEditorState;
 const processed={...processedState,garment:{...processedState.garment,maskCandidates:[{candidateId:'auto',label:'auto',description:'actual candidate',result:cutoutResult}],selectedMaskCandidateId:'auto',maskExplicitlyConfirmed:true}};
 await persistPrintInputState(brandId,{url:sourceUrl,referenceType:'base'},designs,processed,{scope,editorState:value});
 const key='heavy-chain-print-inputs:v1:'+printInputScopeKey(brandId,scope),before=JSON.parse(storage.get(key)!);
 const bytes=await Promise.all(db.records().map(async r=>[r.key,r.blob.type,Buffer.from(await r.blob.arrayBuffer()).toString('base64')]));
 await updatePrintInputCoverage(brandId,'full',{scope});
 const after=JSON.parse(storage.get(key)!);assert.deepEqual(after,{...before,editorState:{...before.editorState,coverageMode:'full'}});
 assert.deepEqual(await Promise.all(db.records().map(async r=>[r.key,r.blob.type,Buffer.from(await r.blob.arrayBuffer()).toString('base64')])),bytes);
 const fresh=await import(`${new URL('../src/lib/printInputPersistence.ts',import.meta.url).href}?coverage=${crypto.randomUUID()}`);
 const restored=await fresh.restorePrintInputState(brandId,{scope});assert.deepEqual(restored.editorState,{...value,coverageMode:'full'});assert.deepEqual(restored.designs.map(d=>d.url),designs.map(d=>d.url));assert.equal(restored.garment?.maskCandidates?.[0].result.dataUrl,processedUrl);
}));
test('unchanged coverage preserves the exact serialized snapshot and creates no storage writes',()=>withStorage(async(storage,db,browser)=>{
 await persistPrintInputState(brandId,{url:sourceUrl,referenceType:'base'},designs,processedState,{scope,editorState:editor});
 const before=[...storage],keys=db.records().map(r=>r.key);let writes=0;const put=browser.localStorage.setItem;browser.localStorage.setItem=(k,v)=>{writes++;put(k,v);};
 await updatePrintInputCoverage(brandId,'spot',{scope});assert.equal(writes,0);assert.deepEqual([...storage],before);assert.deepEqual(db.records().map(r=>r.key),keys);
}));
test('coverage update follows a pending full save and changes its latest snapshot rather than old source bytes',()=>withStorage(async(storage)=>{
 await persistPrintInputState(brandId,{url:sourceUrl,referenceType:'base'},designs,processedState,{scope,editorState:editor});
 const saving=persistPrintInputState(brandId,{url:processedUrl,referenceType:'base'},designs,processedState,{scope,editorState:editor});
 const editing=updatePrintInputCoverage(brandId,'full',{scope});await Promise.all([saving,editing]);
 const restored=await restorePrintInputState(brandId,{scope});assert.equal(restored.garment?.url,processedUrl);assert.deepEqual(restored.editorState,{...editor,coverageMode:'full'});assert.equal(restored.designs.length,6);
}));
test('coverage-only missing, foreign and corrupted snapshots cannot be replaced or delete assets',()=>withStorage(async(storage,db)=>{
 await persistPrintInputState(brandId,{url:sourceUrl,referenceType:'base'},designs,processedState,{scope,editorState:editor});const before=[...storage],keys=db.records().map(r=>r.key).sort();
 for(const target of [{...scope,userId:'other'},{...scope,origin:'https://other.test'}])await assert.rejects(updatePrintInputCoverage(brandId,'full',{scope:target}),/editor_state_unavailable/);assert.deepEqual([...storage],before);
 const key='heavy-chain-print-inputs:v1:'+printInputScopeKey(brandId,scope);const corrupted={...JSON.parse(storage.get(key)!),scopeKey:'foreign'};storage.set(key,JSON.stringify(corrupted));await assert.rejects(updatePrintInputCoverage(brandId,'full',{scope}),/scope_mismatch/);assert.equal(storage.get(key),JSON.stringify(corrupted));assert.deepEqual(db.records().map(r=>r.key).sort(),keys);
}));
test('failed coverage commit and revoked context retain snapshot bytes; a later authorized update recovers',()=>withStorage(async(storage,db,browser)=>{
 await persistPrintInputState(brandId,{url:sourceUrl,referenceType:'base'},designs,processedState,{scope,editorState:editor});const before=[...storage],keys=db.records().map(r=>r.key).sort();
 const put=browser.localStorage.setItem;browser.localStorage.setItem=()=>{throw Error('quota');};await assert.rejects(updatePrintInputCoverage(brandId,'full',{scope}),/quota/);browser.localStorage.setItem=put;
 let calls=0;await assert.rejects(updatePrintInputCoverage(brandId,'full',{scope,assertContext:()=>{if(++calls===2)throw Error('revoked');}}),/revoked/);assert.deepEqual([...storage],before);assert.deepEqual(db.records().map(r=>r.key).sort(),keys);
 await updatePrintInputCoverage(brandId,'full',{scope});assert.equal((await restorePrintInputState(brandId,{scope})).editorState?.coverageMode,'full');
}));

const safetyOptions = { scope, assertContext: () => undefined };
test('independent safety copy restores exact metadata and all raw, processed, mask and manual surface bytes after revision deletion', () => withStorage(async (storage, db) => {
  const plane = { width: 10, height: 10, format: 'png' as const, dataUrl: processedUrl, contentHash: 'sha256:plane' as const };
  const value = { ...editor, printableSurfaceEnabled: true, manualPrintableSurface: { provenance: 'manual-printable-area' as const, plane,
    occluder: { ...plane, dataUrl: sourceUrl }, identity: { version: 'garment-surface-map-v1' as const, sourceHash: 'sha256:source' as const, contentHash: 'sha256:plane' as const, manualRevision: 5, status: 'manual-ready' as const } } };
  const processed = { ...processedState, garment: { ...processedState.garment, maskCandidates: [{ candidateId: 'auto', label: 'auto', description: 'real mask', result: cutoutResult }], selectedMaskCandidateId: 'auto', maskExplicitlyConfirmed: true } };
  await persistPrintInputState(brandId, { url: sourceUrl, referenceType: 'base', fromGallery: true, galleryImageId: 'original', storagePath: 'generated-images/original' }, designs, processed, { scope, editorState: value });
  const key = 'heavy-chain-print-inputs:v1:' + printInputScopeKey(brandId, scope), original = storage.get(key);
  const bytes = await Promise.all(db.records().map(async row => [row.key, row.blob.type, Buffer.from(await row.blob.arrayBuffer()).toString('base64')]));
  await createPrintDraftSafetyCopy(brandId, safetyOptions);
  assert.equal(storage.get(key), original, 'copy does not change the active snapshot');
  const copy = await inspectPrintDraftSafetyCopy(brandId, safetyOptions);
  assert.equal(copy.copy.rawMetadata, original); assert.equal(copy.copy.metadataSha256, copy.current.metadataSha256);
  await persistPrintInputState(brandId, { url: processedUrl, referenceType: 'base' }, [], { designs: [] }, { scope });
  assert(bytes.every(([assetKey]) => !db.records().some(row => row.key === assetKey)), 'ordinary save actually removed every old revision asset');
  const fresh = await import(`${new URL('../src/lib/printInputPersistence.ts', import.meta.url).href}?safety=${crypto.randomUUID()}`);
  await fresh.restorePrintDraftSafetyCopy(brandId, safetyOptions);
  assert.equal(storage.get(key), original);
  assert.deepEqual(await Promise.all(db.records().filter(row => !row.key.includes(':safety:')).map(async row => [row.key, row.blob.type, Buffer.from(await row.blob.arrayBuffer()).toString('base64')])), bytes);
  const restored = await fresh.restorePrintInputState(brandId, { scope });
  assert.equal(restored.garment?.galleryImageId, 'original'); assert.equal(restored.garment?.maskCandidates?.[0].result.dataUrl, processedUrl);
  assert.deepEqual(restored.editorState, value); assert.equal(restored.designs.length, 6);
  const after = await fresh.inspectPrintDraftSafetyCopy(brandId, safetyOptions);
  assert.equal(after.copy.metadataSha256, after.current.metadataSha256);
  assert.deepEqual(after.current.assets, after.copy.assets.map(({ copyReference: _copyReference, ...asset }) => asset));
}));

test('repeated copy retains the first safety snapshot instead of replacing it with edited inputs', () => withStorage(async (storage, db) => {
  await persistPrintInputState(brandId, { url: sourceUrl, referenceType: 'base' }, designs, processedState, { scope, editorState: editor });
  await createPrintDraftSafetyCopy(brandId, safetyOptions);
  const original = (await inspectPrintDraftSafetyCopy(brandId, safetyOptions)).copy, keys = db.records().map(row => row.key).filter(key => key.includes(':safety:'));
  await updatePrintInputCoverage(brandId, 'full', { scope }); await createPrintDraftSafetyCopy(brandId, safetyOptions);
  assert.deepEqual((await inspectPrintDraftSafetyCopy(brandId, safetyOptions)).copy, original);
  assert.deepEqual(db.records().map(row => row.key).filter(key => key.includes(':safety:')), keys);
}));

test('foreign user, origin and brand cannot read or restore a safety copy', () => withStorage(async (storage, db) => {
  await persistPrintInputState(brandId, { url: sourceUrl, referenceType: 'base' }, designs, processedState, { scope, editorState: editor });
  await createPrintDraftSafetyCopy(brandId, safetyOptions); const before = [...storage], keys = db.records().map(row => row.key);
  for (const [brand, target] of [[brandId, { ...scope, userId: 'foreign' }], [brandId, { ...scope, origin: 'https://other.test' }], ['other-brand', scope]] as const) {
    await assert.rejects(inspectPrintDraftSafetyCopy(brand, { ...safetyOptions, scope: target }), /copy_missing/);
    await assert.rejects(restorePrintDraftSafetyCopy(brand, { ...safetyOptions, scope: target }), /copy_missing/);
  }
  assert.deepEqual([...storage], before); assert.deepEqual(db.records().map(row => row.key), keys);
}));

test('failed copy publication removes only its independent copies and preserves active metadata and bytes', () => withStorage(async (storage, db, browser) => {
  await persistPrintInputState(brandId, { url: sourceUrl, referenceType: 'base' }, designs, processedState, { scope, editorState: editor });
  const before = [...storage], keys = db.records().map(row => row.key), put = browser.localStorage.setItem;
  browser.localStorage.setItem = () => { throw new Error('safety_quota'); };
  await assert.rejects(createPrintDraftSafetyCopy(brandId, safetyOptions), /safety_quota/); browser.localStorage.setItem = put;
  assert.deepEqual([...storage], before); assert.deepEqual(db.records().map(row => row.key), keys);
  let checks = 0;
  await assert.rejects(createPrintDraftSafetyCopy(brandId, { scope, assertContext: () => { if (++checks === 3) throw new Error('revoked'); } }), /revoked/);
  assert.deepEqual([...storage], before); assert.deepEqual(db.records().map(row => row.key), keys);
}));

test('tampered safety bytes fail before changing or cleaning the active snapshot', () => withStorage(async (storage, db) => {
  await persistPrintInputState(brandId, { url: sourceUrl, referenceType: 'base' }, designs, processedState, { scope, editorState: editor });
  await createPrintDraftSafetyCopy(brandId, safetyOptions); await updatePrintInputCoverage(brandId, 'full', { scope });
  const before = [...storage], keys = db.records().map(row => row.key);
  const copied = db.records().find(row => row.key.includes(':safety:') && row.key.endsWith(':asset:0'))!;
  copied.blob = new Blob(['corrupted'], { type: copied.blob.type });
  await assert.rejects(restorePrintDraftSafetyCopy(brandId, safetyOptions), /safety_bytes_invalid/);
  assert.deepEqual([...storage], before); assert.deepEqual(db.records().map(row => row.key), keys);
}));

test('safety copy shares the pending save queue and revoked restore never publishes metadata', () => withStorage(async (storage, _db, browser) => {
  const saving = persistPrintInputState(brandId, { url: sourceUrl, referenceType: 'base' }, designs, processedState, { scope, editorState: editor });
  const copying = createPrintDraftSafetyCopy(brandId, safetyOptions); await Promise.all([saving, copying]);
  await updatePrintInputCoverage(brandId, 'full', { scope }); const before = [...storage];
  let checks = 0;
  await assert.rejects(restorePrintDraftSafetyCopy(brandId, { scope, assertContext: () => { if (++checks === 3) throw new Error('revoked'); } }), /revoked/);
  assert.deepEqual([...storage], before);
  const put = browser.localStorage.setItem; browser.localStorage.setItem = () => { throw new Error('restore_quota'); };
  await assert.rejects(restorePrintDraftSafetyCopy(brandId, safetyOptions), /restore_quota/); browser.localStorage.setItem = put;
  assert.deepEqual([...storage], before); await restorePrintDraftSafetyCopy(brandId, safetyOptions);
  assert.equal((await restorePrintInputState(brandId, { scope })).editorState?.coverageMode, 'spot');
}));
