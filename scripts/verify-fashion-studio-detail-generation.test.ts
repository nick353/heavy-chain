import assert from 'node:assert/strict';
import test from 'node:test';
import { createFashionStudioDetailGeneration, type FashionStudioGenerationAdapters, type FashionStudioGenerationInput } from '../src/lib/fashionStudioDetailGeneration.ts';
import { assertCompletedImageEditResult } from '../src/lib/providerResultReadback.ts';
import type { CanvasDocumentRecord } from '../src/lib/canvasDocumentPersistence.ts';
import { createStudioAckStore } from '../src/lib/fashionStudioPendingAck.ts';

const requestId = '11111111-1111-4111-8111-111111111111';
const recoveryStorage = () => {
  const values = new Map<string, string>();
  return { getItem: (key: string) => values.get(key) ?? null, setItem: (key: string, value: string) => { values.set(key, value); },
    removeItem: (key: string) => { values.delete(key); }, values };
};
const input: FashionStudioGenerationInput = {
  scope: { userId: 'user', brandId: 'brand', documentId: 'project', generation: 1 },
  logicalAttemptKey: 'attempt-1', main: { objectId: 'main', imageUrl: 'https://image/main', verified: true },
  referenceImageUrls: ['https://image/reference'], prompt: 'new design',
};
const deferred = <T>() => {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>(done => { resolve = done; });
  return { promise, resolve };
};
const fixture = () => {
  let scopeCurrent = true;
  let document: CanvasDocumentRecord = {
    id: 'project', ownerId: 'user', brandId: 'brand', title: 'existing title', revision: 5,
    snapshotVersion: 1, createdAt: '', updatedAt: '',
    snapshot: { version: 1, objects: [
      { id: 'main', type: 'image', src: 'main-path', x: 17 },
      { id: 'unrelated', type: 'text', text: 'keep this' },
      { id: 'result', type: 'image', src: 'previous-path', x: 99, width: 300, metadata: { parameters: { layerRole: 'generated-result' } } },
    ], view: { zoom: 2, panX: 42 } },
  };
  const calls = { provider: [] as string[], persistence: 0, reads: 0, writes: [] as number[], ack: 0, publish: 0 };
  const provider = { success: true, requestId, clientRecoveryKey: 'existing-transport-recovery-key', imageUrl: 'https://image/result',
    jobId: 'job', imageId: 'image', storagePath: 'canonical/path', persistenceStatus: 'completed' as const };
  const adapters: FashionStudioGenerationAdapters = {
    assertScope(scope) { if (!scopeCurrent || scope.userId !== 'user') throw new Error('scope_changed'); },
    requestId: () => requestId,
    async editImageWithPrompt(url, prompt, brand, options) {
      options.assertContext(); calls.provider.push(options.idempotencyKey);
      assert.equal(url, input.main.imageUrl); assert.equal(prompt, input.prompt); assert.equal(brand, 'brand');
      assert.equal(options.canvasProjectId, 'project'); assert.equal(options.parentObjectId, 'main');
      assert.deepEqual(options.referenceImageUrls, input.referenceImageUrls);
      return provider;
    },
    assertCompletedImageEditResult,
    async persistProviderResultArtifact(value, context) {
      context.assertContext(); calls.persistence++;
      assert.equal(value.requireRemote, true); assert.equal(value.scopeId, 'user');
      assert.equal(value.metadata?.generationOperationId, requestId);
      return { localPersisted: true, artifact: { id: 'artifact', brandId: 'brand', scopeId: 'user',
        featureType: value.featureType, title: 'result', imageUrl: provider.imageUrl, prompt: value.prompt ?? null,
        metadata: value.metadata ?? {}, createdAt: '' }, remote: { jobId: 'job', imageId: 'image', storagePath: 'canonical/path' } };
    },
    async getCanvasDocument(id, brand, context) {
      context.assertContext(); calls.reads++; assert.equal(id, 'project'); assert.equal(brand, 'brand');
      return structuredClone(document);
    },
    async updateCanvasDocument(value, context) {
      context.assertContext(); calls.writes.push(value.expectedRevision);
      assert.equal(value.documentId, 'project'); assert.equal(value.brandId, 'brand');
      document = { ...document, snapshot: value.snapshot, revision: document.revision + 1 };
      return structuredClone(document);
    },
    buildUpdatedSnapshot(value, handoff) {
      const results = value.snapshot.objects.filter(object => (object.metadata as any)?.parameters?.layerRole === 'generated-result');
      if (results.length !== 1) throw new Error('ambiguous_result_fixture');
      const remote = handoff.persisted.remote;
      return { ...value.snapshot, objects: value.snapshot.objects.map(object => object !== results[0] ? object : {
        ...object, src: remote.storagePath, metadata: { prompt: handoff.input.prompt,
          jobId: remote.jobId, imageId: remote.imageId, storagePath: remote.storagePath,
          parameters: { layerRole: 'generated-result', generationOperationId: handoff.requestId } },
      }) };
    },
    findOperationResult(snapshot, id) {
      const matches = snapshot.objects.filter(object => (object.metadata as any)?.parameters?.generationOperationId === id);
      if (matches.length > 1) throw new Error('duplicate_operation');
      return matches[0];
    },
    async acknowledgeImageAction(value, context) {
      context.assertContext(); calls.ack++; assert.equal(value.requestId, requestId);
      assert.ok(adapters.findOperationResult(document.snapshot, requestId));
    },
    publishSuccess(outcome) { calls.publish++; assert.equal(calls.ack, 1); assert.equal(outcome.status, 'success'); },
  };
  return { adapters, calls, provider, getDocument: () => structuredClone(document),
    setDocument: (value: CanvasDocumentRecord) => { document = value; }, stale: () => { scopeCurrent = false; } };
};

