import assert from 'node:assert/strict';
import test, { after } from 'node:test';
import fs from 'node:fs/promises';
import ts from 'typescript';
import { createServer } from 'vite';
import { createPendingIndexedDbHarness, createPendingLegacyStorage } from './verify-cloudflare-image-pending-store.test.mjs';

// Execute the production initialization effect, not a parallel restoration implementation.
const root = new URL('..', import.meta.url).pathname;
const originalGlobals = Object.fromEntries(['window', 'localStorage', 'sessionStorage', 'indexedDB', 'FileReader'].map(key => [key, globalThis[key]]));
const vite = await createServer({ root, configFile: false, envFile: false, cacheDir: `/tmp/canonical-library-${process.pid}`, appType: 'custom', logLevel: 'silent', server: { middlewareMode: true }, plugins: [{
  name: 'canonical-library-read-only-fixture', enforce: 'pre',
  resolveId(id) {
    if (/\/storage(?:\.ts)?$/.test(id)) return '\0fixture-storage';
    if (/\/cloudflareApi(?:\.ts)?$/.test(id)) return '\0fixture-cloudflare';
  },
  load(id) {
    if (id === '\0fixture-storage') return 'export const withSignedImageUrls=(...args)=>globalThis.__canonicalLibrarySign(...args);';
    if (id === '\0fixture-cloudflare') return 'export class ArtifactPersistenceContextError extends Error{};export const cloudflareDataPlane=null;';
  },
}] });
const assets = await vite.ssrLoadModule('/src/lib/canvasLocalAssets.ts');
const readback = await vite.ssrLoadModule('/src/lib/workspaceArtifactImageReadback.ts');
const workspace = await vite.ssrLoadModule('/src/lib/localWorkspaceArtifacts.ts');
const auth = await vite.ssrLoadModule('/src/lib/authBrandSelection.ts');
const resume = await vite.ssrLoadModule('/src/lib/lightchainResume.ts');
const safety = await vite.ssrLoadModule('/src/lib/storagePathSafety.ts');
const modelLibrarySettings = await vite.ssrLoadModule('/src/lib/modelLibrarySettings.ts');
const modelToolSettings = await vite.ssrLoadModule('/src/lib/modelToolSettings.ts');
const source = await fs.readFile(new URL('../src/hooks/useCanonicalImageWorkspace.ts', import.meta.url), 'utf8');
const ast = ts.createSourceFile('canonical.ts', source, ts.ScriptTarget.Latest, true, ts.ScriptKind.TS);
const nodes = [];
const walk = node => { nodes.push(node); ts.forEachChild(node, walk); }; walk(ast);
const effects = nodes.filter(node => ts.isCallExpression(node) && node.expression.getText(ast) === 'useEffect');
const initialize = effects.find(node => node.arguments[0].getText(ast).includes('const token = ++sequence.current'));
const mount = effects.find(node => node.arguments[0].getText(ast).includes('mounted.current = true'));
assert.ok(initialize && mount);
const evaluate = (code, bindings) => new Function('bindings', `with(bindings){${ts.transpile(`return (${code});`, { target: ts.ScriptTarget.ES2022 })}}`)(new Proxy(bindings, {
  has: () => true,
  get: (object, key) => key === Symbol.unscopables ? undefined : key in object ? object[key] : globalThis[key],
}));
const idle = () => new Promise(resolve => setImmediate(resolve));
const deferred = () => { let resolve, reject; const promise = new Promise((yes, no) => { resolve = yes; reject = no; }); return { promise, resolve, reject }; };
const defaults = { gender: '男性', bodyTypes: ['regular'], ageGroups: ['20s'] };
const originalArtifact = overrides => ({ id: 'original-id', brandId: 'brand', scopeId: 'alice', featureType: 'library', title: 'Original garment', prompt: null, createdAt: '2026-10-04', imageUrl: '', metadata: {}, ...overrides });
const DataUrlReader = class {
  readAsDataURL(blob) {
    blob.arrayBuffer().then(buffer => { this.result = `data:${blob.type};base64,${Buffer.from(buffer).toString('base64')}`; this.onload(); }, () => this.onerror());
  }
};

