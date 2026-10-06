import assert from 'node:assert/strict';
import test, { after } from 'node:test';
import { createServer } from 'vite';
const root = new URL('..', import.meta.url).pathname;
const vite = await createServer({ root, cacheDir: `/tmp/heavy-fitting-batch-handoff-${process.pid}`, configFile: false, envFile: false,
  appType: 'custom', logLevel: 'silent', server: { middlewareMode: true }, plugins: [{ name: 'isolated-workspace-provider', enforce: 'pre',
    resolveId(id) { if (/\/cloudflareApi(?:\.ts)?$/.test(id)) return '\0isolated-workspace-api'; },
    load(id) { if (id === '\0isolated-workspace-api') return `export class ArtifactPersistenceContextError extends Error {};
      export const cloudflareDataPlane={saveWorkspaceArtifact:(...args)=>globalThis.__batchWorkspaceSave(...args)};`; },
  }] });
const originalFetch = globalThis.fetch; let externalCalls = 0;
globalThis.fetch = async () => { externalCalls++; throw new Error('external_network_forbidden'); };
after(async () => { await vite.close(); globalThis.fetch = originalFetch; assert.equal(externalCalls, 0); });
const handoff = await vite.ssrLoadModule('/src/lib/fittingBatchHandoff.ts');
const runtime = await vite.ssrLoadModule('/src/lib/fittingBatchRuntime.ts');

const runner = await vite.ssrLoadModule('/src/lib/fittingBatchRunner.ts');
const workspace = await vite.ssrLoadModule('/src/lib/localWorkspaceArtifacts.ts');
const batch = await vite.ssrLoadModule('/src/lib/fittingBatch.ts');
const scope = { userId: 'isolated-handoff-user', brandId: 'isolated-handoff-brand', featureId: 'ai-fitting' };
const clone = x => structuredClone(x);
function fixture() {
  const values = new Map();
  const storage = { getItem: k => values.get(k) ?? null, setItem: (k, v) => values.set(k, v), removeItem: k => values.delete(k) };
  globalThis.window = { localStorage: storage }; globalThis.localStorage = storage;
  const task = { id: crypto.randomUUID(), requestId: crypto.randomUUID(), status: 'ready', input: {
    garment: 'data:image/png;base64,AA==', garmentName: 'shirt.png', model: null, mode: 'regular', prompt: 'keep garment',
    aspect: '1:1', resolution: '1K', references: {}, settings: { gender: 'female' } } };
  const receipt = { requestId: task.requestId, jobId: `ai-${task.requestId}`, state: 'completed', success: true,
    persistenceStatus: 'completed', clientRecoveryKey: 'isolated-original-recovery-key', images: [{ imageId: `ai-${task.requestId}-0`,
      storagePath: `generated-images/ai-${task.requestId}-0`, imageUrl: 'data:image/png;base64,AQ==' }] };
  const events = [], documents = new Map(), assets = new Map();
  let switchScopeDuringWorkspace = false, failWorkspace = false, failCanvas = false, loseCanvasResponse = false, mismatchResult = false, failAck = false, current = true;
  const counters = { submit: 0, read: 0, workspace: 0, create: 0, update: 0, ack: 0 };
  globalThis.__batchWorkspaceSave = async input => {
    counters.workspace++; events.push(`workspace:${input.metadata.fittingBatchRole}`);
    if (failWorkspace) throw new Error('isolated_workspace_unavailable');
    let remote = assets.get(input.requestId)?.remote;
    if (!remote) {
      remote = input.sourceStoragePath ? { jobId: input.sourceJobId, imageId: receipt.images[0].imageId,
        storagePath: input.sourceStoragePath } : { jobId: `workspace-${input.requestId}`, imageId: `workspace-${input.requestId}-0`,
        storagePath: `generated-images/workspace-${input.requestId}-0` };
      assets.set(input.requestId, { input: clone(input), remote: clone(remote) });
    } else assert.deepEqual(input, assets.get(input.requestId).input, 'same save identity must have same body');
    if (mismatchResult && input.sourceStoragePath) remote = { ...remote, jobId: 'wrong-job' };
    if (switchScopeDuringWorkspace) current = false;
    return { success: true, remote: clone(remote) };
  };
  const transport = {
    async get(id) { const doc = documents.get(id); if (!doc) throw new Error('cloudflare_api_404_not_found'); return clone(doc); },
    async create(id, content) {
      counters.create++; if (failCanvas) throw new Error('isolated_canvas_unavailable');
      const document = { id, ownerId: scope.userId, brandId: scope.brandId, ...clone(content), revision: 0, snapshotVersion: 1,
        createdAt: '2026-10-02', updatedAt: '2026-10-02' };
      assert.equal(documents.has(id), false); documents.set(id, document); events.push('canvas-saved');
      if (loseCanvasResponse) throw new Error('isolated_canvas_response_lost'); return clone(document);
    },
    async update(id, revision, content) { counters.update++; assert.equal(documents.get(id).revision, revision);
      const doc = { ...documents.get(id), ...clone(content), revision: revision + 1 }; documents.set(id, doc); return clone(doc); },
  };
  const assertCurrent = () => { if (!current) throw new Error('scope_changed'); };
  const options = { origin: 'https://isolated-handoff.test', scope, transport, assertCurrent, persistenceContext: { assertCurrent: async () => assertCurrent() } };
  const queue = { read: async key => JSON.parse(storage.getItem(`queue:${key}`) ?? '[]'),
    write: async (key, tasks) => storage.setItem(`queue:${key}`, JSON.stringify(tasks)),
    update: async (key, change) => { const tasks = change(await queue.read(key)); await queue.write(key, tasks); return clone(tasks); } };
  storage.setItem(`queue:${batch.fittingBatchScopeKey(scope)}`, JSON.stringify([task]));
  const execution = { assertCurrent: options.assertCurrent, submit: async () => { counters.submit++; events.push('submit'); return clone(receipt); },
    read: async id => { assert.equal(id, task.requestId); counters.read++; return clone(receipt); },
    persist: handoff.createFittingBatchHandoff(options), acknowledge: async saved => {
      assert.equal(saved.clientRecoveryKey, receipt.clientRecoveryKey); counters.ack++; events.push('ack'); if (failAck) throw new Error('ack_disconnected'); } };
  const lock = async (_key, run) => run();
  const run = () => runner.runFittingBatchTask(queue, scope, task.id, execution, lock);
  return { task, receipt, queue, options, execution, counters, events, documents, assets, values, run,
    status: async () => (await queue.read(batch.fittingBatchScopeKey(scope)))[0].status,
    set: flags => { ({ failWorkspace = failWorkspace, failCanvas = failCanvas, loseCanvasResponse = loseCanvasResponse,
      mismatchResult = mismatchResult, failAck = failAck, current = current, switchScopeDuringWorkspace = switchScopeDuringWorkspace } = flags); } };
}