test('duplicate clicks coalesce; success follows canonical remote persistence, explicit revision readback and acknowledgement', async () => {
  const f = fixture(); const gate = deferred<void>(); const edit = f.adapters.editImageWithPrompt;
  f.adapters.editImageWithPrompt = async (...args) => { await gate.promise; return edit(...args); };
  const controller = createFashionStudioDetailGeneration(f.adapters);
  const first = controller.start(input); const duplicate = controller.start(input);
  assert.equal(first, duplicate); gate.resolve();
  assert.equal((await first).status, 'success');
  assert.deepEqual(f.calls, { provider: [requestId], persistence: 1, reads: 2, writes: [5], ack: 1, publish: 1 });
  const saved = f.getDocument().snapshot;
  assert.deepEqual(saved.view, { zoom: 2, panX: 42 });
  assert.deepEqual(saved.objects.slice(0, 2), [{ id: 'main', type: 'image', src: 'main-path', x: 17 }, { id: 'unrelated', type: 'text', text: 'keep this' }]);
  assert.equal(saved.objects.length, 3); assert.equal(saved.objects[2].id, 'result'); assert.equal(saved.objects[2].x, 99);
  assert.equal(saved.objects[2].src, 'canonical/path');
  assert.equal((await controller.start(input)).status, 'success'); assert.equal(f.calls.publish, 1);
});

test('lost provider response recovers through the existing adapter with SAME request ID and blocks a replacement attempt', async () => {
  const f = fixture(); const edit = f.adapters.editImageWithPrompt;
  f.adapters.editImageWithPrompt = async (...args) => {
    if (!f.calls.provider.length) { f.calls.provider.push(args[3].idempotencyKey); return { success: false, error: 'response_uncertain' }; }
    return edit(...args);
  };
  const controller = createFashionStudioDetailGeneration(f.adapters);
  assert.equal((await controller.start(input)).stage, 'provider');
  await assert.rejects(controller.start({ ...input, logicalAttemptKey: 'replacement' }), /attempt_unreconciled/);
  assert.equal((await controller.retry()).status, 'success');
  assert.deepEqual(f.calls.provider, [requestId, requestId]); assert.equal(f.calls.persistence, 1);
});

