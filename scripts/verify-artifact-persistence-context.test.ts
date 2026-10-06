import assert from 'node:assert/strict';
import test, { after } from 'node:test';
import { readFile } from 'node:fs/promises';
import { createServer } from 'vite';
import { createPendingIndexedDbHarness } from './verify-cloudflare-image-pending-store.test.mjs';

const originalFetch = globalThis.fetch;
const originalWindow = globalThis.window;
const originalStorage = globalThis.localStorage;
const originalIndexedDB = globalThis.indexedDB;
const originalFileReader = globalThis.FileReader;
globalThis.window = { location: { origin: 'https://context-web.test' }, dispatchEvent: () => true };
const vite = await createServer({ configFile: false, envFile: false, appType: 'custom', logLevel: 'silent', server: { middlewareMode: true }, define: {
  'import.meta.env.VITE_CLOUDFLARE_API_ENABLED': '"true"',
  'import.meta.env.VITE_CLOUDFLARE_API_BASE_URL': '"https://context-api.test"',
} });
const { auth } = await vite.ssrLoadModule('/src/lib/auth.ts');
const { cloudflareDataPlane: client, ArtifactPersistenceContextError } = await vite.ssrLoadModule('/src/lib/cloudflareApi.ts');
const local = await vite.ssrLoadModule('/src/lib/localWorkspaceArtifacts.ts');
const provider = await vite.ssrLoadModule('/src/lib/providerResultPersistence.ts');
const images = await vite.ssrLoadModule('/src/lib/imageApi.ts');
after(async () => {
  auth.dispose();
  globalThis.fetch = originalFetch;
  globalThis.window = originalWindow;
  globalThis.localStorage = originalStorage;
  globalThis.indexedDB = originalIndexedDB;
  globalThis.FileReader = originalFileReader;
  await vite.close();
});

let session;
let writes;
let reads;
let store;
const setup = () => {
  globalThis.indexedDB = createPendingIndexedDbHarness();
  session = { user: { id: 'alice' }, access_token: 'captured-token' };
  auth.getSession = async () => ({ data: { session }, error: null });
  auth.refreshSession = async () => { throw new Error('unexpected_refresh'); };
  store = new Map(); writes = 0; reads = 0;
  const storage = {
    getItem: key => { reads++; return store.get(key) ?? null; },
    setItem: (key, value) => { writes++; store.set(key, value); },
    removeItem: key => store.delete(key),
  };
  globalThis.window.localStorage = storage;
  globalThis.localStorage = storage;
};
const remoteInput = (requestId = crypto.randomUUID()) => ({ requestId, brandId: 'brand', featureType: 'edit-image', title: 'Result', imageUrl: 'data:image/png;base64,YQ==', prompt: 'edit', metadata: {}, sourceStoragePath: null });
const localInput = () => ({ brandId: 'brand', scopeId: 'alice', featureType: 'edit-image', title: 'Result', imageUrl: 'data:image/png;base64,YQ==', prompt: 'edit', metadata: {} });
const receipt = requestId => ({ success: true, remote: { jobId: `wa-${requestId}`, imageId: `wa-${requestId}`, storagePath: `generated-images/wa-${requestId}` } });
const isContextError = error => error instanceof ArtifactPersistenceContextError;

test('captured capability exposes only assertion and rejects unknown capability without requests', async () => {
  setup();
  const context = await client.captureArtifactPersistenceContext();
  assert.deepEqual(Object.keys(context), ['assertCurrent']);
  assert(Object.isFrozen(context));
  let calls = 0;
  globalThis.fetch = async () => { calls++; throw new Error('unexpected'); };
  await assert.rejects(client.saveWorkspaceArtifact(remoteInput(), undefined, { assertCurrent: async () => {} }), isContextError);
  await assert.rejects(client.readWorkspaceArtifact(crypto.randomUUID(), undefined, undefined, { assertCurrent: async () => {} }), isContextError);
  assert.equal(calls, 0);
});

