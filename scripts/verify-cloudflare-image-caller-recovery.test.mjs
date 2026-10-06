import assert from 'node:assert/strict';
import test from 'node:test';
import { createServer } from 'vite';
import { createPendingIndexedDbHarness, createPendingLegacyStorage } from './verify-cloudflare-image-pending-store.test.mjs';

const ORIGIN = 'https://heavy.test';
const USER_ID = 'alice';
const TOKEN = 'fixture-token';
const DEFAULT_BODY = Object.freeze({ brandId: 'brand', prompt: 'same prompt for caller recovery' });

const json = (payload, status = 200) => Response.json(payload, { status });
const completedReceipt = (requestId, extra = {}) => ({
  success: true,
  requestId,
  state: 'completed',
  recovery: 'terminal',
  persistenceStatus: 'completed',
  images: [{ storagePath: `generated-images/${requestId}`, imageUrl: 'https://media.test/result.png' }],
  ...extra,
});

async function createFixture(t) {
  const originals = {
    fetch: globalThis.fetch,
    localStorage: Object.getOwnPropertyDescriptor(globalThis, 'localStorage'),
    indexedDB: Object.getOwnPropertyDescriptor(globalThis, 'indexedDB'),
    window: globalThis.window,
    navigator: Object.getOwnPropertyDescriptor(globalThis, 'navigator'),
    Image: globalThis.Image,
    document: globalThis.document,
    ImageData: globalThis.ImageData,
    FileReader: globalThis.FileReader,
  };
  let currentSession = { user: { id: USER_ID }, access_token: TOKEN };
  let storage = installStorage();
  let handler = async request => {
    if (request.method === 'POST') return json(completedReceipt(request.headers.get('idempotency-key')));
    return json({ error: 'image_request_not_found' }, 404);
  };
  const requests = [];

  function installStorage() {
    const legacyMap = new Map();
    const indexed = createPendingIndexedDbHarness();
    Object.defineProperty(globalThis, 'localStorage', { value: createPendingLegacyStorage(legacyMap), configurable: true, writable: true });
    Object.defineProperty(globalThis, 'indexedDB', { value: indexed, configurable: true, writable: true });
    return { legacyMap, indexed };
  }

  globalThis.window = { location: { origin: 'https://image-web.test' }, dispatchEvent() {} };
  Object.defineProperty(globalThis, 'navigator', { value: {}, configurable: true, writable: true });
  globalThis.fetch = async (input, init = {}) => {
    const url = String(input);
    if (url.startsWith('data:image/')) {
      return new Response(Uint8Array.from([1, 2, 3]), { headers: { 'content-type': 'image/png' } });
    }
    const request = {
      url,
      path: new URL(url).pathname,
      method: init.method ?? 'GET',
      headers: new Headers(init.headers),
      body: typeof init.body === 'string' ? JSON.parse(init.body) : null,
    };
    requests.push(request);
    return handler(request);
  };

  const viteOptions = {
    configFile: false,
    envFile: false,
    appType: 'custom',
    logLevel: 'silent',
    server: { middlewareMode: true },
    define: {
      'import.meta.env.VITE_CLOUDFLARE_API_ENABLED': JSON.stringify('true'),
      'import.meta.env.VITE_CLOUDFLARE_API_BASE_URL': JSON.stringify(ORIGIN),
    },
  };
  let vite = await createServer(viteOptions);
  let modules;
  const loadModules = async () => {
    const [authModule, apiModule, image, pending, cache, preflight] = await Promise.all([
      vite.ssrLoadModule('/src/lib/auth.ts'),
      vite.ssrLoadModule('/src/lib/cloudflareApi.ts'),
      vite.ssrLoadModule('/src/lib/cloudflareImageAI.ts'),
      vite.ssrLoadModule('/src/lib/cloudflareImagePendingStore.ts'),
      vite.ssrLoadModule('/src/lib/cloudflareImageInputCache.ts'),
      vite.ssrLoadModule('/src/lib/heavyGenerationPreflight.ts'),
    ]);
    authModule.auth.getSession = async () => ({ data: { session: currentSession }, error: null });
    assert.ok(apiModule.cloudflareDataPlane, 'Cloudflare data plane should be enabled in the isolated Vite runtime');
    modules = { auth: authModule.auth, api: apiModule.cloudflareDataPlane, image, pending, cache, preflight };
    return modules;
  };
  await loadModules();

  t.after(async () => {
    try { modules?.auth.dispose?.(); } catch { /* test cleanup only */ }
    await vite.close();
    globalThis.fetch = originals.fetch;
    for (const name of ['localStorage', 'indexedDB', 'navigator']) {
      const descriptor = originals[name];
      if (descriptor) Object.defineProperty(globalThis, name, descriptor);
      else delete globalThis[name];
    }
    globalThis.window = originals.window;
    globalThis.Image = originals.Image;
    globalThis.document = originals.document;
    globalThis.ImageData = originals.ImageData;
    globalThis.FileReader = originals.FileReader;
  });

  return {
    get auth() { return modules.auth; },
    get api() { return modules.api; },
    get image() { return modules.image; },
    get pending() { return modules.pending; },
    get cache() { return modules.cache; },
    get preflight() { return modules.preflight; },
    get storage() { return storage; },
    requests,
    setHandler(next) { handler = next; },
    setSession(userId, token = TOKEN) { currentSession = { user: { id: userId }, access_token: token }; },
    resetStorage() { storage = installStorage(); },
    async reloadModules() {
      modules.auth.dispose?.();
      await vite.close();
      vite = await createServer(viteOptions);
      await loadModules();
    },
  };
}

