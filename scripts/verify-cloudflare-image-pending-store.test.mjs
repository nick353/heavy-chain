import assert from 'node:assert/strict';
import test, { after } from 'node:test';
import { fileURLToPath } from 'node:url';
import { createServer } from 'vite';

/** Deterministic transaction harness, also imported by the existing AI suite. */
export function createPendingIndexedDbHarness() {
  const harness = { databases: new Map(), log: [], unavailable: false, failWrite: false, abortWrite: false, mismatchWrite: false, failList: false, failDelete: false, holdWrites: false, held: [], onCommit: undefined };
  class Transaction {
    constructor(database, name, mode) {
      this.database = database; this.name = name; this.mode = mode;
      this.records = new Map(database.stores.get(name)); this.pending = 0; this.finished = false; this.error = null;
      queueMicrotask(() => this.maybeComplete());
    }
    abort() {
      if (this.finished) return;
      this.finished = true; this.error ??= new Error('transaction_aborted');
      queueMicrotask(() => this.onabort?.());
    }
    maybeComplete() {
      if (this.finished || this.pending) return;
      if (this.mode === 'readwrite' && harness.holdWrites) { harness.held.push(() => this.complete()); return; }
      this.complete();
    }
    complete() {
      if (this.finished || this.pending) return;
      if (this.mode === 'readwrite' && harness.abortWrite) { harness.abortWrite = false; this.abort(); return; }
      this.finished = true;
      if (this.mode === 'readwrite') this.database.stores.set(this.name, this.records);
      harness.onCommit?.(this.database.name, this.mode);
      this.oncomplete?.();
    }
    request(operation, key, value) {
      this.pending++;
      const request = { result: undefined, error: null };
      queueMicrotask(() => {
        if (this.finished) return;
        harness.log.push({ database: this.database.name, store: this.name, mode: this.mode, operation, key });
        const failed = operation === 'getAll' && harness.failList || operation === 'put' && harness.failWrite || operation === 'delete' && harness.failDelete;
        if (failed) {
          request.error = new Error(`injected_${operation}_failure`); this.error = request.error;
          request.onerror?.(); this.abort(); return;
        }
        if (operation === 'get') request.result = this.records.get(key);
        if (operation === 'getAll') request.result = [...this.records.values()];
        if (operation === 'put' && !harness.mismatchWrite) this.records.set(value.key, value);
        if (operation === 'delete') this.records.delete(key);
        request.onsuccess?.(); this.pending--;
        queueMicrotask(() => this.maybeComplete());
      });
      return request;
    }
    objectStore() {
      return { get: key => this.request('get', key), getAll: () => this.request('getAll'),
        put: value => this.request('put', value.key, value), delete: key => this.request('delete', key) };
    }
  }
  harness.open = name => {
    const request = { result: undefined, error: null };
    queueMicrotask(() => {
      if (harness.unavailable) { request.error = new Error('indexeddb_unavailable'); request.onerror?.(); return; }
      let database = harness.databases.get(name);
      const fresh = !database;
      if (!database) {
        database = { name, stores: new Map(), close() {},
          objectStoreNames: { contains: store => database.stores.has(store) },
          createObjectStore(store) { database.stores.set(store, new Map()); },
          transaction(store, mode = 'readonly') { return new Transaction(database, store, mode); } };
        harness.databases.set(name, database);
      }
      request.result = database;
      if (fresh) request.onupgradeneeded?.();
      request.onsuccess?.();
    });
    return request;
  };
  harness.records = () => harness.databases.get('heavy-chain-image-pending-identities')?.stores.get('pending') ?? new Map();
  harness.release = () => { harness.holdWrites = false; harness.held.splice(0).forEach(complete => complete()); };
  return harness;
}

export function createPendingLegacyStorage(store = new Map()) {
  return { get length() { return store.size; }, key: index => [...store.keys()][index] ?? null,
    getItem: key => store.get(key) ?? null, setItem: (key, value) => store.set(key, value), removeItem: key => store.delete(key) };
}