function fixture({ search = '?libraryArtifactId=original-id', toolId = 'model-custom', artifacts = [], readGate = null, sign = null } = {}) {
  const indexed = createPendingIndexedDbHarness();
  const storage = createPendingLegacyStorage();
  const session = createPendingLegacyStorage();
  globalThis.window = { localStorage: storage, dispatchEvent() {} };
  globalThis.localStorage = storage; globalThis.sessionStorage = session;
  globalThis.indexedDB = indexed; globalThis.FileReader = DataUrlReader;
  const calls = { list: 0, read: 0, sign: [], forbidden: [], storageEffects: [], releases: 0 };
  const fixtureWrite = storage.setItem.bind(storage);
  let effectStarted = false, assetLogStart = 0;
  for (const [name, store] of [['localStorage', storage], ['sessionStorage', session]]) {
    for (const operation of ['setItem', 'removeItem']) {
      const original = store[operation].bind(store);
      store[operation] = (...args) => { if (effectStarted) calls.storageEffects.push(`${name}.${operation}`); return original(...args); };
    }
  }
  const forbidden = name => (..._args) => { calls.forbidden.push(name); throw new Error(`forbidden:${name}`); };
  const authState = { user: { id: 'alice' }, currentBrand: { id: 'brand' }, brandState: { status: 'success_nonempty', userId: 'alice', requestGeneration: 1, confirmedBrandIds: ['brand'], error: null } };
  const bindings = {
    ...modelLibrarySettings,
    ...modelToolSettings,
    location: { pathname: '/heavy/model/custom', search, hash: '' }, toolId,
    scope: 'current-scope', scopeRef: { current: 'current-scope' }, mounted: { current: true }, sequence: { current: 0 },
    uploadSequence: { current: { primary: 0, secondary: 0 } }, busy: { current: false }, releases: { current: {} }, restoredArtifact: { current: null }, pending: { current: null },
    configRef: { current: { initialInputState: structuredClone(defaults) } },
    authSnapshot: () => auth.captureAuthBrandFence(authState.brandState, authState.user?.id ?? null, authState.currentBrand?.id ?? null),
    isAuthBrandFenceValid: auth.isAuthBrandFenceValid, assertAuthBrandFence: auth.assertAuthBrandFence,
    ...safety,
    listWorkspaceArtifacts: (...args) => { calls.list++; assert.deepEqual(args, ['brand', 'alice']); return workspace.listWorkspaceArtifacts(...args); },
    readWorkspaceArtifactImage: async (...args) => { calls.read++; if (readGate) await readGate.promise; return readback.readWorkspaceArtifactImage(...args); },
    readLightchainResumeInput: resume.readLightchainResumeInput, readLightchainResumeResult: resume.readLightchainResumeResult,
    isLocalCanvasAssetReference: assets.isLocalCanvasAssetReference,
    resolveLocalCanvasAsset: assets.resolveLocalCanvasAsset,
    withSignedImageUrls: (...args) => globalThis.__canonicalLibrarySign(...args),
    dimensions: forbidden('unexpected dimensions'),
    cloudflareDataPlane: new Proxy({}, { get: (_object, name) => forbidden(`cloudflare.${String(name)}`) }),
  };
  for (const name of ['generateImage', 'generateModelMatrix', 'editImageWithPrompt', 'persistProviderResultArtifact', 'saveWorkspaceArtifactPersisted', 'deleteLocalCanvasAsset', 'putLocalCanvasAsset', 'saveCanvas', 'navigate']) bindings[name] = forbidden(name);
  globalThis.__canonicalLibrarySign = async rows => { calls.sign.push(structuredClone(rows)); return sign ? sign(rows) : rows.map(row => ({ ...row, image_url: `fresh:${row.storage_path}:${calls.sign.length}` })); };
  for (const name of ['jobId', 'libraryArtifactId', 'librarySlot']) {
    const declaration = nodes.find(node => ts.isVariableDeclaration(node) && node.name.getText(ast) === name);
    bindings[name] = evaluate(declaration.initializer.getText(ast), bindings);
  }
  bindings.pendingKey = `heavy:canonical-image-workspace:v1:alice:brand:model-custom:${bindings.jobId ?? 'fresh'}`;
  for (const name of ['record', 'emptyState', 'sanitizeInputState', 'readCandidates']) {
    const declaration = nodes.find(node => ts.isVariableDeclaration(node) && node.name.getText(ast) === name);
    bindings[name] = evaluate(declaration.initializer.getText(ast), bindings);
  }
  const states = [];
  let state = bindings.emptyState();
  bindings.setState = next => { state = typeof next === 'function' ? next(state) : next; states.push(structuredClone(state)); };
  bindings.releaseAll = () => { Object.values(bindings.releases.current).forEach(value => value?.release()); bindings.releases.current = {}; calls.releases++; };
  const persist = rows => fixtureWrite(workspace.getWorkspaceArtifactStorageKey('brand', 'alice'), JSON.stringify(rows));
  persist(artifacts);
  const mountCleanup = evaluate(mount.arguments[0].getText(ast), bindings)();
  let cleanup;
  const run = () => { cleanup?.(); if (!effectStarted) assetLogStart = indexed.log.length; effectStarted = true; cleanup = evaluate(initialize.arguments[0].getText(ast), bindings)(); };
  const unmount = () => { cleanup?.(); mountCleanup(); };
  const safe = () => {
    assert.deepEqual(calls.forbidden, []); assert.deepEqual(calls.storageEffects, []);
    assert.equal(indexed.log.some(entry => entry.operation === 'delete'), false);
    assert.equal(indexed.log.slice(assetLogStart).some(entry => entry.mode === 'readwrite'), false);
  };
  return { bindings, calls, authState, states, indexed, storage, session, persist, run, unmount, safe, get state() { return state; } };
}
async function localOriginal(f) {
  const bytes = Buffer.from([137, 80, 78, 71, 13, 10, 26, 10, 0, 255, 40, 128]);
  const reference = assets.buildLocalCanvasAssetReference(crypto.randomUUID());
  await assets.putLocalCanvasAsset(decodeURIComponent(reference.split('://')[1]), new Blob([bytes], { type: 'image/png' }));
  return { bytes, reference, artifact: originalArtifact({ imageUrl: reference }) };
}
async function settle(f) { for (let i = 0; i < 30 && f.state.status === 'loading'; i++) await idle(); assert.notEqual(f.state.status, 'loading', 'effect must settle'); }
function assertReady(f, artifact, destination = 'primary') {
  assert.equal(f.state.status, 'ready'); assert.equal(f.state.error, null);
  assert.equal(f.state.slots[destination].sourceImageId, artifact.id);
  assert.equal(f.state.slots[destination].name, artifact.title); assert.equal(f.state.slots[destination === 'primary' ? 'secondary' : 'primary'], null);
  assert.equal(f.state.result, null); assert.deepEqual(f.state.inputState, defaults);
  assert.equal(f.state.inputsAvailable, true); assert.equal(f.state.originalInputsAvailable, true); f.safe();
}

