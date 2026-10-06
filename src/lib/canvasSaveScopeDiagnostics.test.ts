import assert from 'node:assert/strict';
import test from 'node:test';
import { createServer } from 'vite';
import {
  inspectCanvasSaveScopeDiagnostics,
  describeSnapshotLineage,
  compareCanvasArtifactSnapshot,
  type CanvasSaveScopeDiagnosticStorage,
} from './canvasSaveScopeDiagnostics.ts';
import type { CanvasSaveRecovery, CanvasSaveScope } from './canvasDocumentSaveRecovery.ts';
import type { CanvasDocumentSnapshot } from './canvasDocumentPersistence.ts';

const scope: CanvasSaveScope = {
  origin: 'https://scope.example/root:alpha',
  userId: 'diagnostic-user',
  brandId: 'diagnostic-brand',
};
const documentId = '00000000-0000-4000-8000-000000000101';
const writeId = '00000000-0000-4000-8000-000000000201';

const anchorObjects = [
  {
    id: 'anchor-object-a', type: 'image', src: 'generated-images/image-a',
    metadata: { imageId: 'image-a', storagePath: 'generated-images/image-a' },
  },
  {
    id: 'anchor-object-b', type: 'image', src: 'generated-images/image-b',
    metadata: { galleryImageId: 'image-b', galleryStoragePath: 'generated-images/image-b' },
  },
];
const anchor: CanvasDocumentSnapshot = { version: 1, objects: anchorObjects };

test('redacted lineage uses the unchanged matcher and distinguishes all overlap bases', () => {
  const snapshot = (objects: unknown[]) => ({ version: 1, objects });
  const cases = [
    { object: anchorObjects[0], overlap: 'both', classification: 'partial' },
    { object: { id: 'anchor-object-a', type: 'image', src: 'generated-images/other' }, overlap: 'objectId', classification: 'partial' },
    { object: { ...anchorObjects[0], id: 'changed-id' }, overlap: 'canonicalImage', classification: 'partial' },
    { object: { id: 'unrelated', type: 'image', src: 'generated-images/other' }, overlap: 'none', classification: 'none' },
  ];
  for (const { object, overlap, classification } of cases) {
    const candidate = snapshot([object]);
    const described = describeSnapshotLineage(anchor, candidate);
    assert.equal(described.ok, true);
    if (!described.ok) throw new Error('unexpected malformed fixture');
    assert.equal(described.classification, classification);
    assert.equal(compareCanvasArtifactSnapshot(anchor, candidate).classification, classification);
    assert.deepEqual(described.anchors[0], { anchorIndex: 0, overlap, matchCount: overlap === 'none' ? 0 : 1 });
    assert.deepEqual(described.counts, { objects: 1, images: 1, identities: 1 });
  }
  assert.equal(compareCanvasArtifactSnapshot(anchor, anchor).classification, 'full');
  assert.equal(compareCanvasArtifactSnapshot(anchor, snapshot(anchorObjects.map((object, index) => ({ ...object, id: `changed-${index}` })))).classification, 'full');
});