test('completed inference is held on persistence failure; retry performs persistence only', async () => {
  const f = fixture(); const persist = f.adapters.persistProviderResultArtifact;
  let failed = false;
  f.adapters.persistProviderResultArtifact = async (...args) => {
    if (!failed) { failed = true; f.calls.persistence++; throw new Error('remote_save_failed'); }
    return persist(...args);
  };
  const before = f.getDocument(); const controller = createFashionStudioDetailGeneration(f.adapters);
  const failure = await controller.start(input);
  assert.equal(failure.status, 'failure'); assert.equal(failure.stage, 'persistence');
  assert.deepEqual(f.getDocument(), before); assert.equal(f.calls.publish, 0);
  assert.equal((await controller.retry()).status, 'success');
  assert.equal(f.calls.provider.length, 1); assert.equal(f.calls.persistence, 2);
});

test('uncertain Canvas PUT reconciles exact operation on readback without another update/provider/artifact', async () => {
  const f = fixture(); const update = f.adapters.updateCanvasDocument;
  f.adapters.updateCanvasDocument = async (...args) => { await update(...args); throw new Error('revision_conflict_or_lost_response'); };
  const controller = createFashionStudioDetailGeneration(f.adapters);
  assert.equal((await controller.start(input)).status, 'success');
  assert.deepEqual(f.calls.writes, [5]); assert.equal(f.calls.reads, 2);
  assert.equal(f.calls.provider.length, 1); assert.equal(f.calls.persistence, 1);
});

test('revision conflict with a concurrently changed role preserves remote content and surfaces reconciliation', async () => {
  const f = fixture(); const before = f.getDocument();
  f.adapters.updateCanvasDocument = async value => {
    f.calls.writes.push(value.expectedRevision);
    f.setDocument({ ...before, revision: 6, snapshot: { ...before.snapshot,
      objects: [...before.snapshot.objects, { id: 'concurrent', type: 'text', text: 'remote edit' }] } });
    throw new Error('409_revision_conflict');
  };
  const result = await createFashionStudioDetailGeneration(f.adapters).start(input);
  assert.equal(result.status, 'failure'); assert.equal(result.stage, 'canvas');
  assert.match(result.error!, /reconciliation_required:409_revision_conflict/);
  assert.equal(f.calls.writes.length, 1); assert.equal(f.calls.ack, 0); assert.equal(f.calls.publish, 0);
  assert.equal(f.getDocument().snapshot.objects.at(-1)?.id, 'concurrent');
});

test('acknowledgement failure retries only acknowledgement after durable handoff; no success before ack', async () => {
  const f = fixture(); const ack = f.adapters.acknowledgeImageAction; let failed = false;
  f.adapters.acknowledgeImageAction = async (...args) => { if (!failed) { failed = true; throw new Error('ack_failed'); } await ack(...args); };
  const controller = createFashionStudioDetailGeneration(f.adapters);
  assert.equal((await controller.start(input)).stage, 'acknowledgement'); assert.equal(f.calls.publish, 0);
  assert.equal((await controller.retry()).status, 'success');
  assert.equal(f.calls.provider.length, 1); assert.equal(f.calls.persistence, 1); assert.equal(f.calls.writes.length, 1);
});

for (const boundary of ['provider', 'persistence', 'read', 'write', 'ack'] as const) {
  test(`scope fence after async ${boundary} completion prevents downstream mutations and presentation`, async () => {
    const f = fixture(); const key = ({ provider: 'editImageWithPrompt', persistence: 'persistProviderResultArtifact',
      read: 'getCanvasDocument', write: 'updateCanvasDocument', ack: 'acknowledgeImageAction' } as const)[boundary];
    const original = f.adapters[key] as (...args: any[]) => Promise<any>;
    (f.adapters as any)[key] = async (...args: any[]) => { const result = await original(...args); f.stale(); return result; };
    const result = await createFashionStudioDetailGeneration(f.adapters).start(input);
    assert.equal(result.status, 'stale'); assert.equal(f.calls.publish, 0);
    if (boundary === 'provider') assert.equal(f.calls.persistence, 0);
    if (boundary === 'persistence' || boundary === 'read') assert.equal(f.calls.writes.length, 0);
    if (boundary !== 'ack') assert.equal(f.calls.ack, 0);
  });
}