for (const slot of ['', '&librarySlot=primary']) test(`production canonical effect restores original local bytes and primary preview on remount (${slot || 'default slot'})`, async () => {
  const f = fixture({ search: `?libraryArtifactId=original-id${slot}` });
  const original = await localOriginal(f);
  const generated = originalArtifact({ id: 'generated-result', imageUrl: 'data:image/png;base64,Z2VuZXJhdGVk', featureType: 'lightchain-model-custom-provider-result', metadata: { sourceImageId: original.artifact.id } });
  f.persist([original.artifact, generated]);
  for (let remount = 0; remount < 2; remount++) {
    f.run(); await settle(f); assertReady(f, original.artifact);
    assert.equal(f.state.slots.primary.localAssetRef, original.reference); assert.equal(f.state.slots.primary.sourceStoragePath, null);
    assert.deepEqual(Buffer.from(f.state.slots.primary.imageUrl.split(',')[1], 'base64'), original.bytes);
    assert.deepEqual(Buffer.from(await (await assets.getLocalCanvasAsset(original.reference)).arrayBuffer()), original.bytes);
    assert.equal(workspace.listWorkspaceArtifacts('brand', 'alice').find(row => row.id === original.artifact.id).imageUrl, original.reference);
    assert.equal(f.calls.sign.length, 0); f.unmount();
    // Real mount cleanup invalidates sequence; re-enable via the actual mount effect.
    evaluate(mount.arguments[0].getText(ast), f.bindings)();
  }
  f.safe();
});