test('user or token switch before remote save stops all remote and local persistence', async () => {
  for (const mutate of [() => { session.user.id = 'bob'; }, () => { session.access_token = 'rotated'; }]) {
    setup();
    const context = await client.captureArtifactPersistenceContext();
    mutate();
    let calls = 0;
    globalThis.fetch = async () => { calls++; throw new Error('unexpected'); };
    await assert.rejects(local.saveWorkspaceArtifactBestEffort(localInput(), { persistenceContext: context }), isContextError);
    assert.equal(calls, 0); assert.equal(writes, 0);
  }
});

test('switch during committed or lost POST stops reconciliation, local fallback and compensation', async () => {
  for (const lost of [false, true]) {
    setup();
    const context = await client.captureArtifactPersistenceContext();
    const calls = [];
    globalThis.fetch = async (_url, init) => {
      calls.push(init.method);
      session = { user: { id: 'bob' }, access_token: 'new-token' };
      if (lost) throw new TypeError('response_lost');
      return Response.json(receipt(JSON.parse(init.body).requestId));
    };
    await assert.rejects(provider.persistProviderResultArtifact({ ...localInput(), requireRemote: true }, { persistenceContext: context }), isContextError);
    assert.deepEqual(calls, ['POST']); assert.equal(writes, 0);
  }
});

test('async scope assertions are awaited and retain their exact cause', async () => {
  setup(); let valid = true;
  const cause = new Error('project_changed');
  const context = await client.captureArtifactPersistenceContext({ assertContext: async () => {
    await Promise.resolve(); if (!valid) throw cause;
  } });
  valid = false;
  await assert.rejects(context.assertCurrent(), error => isContextError(error) && error.cause === cause);
  await assert.rejects(client.captureArtifactPersistenceContext({ assertContext: async () => { throw cause; } }), error => isContextError(error) && error.cause === cause);
  assert.equal(writes, 0);
});

test('lost response GET uses original UUID and captured bearer, with no second POST', async () => {
  setup(); const input = remoteInput(); const calls = [];
  const context = await client.captureArtifactPersistenceContext();
  globalThis.fetch = async (url, init) => {
    assert.equal(new Headers(init.headers).get('authorization'), 'Bearer captured-token');
    calls.push({ url, method: init.method });
    if (init.method === 'POST') throw new TypeError('lost');
    assert.equal(url, `${client.origin}/v1/workspace-artifacts/${input.requestId}`);
    return Response.json(receipt(input.requestId));
  };
  assert.deepEqual(await client.saveWorkspaceArtifact(input, undefined, context), receipt(input.requestId));
  assert.deepEqual(calls.map(call => call.method), ['POST', 'GET']);
});

test('context switch during reconciliation GET remains typed and never falls back', async () => {
  setup(); const calls = []; const context = await client.captureArtifactPersistenceContext();
  globalThis.fetch = async (_url, init) => {
    calls.push(init.method);
    if (init.method === 'POST') throw new TypeError('lost');
    session.access_token = 'rotated';
    throw new Error('get_transport_failure');
  };
  await assert.rejects(local.saveWorkspaceArtifactBestEffort(localInput(), { persistenceContext: context }), isContextError);
  assert.deepEqual(calls, ['POST', 'GET']); assert.equal(writes, 0);
});

test('ordinary transport failure with unchanged scope retains legacy local fallback and UUID', async () => {
  setup(); const context = await client.captureArtifactPersistenceContext(); const calls = [];
  globalThis.fetch = async (_url, init) => { calls.push(init.method); return Response.json({ error: 'unavailable' }, { status: 503 }); };
  const requestId = crypto.randomUUID();
  const input = { ...localInput(), metadata: { cloudflareWorkspaceRequestId: requestId } };
  const result = await local.saveWorkspaceArtifactBestEffort(input, { persistenceContext: context });
  assert.equal(result.localPersisted, true); assert.equal(result.remote, undefined);
  assert.equal(result.artifact.metadata.cloudflareWorkspaceRequestId, requestId);
  assert.deepEqual(calls, ['POST', 'GET']); assert.equal(writes, 1);
});