async function recoveryKey(fixture, userId = USER_ID, body = DEFAULT_BODY, action = 'generate-image') {
  const prepared = await fixture.image.prepareCloudflareImageInput(action, body);
  return fixture.image.durableImageRecoveryKey(ORIGIN, userId, action, prepared);
}

function invoke(fixture, body = DEFAULT_BODY, options = {}) {
  return fixture.api.invokeProviderAction('generate-image', { ...body }, { retainUntilAcknowledged: true, ...options });
}

test('actual caller preserves the helper-selected ID after a lost POST and exact not-found readback', async t => {
  const fixture = await createFixture(t);
  let loseFirstPost = true;
  const observed = [];
  fixture.setHandler(async request => {
    const id = request.method === 'POST'
      ? request.headers.get('idempotency-key')
      : request.path.slice('/v1/image-ai/requests/'.length);
    observed.push({ method: request.method, path: request.path, id });
    if (request.method === 'POST') {
      if (loseFirstPost) { loseFirstPost = false; throw new Error('network_connection_lost'); }
      return json(completedReceipt(request.headers.get('idempotency-key')));
    }
    return json({ error: 'image_request_not_found' }, 404);
  });

  const key = await recoveryKey(fixture);
  const firstError = await invoke(fixture).then(() => null, error => error);
  assert.ok(firstError instanceof Error);
  assert.match(firstError.message, /生成結果を確認できません/);
  const retainedId = firstError.message.match(/依頼 ([0-9a-f-]{36}) を保持/iu)?.[1];
  assert.ok(retainedId, `lost-post error should expose the retained request identity: ${firstError.message}`);
  assert.deepEqual(observed.map(item => [item.method, item.id]), [['POST', retainedId], ['GET', retainedId]]);
  assert.deepEqual(await fixture.pending.readPendingIdentity(key), { state: 'present', requestId: retainedId });
  assert.equal(fixture.storage.legacyMap.get(key), retainedId);

  const second = await invoke(fixture);
  assert.equal(second.requestId, retainedId);
  assert.deepEqual(observed.map(item => [item.method, item.id]), [
    ['POST', retainedId], ['GET', retainedId], ['GET', retainedId], ['POST', retainedId],
  ]);
  assert.deepEqual(await fixture.pending.readPendingIdentity(key), { state: 'present', requestId: retainedId });
});

