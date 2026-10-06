import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createFashionStudioInputController, createFashionStudioGenerationAdapters, replaceFashionStudioRole, buildFashionStudioGeneratedSnapshot, findFashionStudioOperationResult, validateFashionStudioUpload, readFashionStudioUpload, type FashionStudioInputAdapters } from '../src/lib/fashionStudioDetailAdapter.ts';
import { createFashionStudioDetailGeneration } from '../src/lib/fashionStudioDetailGeneration.ts';
import type { CanvasDocumentRecord } from '../src/lib/canvasDocumentPersistence.ts';
import type { FashionStudioGenerationHandoff } from '../src/lib/fashionStudioDetailGeneration.ts';
import { extractFashionStudioSavedDetail } from '../src/lib/fashionStudioDetailHydration.ts';

const uuid = '11111111-1111-4111-8111-111111111111';
const scope = { userId: 'user', brandId: 'brand', documentId: 'project', generation: 1 };
const remote = { jobId: 'job', imageId: 'image', storagePath: 'brands/brand/image.png' };
const image = (id: string, role: string) => ({ id, type: 'image', src: `canonical/${id}`, x: 72, y: 93, width: 143, height: 223, rotation: 7,
  metadata: { feature: `fashion-studio-detail-${role === 'original-base' ? 'original-base-layer' : role}`, prompt: 'previous', parameters: { layerRole: role, retained: true } } });
const document = (): CanvasDocumentRecord => ({ id: 'project', ownerId: 'user', brandId: 'brand', title: 'Keep title', revision: 5,
  snapshotVersion: 2, createdAt: '', updatedAt: '', snapshot: { version: 2, name: 'Keep name', sourceProjectIds: ['other'],
    objects: [image('main', 'original-base'), image('ref', 'material-reference'), image('result', 'generated-result'), { id: 'text', type: 'text', text: 'Keep text' }],
    view: { zoom: 0.4, panX: 33, panY: 44, gridVisible: true } } });
const file = () => new File(['bytes'], 'input.png', { type: 'image/png' });
const deferred = <T>() => { let resolve!: (value: T) => void; const promise = new Promise<T>(r => { resolve = r; }); return { resolve, promise }; };
const fixture = () => {
  let live = true;
  let saved = document();
  const calls = { upload: 0, recover: 0, create: 0, update: 0, committed: 0 };
  const states: any[] = [];
  const adapters: FashionStudioInputAdapters = {
    assertScope(expected) { if (!live || expected.userId !== 'user') throw new Error('scope_stale'); },
    readFile: async () => 'data:image/png;base64,YQ==', requestId: () => uuid,
    saveInput: async (input, context) => { context.assertContext(); calls.upload++; assert.equal(input.requestId, uuid); assert.match(input.imageUrl, /^data:/); return remote; },
    recoverInput: async (id, _scope, context) => { context.assertContext(); calls.recover++; assert.equal(id, uuid); return remote; },
    getDocument: async (_id, _brand, context) => { context.assertContext(); return structuredClone(saved); },
    createDocument: async (input, context) => { context.assertContext(); calls.create++; saved = { ...saved, id: input.documentId, title: input.title, snapshot: input.snapshot, revision: 0 }; return structuredClone(saved); },
    updateDocument: async (input, context) => { context.assertContext(); calls.update++; assert.equal(input.expectedRevision, saved.revision); saved = { ...saved, snapshot: input.snapshot, revision: saved.revision + 1 }; return structuredClone(saved); },
    publish: state => states.push(state), committed: () => { calls.committed++; },
  };
  return { adapters, calls, states, saved: () => structuredClone(saved), setSaved: (value: CanvasDocumentRecord) => { saved = value; }, stale: () => { live = false; } };
};