test('printing-design restores exact secondary original bytes and identity across remount, leaving primary empty', async () => {
  const f = fixture({ search: '?libraryArtifactId=original-id&librarySlot=printing-design', toolId: 'printing-image' });
  const original = await localOriginal(f); f.persist([original.artifact]);
  for (let mountIndex = 0; mountIndex < 2; mountIndex++) {
    f.run(); await settle(f); assertReady(f, original.artifact, 'secondary');
    assert.equal(f.state.slots.secondary.localAssetRef, original.reference);
    assert.equal(f.state.slots.secondary.sourceStoragePath, null);
    assert.deepEqual(Buffer.from(f.state.slots.secondary.imageUrl.split(',')[1], 'base64'), original.bytes);
    assert.deepEqual(Buffer.from(await (await assets.getLocalCanvasAsset(original.reference)).arrayBuffer()), original.bytes);
    f.unmount(); evaluate(mount.arguments[0].getText(ast), f.bindings)();
  }
  assert.equal(workspace.listWorkspaceArtifacts('brand', 'alice')[0].imageUrl, original.reference); f.safe();
});

test('printing-design preserves remote original path and refreshes its signature on reload', async () => {
  const artifact = originalArtifact({ metadata: { remoteStoragePath: 'generated-images/original-id' } });
  const f = fixture({ search: '?libraryArtifactId=original-id&librarySlot=printing-design', toolId: 'printing-image', artifacts: [artifact] });
  for (let index = 1; index <= 2; index++) {
    f.run(); await settle(f); assertReady(f, artifact, 'secondary');
    assert.equal(f.state.slots.secondary.sourceStoragePath, 'generated-images/original-id');
    assert.equal(f.state.slots.secondary.imageUrl, `fresh:generated-images/original-id:${index}`);
  }
  f.unmount(); f.safe();
});

test('remote canonical original identity/path gets a fresh signature each mount; expired URL and generated fixture are never inputs', async () => {
  const artifact = originalArtifact({ imageUrl: 'https://expired.test/original', metadata: { remoteStoragePath: 'generated-images/original-id' } });
  const f = fixture({ artifacts: [artifact, originalArtifact({ id: 'generated-result', metadata: { remoteStoragePath: 'generated-images/generated-result' } })] });
  for (let remount = 1; remount <= 2; remount++) {
    f.run(); await settle(f); assertReady(f, artifact);
    assert.equal(f.state.slots.primary.sourceStoragePath, 'generated-images/original-id'); assert.equal(f.state.slots.primary.localAssetRef, undefined);
    assert.equal(f.state.slots.primary.imageUrl, `fresh:generated-images/original-id:${remount}`);
  }
  assert.deepEqual(f.calls.sign, [[{ storage_path: 'generated-images/original-id', image_url: '' }], [{ storage_path: 'generated-images/original-id', image_url: '' }]]); f.unmount(); f.safe();
});