test('invalid main/prompt and altered logical-attempt input fail before paid submission', async () => {
  const f = fixture(); const gate = deferred<void>(); const edit = f.adapters.editImageWithPrompt;
  const controller = createFashionStudioDetailGeneration(f.adapters);
  await assert.rejects(controller.start({ ...input, main: { ...input.main, verified: false } }), /input_unverified/);
  await assert.rejects(controller.start({ ...input, prompt: ' ' }), /input_unverified/);
  assert.equal(f.calls.provider.length, 0);
  f.adapters.editImageWithPrompt = async (...args) => { await gate.promise; return edit(...args); };
  const flight = controller.start(input);
  await assert.rejects(controller.start({ ...input, prompt: 'changed' }), /attempt_input_changed/);
  controller.dispose(); gate.resolve(); assert.equal((await flight).status, 'stale'); assert.equal(f.calls.provider.length, 0);
});

test('wrong owner or operation canonical identity cannot acknowledge/publish', async () => {
  for (const fault of ['owner', 'identity']) {
    const f = fixture(); const doc = f.getDocument();
    if (fault === 'owner') f.setDocument({ ...doc, ownerId: 'another-user' });
    else f.setDocument({ ...doc, snapshot: { ...doc.snapshot, objects: [...doc.snapshot.objects,
      { id: 'false-operation', type: 'image', src: 'wrong-path', metadata: { imageId: 'other-image',
        parameters: { generationOperationId: requestId } } }] } });
    const result = await createFashionStudioDetailGeneration(f.adapters).start(input);
    assert.equal(result.status, 'failure'); assert.equal(f.calls.writes.length, 0); assert.equal(f.calls.ack, 0);
    assert.match(result.error!, fault === 'owner' ? /document_scope_mismatch/ : /operation_identity_mismatch/);
  }
});

test('Canvas-only retry carries original role identity so the page adapter can reject concurrent result replacement', async () => {
  const f = fixture(); const original = f.getDocument(); const build = f.adapters.buildUpdatedSnapshot;
  let first = true;
  f.adapters.updateCanvasDocument = async value => {
    f.calls.writes.push(value.expectedRevision);
    f.setDocument({ ...original, revision: 6, snapshot: { ...original.snapshot,
      objects: original.snapshot.objects.map(object => object.id !== 'result' ? object : { ...object, src: 'concurrent-result' }) } });
    throw new Error('revision_conflict');
  };
  f.adapters.buildUpdatedSnapshot = (document, handoff) => {
    assert.equal(handoff.baseDocument.revision, 5);
    if (!first) {
      assert.equal(document.revision, 6);
      throw new Error('result_role_changed_concurrently');
    }
    first = false; return build(document, handoff);
  };
  const controller = createFashionStudioDetailGeneration(f.adapters);
  assert.equal((await controller.start(input)).status, 'failure');
  const retry = await controller.retry();
  assert.equal(retry.error, 'result_role_changed_concurrently');
  assert.equal(f.calls.provider.length, 1); assert.equal(f.calls.persistence, 1); assert.equal(f.calls.writes.length, 1);
  assert.equal(f.calls.publish, 0);
});

test('remote artifact identity mismatch never reaches Canvas or success presentation', async () => {
  const f = fixture(); const persist = f.adapters.persistProviderResultArtifact;
  f.adapters.persistProviderResultArtifact = async (...args) => {
    const result = await persist(...args); return { ...result, remote: { ...result.remote!, imageId: 'different-image' } };
  };
  const result = await createFashionStudioDetailGeneration(f.adapters).start(input);
  assert.match(result.error!, /canonical_identity_mismatch/); assert.equal(f.calls.reads, 0); assert.equal(f.calls.publish, 0);
});

test('completed logical-attempt duplicate cannot submit again after a later logical attempt', async () => {
  const f = fixture(); const controller = createFashionStudioDetailGeneration(f.adapters);
  assert.equal((await controller.start(input)).status, 'success');
  const count = f.calls.provider.length;
  // A later attempt can fail validation or stay unresolved without erasing old success identity.
  f.adapters.editImageWithPrompt = async () => { f.calls.provider.push(requestId); return { success: false, error: 'response_uncertain' }; };
  assert.equal((await controller.start({ ...input, logicalAttemptKey: 'later' })).status, 'failure');
  assert.equal((await controller.start(input)).status, 'success');
  assert.equal(f.calls.provider.length, count + 1); assert.equal(f.calls.publish, 1);
});