test('completed exact GET is returned without another POST and stays pending until acknowledged', async t => {
  const fixture = await createFixture(t);
  const observed = [];
  const completed = new Map();
  fixture.setHandler(async request => {
    if (request.method === 'POST') {
      const id = request.headers.get('idempotency-key');
      observed.push(['POST', id]);
      const result = completedReceipt(id);
      completed.set(id, result);
      return json(result);
    }
    const id = request.path.slice('/v1/image-ai/requests/'.length);
    observed.push(['GET', id]);
    return completed.has(id) ? json(completed.get(id)) : json({ error: 'image_request_not_found' }, 404);
  });

  const key = await recoveryKey(fixture);
  const first = await invoke(fixture);
  assert.equal(first.requestId, observed[0][1]);
  assert.deepEqual(observed, [['POST', first.requestId]]);
  const second = await invoke(fixture);
  assert.equal(second.requestId, first.requestId);
  assert.deepEqual(observed, [['POST', first.requestId], ['GET', first.requestId]]);
  assert.deepEqual(await fixture.pending.readPendingIdentity(key), { state: 'present', requestId: first.requestId });
});

test('non-exact absence, server/auth/network failures and unavailable stores never submit a new ID', async t => {
  const fixture = await createFixture(t);
  const cases = [
    { name: 'different 404', response: () => json({ error: 'different_not_found' }, 404) },
    { name: '5xx', response: () => json({ error: 'provider_unavailable' }, 503) },
    { name: '401', response: () => json({ error: 'unauthorized' }, 401) },
    { name: 'network', response: () => { throw new Error('network_read_failed'); } },
  ];
  for (const scenario of cases) {
    fixture.resetStorage();
    fixture.requests.length = 0;
    const key = await recoveryKey(fixture);
    const originalId = crypto.randomUUID();
    await fixture.pending.rememberPendingIdentity(key, originalId);
    fixture.setHandler(async request => scenario.response());
    await assert.rejects(invoke(fixture), undefined, scenario.name);
    assert.deepEqual(fixture.requests.map(request => request.method), ['GET'], scenario.name);
    assert.deepEqual(await fixture.pending.readPendingIdentity(key), { state: 'present', requestId: originalId }, scenario.name);
    assert.equal(fixture.storage.legacyMap.get(key), originalId, scenario.name);
  }

  fixture.resetStorage();
  fixture.requests.length = 0;
  const conflictKey = await recoveryKey(fixture);
  const indexedId = crypto.randomUUID();
  const legacyId = crypto.randomUUID();
  globalThis.localStorage.setItem = () => { throw new Error('quota_full'); };
  await fixture.pending.rememberPendingIdentity(conflictKey, indexedId);
  fixture.storage.legacyMap.set(conflictKey, legacyId);
  await assert.rejects(invoke(fixture), /conflict/u);
  assert.deepEqual(fixture.requests, []);
  assert.equal((await fixture.pending.readPendingIdentity(conflictKey)).state, 'conflict');
  assert.equal(fixture.storage.legacyMap.get(conflictKey), legacyId);
  assert.equal(fixture.storage.indexed.records().get(conflictKey).requestId, indexedId);

  fixture.resetStorage();
  fixture.requests.length = 0;
  const unavailableKey = await recoveryKey(fixture);
  const legacyPendingId = crypto.randomUUID();
  await fixture.pending.rememberPendingIdentity(unavailableKey, legacyPendingId);
  fixture.storage.indexed.unavailable = true;
  fixture.setHandler(async () => json({ error: 'image_request_not_found' }, 404));
  await assert.rejects(invoke(fixture), /unavailable/u);
  assert.deepEqual(fixture.requests.map(request => request.method), ['GET']);
  assert.equal(fixture.storage.legacyMap.get(unavailableKey), legacyPendingId);

  fixture.resetStorage();
  fixture.requests.length = 0;
  fixture.storage.indexed.unavailable = true;
  await assert.rejects(invoke(fixture), /unavailable/u);
  assert.deepEqual(fixture.requests, []);
  assert.equal(fixture.storage.legacyMap.size, 0);
});