test('lineage reports safe ambiguity sides, multiple matches, malformed inputs and object bounds', () => {
  const conflicting = { ...anchorObjects[0], metadata: { imageId: 'different' } };
  const duplicate = { version: 1, objects: [anchorObjects[0], anchorObjects[0]] };
  for (const [left, right, anchorAmbiguous, candidateAmbiguous] of [
    [anchor, { version: 1, objects: [conflicting] }, false, true],
    [duplicate, anchor, true, false],
    [anchor, duplicate, false, true],
  ] as const) {
    const result = describeSnapshotLineage(left, right);
    assert.equal(result.ok, true);
    if (!result.ok) throw new Error('unexpected malformed fixture');
    assert.equal(result.classification, 'ambiguous');
    assert.deepEqual(result.ambiguity, { anchorAmbiguous, candidateAmbiguous, detail: 'unavailable' });
  }
  const multiple = describeSnapshotLineage(anchor, duplicate);
  assert.ok(multiple.ok);
  assert.equal(multiple.anchors[0].matchCount, 2);
  const oversized = { version: 1, objects: Array.from({ length: 513 }, (_, index) => ({ id: String(index), type: 'text' })) };
  assert.deepEqual(describeSnapshotLineage(null, anchor), { ok: false, code: 'anchor_malformed' });
  assert.deepEqual(describeSnapshotLineage(anchor, { version: 1, objects: [{ id: 'bad', type: 'unsupported' }] }), { ok: false, code: 'candidate_malformed' });
  assert.deepEqual(describeSnapshotLineage(oversized, anchor), { ok: false, code: 'anchor_object_limit' });
  assert.deepEqual(describeSnapshotLineage(anchor, oversized), { ok: false, code: 'candidate_object_limit' });
  const encoded = JSON.stringify(describeSnapshotLineage(anchor, anchor));
  for (const secret of ['anchor-object-a', 'image-a', 'generated-images', 'src', 'storagePath', 'title', 'snapshot']) {
    assert.equal(encoded.includes(secret), false, `lineage leaked ${secret}`);
  }
});
const keyForDocument = (currentScope: CanvasSaveScope, id: string) => (
  ['heavy-chain-canvas:save:v1', currentScope.origin, currentScope.userId, currentScope.brandId, id]
    .map(encodeURIComponent)
    .join(':')
);

function recoveryRecord(overrides: Record<string, unknown> = {}) {
  return {
    version: 1,
    scope,
    documentId,
    ownerId: scope.userId,
    revision: 3,
    pending: null,
    title: 'private recovery title',
    snapshot: structuredClone(anchor),
    updatedAt: '2026-09-30T00:00:00.000Z',
    ...overrides,
  };
}

function scopedPair(record: unknown, id = documentId): [string, string] {
  return [keyForDocument(scope, id), JSON.stringify(record)];
}

function readFixtureEntry(currentScope: CanvasSaveScope, id: string): CanvasSaveRecovery | null {
  const raw = window.localStorage.getItem(keyForDocument(currentScope, id));
  if (!raw) return null;
  const value = JSON.parse(raw) as CanvasSaveRecovery;
  if (value.version !== 1 || value.documentId !== id
    || value.scope.origin !== currentScope.origin
    || value.scope.userId !== currentScope.userId
    || value.scope.brandId !== currentScope.brandId) throw new Error('fixture_record_invalid');
  return value;
}

function memoryStorage(
  entries: Array<[string, string]>,
  hooks: {
    onLengthRead?: (read: number, store: Map<string, string>) => void;
    onGetItem?: (key: string, read: number, store: Map<string, string>) => string | null | undefined;
    onKey?: (index: number, store: Map<string, string>) => string | null | undefined;
  } = {},
) {
  const values = new Map(entries);
  let lengthReads = 0;
  let getReads = 0;
  const readKeys: string[] = [];
  let writes = 0;
  const storage = {
    get length() {
      lengthReads += 1;
      hooks.onLengthRead?.(lengthReads, values);
      return values.size;
    },
    key(index: number) {
      const hooked = hooks.onKey?.(index, values);
      if (hooked !== undefined) return hooked;
      return Array.from(values.keys())[index] ?? null;
    },
    getItem(key: string) {
      getReads += 1;
      readKeys.push(key);
      const hooked = hooks.onGetItem?.(key, getReads, values);
      if (hooked !== undefined) return hooked;
      return values.get(key) ?? null;
    },
    setItem(key: string, value: string) {
      writes += 1;
      values.set(key, value);
    },
    removeItem(key: string) {
      writes += 1;
      values.delete(key);
    },
    clear() {
      writes += 1;
      values.clear();
    },
  };
  return {
    storage: storage as CanvasSaveScopeDiagnosticStorage,
    values,
    readKeys,
    get writes() { return writes; },
    get getReads() { return getReads; },
  };
}