for (const failure of ['foreign-owner', 'foreign-brand', 'logout', 'auth-pending', 'unconfirmed-brand', 'missing-artifact', 'missing-bytes', 'inaccessible-idb', 'read-failure', 'sign-failure']) test(`original unavailable with ${failure}; no replacement/effects`, async () => {
  const f = fixture(); const original = await localOriginal(f); let artifact = original.artifact;
  if (failure === 'foreign-owner') artifact.scopeId = 'bob';
  if (failure === 'foreign-brand') artifact.brandId = 'other';
  if (failure === 'logout') f.authState.user = null;
  if (failure === 'auth-pending') f.authState.brandState.status = 'pending';
  if (failure === 'unconfirmed-brand') f.authState.brandState.confirmedBrandIds = ['other'];
  if (failure === 'missing-bytes') artifact.imageUrl = assets.buildLocalCanvasAssetReference('missing');
  if (failure === 'inaccessible-idb') f.indexed.unavailable = true;
  if (failure === 'read-failure') globalThis.FileReader = class { readAsDataURL() { queueMicrotask(() => this.onerror()); } };
  if (failure === 'sign-failure') { artifact = originalArtifact({ metadata: { remoteStoragePath: 'generated-images/original-id' } }); globalThis.__canonicalLibrarySign = async rows => { f.calls.sign.push(rows); return []; }; }
  const generated = originalArtifact({ id: 'generated-result', imageUrl: 'data:image/png;base64,Z2VuZXJhdGVk' });
  f.persist(failure === 'missing-artifact' ? [generated] : [artifact, generated]);
  f.run(); await settle(f); assert.equal(f.state.status, 'unavailable'); assert.equal(f.state.slots.primary, null); assert.equal(f.state.result, null); assert.ok(f.state.error);
  if (['logout', 'auth-pending', 'unconfirmed-brand'].includes(failure)) assert.equal(f.calls.list, 0);
  if (['foreign-owner', 'foreign-brand', 'missing-artifact'].includes(failure)) assert.equal(f.calls.read, 0);
  assert.equal(f.calls.sign.length, failure === 'sign-failure' ? 1 : 0); f.unmount(); f.safe();
});

for (const slot of ['secondary', 'printing-design', 'fabric-design', 'unknown', '']) test(`unsupported explicit librarySlot=${JSON.stringify(slot)} rejected before asset read/sign`, async () => {
  const f = fixture({ search: `?libraryArtifactId=original-id&librarySlot=${slot}`, artifacts: [originalArtifact({ metadata: { remoteStoragePath: 'generated-images/original-id' } })] });
  f.run(); await settle(f); assert.equal(f.state.status, 'unavailable'); assert.equal(f.state.slots.primary, null);
  assert.equal(f.calls.list, 0); assert.equal(f.calls.read, 0); assert.equal(f.calls.sign.length, 0); f.unmount(); f.safe();
});

test('retained pending operation suppresses all Library list/read/sign and preserves unknown ID/state', async () => {
  const f = fixture({ artifacts: [originalArtifact({ metadata: { remoteStoragePath: 'generated-images/original-id' } })] });
  const retained = { requestId: 'pending-original', originJob: null, brief: 'retained request', referenceNote: '', materialSlots: [] };
  f.session.setItem(f.bindings.pendingKey, JSON.stringify(retained)); f.run(); await idle();
  assert.equal(f.state.status, 'unknown'); assert.equal(f.state.pendingId, retained.requestId); assert.deepEqual(f.bindings.pending.current, retained);
  assert.equal(f.state.slots.primary, null); assert.equal(f.calls.list, 0); assert.equal(f.calls.read, 0); assert.equal(f.calls.sign.length, 0);
  assert.equal(f.session.getItem(f.bindings.pendingKey), JSON.stringify(retained)); f.unmount(); f.safe();
});

for (const stale of ['scope', 'sequence', 'auth-owner', 'brand', 'auth-generation', 'auth-status', 'artifact-url', 'unmount']) for (const rejects of [false, true]) test(`late ${rejects ? 'failure' : 'success'} discarded after ${stale}`, async () => {
  const hold = deferred(); const f = fixture({ readGate: hold }); const original = await localOriginal(f);
  f.persist([original.artifact]); f.run(); assert.equal(f.state.status, 'loading'); const before = f.states.length;
  if (stale === 'scope') f.bindings.scopeRef.current = 'new-scope';
  if (stale === 'sequence') f.bindings.sequence.current++;
  if (stale === 'auth-owner') f.authState.user = { id: 'bob' };
  if (stale === 'brand') f.authState.currentBrand = { id: 'other' };
  if (stale === 'auth-generation') f.authState.brandState.requestGeneration++;
  if (stale === 'auth-status') f.authState.brandState.status = 'pending';
  if (stale === 'artifact-url') { f.bindings.location.search = '?libraryArtifactId=other-original'; f.bindings.scopeRef.current = 'changed-artifact-scope'; }
  if (stale === 'unmount') f.unmount();
  rejects ? hold.reject(new Error('late read failure')) : hold.resolve(); await idle(); await idle();
  assert.equal(f.states.length, before); assert.equal(f.state.slots.primary, null); assert.equal(f.state.error, null); f.safe();
});