test('a fresh SSR module load reuses the same dedicated-IDB and legacy identity', async t => {
  const fixture = await createFixture(t);
  const observed = [];
  let loseFirstPost = true;
  fixture.setHandler(async request => {
    const id = request.method === 'POST'
      ? request.headers.get('idempotency-key')
      : request.path.slice('/v1/image-ai/requests/'.length);
    observed.push([request.method, id]);
    if (request.method === 'POST' && loseFirstPost) { loseFirstPost = false; throw new Error('network_connection_lost'); }
    if (request.method === 'POST') return json(completedReceipt(id));
    return json({ error: 'image_request_not_found' }, 404);
  });

  const key = await recoveryKey(fixture);
  const firstError = await invoke(fixture).then(() => null, error => error);
  assert.ok(firstError instanceof Error);
  const retainedId = firstError.message.match(/依頼 ([0-9a-f-]{36}) を保持/iu)?.[1];
  assert.ok(retainedId);
  assert.deepEqual(await fixture.pending.readPendingIdentity(key), { state: 'present', requestId: retainedId });
  assert.equal(fixture.storage.legacyMap.get(key), retainedId);

  observed.length = 0;
  await fixture.reloadModules();
  const result = await invoke(fixture);
  assert.equal(result.requestId, retainedId);
  assert.deepEqual(observed, [['GET', retainedId], ['POST', retainedId]]);
  assert.deepEqual(await fixture.pending.readPendingIdentity(key), { state: 'present', requestId: retainedId });
  assert.equal(fixture.storage.legacyMap.get(key), retainedId);
});

test('user, token and caller-context changes fence requests without erasing the pending ID', async t => {
  const fixture = await createFixture(t);
  const priorId = crypto.randomUUID();
  const aliceKey = await recoveryKey(fixture, USER_ID);
  await fixture.pending.rememberPendingIdentity(aliceKey, priorId);
  fixture.setSession('bob', 'bob-token');
  fixture.requests.length = 0;
  fixture.setHandler(async request => json(completedReceipt(request.headers.get('idempotency-key'))));
  const bobResult = await invoke(fixture);
  assert.notEqual(bobResult.requestId, priorId);
  assert.deepEqual(fixture.requests.map(request => request.method), ['POST']);
  const bobKey = await recoveryKey(fixture, 'bob');
  assert.notEqual(bobKey, aliceKey);
  assert.deepEqual(await fixture.pending.readPendingIdentity(aliceKey), { state: 'present', requestId: priorId });
  assert.deepEqual(await fixture.pending.readPendingIdentity(bobKey), { state: 'present', requestId: bobResult.requestId });

  for (const change of ['user', 'token']) {
    fixture.resetStorage();
    fixture.setSession(USER_ID, TOKEN);
    fixture.requests.length = 0;
    const key = await recoveryKey(fixture);
    const requestId = crypto.randomUUID();
    await fixture.pending.rememberPendingIdentity(key, requestId);
    fixture.setHandler(async request => {
      fixture.setSession(change === 'user' ? 'bob' : USER_ID, change === 'token' ? 'changed-token' : TOKEN);
      return json(completedReceipt(requestId));
    });
    await assert.rejects(invoke(fixture), /session_changed/u, change);
    assert.deepEqual(fixture.requests.map(request => request.method), ['GET'], change);
    assert.deepEqual(await fixture.pending.readPendingIdentity(key), { state: 'present', requestId }, change);
  }

  fixture.resetStorage();
  fixture.setSession(USER_ID, TOKEN);
  fixture.requests.length = 0;
  let contextCurrent = true;
  fixture.storage.indexed.onCommit = (database, mode) => {
    if (database === 'heavy-chain-image-pending-identities' && mode === 'readwrite') contextCurrent = false;
  };
  globalThis.localStorage.setItem = () => { throw new Error('quota_full'); };
  fixture.setHandler(async () => { throw new Error('unexpected_provider_call'); });
  await assert.rejects(invoke(fixture, DEFAULT_BODY, { assertContext: () => { if (!contextCurrent) throw new Error('scope_changed'); } }), /scope_changed/u);
  assert.deepEqual(fixture.requests, []);
  const contextKey = await recoveryKey(fixture);
  assert.equal((await fixture.pending.readPendingIdentity(contextKey)).state, 'present');
});