async function withWindowStorage<T>(
  storage: CanvasSaveScopeDiagnosticStorage,
  run: () => Promise<T>,
  onGetter?: () => void,
): Promise<T> {
  const previous = Object.getOwnPropertyDescriptor(globalThis, 'window');
  Object.defineProperty(globalThis, 'window', {
    configurable: true,
    value: Object.defineProperty({}, 'localStorage', {
      configurable: true,
      get() {
        onGetter?.();
        return storage;
      },
    }),
  });
  try {
    return await run();
  } finally {
    if (previous) Object.defineProperty(globalThis, 'window', previous);
    else Reflect.deleteProperty(globalThis, 'window');
  }
}

async function loadFrozenRecoveryAdapter() {
  const vite = await createServer({
    root: process.cwd(),
    configFile: false,
    envFile: false,
    appType: 'custom',
    logLevel: 'silent',
    server: { middlewareMode: true, hmr: false },
  });
  try {
    const adapter = await vite.ssrLoadModule('/src/lib/canvasDocumentSaveRecovery.ts') as {
      canvasSaveRecoveryKey(scope: CanvasSaveScope, documentId: string): string;
      readCanvasSaveRecovery(scope: CanvasSaveScope, documentId: string): CanvasSaveRecovery | null;
    };
    return { vite, adapter };
  } catch (error) {
    await vite.close();
    throw error;
  }
}

function inspect(
  storage: CanvasSaveScopeDiagnosticStorage,
  overrides: Partial<Parameters<typeof inspectCanvasSaveScopeDiagnostics>[0]> = {},
) {
  return inspectCanvasSaveScopeDiagnostics({
    enabled: true,
    scopeReady: true,
    scope,
    workingSnapshot: anchor,
    generation: 17,
    isCurrent: () => true,
    keyForDocument,
    readEntry: readFixtureEntry,
    getStorage: () => storage,
    ...overrides,
  });
}

test('debug off and unready scope return before any storage getter or accessor', async () => {
  const store = memoryStorage([]);
  let storageGetterCalls = 0;
  let windowGetterCalls = 0;
  const off = await withWindowStorage(store.storage, () => inspect(store.storage, {
    enabled: false,
    getStorage: () => { storageGetterCalls += 1; return store.storage; },
  }), () => { windowGetterCalls += 1; });
  const unready = await withWindowStorage(store.storage, () => inspect(store.storage, {
    scopeReady: false,
    getStorage: () => { storageGetterCalls += 1; return store.storage; },
  }), () => { windowGetterCalls += 1; });

  assert.deepEqual(off, { readiness: 'disabled', complete: false, reason: 'debug_off', entries: [] });
  assert.deepEqual(unready, { readiness: 'not_ready', complete: false, reason: 'scope_not_ready', entries: [] });
  assert.equal(storageGetterCalls, 0);
  assert.equal(windowGetterCalls, 0);
  assert.equal(store.getReads, 0);
});

test('working and immutable pending snapshots are classified independently by canonical lineage', async () => {
  const changedWorkingObjects = anchorObjects.map((object, index) => ({
    ...structuredClone(object),
    id: `new-object-id-${index}`,
    x: 900 + index,
    label: `changed working content ${index}`,
  }));
  const partialPending = {
    writeId,
    kind: 'create',
    expectedRevision: null,
    title: 'private pending title',
    snapshot: { version: 1, objects: [{ ...structuredClone(anchorObjects[0]), id: 'pending-object-a' }] },
  };
  const store = memoryStorage([scopedPair(recoveryRecord({
    snapshot: { version: 1, objects: changedWorkingObjects },
    pending: partialPending,
  }))]);

  const result = await withWindowStorage(store.storage, () => inspect(store.storage));
  assert.equal(result.readiness, 'ready');
  assert.equal(result.complete, true);
  assert.equal(result.reason, 'ambiguous_candidate');
  assert.equal(result.entries.length, 1);
  assert.equal(result.entries[0].workingMatch, 'full');
  assert.equal(result.entries[0].workingObjectIdsEqual, false);
  assert.equal(result.entries[0].pendingMatch, 'partial');
  assert.equal(result.entries[0].pendingObjectIdsEqual, null);
  assert.equal(store.writes, 0);

  const publicResult = JSON.stringify(result);
  for (const secret of [scope.origin, scope.userId, scope.brandId, 'private recovery title', 'private pending title',
    'changed working content', 'anchor-object-a', 'image-a', 'generated-images/image-a', 'token=']) {
    assert.equal(publicResult.includes(secret), false, `diagnostic output leaked ${secret}`);
  }
});