test('switch on local save stops readback and cleanup, even after a quota exception', async () => {
  for (const quota of [false, true]) {
    setup();
    const context = await client.captureArtifactPersistenceContext();
    const oldRead = window.localStorage.getItem;
    let readsAfterWrite = 0;
    window.localStorage.getItem = key => { if (writes) readsAfterWrite++; return oldRead(key); };
    window.localStorage.setItem = (key, value) => {
      writes++; store.set(key, value); session.user.id = 'bob';
      if (quota) { const error = new Error('quota'); error.name = 'QuotaExceededError'; throw error; }
    };
    globalThis.fetch = async () => Response.json({ error: 'unavailable' }, { status: 503 });
    await assert.rejects(provider.persistProviderResultArtifact({ ...localInput(), requireRemote: true }, { persistenceContext: context }), isContextError);
    assert.equal(writes, 1); assert.equal(readsAfterWrite, 0);
    assert.equal(store.size, 1, 'old-scope write is retained, not compensated');
  }
});

test('scope switch after fallback read prevents local write', async () => {
  setup(); const context = await client.captureArtifactPersistenceContext();
  window.localStorage.getItem = () => { reads++; session.user.id = 'bob'; return null; };
  globalThis.fetch = async () => Response.json({ error: 'unavailable' }, { status: 503 });
  await assert.rejects(local.saveWorkspaceArtifactBestEffort(localInput(), { persistenceContext: context }), isContextError);
  assert.equal(writes, 0);
});

test('guarded cleanup stops readback after switch during delete', async () => {
  setup(); const context = await client.captureArtifactPersistenceContext();
  window.localStorage.setItem = () => { writes++; session.user.id = 'bob'; };
  let readsAfterDelete = 0;
  window.localStorage.getItem = () => { if (writes) readsAfterDelete++; return '[]'; };
  await assert.rejects(local.deleteWorkspaceArtifactWithContext('brand', 'artifact', 'alice', context), isContextError);
  assert.equal(writes, 1); assert.equal(readsAfterDelete, 0);
});

test('supplied checked transport keeps precedence and receives capability guards', async () => {
  setup(); const input = remoteInput(); const context = await client.captureArtifactPersistenceContext(); let checkedCalls = 0;
  globalThis.fetch = async () => { throw new Error('raw_transport_must_not_run'); };
  const checked = async (_path, _init) => { checkedCalls++; return receipt(input.requestId); };
  assert.deepEqual(await client.saveWorkspaceArtifact(input, checked, context), receipt(input.requestId));
  assert.deepEqual(await client.readWorkspaceArtifact(input.requestId, checked, undefined, context), receipt(input.requestId));
  session.user.id = 'bob';
  await assert.rejects(client.saveWorkspaceArtifact(input, checked, context), isContextError);
  assert.equal(checkedCalls, 2);
});

test('existing no-context persistence still saves and reads back locally', async () => {
  setup(); globalThis.fetch = async (_url, init) => Response.json(receipt(JSON.parse(init.body).requestId));
  const result = await local.saveWorkspaceArtifactBestEffort(localInput());
  assert(result.remote); assert.equal(result.localPersisted, true); assert.equal(writes, 1);
});