test('explicit caller IDs preserve strict conflict, exact GET and exact POST behavior', async t => {
  const fixture = await createFixture(t);
  const key = await recoveryKey(fixture);
  const pendingId = crypto.randomUUID();
  const explicitId = crypto.randomUUID();
  await fixture.pending.rememberPendingIdentity(key, pendingId);
  fixture.requests.length = 0;
  fixture.setHandler(async () => json({ error: 'image_request_not_found' }, 404));
  await assert.rejects(invoke(fixture, DEFAULT_BODY, { idempotencyKey: explicitId }), /未照合/u);
  assert.deepEqual(fixture.requests, []);
  assert.deepEqual(await fixture.pending.readPendingIdentity(key), { state: 'present', requestId: pendingId });

  fixture.resetStorage();
  fixture.requests.length = 0;
  await fixture.pending.rememberPendingIdentity(key, explicitId);
  fixture.setHandler(async request => json(completedReceipt(request.path.slice('/v1/image-ai/requests/'.length))));
  const matching = await invoke(fixture, DEFAULT_BODY, { idempotencyKey: explicitId });
  assert.equal(matching.requestId, explicitId);
  assert.deepEqual(fixture.requests.map(request => [request.method, request.path]), [['GET', `/v1/image-ai/requests/${explicitId}`]]);

  fixture.resetStorage();
  fixture.requests.length = 0;
  fixture.setHandler(async request => json(completedReceipt(request.headers.get('idempotency-key'))));
  const absent = await invoke(fixture, DEFAULT_BODY, { idempotencyKey: explicitId });
  assert.equal(absent.requestId, explicitId);
  assert.deepEqual(fixture.requests.map(request => [request.method, request.headers.get('idempotency-key')]), [['POST', explicitId]]);
});

test('legacy Heavy consent keeps one request ID and the same valid input proof through provider admission', async t => {
  const fixture = await createFixture(t);
  const cases = [
    { label: 'implicit', idempotencyKey: undefined },
    { label: 'explicit', idempotencyKey: crypto.randomUUID() },
  ];
  for (const scenario of cases) {
    fixture.resetStorage();
    fixture.requests.length = 0;
    const observed = { prepare: [], acceptance: [], attestation: [], provider: [] };
    fixture.api.prepareHeavyGeneration = async input => {
      observed.prepare.push(input);
      const bytes = new TextEncoder().encode(JSON.stringify(input.input));
      const digest = Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256', bytes)), byte => byte.toString(16).padStart(2, '0')).join('');
      observed.preparedDigest = digest;
      return {
        preparationId: crypto.randomUUID(), inputDigest: digest, expiresAt: new Date(Date.now() + 60_000).toISOString(),
        termsVersion: 'terms-v1', termsDocumentVersion: 'terms-doc-v1', termsDocumentDigest: 'a'.repeat(64),
        rightsVersion: 'rights-v1', rightsDocumentVersion: 'rights-doc-v1', rightsDocumentDigest: 'b'.repeat(64),
      };
    };
    fixture.api.getHeavyEntitlement = async () => ({ termsAcceptanceId: null });
    fixture.api.recordHeavyTermsAcceptance = async input => {
      observed.acceptance.push(input);
      return { success: true, acceptanceId: 'acceptance-fixture', acceptedAt: new Date().toISOString(), termsVersion: 'terms-v1', documentVersion: 'terms-doc-v1', documentDigest: 'a'.repeat(64) };
    };
    fixture.api.recordHeavyRequestAttestation = async input => {
      observed.attestation.push(input);
      return { success: true, requestId: input.requestId, inputDigest: input.preflight.inputDigest, termsAcceptanceId: 'acceptance-fixture', rightsAttestationId: null,
        termsVersion: 'terms-v1', documentVersion: 'terms-doc-v1', documentDigest: 'a'.repeat(64), rightsVersion: 'rights-v1',
        rightsDocumentVersion: 'rights-doc-v1', rightsDocumentDigest: 'b'.repeat(64), requestScopedAttestationRequired: false };
    };
    fixture.setHandler(async request => {
      if (request.method === 'POST') {
        observed.provider.push(request);
        return json(completedReceipt(request.headers.get('idempotency-key')));
      }
      return json({ error: 'image_request_not_found' }, 404);
    });
    const options = { heavyConsent: { termsAccepted: true, rightsAttested: true } };
    if (scenario.idempotencyKey) options.idempotencyKey = scenario.idempotencyKey;
    const result = await fixture.api.invokeProviderAction('generate-image', { ...DEFAULT_BODY }, options);
    const requestId = scenario.idempotencyKey ?? observed.prepare[0].requestId;
    assert.equal(result.requestId, requestId, scenario.label);
    assert.equal(observed.prepare[0].requestId, requestId, scenario.label);
    assert.equal(observed.acceptance[0].requestId, requestId, scenario.label);
    assert.equal(observed.attestation[0].requestId, requestId, scenario.label);
    assert.equal(observed.provider[0].headers.get('idempotency-key'), requestId, scenario.label);
    const proof = observed.attestation[0].preflight;
    const attestedBytes = new TextEncoder().encode(JSON.stringify(observed.attestation[0].providerInput));
    const attestedDigest = Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256', attestedBytes)), byte => byte.toString(16).padStart(2, '0')).join('');
    assert.equal(attestedDigest, proof.inputDigest, scenario.label);
    assert.equal(observed.provider[0].body.preparationId, proof.preparationId, scenario.label);
    assert.equal(observed.provider[0].body.inputDigest, proof.inputDigest, scenario.label);
    assert.equal(observed.provider[0].body.inputDigest, observed.preparedDigest, scenario.label);
  }
});