test('contradictory image ID and serialized source are ambiguous', async () => {
  const contradictory = structuredClone(anchorObjects);
  contradictory[0].metadata.imageId = 'different-image';
  const store = memoryStorage([scopedPair(recoveryRecord({
    snapshot: { version: 1, objects: contradictory },
  }))]);
  const result = await withWindowStorage(store.storage, () => inspect(store.storage));
  assert.equal(result.complete, true);
  assert.equal(result.reason, 'ambiguous_candidate');
  assert.equal(result.entries[0].workingMatch, 'ambiguous');
  assert.equal(result.entries[0].workingObjectIdsEqual, null);
});

test('duplicate objects and multiple candidate documents stop as ambiguous', async () => {
  const duplicate = { ...structuredClone(anchorObjects[0]), id: 'duplicate-object' };
  const duplicateStore = memoryStorage([scopedPair(recoveryRecord({
    snapshot: { version: 1, objects: [duplicate, duplicate, structuredClone(anchorObjects[1])] },
  }))]);
  const duplicateResult = await withWindowStorage(duplicateStore.storage, () => inspect(duplicateStore.storage));
  assert.equal(duplicateResult.reason, 'ambiguous_candidate');
  assert.equal(duplicateResult.entries[0].workingMatch, 'ambiguous');

  const secondId = '00000000-0000-4000-8000-000000000102';
  const multipleStore = memoryStorage([
    scopedPair(recoveryRecord(), documentId),
    scopedPair(recoveryRecord({ documentId: secondId }), secondId),
  ]);
  const multipleResult = await withWindowStorage(multipleStore.storage, () => inspect(multipleStore.storage));
  assert.equal(multipleResult.complete, true);
  assert.equal(multipleResult.reason, 'multiple_candidates');
  assert.equal(multipleResult.entries.length, 2);
});

test('invalid, inaccessible, oversized, and over-limit entries fail closed', async () => {
  const invalidStore = memoryStorage([scopedPair('malformed-json')]);
  const invalid = await withWindowStorage(invalidStore.storage, () => inspect(invalidStore.storage));
  assert.equal(invalid.complete, false);
  assert.equal(invalid.reason, 'reader_error');

  const inaccessible = memoryStorage([scopedPair(recoveryRecord())], {
    onKey: () => { throw new Error('fixture-storage-failure'); },
  });
  const inaccessibleResult = await withWindowStorage(inaccessible.storage, () => inspect(inaccessible.storage));
  assert.equal(inaccessibleResult.complete, false);
  assert.equal(inaccessibleResult.reason, 'storage_inaccessible');

  const oversized = memoryStorage([[keyForDocument(scope, documentId), 'x'.repeat(2 * 1024 * 1024 + 1)]]);
  const oversizedResult = await withWindowStorage(oversized.storage, () => inspect(oversized.storage));
  assert.equal(oversizedResult.complete, false);
  assert.equal(oversizedResult.reason, 'value_limit');

  const tooManyKeys = memoryStorage(Array.from({ length: 4097 }, (_, index) => [`unrelated-${index}`, 'x']));
  const keyLimitResult = await withWindowStorage(tooManyKeys.storage, () => inspect(tooManyKeys.storage));
  assert.equal(keyLimitResult.complete, false);
  assert.equal(keyLimitResult.reason, 'total_key_limit');

  const tooManyScoped = memoryStorage(Array.from({ length: 65 }, (_, index) => {
    const id = `00000000-0000-4000-8000-${String(index + 1).padStart(12, '0')}`;
    return [keyForDocument(scope, id), '{}'];
  }));
  const scopedLimitResult = await withWindowStorage(tooManyScoped.storage, () => inspect(tooManyScoped.storage));
  assert.equal(scopedLimitResult.complete, false);
  assert.equal(scopedLimitResult.reason, 'scoped_key_limit');

  const tooManyObjects = memoryStorage([scopedPair(recoveryRecord({
    snapshot: {
      version: 1,
      objects: Array.from({ length: 513 }, (_, index) => ({ id: `text-${index}`, type: 'text' })),
    },
  }))]);
  const objectLimitResult = await withWindowStorage(tooManyObjects.storage, () => inspect(tooManyObjects.storage));
  assert.equal(objectLimitResult.complete, false);
  assert.equal(objectLimitResult.reason, 'object_limit');
});