test('20MB validation includes boundary and rejects unsupported/empty/oversize images', () => {
  validateFashionStudioUpload({ type: 'image/png', size: 20 * 1024 * 1024 });
  assert.throws(() => validateFashionStudioUpload({ type: 'image/png', size: 20 * 1024 * 1024 + 1 }), /size_invalid/);
  assert.throws(() => validateFashionStudioUpload({ type: 'text/plain', size: 1 }), /format_invalid/);
  assert.throws(() => validateFashionStudioUpload({ type: 'image/png', size: 0 }), /size_invalid/);
});
test('Node Blob is explicitly read into a data URL, never committed as blob URL', async () => {
  const previous = globalThis.FileReader;
  class Reader {
    result = ''; onload?: () => void;
    readAsDataURL(blob: Blob) { void blob.arrayBuffer().then(bytes => { this.result = `data:${blob.type};base64,${Buffer.from(bytes).toString('base64')}`; this.onload?.(); }); }
  }
  Object.assign(globalThis, { FileReader: Reader });
  try { assert.equal(await readFashionStudioUpload(new Blob(['a'], { type: 'image/png' })), 'data:image/png;base64,YQ=='); }
  finally { Object.assign(globalThis, { FileReader: previous }); }
});
test('main and reference replacements preserve IDs, geometry, view and unrelated objects', async () => {
  for (const role of ['main', 'reference'] as const) {
    const f = fixture(); const before = f.saved(); const controller = createFashionStudioInputController(f.adapters);
    assert.equal((await controller.start(file(), role, scope)).status, 'success');
    const after = f.saved(); const index = role === 'main' ? 0 : 1;
    assert.deepEqual(after.snapshot.view, before.snapshot.view); assert.equal(after.title, before.title); assert.equal(after.snapshot.version, 2);
    assert.equal(after.snapshot.objects[index].id, before.snapshot.objects[index].id);
    for (const field of ['x', 'y', 'width', 'height', 'rotation']) assert.equal(after.snapshot.objects[index][field], before.snapshot.objects[index][field]);
    for (let i = 0; i < before.snapshot.objects.length; i++) if (i !== index) assert.deepEqual(after.snapshot.objects[i], before.snapshot.objects[i]);
    assert.equal(f.calls.committed, 1); assert.equal(after.snapshot.objects[index].src, remote.storagePath);
  }
});
test('missing main creates an original-base role without borrowing a result', () => {
  const snapshot = document().snapshot; snapshot.objects = snapshot.objects.filter(object => object.id !== 'main');
  const after = replaceFashionStudioRole(snapshot, 'main', remote, uuid);
  assert.equal(after.objects.length, snapshot.objects.length + 1); assert.deepEqual(after.objects.slice(0, -1), snapshot.objects);
  assert.equal((after.objects.at(-1)?.metadata as any).parameters.layerRole, 'original-base');
});
test('ambiguous roles stop before an upload and preserve committed document', async () => {
  const f = fixture(); const saved = f.saved(); saved.snapshot.objects.push(image('duplicate', 'original-base')); f.setSaved(saved);
  assert.match((await createFashionStudioInputController(f.adapters).start(file(), 'main', scope)).error!, /role_ambiguous/);
  assert.equal(f.calls.upload, 0); assert.equal(f.calls.update, 0); assert.deepEqual(f.saved(), saved);
});
test('conflicting roles and missing explicit IDs fail instead of guessing array order', () => {
  const snapshot = document().snapshot;
  (snapshot.objects[0].metadata as any).feature = 'fashion-studio-detail-generated-result';
  assert.throws(() => replaceFashionStudioRole(snapshot, 'main', remote, uuid), /role_ambiguous/);
  const missingId = { version: 1, objects: [{ type: 'image', metadata: { parameters: { layerRole: 'original-base' } } }] };
  assert.throws(() => replaceFashionStudioRole(missingId, 'main', remote, uuid), /identity_invalid/);
});
test('uncertain upload recovery GETs original UUID, never resends POST', async () => {
  const f = fixture(); f.adapters.saveInput = async () => { f.calls.upload++; throw new Error('lost_upload'); };
  const controller = createFashionStudioInputController(f.adapters); const prior = f.saved();
  assert.equal((await controller.start(file(), 'main', scope)).status, 'failure'); assert.deepEqual(f.saved(), prior);
  assert.equal((await controller.retry()).status, 'success'); assert.equal(f.calls.upload, 1); assert.equal(f.calls.recover, 1);
});
test('lost input PATCH response reads committed operation and never repeats upload or PATCH', async () => {
  const f = fixture(); const update = f.adapters.updateDocument;
  f.adapters.updateDocument = async (...args) => { await update(...args); throw new Error('lost_patch_response'); };
  const result = await createFashionStudioInputController(f.adapters).start(file(), 'main', scope);
  assert.equal(result.status, 'success'); assert.equal(f.calls.upload, 1); assert.equal(f.calls.update, 1); assert.equal(f.calls.committed, 1);
});
test('uncertain input conflict preserves another writer, and retry never sends another PATCH', async () => {
  const f = fixture(); f.adapters.updateDocument = async () => { f.calls.update++; const changed = f.saved(); changed.snapshot.objects[0].src = 'foreign'; changed.revision++; f.setSaved(changed); throw new Error('revision_conflict'); };
  const controller = createFashionStudioInputController(f.adapters);
  assert.match((await controller.start(file(), 'main', scope)).error!, /role_changed/);
  assert.equal((await controller.retry()).status, 'failure'); assert.equal(f.calls.upload, 1); assert.equal(f.calls.update, 1); assert.equal(f.saved().snapshot.objects[0].src, 'foreign');
});
test('upload session capture happens once before reads and uncertain recovery cannot adopt a new same-user token', async () => {
  const f = fixture(); let token = 'first'; let captured = ''; let captures = 0;
  f.adapters.begin = async (_id, _scope, context) => { context.assertContext(); captures++; captured = token; };
  const save = f.adapters.saveInput;
  f.adapters.saveInput = async (...args) => { await save(...args); token = 'second'; throw new Error('lost_upload'); };
  f.adapters.recoverInput = async () => { if (token !== captured) throw new Error('same_user_session_changed'); return remote; };
  const controller = createFashionStudioInputController(f.adapters); const before = f.saved();
  assert.equal((await controller.start(file(), 'main', scope)).status, 'failure');
  assert.match((await controller.retry()).error!, /same_user_session_changed/); assert.equal(captures, 1); assert.equal(f.calls.upload, 1); assert.equal(f.calls.update, 0); assert.deepEqual(f.saved(), before);
});
test('cancelled read preserves prior document and allows a new attempt', async () => {
  const f = fixture(); const prior = f.saved(); f.adapters.readFile = async () => { throw new Error('fashion_studio_upload_cancelled'); };
  const controller = createFashionStudioInputController(f.adapters);
  assert.equal((await controller.start(file(), 'main', scope)).recoverable, false); assert.deepEqual(f.saved(), prior); assert.equal(f.calls.upload, 0);
  f.adapters.readFile = async () => 'data:image/png;base64,YQ=='; assert.equal((await controller.start(file(), 'main', scope)).status, 'success');
});
test('stale upload cannot publish, write Canvas, or affect prior committed image', async () => {
  const f = fixture(); const gate = deferred<typeof remote>(); const prior = f.saved(); f.adapters.saveInput = async () => gate.promise;
  const controller = createFashionStudioInputController(f.adapters); const outcome = controller.start(file(), 'main', scope);
  await new Promise(resolve => setImmediate(resolve)); const states = f.states.length; f.stale(); gate.resolve(remote);
  assert.equal((await outcome).status, 'failure'); assert.equal(f.states.length, states); assert.equal(f.calls.update, 0); assert.deepEqual(f.saved(), prior);
});
test('another writer changing the input role during upload is never overwritten', async () => {
  const f = fixture(); f.adapters.saveInput = async () => { const changed = f.saved(); changed.snapshot.objects[0].src = 'other-writer'; f.setSaved(changed); return remote; };
  assert.match((await createFashionStudioInputController(f.adapters).start(file(), 'main', scope)).error!, /role_changed/);
  assert.equal(f.calls.update, 0); assert.equal(f.saved().snapshot.objects[0].src, 'other-writer');
});
test('lost new-file create is reconciled by same ID and publishes only verified document', async () => {
  const f = fixture(); const create = f.adapters.createDocument; let id = '';
  f.adapters.createDocument = async (...args) => { id = args[0].documentId; await create(...args); throw new Error('lost_create'); };
  const result = await createFashionStudioInputController(f.adapters).start(file(), 'main', { ...scope, documentId: '' });
  assert.equal(result.status, 'success'); assert.equal(result.document?.id, id); assert.equal(f.calls.create, 1); assert.equal(f.calls.committed, 1);
  assert.equal(result.document?.snapshot.version, 1); assert.equal(result.document?.snapshot.view?.zoom, 0.3);
});
test('uncertain new-file create never blindly repeats on retry', async () => {
  const f = fixture(); f.adapters.createDocument = async () => { f.calls.create++; throw new Error('lost_create'); };
  f.adapters.getDocument = async () => { throw new Error('404'); };
  const controller = createFashionStudioInputController(f.adapters);
  assert.equal((await controller.start(file(), 'main', { ...scope, documentId: '' })).status, 'failure');
  assert.equal((await controller.retry()).status, 'failure'); assert.equal(f.calls.create, 1); assert.equal(f.calls.committed, 0);
});
test('result replacement retains old result layout, view, title and unrelated references', () => {
  const before = document(); const handoff = { baseDocument: structuredClone(before), requestId: uuid, input: { scope, main: { objectId: 'main' }, prompt: 'new' }, persisted: { remote } } as FashionStudioGenerationHandoff;
  const after = buildFashionStudioGeneratedSnapshot(before, handoff);
  assert.equal(after.objects[2].id, 'result'); assert.equal(after.objects[2].x, 72); assert.equal(after.objects[2].rotation, 7);
  assert.deepEqual(after.objects.slice(0, 2), before.snapshot.objects.slice(0, 2)); assert.deepEqual(after.objects[3], before.snapshot.objects[3]);
  assert.deepEqual(after.view, before.snapshot.view); assert.equal(findFashionStudioOperationResult(after, uuid)?.src, remote.storagePath);
  const changed = structuredClone(before); changed.snapshot.objects[2].src = 'other-result';
  assert.throws(() => buildFashionStudioGeneratedSnapshot(changed, handoff), /result_role_changed/);
  const ambiguous = structuredClone(before); ambiguous.snapshot.objects.push(image('second-result', 'generated-result'));
  assert.throws(() => buildFashionStudioGeneratedSnapshot(ambiguous, handoff), /role_ambiguous/);
});
test('operation duplicate detection and absent result placement are explicit', () => {
  const snapshot = document().snapshot; snapshot.objects = snapshot.objects.filter(object => object.id !== 'result');
  const after = replaceFashionStudioRole(snapshot, 'result', remote, uuid);
  assert.equal(after.objects.at(-1)?.x, 1150); assert.equal(findFashionStudioOperationResult(after, uuid)?.src, remote.storagePath);
  after.objects.push(structuredClone(after.objects.at(-1)!)); assert.throws(() => findFashionStudioOperationResult(after, uuid), /operation_ambiguous/);
});
test('actual UI generation adapter retains receipt and UUID through persistence retry with zero repeat inference', async () => {
  const f = fixture(); const calls = { provider: 0, workspaceIds: [] as unknown[], ack: 0, published: 0, captures: 0 };
  const capabilities: unknown[] = [];
  const persisted = { artifact: { id: 'artifact', brandId: 'brand', scopeId: 'user', featureType: 'fashion-studio-detail-generated-result', title: '', imageUrl: 'https://result', prompt: '', metadata: {}, createdAt: '' }, localPersisted: true, remote };
  const adapters = createFashionStudioGenerationAdapters({
    assertScope: f.adapters.assertScope,
    capturePersistenceContext: async context => { calls.captures++; return { assertCurrent: async () => context.assertContext() }; },
    editImageWithPrompt: async (_url, _prompt, _brand, options) => {
      calls.provider++; assert.equal(options.retainUntilAcknowledged, true); assert.equal(options.idempotencyKey.length, 36);
      assert.deepEqual(options.referenceImageUrls, ['https://resolved/reference']);
      return { success: true, requestId: options.idempotencyKey, clientRecoveryKey: 'retained', imageUrl: 'https://result', ...remote, persistenceStatus: 'completed' };
    },
    resolveImage: async () => ({ ok: true, url: 'https://resolved/reference' }), assertCompletedImageEditResult: () => {},
    persistProviderResultArtifact: async (input, options) => {
      await options.persistenceContext.assertCurrent(); capabilities.push(options.persistenceContext); calls.workspaceIds.push(input.metadata?.cloudflareWorkspaceRequestId);
      assert.equal(input.requireRemote, true); if (calls.workspaceIds.length === 1) throw new Error('uncertain_workspace'); return persisted;
    },
    getCanvasDocument: f.adapters.getDocument, updateCanvasDocument: f.adapters.updateDocument,
    acknowledgeImageAction: async (_receipt, context) => { context.assertContext(); calls.ack++; assert.equal(f.saved().snapshot.objects[2].src, remote.storagePath); },
    activity: () => {}, publishSuccess: () => { calls.published++; }, committedInputs: () => extractFashionStudioSavedDetail(f.saved().snapshot),
  });
  const controller = createFashionStudioDetailGeneration(adapters); const oldResult = f.saved().snapshot.objects[2];
  const input = { scope, logicalAttemptKey: 'same-attempt', main: { objectId: 'main', imageUrl: 'https://loaded/main', verified: true }, referenceImageUrls: ['canonical/reference'], prompt: 'new prompt' };
  const first = await controller.start(input); assert.equal(first.status, 'failure'); assert.equal(first.stage, 'persistence'); assert.deepEqual(f.saved().snapshot.objects[2], oldResult);
  assert.equal((await controller.retry()).status, 'success'); assert.equal(calls.provider, 1); assert.equal(calls.workspaceIds.length, 2); assert.equal(calls.workspaceIds[0], calls.workspaceIds[1]);
  assert.equal(calls.ack, 1); assert.equal(calls.published, 1); assert.equal((await controller.start(input)).status, 'success'); assert.equal(calls.provider, 1);
  assert.equal(calls.captures, 1); assert.equal(capabilities[0], capabilities[1]);
});
const generationFixture = () => {
  const f = fixture(); let token = 'token-1';
  const calls = { provider: 0, persistence: 0, ack: 0, publish: 0, captures: 0 };
  const dependencies: Parameters<typeof createFashionStudioGenerationAdapters>[0] = {
    assertScope: f.adapters.assertScope, committedInputs: () => extractFashionStudioSavedDetail(f.saved().snapshot),
    capturePersistenceContext: async context => { const captured = token; calls.captures++; return { assertCurrent: async () => { context.assertContext(); if (token !== captured) throw new Error('same_user_session_changed'); } }; },
    editImageWithPrompt: async (_url, _prompt, _brand, options) => { calls.provider++; return { success: true, requestId: options.idempotencyKey, imageUrl: 'https://result', ...remote, persistenceStatus: 'completed' }; },
    resolveImage: async () => ({ ok: true, url: 'https://reference' }), assertCompletedImageEditResult: () => {},
    persistProviderResultArtifact: async (_input, options) => { await options.persistenceContext.assertCurrent(); calls.persistence++; return { remote, localPersisted: true, artifact: { id: 'artifact', scopeId: 'user', brandId: 'brand', featureType: 'generated', title: '', prompt: '', imageUrl: 'https://result', metadata: {}, createdAt: '' } }; },
    getCanvasDocument: f.adapters.getDocument, updateCanvasDocument: f.adapters.updateDocument,
    acknowledgeImageAction: async () => { calls.ack++; }, activity: () => {}, publishSuccess: () => { calls.publish++; },
  };
  const input = { scope, logicalAttemptKey: 'attempt', main: { objectId: 'main', imageUrl: 'https://loaded/main', verified: true }, referenceImageUrls: ['canonical/ref'], prompt: 'generate' };
  return { f, calls, dependencies, input, switchToken: () => { token = 'token-2'; } };
};
test('same-user token switch during provider blocks saving and retry reuses original captured session', async () => {
  const t = generationFixture(); const old = t.f.saved(); const provider = t.dependencies.editImageWithPrompt;
  t.dependencies.editImageWithPrompt = async (...args) => { const result = await provider(...args); t.switchToken(); return result; };
  const controller = createFashionStudioDetailGeneration(createFashionStudioGenerationAdapters(t.dependencies));
  assert.match((await controller.start(t.input)).error!, /same_user_session_changed/);
  assert.match((await controller.retry()).error!, /same_user_session_changed/);
  assert.deepEqual(t.calls, { provider: 1, persistence: 0, ack: 0, publish: 0, captures: 1 }); assert.deepEqual(t.f.saved(), old);
});
test('same-ID main/reference/result content changed during inference blocks Canvas replacement', async () => {
  for (const index of [0, 1, 2]) {
    const t = generationFixture(); const provider = t.dependencies.editImageWithPrompt;
    t.dependencies.editImageWithPrompt = async (...args) => { const result = await provider(...args); const changed = t.f.saved(); changed.snapshot.objects[index].src = 'concurrent-change'; t.f.setSaved(changed); return result; };
    const controller = createFashionStudioDetailGeneration(createFashionStudioGenerationAdapters(t.dependencies));
    assert.match((await controller.start(t.input)).error!, /role_changed/); assert.equal(t.f.calls.update, 0); assert.equal(t.calls.ack, 0); assert.equal(t.calls.publish, 0);
    assert.equal(t.f.saved().snapshot.objects[index].src, 'concurrent-change');
  }
});
test('stale UI canonical role identity fails fresh pre-provider document validation', async () => {
  const t = generationFixture(); const staleDetail = extractFashionStudioSavedDetail(t.f.saved().snapshot);
  const changed = t.f.saved(); changed.snapshot.objects[0].src = 'new-main'; t.f.setSaved(changed); t.dependencies.committedInputs = () => staleDetail;
  const controller = createFashionStudioDetailGeneration(createFashionStudioGenerationAdapters(t.dependencies));
  assert.match((await controller.start(t.input)).error!, /main_role_changed/); assert.equal(t.calls.provider, 0); assert.equal(t.calls.persistence, 0);
});
test('page uses tested adapters, scoped controls, file reset, staged preview and route-preserving navigation', () => {
  const source = readFileSync(new URL('../src/pages/FashionStudioDetailPage.tsx', import.meta.url), 'utf8');
  for (const token of ['createFashionStudioGenerationAdapters(', 'createFashionStudioInputController(', 'event.target.value =', "loadedMain.identity !== mainIdentity", "next.set('boardProjectCode', document.id)", 'window.location.pathname', 'onDrop=', 'activeUpload?.preview', 'busyRef.current', 'controller.dispose()']) assert.ok(source.includes(token), token);
  assert.doesNotMatch(source, /useCanvasStore|replaceAllObjects|disabled aria-label="AI生成 未接続"/);
});