// Importing the harness from another suite must not register this suite again.
if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const originalStorage = globalThis.localStorage, originalIndexed = globalThis.indexedDB;
  const originalWindow = globalThis.window, originalNavigator = globalThis.navigator;
  const vite = await createServer({ configFile: false, envFile: false, appType: 'custom', logLevel: 'silent', server: { middlewareMode: true } });
  const pending = await vite.ssrLoadModule('/src/lib/cloudflareImagePendingStore.ts');
  let image = await vite.ssrLoadModule('/src/lib/cloudflareImageAI.ts');
  const cache = await vite.ssrLoadModule('/src/lib/cloudflareImageInputCache.ts');
  const contract = await vite.ssrLoadModule('/src/lib/protectedImageEditContract.ts');
  after(async () => {
    globalThis.localStorage = originalStorage; globalThis.indexedDB = originalIndexed; globalThis.window = originalWindow;
    Object.defineProperty(globalThis, 'navigator', { value: originalNavigator, configurable: true });
    await vite.close();
  });
  const prefix = 'heavy:image-ai:v1:https://heavy.test:alice:brand:';
  const key = suffix => prefix + suffix.repeat(64);
  const setup = () => {
    const store = new Map(); const indexed = createPendingIndexedDbHarness();
    globalThis.localStorage = createPendingLegacyStorage(store); globalThis.indexedDB = indexed;
    globalThis.window = { dispatchEvent() {} };
    Object.defineProperty(globalThis, 'navigator', { value: {}, configurable: true });
    return { store, indexed };
  };
  const receipt = (id, state = 'completed') => ({ success: state === 'completed', requestId: id, state, recovery: 'terminal',
    persistenceStatus: state === 'completed' ? 'completed' : 'failed', images: state === 'completed' ? [{ storagePath: `generated-images/ai-${id}`, imageUrl: 'data:image/png;base64,YQ==' }] : [] });
  const options = () => ({ origin: 'https://heavy.test', userId: 'alice', action: 'generate-image', body: { brandId: 'brand', prompt: crypto.randomUUID() },
    assertCurrent: async () => {}, retainUntilAcknowledged: true });
  const quota = () => { throw new Error('quota_full'); };

  test('confirmed absence, legacy-only, matching dual and conflicting identities are distinct', async () => {
    const s = setup(); const id = crypto.randomUUID(), other = crypto.randomUUID();
    assert.deepEqual(await pending.readPendingIdentity(key('a')), { state: 'absent' });
    s.store.set(key('a'), id);
    assert.deepEqual(await pending.readPendingIdentity(key('a')), { state: 'present', requestId: id });
    s.indexed.records().set(key('a'), { key: key('a'), requestId: id });
    assert.equal((await pending.readPendingIdentity(key('a'))).state, 'present');
    s.indexed.records().set(key('a'), { key: key('a'), requestId: other });
    assert.equal((await pending.readPendingIdentity(key('a'))).state, 'conflict');
    await assert.rejects(pending.rememberPendingIdentity(key('a'), id), /conflict/);
  });

  test('quota fallback commits the same UUID in dedicated IDB and reload only GETs that identity', async () => {
    const s = setup(); localStorage.setItem = quota; const o = options(); const methods = [];
    o.call = async (path, init = {}) => { methods.push(init.method ?? 'GET'); return receipt(init.method === 'POST' ? new Headers(init.headers).get('idempotency-key') : path.split('/').at(-1)); };
    const first = await image.invokeDurableImageAction(o);
    assert.equal(s.store.size, 0); assert.equal(s.indexed.records().get(first.clientRecoveryKey).requestId, first.requestId);
    assert.equal(s.indexed.databases.has('heavy-chain-canvas-assets'), false);
    vite.moduleGraph.invalidateAll(); image = await vite.ssrLoadModule('/src/lib/cloudflareImageAI.ts');
    const second = await image.invokeDurableImageAction(o);
    assert.equal(second.requestId, first.requestId); assert.deepEqual(methods, ['POST', 'GET']);
  });

  test('both writes fail or a write transaction aborts/readback mismatches: zero POST', async () => {
    for (const mode of ['failWrite', 'abortWrite', 'mismatchWrite']) {
      const s = setup(); localStorage.setItem = quota; s.indexed[mode] = true; let posts = 0;
      await assert.rejects(image.invokeDurableImageAction({ ...options(), call: async () => { posts++; } }));
      assert.equal(posts, 0);
      if (mode === 'abortWrite') assert.equal(s.indexed.records().size, 0);
    }
  });

  test('transaction request success cannot start inference before transaction commit and separate readback', async () => {
    const s = setup(); localStorage.setItem = quota; s.indexed.holdWrites = true; let posts = 0;
    const o = options(); o.call = async (_path, init) => { posts++; return receipt(new Headers(init.headers).get('idempotency-key')); };
    const running = image.invokeDurableImageAction(o);
    while (!s.indexed.held.length) await new Promise(resolve => setImmediate(resolve));
    assert.equal(posts, 0); assert.equal(s.indexed.records().size, 0);
    s.indexed.release(); await running; assert.equal(posts, 1);
    const operations = s.indexed.log.map(item => item.operation);
    assert(operations.lastIndexOf('get') > operations.indexOf('put'));
  });

  test('ambiguous read or IDB unavailable without a legacy ID never chooses UUID or submits', async () => {
    for (const legacyReadFailure of [false, true]) {
      const s = setup(); if (legacyReadFailure) localStorage.getItem = () => { throw new Error('read_ambiguous'); }; else s.indexed.unavailable = true;
      let calls = 0;
      await assert.rejects(image.invokeDurableImageAction({ ...options(), call: async () => { calls++; } }), /unavailable/);
      assert.equal(calls, 0); assert.equal(s.store.size, 0); assert.equal(s.indexed.records().size, 0);
    }
  });

  test('legacy ID with unavailable IDB allows exact GET display but no POST, finalization, cache or ack cleanup', async () => {
    const s = setup(); const o = options(); const id = crypto.randomUUID();
    const recoveryKey = await image.durableImageRecoveryKey(o.origin, o.userId, o.action, o.body);
    s.store.set(recoveryKey, id); s.indexed.unavailable = true; let before = 0, cleanup = 0;
    o.beforeSubmit = async () => { before++; };
    const methods = []; o.call = async (path, init = {}) => { methods.push(init.method ?? 'GET'); assert.equal(path, `/v1/image-ai/requests/${id}`); return receipt(id); };
    const result = await image.invokeDurableImageAction(o);
    assert.equal(result.requestId, id); assert.equal(before, 0);
    await assert.rejects(image.acknowledgeDurableImageAction({ ...o, receipt: result, cleanup: async () => { cleanup++; } }), /unavailable/);
    o.finalize = async () => { cleanup++; };
    await assert.rejects(image.invokeDurableImageAction(o), /unavailable/);
    delete o.finalize; o.call = async () => { throw new Error('cloudflare_api_404_image_request_not_found'); };
    await assert.rejects(image.invokeDurableImageAction(o), /unavailable/);
    assert.deepEqual(methods, ['GET', 'GET']); assert.equal(cleanup, 0); assert.equal(s.store.get(recoveryKey), id);
  });

  test('partial legacy write conflict remains blocked even when IDB could persist', async () => {
    const s = setup(); const id = crypto.randomUUID(), other = crypto.randomUUID();
    localStorage.setItem = k => { s.store.set(k, other); throw new Error('partial_write'); };
    await assert.rejects(pending.rememberPendingIdentity(key('b'), id), /conflict/);
    assert.equal(s.store.get(key('b')), other); assert.equal(s.indexed.records().size, 0);
  });

  test('IDB-only identity with ambiguous legacy read also permits GET only', async () => {
    const s = setup(); const o = options(); const id = crypto.randomUUID();
    const k = await image.durableImageRecoveryKey(o.origin, o.userId, o.action, o.body);
    await pending.readPendingIdentity(k); s.indexed.records().set(k, { key: k, requestId: id });
    localStorage.getItem = () => { throw new Error('legacy_read_failed'); };
    let posts = 0;
    o.call = async (path, init = {}) => { if (init.method === 'POST') posts++; assert.equal(path, `/v1/image-ai/requests/${id}`); return receipt(id); };
    assert.equal((await image.invokeDurableImageAction(o)).requestId, id);
    assert.equal(posts, 0);
    await assert.rejects(image.acknowledgeDurableImageAction({ ...o, receipt: { requestId: id, clientRecoveryKey: k } }), /unavailable/);
    assert.equal(s.indexed.records().get(k).requestId, id);
  });

  test('WebLock and coalescing cover choose/persist/submit and exact acknowledgement cleanup', async () => {
    setup(); let held = false; const names = []; const o = options();
    Object.defineProperty(globalThis, 'navigator', { configurable: true, value: { locks: { request: async (name, run) => {
      assert.equal(held, false); names.push(name); held = true;
      try { return await run(); } finally { held = false; }
    } } } });
    let posts = 0;
    o.call = async (_path, init) => { assert.equal(held, true); posts++; return receipt(new Headers(init.headers).get('idempotency-key')); };
    const [first, second] = await Promise.all([image.invokeDurableImageAction(o), image.invokeDurableImageAction(o)]);
    assert.equal(first.requestId, second.requestId); assert.equal(posts, 1);
    await image.acknowledgeDurableImageAction({ ...o, receipt: first, cleanup: async () => { assert.equal(held, true); } });
    assert.deepEqual(names, [first.clientRecoveryKey, first.clientRecoveryKey]);
  });

  test('legacy readback mismatch falls back to same IDB UUID, then rechecks both stores', async () => {
    const s = setup(); const id = crypto.randomUUID(); localStorage.setItem = () => {};
    await pending.rememberPendingIdentity(key('b'), id);
    assert.deepEqual(await pending.readPendingIdentity(key('b')), { state: 'present', requestId: id });
    assert.equal(s.indexed.records().get(key('b')).requestId, id);
  });

  test('scope change after IDB commit stops before snapshot/provider while identity is retained', async () => {
    const s = setup(); localStorage.setItem = quota; const o = options(); let current = true, effects = 0;
    s.indexed.onCommit = (name, mode) => { if (name.includes('pending') && mode === 'readwrite') current = false; };
    o.assertCurrent = async () => { if (!current) throw new Error('scope_changed'); };
    o.call = o.beforeSubmit = async () => { effects++; };
    await assert.rejects(image.invokeDurableImageAction(o), /scope_changed/);
    assert.equal(effects, 0); assert.equal(s.indexed.records().size, 1);
  });

  test('exact acknowledgement rejects wrong/newer identity before cleanup and keeps partial failure durable', async () => {
    const s = setup(); const id = crypto.randomUUID(), k = key('c');
    await pending.rememberPendingIdentity(k, id);
    s.indexed.records().set(k, { key: k, requestId: id });
    let cleanup = 0;
    const ack = { origin: 'https://heavy.test', userId: 'alice', receipt: { requestId: id, clientRecoveryKey: k }, assertCurrent: async () => {}, cleanup: async () => { cleanup++; } };
    await assert.rejects(image.acknowledgeDurableImageAction({ ...ack, userId: 'bob' }), /scope_invalid/);
    s.store.set(k, crypto.randomUUID());
    await assert.rejects(image.acknowledgeDurableImageAction(ack), /request_mismatch/); assert.equal(cleanup, 0);
    s.store.set(k, id); localStorage.removeItem = () => { throw new Error('legacy_remove_failed'); };
    await assert.rejects(image.acknowledgeDurableImageAction(ack), /legacy_remove_failed/);
    assert.equal(s.indexed.records().get(k).requestId, id); assert.equal(s.store.get(k), id);
    localStorage.removeItem = key => s.store.delete(key); s.indexed.failDelete = true;
    await assert.rejects(image.acknowledgeDurableImageAction(ack), /delete_failure/);
    assert.equal(s.store.has(k), false); assert.equal(s.indexed.records().get(k).requestId, id);
    s.indexed.failDelete = false; await image.acknowledgeDurableImageAction(ack);
    assert.equal((await pending.readPendingIdentity(k)).state, 'absent');
  });

  test('ack scope switch in cleanup prevents all identity removals', async () => {
    const s = setup(); const id = crypto.randomUUID(), k = key('d'); await pending.rememberPendingIdentity(k, id);
    let current = true;
    await assert.rejects(image.acknowledgeDurableImageAction({ origin: 'https://heavy.test', userId: 'alice', receipt: { requestId: id, clientRecoveryKey: k },
      assertCurrent: async () => { if (!current) throw new Error('scope_changed'); }, cleanup: async () => { current = false; } }), /scope_changed/);
    assert.equal(s.store.get(k), id);
  });

  test('failed legacy remove readback or scope change after legacy removal retains IDB identity', async () => {
    for (const change of [false, true]) {
      const s = setup(); const id = crypto.randomUUID(), k = key('f'); await pending.rememberPendingIdentity(k, id);
      s.indexed.records().set(k, { key: k, requestId: id }); let current = true;
      localStorage.removeItem = key => { if (change) { s.store.delete(key); current = false; } };
      await assert.rejects(pending.forgetPendingIdentity(k, id, async () => { if (!current) throw new Error('scope_changed'); }), change ? /scope_changed/ : /remove_readback_failed/);
      assert.equal(s.indexed.records().get(k).requestId, id);
      assert.equal(s.indexed.log.filter(item => item.operation === 'delete').length, 0);
    }
  });

  test('listing unions both stores with exact prefix and refuses incomplete/conflicting results', async () => {
    const s = setup(); const a = crypto.randomUUID(), b = crypto.randomUUID();
    await pending.rememberPendingIdentity(key('a'), a); localStorage.setItem = quota;
    await pending.rememberPendingIdentity(key('b'), b);
    s.indexed.records().set('heavy:image-ai:v1:https://heavy.test:alice:other:' + 'e'.repeat(64), { key: 'heavy:image-ai:v1:https://heavy.test:alice:other:' + 'e'.repeat(64), requestId: crypto.randomUUID() });
    assert.deepEqual((await pending.listPendingIdentities(prefix)).identities.map(item => item.requestId).sort(), [a, b].sort());
    s.store.set(key('b'), crypto.randomUUID()); assert.equal((await pending.listPendingIdentities(prefix)).state, 'conflict');
    s.store.delete(key('b')); s.indexed.failList = true; assert.equal((await pending.listPendingIdentities(prefix)).state, 'unavailable');
    await assert.rejects(cache.listProtectedImageInputs({ origin: 'https://heavy.test', userId: 'alice', brandId: 'brand' }), /listing_unavailable/);
  });

  test('protected snapshot validates, lists and cleans up with IDB-only pending identity; missing availability never purges', async () => {
    const s = setup(); localStorage.setItem = quota;
    const scope = { origin: 'https://heavy.test', userId: 'alice', brandId: 'brand' };
    const sourceImageUrl = 'data:image/png;base64,YQ==', maskDataUrl = 'data:image/png;base64,Yg==';
    const plan = { mode: contract.PROTECTED_IMAGE_EDIT_MODE, sourceSha256: await contract.protectedImageDigest(sourceImageUrl), maskSha256: await contract.protectedImageDigest(maskDataUrl) };
    const prepared = { sourceImageUrl, maskDataUrl, plan, body: { brandId: 'brand', prompt: 'edit', imageUrls: [sourceImageUrl, maskDataUrl], protectedEdit: plan } };
    const id = crypto.randomUUID(), k = await image.durableImageRecoveryKey(scope.origin, scope.userId, 'edit-image', prepared.body);
    await pending.rememberPendingIdentity(k, id);
    await cache.persistProtectedImageInput(scope, prepared, id, k);
    assert.equal((await cache.loadProtectedImageInput(scope, id)).requestId, id);
    assert.equal((await cache.listProtectedImageInputs(scope))[0].requestId, id);
    s.store.set(k, crypto.randomUUID());
    await assert.rejects(cache.loadProtectedImageInput(scope, id), /conflict/);
    await assert.rejects(cache.deleteProtectedImageInput(scope, id, k), /conflict/);
    assert.equal(s.indexed.databases.get('heavy-chain-canvas-assets').stores.get('images').size, 1);
    s.store.delete(k);
    s.indexed.unavailable = true;
    await assert.rejects(cache.listProtectedImageInputs(scope), /unavailable/);
    await assert.rejects(cache.deleteProtectedImageInput(scope, id, k), /unavailable/);
    s.indexed.unavailable = false;
    await image.acknowledgeDurableImageAction({ ...scope, receipt: { requestId: id, clientRecoveryKey: k }, assertCurrent: async () => {}, cleanup: () => cache.deleteProtectedImageInput(scope, id, k) });
    assert.equal((await pending.readPendingIdentity(k)).state, 'absent');
    assert.deepEqual(await cache.listProtectedImageInputs(scope), []);
    assert.equal(s.indexed.databases.get('heavy-chain-canvas-assets').stores.get('images').size, 0);
  });
}