test('conservative cumulative value limit and a changing storage scope fail closed', async () => {
  const paddedRecords = Array.from({ length: 4 }, (_, index) => {
    const id = `00000000-0000-4000-8000-${String(index + 1).padStart(12, '0')}`;
    return scopedPair(recoveryRecord({ documentId: id, padding: 'p'.repeat(1_100_000) }), id);
  });
  const cumulativeStore = memoryStorage(paddedRecords);
  const cumulative = await withWindowStorage(cumulativeStore.storage, () => inspect(cumulativeStore.storage));
  assert.equal(cumulative.complete, false);
  assert.equal(cumulative.reason, 'total_value_limit');

  const changedKey = 'unrelated-key-added-during-scan';
  const changingKeys = memoryStorage([scopedPair(recoveryRecord())], {
    onLengthRead: (read, values) => {
      if (read === 2) values.set(changedKey, 'private offscope value');
    },
  });
  const keysResult = await withWindowStorage(changingKeys.storage, () => inspect(changingKeys.storage));
  assert.equal(keysResult.complete, false);
  assert.equal(keysResult.reason, 'storage_changed');

  const originalRaw = JSON.stringify(recoveryRecord());
  const valueKey = keyForDocument(scope, documentId);
  const changingValue = memoryStorage([[valueKey, originalRaw]], {
    onGetItem: (_key, read) => read === 3 ? `${originalRaw} ` : undefined,
  });
  const valuesResult = await withWindowStorage(changingValue.storage, () => inspect(changingValue.storage));
  assert.equal(valuesResult.complete, false);
  assert.equal(valuesResult.reason, 'storage_changed');
});

test('generation invalidation, exact scope scan, and read-only behavior hold', async () => {
  const otherScope: CanvasSaveScope = { ...scope, userId: `${scope.userId}-other` };
  const offscopeKey = keyForDocument(otherScope, documentId);
  const store = memoryStorage([
    scopedPair(recoveryRecord()),
    [offscopeKey, 'offscope secret value'],
    ['unrelated-secret-key', 'offscope secret value'],
  ]);
  const stale = await withWindowStorage(store.storage, () => inspect(store.storage, {
    isCurrent: (() => {
      let checks = 0;
      return () => ++checks < 3;
    })(),
  }));
  assert.deepEqual(stale, { readiness: 'stale', complete: false, reason: 'stale_generation', entries: [] });

  const completeStore = memoryStorage([
    scopedPair(recoveryRecord()),
    [offscopeKey, 'offscope secret value'],
    ['unrelated-secret-key', 'offscope secret value'],
  ]);
  const complete = await withWindowStorage(completeStore.storage, () => inspect(completeStore.storage));
  assert.equal(complete.complete, true);
  assert.ok(completeStore.readKeys.length > 0);
  assert.ok(completeStore.readKeys.every((key) => key === keyForDocument(scope, documentId)));
  assert.equal(completeStore.writes, 0);
});