test('ACK failure survives fresh controller/store creation and retries only original ACK', async () => {
  const f = fixture(), storage = recoveryStorage();
  f.adapters.ackStore = createStudioAckStore(storage);
  f.adapters.acknowledgeImageAction = async (_receipt, context) => { context.assertContext(); f.calls.ack++; throw Error('ack_failed'); };
  const original = createFashionStudioDetailGeneration(f.adapters);
  const failed = await original.start(input);
  assert.equal(failed.stage, 'acknowledgement'); assert.equal(failed.status, 'failure');
  const before = structuredClone(f.calls), document = f.getDocument(); original.dispose();
  const freshScope = { ...input.scope, generation: 2 };
  const recoveredAdapters = { ...f.adapters, ackStore: createStudioAckStore(storage),
    async prepareAcknowledgement(scope: typeof freshScope, id: string, context: any) { context.assertContext(); assert.equal(scope.generation, 2); assert.equal(id, requestId); return f.getDocument(); },
    async acknowledgeImageAction(receipt: any, context: any) { context.assertContext(); assert.equal(receipt.requestId, requestId); f.calls.ack++; },
  };
  const reloaded = createFashionStudioDetailGeneration(recoveredAdapters);
  assert.equal(reloaded.restorePendingAcknowledgement(freshScope)?.requestId, requestId);
  await assert.rejects(reloaded.start({ ...input, scope: freshScope }), /unreconciled/);
  const first = reloaded.retry(), duplicate = reloaded.retry(); assert.equal(first, duplicate);
  assert.equal((await first).status, 'success');
  assert.equal(f.calls.ack, before.ack + 1); assert.deepEqual(f.calls.provider, before.provider);
  assert.equal(f.calls.persistence, before.persistence); assert.deepEqual(f.calls.writes, before.writes);
  assert.deepEqual(f.getDocument(), document); assert.equal(storage.values.size, 0);
  const again = createFashionStudioDetailGeneration(recoveredAdapters);
  assert.equal(again.restorePendingAcknowledgement(freshScope), null);
});

test('ACK reload refuses changed Canvas role without clearing checkpoint or repeating effects', async () => {
  const f = fixture(), storage = recoveryStorage(); f.adapters.ackStore = createStudioAckStore(storage);
  f.adapters.acknowledgeImageAction = async () => { f.calls.ack++; throw Error('ack_failed'); };
  const original = createFashionStudioDetailGeneration(f.adapters); await original.start(input); original.dispose();
  const before = structuredClone(f.calls), changed = f.getDocument(); changed.snapshot.objects[0].id = 'foreign-main'; f.setDocument(changed);
  f.adapters.prepareAcknowledgement = async () => f.getDocument();
  const reload = createFashionStudioDetailGeneration(f.adapters); reload.restorePendingAcknowledgement(input.scope);
  assert.equal((await reload.retry()).error, 'fashion_studio_ack_document_changed');
  assert.deepEqual(f.calls, before); assert.equal(storage.values.size, 1);
  assert.equal(f.adapters.ackStore.read({ ...input.scope, userId: 'foreign' }), null);
  assert.throws(() => createFashionStudioDetailGeneration(f.adapters).restorePendingAcknowledgement({ ...input.scope, userId: 'foreign' }), /scope_changed/);
});

test('checkpoint cleanup failure after successful ACK is recoverable with ACK only', async () => {
  const f = fixture(), storage = recoveryStorage(); let failClear = true;
  const durable = createStudioAckStore(storage);
  f.adapters.ackStore = { ...durable, clear(value) { if (failClear) throw Error('checkpoint_clear_failed'); durable.clear(value); } };
  const controller = createFashionStudioDetailGeneration(f.adapters);
  assert.equal((await controller.start(input)).status, 'failure'); controller.dispose();
  const before = structuredClone(f.calls); failClear = false;
  f.adapters.prepareAcknowledgement = async () => f.getDocument();
  // Existing ACK cleanup accepts an already-absent pending key; no provider replay.
  f.adapters.acknowledgeImageAction = async (_receipt, context) => { context.assertContext(); f.calls.ack++; };
  const reload = createFashionStudioDetailGeneration(f.adapters); reload.restorePendingAcknowledgement(input.scope);
  assert.equal((await reload.retry()).status, 'success'); assert.equal(storage.values.size, 0);
  assert.deepEqual(f.calls.provider, before.provider); assert.equal(f.calls.persistence, before.persistence); assert.deepEqual(f.calls.writes, before.writes);
});