test('existing workspace/Canvas contract preserves source/result/job/request/object identities before ACK', async () => {
  const f = fixture(); assert.equal(await f.run(), 'completed'); assert.equal(await f.status(), 'completed');
  assert.deepEqual(f.events, ['submit', 'workspace:source', 'workspace:result', 'canvas-saved', 'ack']);
  const id = await handoff.fittingBatchDocumentId(f.options, f.task), doc = f.documents.get(id);
  assert.equal(doc.snapshot.objects.length, 2); const [source, result] = doc.snapshot.objects;
  assert.equal(source.id, `fitting-batch:${f.task.id}:source`); assert.equal(result.derivedFrom, source.id);
  assert.equal(result.id, `fitting-batch:${f.task.id}:result`); assert.equal(result.metadata.jobId, f.receipt.jobId);
  assert.equal(result.metadata.parameters.fittingBatchRequestId, f.task.requestId); assert.equal(result.src, f.receipt.images[0].storagePath);
  assert.equal(f.assets.get(f.task.id).input.imageUrl, f.task.input.garment);
  assert.equal(f.assets.get(f.task.requestId).input.sourceStoragePath, f.receipt.images[0].storagePath);
  assert.equal(workspace.listWorkspaceArtifacts(scope.brandId, scope.userId).length, 2);
  assert.equal(workspace.listWorkspaceArtifacts(scope.brandId, 'foreign-user').length, 0);
});

test('workspace failure/local fallback never marks success or ACKs; recovery reads same provider request', async () => {
  const f = fixture(); f.set({ failWorkspace: true }); await assert.rejects(f.run(), /workspace_not_saved/);
  assert.equal(await f.status(), 'unknown'); assert.equal(f.counters.ack, 0); assert.equal(f.documents.size, 0);
  f.set({ failWorkspace: false }); assert.equal(await f.run(), 'completed');
  assert.equal(f.counters.submit, 1); assert.equal(f.counters.read, 1); assert.equal(f.assets.size, 2);
});

test('Canvas failure cannot ACK; same save IDs and object layout survive retry without inference', async () => {
  const f = fixture(); f.set({ failCanvas: true }); await assert.rejects(f.run(), /canvas_unavailable/);
  assert.equal(await f.status(), 'unknown'); assert.equal(f.counters.ack, 0);
  f.set({ failCanvas: false }); await f.run(); assert.equal(f.counters.submit, 1); assert.equal(f.counters.read, 1);
  assert.equal(f.assets.size, 2); assert.equal(f.documents.size, 1); assert.equal(f.counters.update, 0);
});