test('Vite SSR integration uses the frozen recovery adapter and fails closed on malformed scoped records', async (t) => {
  const { vite, adapter } = await loadFrozenRecoveryAdapter();
  try {
    const expectedKey = [
      'heavy-chain-canvas:save:v1', scope.origin, scope.userId, scope.brandId, documentId,
    ].map(encodeURIComponent).join(':');
    assert.equal(adapter.canvasSaveRecoveryKey(scope, documentId), expectedKey);

    await t.test('rejects malformed UUID suffix before reading any cache value', async () => {
      const prefix = `${adapter.canvasSaveRecoveryKey(scope, documentId).slice(0, -documentId.length)}`;
      const malformedKey = `${prefix}not-a-uuid`;
      const store = memoryStorage([[malformedKey, JSON.stringify(recoveryRecord())]]);
      const result = await withWindowStorage(store.storage, () => inspectCanvasSaveScopeDiagnostics({
        enabled: true,
        scopeReady: true,
        scope,
        workingSnapshot: anchor,
        generation: 17,
        isCurrent: () => true,
        keyForDocument: adapter.canvasSaveRecoveryKey,
        readEntry: adapter.readCanvasSaveRecovery,
        getStorage: () => store.storage,
      }));

      assert.equal(result.complete, false);
      assert.equal(result.reason, 'malformed_key');
      assert.deepEqual(store.readKeys, []);
      assert.equal(store.writes, 0);
    });

    await t.test('real reader rejects invalid owner and revision; snapshot structure is validated by scanner', async () => {
      const invalidRecords = [
        { record: recoveryRecord({ ownerId: '' }), reason: 'reader_error' },
        { record: recoveryRecord({ revision: -1 }), reason: 'reader_error' },
        { record: recoveryRecord({ snapshot: { version: 1, objects: [{ id: 'bad-body', type: 'unknown' }] } }), reason: 'record_invalid' },
      ];

      for (const { record, reason } of invalidRecords) {
        const store = memoryStorage([scopedPair(record)]);
        const result = await withWindowStorage(store.storage, () => inspectCanvasSaveScopeDiagnostics({
          enabled: true,
          scopeReady: true,
          scope,
          workingSnapshot: anchor,
          generation: 17,
          isCurrent: () => true,
          keyForDocument: adapter.canvasSaveRecoveryKey,
          readEntry: adapter.readCanvasSaveRecovery,
          getStorage: () => store.storage,
        }));
        assert.equal(result.complete, false);
        assert.equal(result.reason, reason);
        assert.equal(store.writes, 0);
      }
    });

    await t.test('one-image immutable pending snapshot is a partial candidate STOP with no offscope reads or output leaks', async () => {
      const changedWorkingObjects = anchorObjects.map((object, index) => ({
        ...structuredClone(object),
        id: `working-revision-${index}`,
        label: `private working label ${index}`,
      }));
      const record = recoveryRecord({
        snapshot: { version: 1, objects: changedWorkingObjects },
        pending: {
          writeId,
          kind: 'create',
          expectedRevision: null,
          title: 'private immutable pending title',
          snapshot: { version: 1, objects: [{ ...structuredClone(anchorObjects[0]), id: 'pending-one-image' }] },
        },
      });
      const offscopeKey = adapter.canvasSaveRecoveryKey({ ...scope, brandId: 'other-brand' }, documentId);
      const store = memoryStorage([
        scopedPair(record),
        [offscopeKey, 'offscope secret body'],
        ['unrelated-secret-key', 'unrelated secret body'],
      ]);
      const result = await withWindowStorage(store.storage, () => inspectCanvasSaveScopeDiagnostics({
        enabled: true,
        scopeReady: true,
        scope,
        workingSnapshot: anchor,
        generation: 17,
        isCurrent: () => true,
        keyForDocument: adapter.canvasSaveRecoveryKey,
        readEntry: adapter.readCanvasSaveRecovery,
        getStorage: () => store.storage,
      }));

      assert.equal(result.complete, true);
      assert.equal(result.reason, 'ambiguous_candidate');
      assert.equal(result.entries[0].workingMatch, 'full');
      assert.equal(result.entries[0].pendingMatch, 'partial');
      assert.ok(store.readKeys.length > 0);
      assert.ok(store.readKeys.every((key) => key === expectedKey));
      assert.equal(store.writes, 0);

      const publicResult = JSON.stringify(result);
      for (const secret of [scope.origin, scope.userId, scope.brandId, 'other-brand', 'private immutable pending title',
        'private working label', 'pending-one-image', 'image-a', 'generated-images/image-a', 'offscope secret body',
        'unrelated secret body', expectedKey]) {
        assert.equal(publicResult.includes(secret), false, `diagnostic output leaked ${secret}`);
      }
    });
  } finally {
    await vite.close();
  }
});