test('provider retention opt-in stays outside body, keeps recovery key and defaults unchanged', async () => {
  for (const retainUntilAcknowledged of [undefined, false, true]) {
    setup(); const body = { brandId: 'brand', prompt: `retention-${retainUntilAcknowledged}-${crypto.randomUUID()}` };
    const calls = [];
    globalThis.fetch = async (url, init) => {
      calls.push(init.method ?? 'GET');
      if (init.body) assert.equal(Object.hasOwn(JSON.parse(init.body), 'retainUntilAcknowledged'), false);
      const requestId = init.method === 'POST' ? new Headers(init.headers).get('Idempotency-Key') : url.split('/').at(-1);
      return Response.json({ success: true, requestId, state: 'completed', recovery: 'terminal', persistenceStatus: 'completed', images: [{ storagePath: `generated-images/ai-${requestId}-0`, imageUrl: 'data:image/png;base64,YQ==' }] });
    };
    const result = await client.invokeProviderAction('generate-image', body, { retainUntilAcknowledged });
    assert.equal(typeof result.clientRecoveryKey === 'string', retainUntilAcknowledged === true);
    assert.equal(store.size, retainUntilAcknowledged === true ? 1 : 0);
    if (retainUntilAcknowledged) {
      const resumed = await client.invokeProviderAction('generate-image', body, { retainUntilAcknowledged, idempotencyKey: result.requestId });
      assert.equal(resumed.requestId, result.requestId);
      assert.equal(resumed.clientRecoveryKey, result.clientRecoveryKey);
      assert.deepEqual(calls, ['POST', 'GET']);
    }
  }
});

test('persistence-only retry reuses both workspace UUID and local artifact ID without provider submit', async () => {
  setup(); const context = await client.captureArtifactPersistenceContext(); const requestId = crypto.randomUUID();
  const input = { ...localInput(), metadata: { cloudflareWorkspaceRequestId: requestId } };
  let outage = true; const requests = [];
  globalThis.fetch = async (url, init) => {
    assert.match(url, /\/v1\/workspace-artifacts/);
    requests.push(init.body ? JSON.parse(init.body).requestId : url.split('/').at(-1));
    if (outage) return Response.json({ error: 'outage' }, { status: 503 });
    return Response.json(receipt(requestId));
  };
  const first = await local.saveWorkspaceArtifactBestEffort(input, { persistenceContext: context });
  outage = false;
  const second = await provider.persistProviderResultArtifact({ ...input, requireRemote: true }, { persistenceContext: context });
  assert.equal(first.artifact.id, second.artifact.id);
  assert.equal(first.artifact.id, `local-${requestId}`);
  assert(requests.every(id => id === requestId));
  assert.equal(local.listWorkspaceArtifacts('brand', 'alice').length, 1);
  assert.equal(second.remote.imageId, `wa-${requestId}`);
});

test('edit wrapper forwards retention in options and awaits async assertions', async () => {
  setup(); const originalInvoke = client.invokeProviderAction;
  globalThis.FileReader = class {
    readAsDataURL() { this.result = 'data:image/png;base64,YQ=='; queueMicrotask(() => this.onload()); }
  };
  globalThis.fetch = async () => new Response(new Blob(['image'], { type: 'image/png' }));
  let assertions = 0;
  client.invokeProviderAction = async (action, body, options) => {
    assert.equal(action, 'edit-image'); assert.equal(Object.hasOwn(body, 'retainUntilAcknowledged'), false);
    assert.equal(options.retainUntilAcknowledged, true);
    return { success: true, imageUrl: 'data:image/png;base64,YQ==' };
  };
  try {
    const result = await images.editImageWithPrompt('data:image/png;base64,YQ==', 'edit', 'brand', {
      retainUntilAcknowledged: true, assertContext: async () => { await Promise.resolve(); assertions++; },
    });
    assert.equal(result.success, true); assert.equal(assertions, 3);
  } finally { client.invokeProviderAction = originalInvoke; }
});

test('protected retention cannot be disabled and persistence options do not enter provider body', async () => {
  const source = await readFile(new URL('../src/lib/cloudflareApi.ts', import.meta.url), 'utf8');
  assert.match(source, /retainUntilAcknowledged:\s*!!protectedEdit\s*\|\|\s*options\.retainUntilAcknowledged === true/);
  assert.match(source, /retainUntilAcknowledged:true/);
  const providerSource = await readFile(new URL('../src/lib/providerResultPersistence.ts', import.meta.url), 'utf8');
  assert.match(providerSource, /persistenceContext: options\.persistenceContext/);
});