test('protected edit binds snapshots and finalization to the helper ID, retains until acknowledgement, and cleans terminals', async t => {
  const fixture = await createFixture(t);
  class FixtureImageData {
    constructor(data, width, height) { this.data = data; this.width = width; this.height = height; }
  }
  class FixtureImage {
    naturalWidth = 2;
    naturalHeight = 2;
    width = 2;
    height = 2;
    set src(value) { this.source = value; queueMicrotask(() => this.onload?.()); }
  }
  class FixtureFileReader {
    readAsDataURL(blob) {
      blob.arrayBuffer().then(bytes => {
        this.result = `data:${blob.type};base64,${Buffer.from(bytes).toString('base64')}`;
        this.onload?.();
      }, error => { this.error = error; this.onerror?.(); });
    }
  }
  globalThis.Image = FixtureImage;
  globalThis.ImageData = FixtureImageData;
  globalThis.FileReader = FixtureFileReader;
  globalThis.document = {
    createElement(name) {
      assert.equal(name, 'canvas');
      const canvas = { width: 1, height: 1 };
      const context = {
        imageSmoothingEnabled: false,
        imageSmoothingQuality: 'low',
        drawImage() {}, clearRect() {}, putImageData() {},
        getImageData() { return new FixtureImageData(new Uint8ClampedArray([100, 120, 140, 128]), canvas.width, canvas.height); },
      };
      canvas.getContext = () => context;
      canvas.toDataURL = () => 'data:image/png;base64,YQ==';
      canvas.toBlob = callback => callback(new Blob([Uint8Array.from([1, 2, 3])], { type: 'image/png' }));
      return canvas;
    },
  };

  const savedInputs = [];
  const snapshotsAtPost = [];
  let state = 'completed';
  fixture.api.saveWorkspaceArtifact = async input => {
    savedInputs.push(input);
    const imageId = `wa-${input.requestId}`;
    return { success: true, remote: { jobId: imageId, imageId, storagePath: `generated-images/${imageId}` }, metadata: input.metadata };
  };
  fixture.setHandler(async request => {
    if (request.method === 'POST' && request.path === '/v1/provider-actions/edit-image') {
      const requestId = request.headers.get('idempotency-key');
      if (state === 'completed') {
        const imageId = `ai-${requestId}-0`;
        const database = fixture.storage.indexed.databases.get('heavy-chain-canvas-assets');
        const entries = [...(database?.stores.get('images')?.values() ?? [])];
        snapshotsAtPost.push(entries.length ? JSON.parse(await entries[0].blob.text()) : null);
        return json(completedReceipt(requestId, {
          provider: 'workers_ai', backendProvider: 'cloudflare-workers-ai', providerModel: '@cf/black-forest-labs/flux-2-klein-4b',
          jobId: `ai-${requestId}`, featureType: 'edit-image', requestedCandidateCount: 1,
          protectedEdit: request.body.protectedEdit,
          images: [{ candidateIndex: 0, imageId, jobId: `ai-${requestId}`, storagePath: `generated-images/${imageId}`, imageUrl: 'https://provider.test/image.png' }],
        }));
      }
      const database = fixture.storage.indexed.databases.get('heavy-chain-canvas-assets');
      const entries = [...(database?.stores.get('images')?.values() ?? [])];
      snapshotsAtPost.push(entries.length ? JSON.parse(await entries[0].blob.text()) : null);
      return json({ success: false, requestId, state: 'failed', recovery: 'terminal' });
    }
    if (request.method === 'GET' && request.path.startsWith('/v1/workspace-artifacts/')) {
      return json({ error: 'workspace_artifact_not_found' }, 404);
    }
    if (request.method === 'GET' && request.path === '/v1/media/read') return json({ url: 'https://media.test/final.png' });
    return json({ error: 'unexpected_path' }, 500);
  });

  const completed = await fixture.api.invokeProviderAction('edit-image', {
    brandId: 'brand', prompt: 'protected edit success', imageUrls: ['https://input.test/source.png'],
    maskDataUrl: 'data:image/png;base64,Yg==',
  });
  const completedKey = completed.clientRecoveryKey;
  assert.match(completedKey, /^heavy:image-ai:v1:https:\/\/heavy\.test:alice:brand:/u);
  assert.equal(snapshotsAtPost.length, 1);
  assert.equal(snapshotsAtPost[0].requestId, completed.requestId);
  assert.equal(snapshotsAtPost[0].clientRecoveryKey, completedKey);
  assert.equal(savedInputs.length, 1);
  assert.equal(savedInputs[0].imageAI.requestId, completed.requestId);
  assert.equal(savedInputs[0].imageAI.candidateIndex, 0);
  assert.deepEqual(await fixture.pending.readPendingIdentity(completedKey), { state: 'present', requestId: completed.requestId });
  assert.equal((await fixture.cache.listProtectedImageInputs({ origin: ORIGIN, userId: USER_ID, brandId: 'brand' })).length, 1);

  await fixture.api.acknowledgeImageAction(completed);
  assert.deepEqual(await fixture.pending.readPendingIdentity(completedKey), { state: 'absent' });
  assert.deepEqual(await fixture.cache.listProtectedImageInputs({ origin: ORIGIN, userId: USER_ID, brandId: 'brand' }), []);

  state = 'failed';
  const failed = await fixture.api.invokeProviderAction('edit-image', {
    brandId: 'brand', prompt: 'protected edit terminal failure', imageUrls: ['https://input.test/source.png'],
    maskDataUrl: 'data:image/png;base64,Yg==',
  });
  assert.equal(failed.state, 'failed');
  assert.equal(snapshotsAtPost.length, 2);
  assert.equal(snapshotsAtPost[1].requestId, failed.requestId);
  assert.match(snapshotsAtPost[1].clientRecoveryKey, /^heavy:image-ai:v1:https:\/\/heavy\.test:alice:brand:/u);
  assert.deepEqual(await fixture.cache.listProtectedImageInputs({ origin: ORIGIN, userId: USER_ID, brandId: 'brand' }), []);
  assert.deepEqual(await fixture.pending.readPendingIdentity(snapshotsAtPost[1].clientRecoveryKey), { state: 'absent' });
});
