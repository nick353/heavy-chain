import assert from 'node:assert/strict';
import test from 'node:test';
import { persistPrintResultHistory, restorePrintResultHistory, releaseRestoredPrintResult } from '../src/lib/printResultHistoryPersistence.ts';

// Deliberate storage fixture; actual browser IndexedDB/React is a separate check.
function setup(t) {
  const previous = { window: globalThis.window, indexedDB: globalThis.indexedDB, fetch: globalThis.fetch };
  const metadata = new Map(), records = new Map();
  const storage = { getItem: key => metadata.get(key) ?? null, setItem: (key, value) => metadata.set(key, value) };
  globalThis.window = { localStorage: storage };
  const database = {
    objectStoreNames: { contains: () => true }, close() {},
    transaction() {
      const transaction = { objectStore: () => ({
        get(key) { const request = {}; queueMicrotask(() => { request.result = records.get(key); request.onsuccess?.(); }); return request; },
        put(value) { records.set(value.key, value); queueMicrotask(() => transaction.oncomplete?.()); },
        delete(key) { records.delete(key); queueMicrotask(() => transaction.oncomplete?.()); },
      }) }; return transaction;
    },
  };
  globalThis.indexedDB = { open() { const request = {}; queueMicrotask(() => { request.result = database; request.onsuccess?.(); }); return request; } };
  t.after(() => Object.assign(globalThis, previous));
  return { metadata, records, storage, previous };
}
const scope = { origin: 'https://heavy-api.test', userId: 'alice' };
const result = id => ({ id: 'print-' + id, brandId: 'brand', title: 'Synthetic', note: 'fixture only', imageUrl: 'data:image/png;base64,c3ludGhldGljLWJ5dGVz' });
async function restored(owner = scope) {
  const rows = await restorePrintResultHistory('brand', owner);
  try { return await Promise.all(rows.map(async row => ({ ...row, bytes: await (await fetch(row.imageUrl)).text() }))); }
  finally { rows.forEach(releaseRestoredPrintResult); }
}

test('origin/user/brand scope excludes legacy and foreign references; clearing one user preserves another', async t => {
  const f = setup(t), bob = { ...scope, userId: 'bob' };
  f.metadata.set('heavy-chain-print-result-history:v1:brand', 'legacy-must-not-be-adopted-or-deleted');
  const refs = await persistPrintResultHistory('brand', [result('one')], scope);
  assert.equal((await restored())[0].bytes, 'synthetic-bytes');
  assert.deepEqual(await restored(bob), []);
  assert.deepEqual(await restored({ ...scope, origin: 'https://other-api.test' }), []);
  await assert.rejects(persistPrintResultHistory('brand', [{ ...result('one'), assetRef: refs.assetRefs['print-one'] }], bob), /foreign_reference/);
  await persistPrintResultHistory('brand', [result('two')], bob);
  await persistPrintResultHistory('brand', [], bob);
  assert.equal((await restored()).length, 1);
  assert.equal(f.metadata.get('heavy-chain-print-result-history:v1:brand'), 'legacy-must-not-be-adopted-or-deleted');
});

test('blob URL bytes persist and scoped references survive expired display URLs', async t => {
  setup(t);
  const imageUrl = URL.createObjectURL(new Blob(['actual-blob-bytes'], { type: 'image/png' }));
  const refs = await persistPrintResultHistory('brand', [{ ...result('blob'), imageUrl }], scope);
  URL.revokeObjectURL(imageUrl);
  await persistPrintResultHistory('brand', [{ ...result('blob'), imageUrl, assetRef: refs.assetRefs['print-blob'] }], scope);
  assert.equal((await restored())[0].bytes, 'actual-blob-bytes');
});

test('stale asynchronous writes and metadata readback failure cannot replace prior history', async t => {
  const f = setup(t);
  await persistPrintResultHistory('brand', [result('existing')], scope);
  let current = true;
  globalThis.fetch = async (...args) => { const response = await f.previous.fetch(...args); current = false; return response; };
  await assert.rejects(persistPrintResultHistory('brand', [result('late')], { ...scope, assertCurrent() { if (!current) throw new Error('scope_changed'); } }), /scope_changed/);
  globalThis.fetch = f.previous.fetch;
  f.storage.setItem = () => {};
  await assert.rejects(persistPrintResultHistory('brand', [result('lost-metadata')], scope), /metadata_readback_failed/);
  assert.equal((await restored())[0].id, 'print-existing');
});

test('same-scope writes serialize and retaining earlier refs preserves both results', async t => {
  setup(t);
  const refs = await persistPrintResultHistory('brand', [result('one')], scope);
  const earlier = { ...result('one'), assetRef: refs.assetRefs['print-one'] };
  await persistPrintResultHistory('brand', [result('two'), earlier], scope);
  assert.deepEqual((await restored()).map(x => x.id), ['print-two', 'print-one']);
  await Promise.all([
    persistPrintResultHistory('brand', [result('three')], scope),
    persistPrintResultHistory('brand', [result('four')], scope),
  ]);
  assert.deepEqual((await restored()).map(x => x.id), ['print-four']);
});

test('unreadable metadata is not adopted as empty or overwritten', async t => {
  const f = setup(t);
  await persistPrintResultHistory('brand', [result('existing')], scope);
  const key = [...f.metadata.keys()][0];
  const before = f.metadata.get(key);
  const getItem = f.storage.getItem;
  f.storage.getItem = () => { throw new Error('storage_denied'); };
  await assert.rejects(restorePrintResultHistory('brand', scope), /storage_denied/);
  await assert.rejects(persistPrintResultHistory('brand', [], scope), /storage_denied/);
  assert.equal(f.metadata.get(key), before);
  f.storage.getItem = getItem;
  for (const corrupt of ['{', '{}', '']) {
    f.metadata.set(key, corrupt);
    await assert.rejects(restorePrintResultHistory('brand', scope));
    await assert.rejects(persistPrintResultHistory('brand', [], scope));
    assert.equal(f.metadata.get(key), corrupt);
  }
  f.metadata.set(key, before);
  assert.equal((await restored())[0].id, 'print-existing');
});