test('scope switches to a different artifact: earlier completion cannot replace the current source', async () => {
  const hold = deferred(); const f = fixture({ readGate: hold });
  const first = await localOriginal(f), second = originalArtifact({ id: 'second-original', imageUrl: 'data:image/png;base64,c2Vjb25k' }); f.persist([first.artifact, second]);
  f.run(); f.bindings.scope = 'second-scope'; f.bindings.scopeRef.current = 'second-scope'; f.bindings.libraryArtifactId = second.id;
  f.run(); hold.resolve(); await settle(f); assertReady(f, second); assert.equal(f.state.slots.primary.imageUrl, second.imageUrl); f.unmount(); f.safe();
});

test('signing in flight cannot commit a preview or error after auth or scope revocation', async () => {
  for (const rejects of [false, true]) {
    const hold = deferred(); const f = fixture({ artifacts: [originalArtifact({ metadata: { remoteStoragePath: 'generated-images/original-id' } })], sign: () => hold.promise });
    f.run(); await idle(); assert.equal(f.calls.sign.length, 1); const before = f.states.length;
    f.authState.user = null; f.bindings.scopeRef.current = 'logout-scope';
    rejects ? hold.reject(new Error('late signing failure')) : hold.resolve([{ image_url: 'late-signed-url' }]); await idle();
    assert.equal(f.states.length, before); assert.equal(f.state.slots.primary, null); assert.equal(f.state.error, null); f.unmount(); f.safe();
  }
});

for (const both of [false, true]) test(`resumeJob remains authoritative (${both ? 'both IDs, unsupported Library slot' : 'resume only'}) with actual resume helpers`, async () => {
  const inputPath = 'generated-images/resume-input', resultPath = 'generated-images/resume-result';
  const resumed = originalArtifact({ id: 'resume-artifact', featureType: 'lightchain-model-custom-provider-result', sourceJobId: 'saved-job', metadata: {
    toolId: 'model-custom', inputState: defaults, originalInputsAvailable: true, providerResultArtifact: true, remoteStoragePath: resultPath,
    imageId: 'resume-result', generationMode: 'provider', materialSlots: [{ key: 'primary', fileName: 'Saved input', materialKind: 'garment', imageUrl: '', sourceImageId: 'resume-input', sourceStoragePath: inputPath }], brief: 'saved brief', referenceNote: 'saved note',
  } });
  const f = fixture({ search: `?resumeJob=saved-job${both ? '&libraryArtifactId=original-id&librarySlot=secondary' : ''}`, artifacts: [resumed, originalArtifact({ imageUrl: 'data:image/png;base64,bGlicmFyeQ==' })] });
  f.run(); await settle(f); assert.equal(f.state.status, 'saved'); assert.equal(f.state.slots.primary.sourceImageId, 'resume-input');
  assert.equal(f.state.result.artifactId, resumed.id); assert.equal(f.state.result.storagePath, resultPath); assert.deepEqual(f.state.inputState, defaults);
  assert.equal(f.calls.read, 0); assert.deepEqual(f.calls.sign, [[{ storage_path: inputPath, image_url: '' }], [{ storage_path: resultPath, image_url: '' }]]); f.unmount(); f.safe();
});

after(async () => { Object.assign(globalThis, originalGlobals); delete globalThis.__canonicalLibrarySign; await vite.close(); });