test('checkpoint storage failure stops ACK and corrupted checkpoint prevents new generation', async () => {
  const f = fixture(), storage = recoveryStorage();
  f.adapters.ackStore = createStudioAckStore({ ...storage, setItem() { throw Error('storage_unavailable'); } });
  assert.equal((await createFashionStudioDetailGeneration(f.adapters).start(input)).error, 'storage_unavailable');
  assert.equal(f.calls.ack, 0);
  const key = `heavy:studio-pending-ack:v1:${JSON.stringify(['user', 'brand', 'project'])}`;
  storage.values.set(key, '{broken'); f.adapters.ackStore = createStudioAckStore(storage);
  const reload = createFashionStudioDetailGeneration(f.adapters);
  assert.equal(reload.restorePendingAcknowledgement(input.scope)?.status, 'failure');
  await assert.rejects(reload.start(input), /unreconciled/); await assert.rejects(reload.retry(), /checkpoint_invalid/);
  assert.equal(storage.values.get(key), '{broken');
});

test('checkpoint appearing after page mount prevents allocation of a replacement provider request', async () => {
  const f = fixture(), storage = recoveryStorage(); f.adapters.ackStore = createStudioAckStore(storage);
  const mounted = createFashionStudioDetailGeneration(f.adapters);
  assert.equal(mounted.restorePendingAcknowledgement(input.scope), null);
  const original = createFashionStudioDetailGeneration(f.adapters);
  f.adapters.acknowledgeImageAction = async () => { f.calls.ack++; throw Error('ack_failed'); };
  await original.start(input); const before = structuredClone(f.calls);
  await assert.rejects(mounted.start({ ...input, logicalAttemptKey: 'new-page-attempt' }), /unreconciled/);
  assert.deepEqual(f.calls, before); assert.equal(storage.values.size, 1);
});

test('checkpoint replaced during async Canvas read stops before ACK', async () => {
  const f = fixture(), storage = recoveryStorage(); f.adapters.ackStore = createStudioAckStore(storage);
  f.adapters.acknowledgeImageAction = async () => { f.calls.ack++; throw Error('ack_failed'); };
  const original = createFashionStudioDetailGeneration(f.adapters); await original.start(input); original.dispose();
  const before = structuredClone(f.calls), gate = deferred<void>();
  f.adapters.prepareAcknowledgement = async () => { await gate.promise; return f.getDocument(); };
  const reload = createFashionStudioDetailGeneration(f.adapters); reload.restorePendingAcknowledgement(input.scope);
  const retry = reload.retry(); await Promise.resolve();
  const [key, raw] = [...storage.values.entries()][0]; const replacement = JSON.parse(raw);
  replacement.requestId = '22222222-2222-4222-8222-222222222222'; replacement.receipt.requestId = replacement.requestId;
  storage.values.set(key, JSON.stringify(replacement)); gate.resolve();
  assert.equal((await retry).error, 'fashion_studio_ack_checkpoint_conflict');
  assert.deepEqual(f.calls, before); assert.equal(storage.values.get(key), JSON.stringify(replacement));
});

test('silent checkpoint removal failure stays recoverable and never claims cleanup success', async () => {
  const f = fixture(), storage = recoveryStorage();
  f.adapters.ackStore = createStudioAckStore({ ...storage, removeItem() {} });
  const result = await createFashionStudioDetailGeneration(f.adapters).start(input);
  assert.equal(result.status, 'failure'); assert.equal(result.error, 'fashion_studio_ack_checkpoint_clear_failed');
  assert.equal(storage.values.size, 1); assert.equal(f.calls.ack, 1);
});