test('Canvas committed response loss is reconciled by GET and never creates another document', async () => {
  const f = fixture(); f.set({ loseCanvasResponse: true }); await f.run();
  assert.equal(await f.status(), 'completed'); assert.equal(f.counters.create, 1); assert.equal(f.counters.update, 0);
});

test('saved ACK disconnection survives queue/module reload; retry only ACKs and restores identical document', async () => {
  const f = fixture(); f.set({ failAck: true }); await assert.rejects(f.run(), /ack_disconnected/);
  assert.equal(await f.status(), 'saved'); const counters = clone(f.counters), document = clone([...f.documents.values()][0]);
  const reloaded = await vite.ssrLoadModule(`/src/lib/fittingBatchHandoff.ts?reload=${crypto.randomUUID()}`);
  f.execution.persist = reloaded.createFittingBatchHandoff(f.options);
  const inspection = await reloaded.readFittingBatchHandoff(f.options, f.task);
  assert.equal(inspection.state, 'saved'); assert.deepEqual(inspection.document, document);
  assert.deepEqual(f.counters, counters, 'reload inspection is read-only');
  f.set({ failAck: false }); await f.run(); assert.equal(await f.status(), 'completed');
  assert.equal(f.counters.submit, 1); assert.equal(f.counters.read, 0); assert.equal(f.counters.workspace, 2);
  assert.equal(f.counters.create, 1); assert.equal(f.counters.ack, 2); assert.deepEqual([...f.documents.values()][0], document);
});

test('wrong canonical result job and wrong request are rejected before ACK', async () => {
  for (const wrongRequest of [true, false]) { const f = fixture();
    if (wrongRequest) f.receipt.requestId = crypto.randomUUID(); else f.set({ mismatchResult: true });
    await assert.rejects(f.run(), wrongRequest ? /receipt_mismatch/ : /result_identity_changed/);
    assert.equal(await f.status(), 'unknown'); assert.equal(f.counters.ack, 0); assert.equal(f.documents.size, 0);
  }
});

test('scope change before save cannot dispatch workspace or mount global Canvas', async () => {
  const f = fixture(); f.set({ current: false }); await assert.rejects(f.run(), /scope_changed/);
  assert.equal(await f.status(), 'ready'); assert.equal(f.counters.submit, 0); assert.equal(f.counters.workspace, 0);
  assert.equal(f.documents.size, 0);
});

test('scope switch while workspace response is outstanding cannot commit local artifacts or ACK', async () => {
  const f = fixture(); f.set({ switchScopeDuringWorkspace: true }); await assert.rejects(f.run(), /scope_changed/);
  assert.equal(await f.status(), 'unknown'); assert.equal(f.counters.ack, 0); assert.equal(f.documents.size, 0);
  assert.equal(workspace.listWorkspaceArtifacts(scope.brandId, scope.userId).length, 0);
});

test('production runtime assembly captures context then submits/saves/ACKs through existing contracts',async()=>{
 const f=fixture(),events=[];
 const client={origin:f.options.origin,captureArtifactPersistenceContext:async options=>{options.assertContext();events.push('capture');return f.options.persistenceContext;},invokeProviderAction:async(action,body,options)=>{assert.equal(action,'model-matrix');assert.equal(options.idempotencyKey,f.task.requestId);assert.equal(options.retainUntilAcknowledged,true);await options.assertContext();assert.equal(body.brandId,f.options.scope.brandId);return f.execution.submit(f.task);},readImageAIRequest:f.execution.read,acknowledgeImageAction:f.execution.acknowledge};
 const bound=await runtime.createFittingBatchRuntime(client,f.options.scope,f.options.transport,f.options.assertCurrent);
 assert.deepEqual(events,['capture']);assert.equal(f.counters.submit,0);
 assert.equal(await runner.runFittingBatchTask(f.queue,f.options.scope,f.task.id,bound,async(_key,run)=>run()),'completed');
 assert.deepEqual(f.events,['submit','workspace:source','workspace:result','canvas-saved','ack']);
});
test('runtime context capture failure or revoked scope prevents all provider/save/ACK calls',async()=>{
 for(const revoked of [false,true]){const f=fixture(),client={origin:f.options.origin,captureArtifactPersistenceContext:async()=>{if(revoked){f.set({current:false});return f.options.persistenceContext;}throw Error('capture_failed');},invokeProviderAction:async()=>{throw Error('must_not_submit');},readImageAIRequest:f.execution.read,acknowledgeImageAction:f.execution.acknowledge};
 await assert.rejects(runtime.createFittingBatchRuntime(client,f.options.scope,f.options.transport,f.options.assertCurrent));assert.equal(f.counters.submit,0);assert.equal(f.counters.workspace,0);assert.equal(f.counters.create,0);assert.equal(f.counters.ack,0);}
});