test('new actual adapter captures fresh ACK context after controller recreation without generation or persistence', async () => {
  const { createStudioAckStore } = await import('../src/lib/fashionStudioPendingAck.ts');
  const f = fixture(), values = new Map<string, string>(); let failAck = true;
  const storage = { getItem: (k: string) => values.get(k) ?? null, setItem: (k: string, v: string) => { values.set(k, v); }, removeItem: (k: string) => { values.delete(k); } };
  const calls = { provider: 0, workspace: 0, ack: 0, captures: 0 };
  const dependencies: Parameters<typeof createFashionStudioGenerationAdapters>[0] = {
    ackStore: createStudioAckStore(storage), assertScope: f.adapters.assertScope,
    capturePersistenceContext: async context => { calls.captures++; return { assertCurrent: async () => context.assertContext() }; },
    editImageWithPrompt: async (_url, _prompt, _brand, options) => { calls.provider++; return { success: true, requestId: options.idempotencyKey, clientRecoveryKey: 'retained', imageUrl: 'https://result', ...remote, persistenceStatus: 'completed' }; },
    resolveImage: async () => ({ ok: true, url: 'https://reference' }), assertCompletedImageEditResult: () => {},
    persistProviderResultArtifact: async (_value, options) => { await options.persistenceContext.assertCurrent(); calls.workspace++; return { localPersisted: true,
      artifact: { id: 'artifact', scopeId: 'user', brandId: 'brand', featureType: 'fashion-studio-detail-generated-result', title: '', imageUrl: 'https://result', prompt: '', metadata: {}, createdAt: '' }, remote }; },
    getCanvasDocument: f.adapters.getDocument, updateCanvasDocument: f.adapters.updateDocument,
    acknowledgeImageAction: async (_receipt, context) => { context.assertContext(); calls.ack++; if (failAck) throw Error('forced_ack_failure'); },
    activity: () => {}, publishSuccess: () => {}, committedInputs: () => extractFashionStudioSavedDetail(f.saved().snapshot),
  };
  const original = createFashionStudioDetailGeneration(createFashionStudioGenerationAdapters(dependencies));
  const outcome = await original.start({ scope, logicalAttemptKey: 'own', main: { objectId: 'main', imageUrl: 'https://main', verified: true }, prompt: 'new' });
  assert.equal(outcome.stage, 'acknowledgement'); assert.equal(outcome.status, 'failure'); original.dispose();
  const before = { ...calls }, saved = f.saved(), updates = f.calls.update; failAck = false;
  const reload = createFashionStudioDetailGeneration(createFashionStudioGenerationAdapters({ ...dependencies, ackStore: createStudioAckStore(storage) }));
  assert.equal(reload.restorePendingAcknowledgement({ ...scope, generation: 2 })?.requestId, outcome.requestId);
  assert.equal((await reload.retry()).status, 'success');
  assert.equal(calls.provider, before.provider); assert.equal(calls.workspace, before.workspace); assert.equal(f.calls.update, updates);
  assert.equal(calls.captures, before.captures + 1); assert.equal(calls.ack, before.ack + 1); assert.equal(values.size, 0); assert.deepEqual(f.saved(), saved);
});
