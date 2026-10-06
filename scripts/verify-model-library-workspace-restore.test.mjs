import assert from 'node:assert/strict';
import test, { after } from 'node:test';
import fs from 'node:fs/promises';
import path from 'node:path';
import { tmpdir } from 'node:os';
import ts from 'typescript';
import { createServer } from 'vite';

const root = new URL('..', import.meta.url).pathname;
const cacheDir = await fs.mkdtemp(path.join(tmpdir(), 'heavy-model-library-verify-'));
const vite = await createServer({ root, cacheDir, configFile: false, envFile: false, appType: 'custom', logLevel: 'silent', server: { middlewareMode: true }, plugins: [{ name: 'model-library-read-fixtures', enforce: 'pre',
  resolveId(id) { if (/\/cloudflareApi(?:\.ts)?$/.test(id)) return '\0cloudflare-fixture'; },
  load(id) { if (id === '\0cloudflare-fixture') return 'export const cloudflareDataPlane=null;export class ArtifactPersistenceContextError extends Error{};'; },
}] });
const [auth, resume, safety, library, model, capability, readback, references] = await Promise.all([
  '/src/lib/authBrandSelection.ts', '/src/lib/lightchainResume.ts', '/src/lib/storagePathSafety.ts',
  '/src/lib/modelLibrarySettings.ts', '/src/lib/modelToolSettings.ts', '/src/lib/heavyCapability.ts', '/src/lib/providerResultReadback.ts', '/src/lib/generationSourceReferences.ts',
].map(path => vite.ssrLoadModule(path)));
const source = await fs.readFile(new URL('../src/hooks/useCanonicalImageWorkspace.ts', import.meta.url), 'utf8');
const ast = ts.createSourceFile('canonical.ts', source, ts.ScriptTarget.Latest, true, ts.ScriptKind.TS);
const nodes = []; const walk = node => { nodes.push(node); ts.forEachChild(node, walk); }; walk(ast);
const initialize = nodes.find(node => ts.isCallExpression(node) && node.expression.getText(ast) === 'useEffect' && node.arguments[0].getText(ast).includes('const token = ++sequence.current'));
const declaration = name => nodes.find(node => ts.isVariableDeclaration(node) && node.name.getText(ast) === name);
const evaluate = (code, bindings) => new Function('bindings', `with(bindings){${ts.transpile(`return (${code});`, { target: ts.ScriptTarget.ES2022 })}}`)(new Proxy(bindings, {
  has: () => true, get: (object, key) => key === Symbol.unscopables ? undefined : key in object ? object[key] : globalThis[key],
}));
const imageApiSource = await fs.readFile(new URL('../src/lib/imageApi.ts', import.meta.url), 'utf8');
const imageAst = ts.createSourceFile('imageApi.ts', imageApiSource, ts.ScriptTarget.Latest, true);
const normalizeNode = imageAst.statements.find(node => ts.isFunctionDeclaration(node) && node.name?.text === 'normalizeCompletedModelMatrixResult');
const originalSession = globalThis.sessionStorage;
const job = 'ai-original';
const old = { customMode: 'ラベル', gender: '女性', age: '中年', nationality: '日本', skinTone: '白い肌', bodyType: '正常', half: 'オン' };
const artifact = metadata => ({ id: 'original-image', brandId: 'brand', scopeId: 'alice', featureType: 'lightchain-model-custom-provider-result', sourceJobId: job,
  title: 'Original', prompt: null, imageUrl: '', createdAt: '2026-09-29', metadata: { toolId: 'model-custom', imageId: 'original-image', storagePath: 'generated-images/original-image', provider: 'openai', ...metadata } });
function receipt(id) { const jobId = `ai-${id}`, imageId = `${jobId}-0`; const image = { id: imageId, imageId, jobId, storagePath: `generated-images/${imageId}`, imageUrl: 'https://fixture.test/result.png', provider: 'openai', persistenceStatus: 'completed', candidateIndex: 0 };
  return { success: true, requestId: id, jobId, imageId, storagePath: image.storagePath, imageUrl: image.imageUrl, provider: 'openai', state: 'completed', persistenceStatus: 'completed', requestedCandidateCount: 1, persistedCandidateCount: 1, images: [image] };
}
function fixture({ artifacts = [], remote = [], resumeJob = job, pending = null, requestReply = null } = {}) {
  const calls = { generate: [], matrix: [], edit: [], reads: [], lists: [], sign: [], persisted: [], forbidden: [] };
  const storage = new Map();
  globalThis.sessionStorage = { getItem: key => storage.get(key) ?? null, setItem: (key, value) => storage.set(key, value), removeItem: key => storage.delete(key) };
  const authState = { user: { id: 'alice' }, currentBrand: { id: 'brand' }, brandState: { status: 'success_nonempty', userId: 'alice', requestGeneration: 1, confirmedBrandIds: ['brand'], error: null } };
  const bindings = { ...auth, ...resume, ...safety, ...library, ...model, ...capability, ...readback, ...references,
    location: { pathname: '/model-library/model-custom-form', search: resumeJob ? `?resumeJob=${resumeJob}` : '', hash: '' }, toolId: 'model-custom', jobId: resumeJob, libraryArtifactId: null, librarySlot: null,
    scope: 'fixture', scopeRef: { current: 'fixture' }, mounted: { current: true }, sequence: { current: 0 }, busy: { current: false },
    uploadSequence: { current: { primary: 0, secondary: 0 } }, releases: { current: {} }, restoredArtifact: { current: null }, pending: { current: null },
    configRef: { current: { modelLibraryCreation: true, requiredSources: 0, title: 'モデルカスタマイズ', initialInputState: library.defaultModelLibrarySettings() } },
    authSnapshot: () => auth.captureAuthBrandFence(authState.brandState, authState.user?.id ?? null, authState.currentBrand?.id ?? null),
    listWorkspaceArtifacts: (brandId, userId) => { assert.equal(brandId, 'brand'); assert.equal(userId, 'alice'); return structuredClone(artifacts); },
    withSignedImageUrls: async rows => { calls.sign.push(structuredClone(rows)); return rows.map(row => ({ ...row, image_url: `fresh:${row.storage_path}` })); },
    isLocalCanvasAssetReference: () => false, dimensions: () => { calls.forbidden.push('dimensions'); throw new Error('unexpected transient URL'); },
    resolveLocalCanvasAsset: () => { calls.forbidden.push('local asset'); throw new Error('unexpected local asset'); },
    HEAVY_IMAGE_PROVIDER: 'openai', navigate: () => {}, releaseAll: () => {},
    cloudflareDataPlane: {
      listGeneratedImages: async (brandId, query) => { calls.lists.push({ brandId, query }); if (remote instanceof Error) throw remote; return typeof remote === 'function' ? remote(authState) : remote; },
      readImageAIRequest: async id => { calls.reads.push(id); if (requestReply instanceof Error) throw requestReply; return typeof requestReply === 'function' ? requestReply(id, authState) : requestReply ?? receipt(id); },
      captureArtifactPersistenceContext: async ({ assertContext }) => { assertContext(); return { fixture: true }; },
    },
    generateImage: async (prompt, brandId, options) => { calls.generate.push({ prompt, brandId, options }); return receipt(options.idempotencyKey); },
    generateModelMatrix: async (...args) => { calls.matrix.push(args); throw new Error('unexpected matrix inference'); },
    editImageWithPrompt: async (...args) => { calls.edit.push(args); throw new Error('unexpected edit inference'); },
    persistProviderResultArtifact: async input => { calls.persisted.push(input); return { artifact: { ...input, id: 'saved-fixture' }, remote: { jobId: input.sourceJobId, imageId: input.metadata.imageId, storagePath: input.storagePath } }; },
  };
  for (const name of ['record', 'readCandidates', 'sanitizeInputState', 'workspaceInputState', 'emptyState']) bindings[name] = evaluate(declaration(name).initializer.getText(ast), bindings);
  bindings.backendAction = evaluate(declaration('backendAction').initializer.getText(ast), bindings);
  bindings.pendingKey = `heavy:canonical-image-workspace:v1:alice:brand:model-custom:${resumeJob ?? 'fresh'}`;
  if (pending) storage.set(bindings.pendingKey, JSON.stringify(pending));
  bindings.normalizeCompletedModelMatrixResult = evaluate(normalizeNode.getText(imageAst).replace(/^export\s+/, ''), bindings);
  let state = bindings.emptyState(); const states = [];
  bindings.stateRef = { current: state };
  bindings.setState = next => { state = typeof next === 'function' ? next(state) : next; bindings.stateRef.current = state; states.push(structuredClone(state)); };
  bindings.rememberPending = value => { if (value) sessionStorage.setItem(bindings.pendingKey, JSON.stringify(value)); else sessionStorage.removeItem(bindings.pendingKey); bindings.pending.current = value; };
  const start = () => evaluate(initialize.arguments[0].getText(ast), bindings)();
  const run = (...args) => evaluate(declaration('run').initializer.getText(ast), bindings)(...args);
  const selectModelReference = (...args) => evaluate(declaration('selectModelReference').initializer.getText(ast), bindings)(...args);
  return { bindings, authState, calls, storage, states, start, run, selectModelReference, get state() { return state; } };
}
const settle = async f => { for (let i = 0; i < 40 && f.state.status === 'loading'; i++) await new Promise(resolve => setImmediate(resolve)); assert.notEqual(f.state.status, 'loading'); };

test('production restoration maps exact same-job legacy label fields without new defaults or inference', async () => {
  const f = fixture({ artifacts: [artifact({ modelFormState: old })] }); f.start(); await settle(f);
  assert.equal(f.state.status, 'saved'); assert.deepEqual(f.state.inputState, library.readLegacyModelLibrarySettings(old));
  assert.equal(f.state.originalInputsAvailable, true); assert.equal(f.state.result.imageId, 'original-image');
  assert.equal(f.state.slots.primary, null); assert.equal(f.state.slots.secondary, null);
  assert.deepEqual(f.calls.lists, []); assert.equal(f.state.libraryInputReadback.source, 'local'); assert.equal(f.state.libraryInputReadback.legacySettings, 'valid');
  assert.deepEqual(f.calls.generate, []); assert.deepEqual(f.calls.matrix, []); assert.deepEqual(f.calls.persisted, []);
});
test('production remote restoration preserves custom mode, scalar inputs and exact durable face identity', async () => {
  const inputState = { ...library.chooseModelLibraryMode(library.defaultModelLibrarySettings(), 'custom'), chest: '100', customPrompt: '淡い背景' };
  const metadata = { toolId: 'model-custom', inputState, brief: '', materialSlots: [{ key: 'secondary', name: 'Face', kind: '顔の参考図', sourceImageId: 'face-0', sourceStoragePath: 'generated-images/face-0', imageUrl: '' }] };
  const f = fixture({ remote: [{ id: 'original-image', job_id: job, brand_id: 'brand', user_id: 'alice', feature_type: 'lightchain-model-custom', storage_path: 'generated-images/original-image', created_at: '2026-09-29', metadata }] });
  f.start(); await settle(f); assert.equal(f.state.status, 'saved'); assert.deepEqual(f.state.inputState, inputState);
  assert.equal(f.state.slots.secondary.sourceImageId, 'face-0'); assert.equal(f.state.slots.secondary.sourceStoragePath, 'generated-images/face-0');
  assert.deepEqual(f.calls.lists, [{ brandId: 'brand', query: { jobId: job, limit: 20 } }]); assert.deepEqual(f.calls.forbidden, []);
});
test('foreign owner, brand, tool and job records never restore old values', async () => {
  const base = artifact({ modelFormState: old });
  for (const other of [{ ...base, scopeId: 'other' }, { ...base, brandId: 'other' }, { ...base, metadata: { ...base.metadata, toolId: 'model-library' } }, { ...base, sourceJobId: 'other' }]) {
    const f = fixture({ artifacts: [other] }); f.start(); await settle(f);
    assert.equal(f.state.status, 'unavailable'); assert.equal(f.state.originalInputsAvailable, false); assert.deepEqual(f.state.inputState, {});
  }
});
test('malformed modern inputs cannot be replaced with a plausible legacy record', async () => {
  const f = fixture({ artifacts: [artifact({ inputState: { ...library.defaultModelLibrarySettings(), half: 'false' }, modelFormState: old })] }); f.start(); await settle(f);
  assert.equal(f.state.originalInputsAvailable, false); assert.deepEqual(f.state.inputState, {}); assert.equal(f.state.result.imageId, 'original-image');
});
test('production creation sends active custom face and parameters without adult matrix or hidden label inputs', async () => {
  const f = fixture({ resumeJob: null }); f.start(); await settle(f);
  const custom = { ...library.changeModelLibraryGender(library.chooseModelLibraryMode(f.state.inputState, 'custom'), '女の子'), customPrompt: '淡い背景' };
  f.bindings.setState(s => ({ ...s, brief: '専用モデル', inputState: custom, slots: { primary: { imageUrl: 'hidden:garment', name: 'hidden', kind: 'garment' }, secondary: { imageUrl: 'face:exact', sourceImageId: 'face-0', sourceStoragePath: 'generated-images/face-0', name: 'face', kind: '顔の参考図' } } }));
  await f.run('generate'); assert.equal(f.state.status, 'saved'); assert.equal(f.calls.generate.length, 1);
  const sent = f.calls.generate[0]; assert.deepEqual(sent.options.imageUrls, ['face:exact', library.modelLibraryBodyPreview(custom)]);
  assert.deepEqual([sent.options.width, sent.options.height], [1024, 1536]);
  assert.match(sent.prompt, /頭頂から両足のつま先まで/);
  assert.equal(sent.options.sourceReadback.bodyReferenceIndex, 1);
  assert.equal(sent.options.sourceReadback.bodyCatalogSha256, library.MODEL_LIBRARY_BODY_CATALOG_SHA256);
  assert.match(sent.prompt, /性別: 女の子/); assert.match(sent.prompt, /身長: 130cm/); assert.match(sent.prompt, /淡い背景/);
  assert.doesNotMatch(sent.prompt, /国籍:|adult|20s/); assert.equal(sent.options.materialReferences.length, 1);
  assert.equal(sent.options.materialReferences[0].key, 'secondary'); assert.deepEqual(f.calls.matrix, []);
  assert.deepEqual(f.calls.persisted[0].metadata.inputState, custom); assert.equal(f.calls.persisted[0].metadata.backendAction, 'generate-image');
  assert.equal(f.calls.persisted[0].metadata.modelBodyPreview.url, library.modelLibraryBodyPreview(custom));
  assert.deepEqual(f.calls.persisted[0].metadata.requestedOutputSize, { width: 1024, height: 1536 });
});
test('production Library selection admits both explicit creation features only in custom mode and preserves durable face identity', async () => {
  for (const toolId of ['model-custom', 'model-library']) {
    const f = fixture({ resumeJob: null }); f.start(); await settle(f); f.bindings.toolId = toolId;
    const selected = { imageUrl: 'expired:preview', imageId: 'face-0', storagePath: 'generated-images/face-0', name: 'Original face' };
    f.bindings.dimensions = async url => { assert.equal(url, 'fresh:generated-images/face-0'); return { width: 1024, height: 1024 }; };
    await f.selectModelReference(selected); assert.equal(f.calls.sign.length, 0);
    f.bindings.setState(s => ({ ...s, inputState: library.chooseModelLibraryMode(s.inputState, 'custom') }));
    await f.selectModelReference(selected);
    assert.equal(f.calls.sign.length, 1); assert.equal(f.state.slots.secondary.sourceImageId, 'face-0');
    assert.equal(f.state.slots.secondary.sourceStoragePath, 'generated-images/face-0');
    assert.equal(f.state.slots.secondary.imageUrl, 'fresh:generated-images/face-0');
    assert.deepEqual(f.calls.generate, []); assert.deepEqual(f.calls.matrix, []);
  }
});
test('late Library decode cannot commit after mode changes; ordinary matrix callers remain outside creation selection', async () => {
  const f = fixture({ resumeJob: null }); f.start(); await settle(f);
  f.bindings.setState(s => ({ ...s, inputState: library.chooseModelLibraryMode(s.inputState, 'custom') }));
  let ready, release;
  const started = new Promise(resolve => { ready = resolve; });
  f.bindings.dimensions = async () => { ready(); await new Promise(resolve => { release = resolve; }); return { width: 1024, height: 1024 }; };
  const selected = { imageUrl: 'expired:preview', imageId: 'face-0', storagePath: 'generated-images/face-0' };
  const pending = f.selectModelReference(selected); await started;
  f.bindings.setState(s => ({ ...s, inputState: library.chooseModelLibraryMode(s.inputState, 'label') }));
  release(); await pending; assert.equal(f.state.slots.secondary, null);
  f.bindings.toolId = 'model-library'; f.bindings.configRef.current.modelLibraryCreation = false;
  await f.selectModelReference(selected); assert.equal(f.calls.sign.length, 1);
  assert.deepEqual(f.calls.generate, []); assert.deepEqual(f.calls.matrix, []);
});
test('label creation needs no source; custom missing-face failure stays before pending reservation or inference', async () => {
  const label = fixture({ resumeJob: null }); label.start(); await settle(label); label.bindings.setState(s => ({ ...s, brief: '専用モデル' }));
  await label.run('generate'); assert.equal(label.calls.generate.length, 1); assert.deepEqual(label.calls.generate[0].options.imageUrls, []);
  assert.equal(Object.hasOwn(label.calls.generate[0].options, 'width'), false); assert.equal(Object.hasOwn(label.calls.persisted[0].metadata, 'requestedOutputSize'), false);
  const custom = fixture({ resumeJob: null }); custom.start(); await settle(custom); custom.bindings.setState(s => ({ ...s, brief: '専用モデル', inputState: library.chooseModelLibraryMode(s.inputState, 'custom') }));
  await custom.run('generate'); assert.match(custom.state.error, /顔の参考図/); assert.equal(custom.storage.size, 0); assert.deepEqual(custom.calls.generate, []);
});
test('old pending matrix UUID is read without reinference, action conversion or manufactured mode', async () => {
  const requestId = 'b1111111-1111-4111-8111-111111111111';
  const f = fixture({ artifacts: [artifact({ modelFormState: old })], pending: { requestId, originJob: job, brief: 'Old requested conditions', referenceNote: '', materialSlots: [], inputState: { gender: '男性', bodyTypes: ['regular'], ageGroups: ['20s'] } } });
  f.start(); await settle(f); assert.equal(f.state.status, 'unknown'); await f.run('reconcile');
  assert.deepEqual(f.calls.reads, [requestId]); assert.deepEqual(f.calls.generate, []); assert.deepEqual(f.calls.matrix, []); assert.deepEqual(f.calls.edit, []);
  assert.equal(f.calls.persisted[0].sourceJobId, `ai-${requestId}`); assert.equal(f.calls.persisted[0].metadata.backendAction, 'model-matrix');
  assert.equal(library.readModelLibrarySettings(f.state.inputState), null);
});
test('old retained creation receipt is read without assigning the new portrait request size', async () => {
  const requestId = 'b2222222-2222-4222-8222-222222222222';
  const inputState = library.chooseModelLibraryMode(library.defaultModelLibrarySettings(), 'custom');
  const f = fixture({ resumeJob: null, pending: { requestId, originJob: null, backendAction: 'generate-image', brief: 'Old model', referenceNote: '', materialSlots: [], inputState } });
  f.start(); await settle(f); await f.run('reconcile');
  assert.deepEqual(f.calls.reads, [requestId]); assert.deepEqual(f.calls.generate, []); assert.deepEqual(f.calls.matrix, []);
  assert.equal(Object.hasOwn(f.calls.persisted[0].metadata, 'requestedOutputSize'), false);
});
const remoteArtifact = metadata => ({ id: 'original-image', job_id: job, brand_id: 'brand', user_id: 'alice', feature_type: 'lightchain-model-custom', storage_path: 'generated-images/original-image', created_at: '2026-09-29', metadata: { toolId: 'model-custom', ...metadata } });
test('cached result without inputs refreshes actual same-image legacy settings from the owner adapter', async () => {
  const f = fixture({ artifacts: [artifact({})], remote: [remoteArtifact({ modelFormState: old })] }); f.start(); await settle(f);
  assert.equal(f.state.status, 'saved'); assert.equal(f.state.originalInputsAvailable, true); assert.deepEqual(f.state.inputState, library.readLegacyModelLibrarySettings(old));
  assert.equal(f.state.result.imageId, 'original-image'); assert.equal(f.state.result.storagePath, 'generated-images/original-image');
  assert.deepEqual(f.state.libraryInputReadback, { source: 'remote', remoteLookup: 'matched', modernSettings: 'absent', legacySettings: 'valid', requestLookup: 'not-needed', requestModernSettings: 'not-read', requestLegacySettings: 'not-read' });
  assert.deepEqual(f.calls.lists, [{ brandId: 'brand', query: { jobId: job, limit: 20 } }]); assert.deepEqual(f.calls.generate, []); assert.deepEqual(f.calls.persisted, []);
});
test('cached missing inputs refresh same-image modern custom settings and actual face reference', async () => {
  const inputState = { ...library.chooseModelLibraryMode(library.defaultModelLibrarySettings(), 'custom'), chest: '100', customPrompt: '元の背景' };
  const metadata = { inputState, brief: '', materialSlots: [{ key: 'secondary', name: 'Face', kind: '顔の参考図', sourceImageId: 'face-0', sourceStoragePath: 'generated-images/face-0', imageUrl: '' }] };
  const f = fixture({ artifacts: [artifact({})], remote: [remoteArtifact(metadata)] }); f.start(); await settle(f);
  assert.equal(f.state.status, 'saved'); assert.deepEqual(f.state.inputState, inputState); assert.equal(f.state.slots.secondary.sourceImageId, 'face-0');
  assert.equal(f.state.libraryInputReadback.modernSettings, 'valid'); assert.equal(f.state.result.imageId, 'original-image'); assert.deepEqual(f.calls.generate, []);
});
test('input refresh never substitutes another image, path, owner, brand, feature or tool from the same job', async () => {
  const base = remoteArtifact({ modelFormState: old });
  for (const remote of [{ ...base, id: 'other-image' }, { ...base, storage_path: 'generated-images/other-image' }, { ...base, user_id: 'other' }, { ...base, brand_id: 'other' }, { ...base, feature_type: 'lightchain-model-library' }, { ...base, metadata: { ...base.metadata, toolId: 'model-library' } }]) {
    const f = fixture({ artifacts: [artifact({})], remote: [remote] }); f.start(); await settle(f);
    assert.equal(f.state.status, 'unavailable'); assert.equal(f.state.originalInputsAvailable, false); assert.deepEqual(f.state.inputState, {});
    assert.equal(f.state.result.imageId, 'original-image'); assert.equal(f.state.result.storagePath, 'generated-images/original-image'); assert.equal(f.state.libraryInputReadback.remoteLookup, 'no-match');
    assert.deepEqual(f.calls.generate, []); assert.deepEqual(f.calls.persisted, []);
  }
});
test('refreshed settings cannot select another result candidate in place of the cached original image', async () => {
  const metadata = { modelFormState: old, selectedCandidateId: 'other-image', modelCandidates: [{ imageId: 'other-image', storagePath: 'generated-images/other-image', jobId: job, bodyType: 'regular', ageGroup: '20s', provider: 'openai' }] };
  const f = fixture({ artifacts: [artifact({})], remote: [remoteArtifact(metadata)] }); f.start(); await settle(f);
  assert.equal(f.state.originalInputsAvailable, true); assert.equal(f.state.result.imageId, 'original-image'); assert.equal(f.state.result.storagePath, 'generated-images/original-image'); assert.equal(f.state.selectedCandidateId, null);
});
test('valid saved legacy candidate selection retains its existing restoration behavior without input lookup', async () => {
  const metadata = { modelFormState: old, selectedCandidateId: 'other-image', modelCandidates: [{ imageId: 'other-image', storagePath: 'generated-images/other-image', jobId: job, bodyType: 'regular', ageGroup: '20s', provider: 'openai' }] };
  const f = fixture({ artifacts: [artifact(metadata)] }); f.start(); await settle(f);
  assert.equal(f.state.originalInputsAvailable, true); assert.equal(f.state.result.imageId, 'other-image'); assert.equal(f.state.result.storagePath, 'generated-images/other-image'); assert.equal(f.state.selectedCandidateId, 'other-image'); assert.deepEqual(f.calls.lists, []);
});
test('optional input lookup failure retains the original cached result and reports an unavailable read', async () => {
  const f = fixture({ artifacts: [artifact({})], remote: new Error('read unavailable') }); f.start(); await settle(f);
  assert.equal(f.state.result.imageId, 'original-image'); assert.equal(f.state.originalInputsAvailable, false); assert.equal(f.state.libraryInputReadback.remoteLookup, 'unavailable');
  assert.match(f.state.error, /読み直せません/); assert.deepEqual(f.state.inputState, {}); assert.deepEqual(f.calls.generate, []);
});
test('exact remote provenance distinguishes absent, null and unsupported legacy input records without invented values', async () => {
  for (const [metadata, modern, legacy, message] of [[{}, 'absent', 'absent', /含まれていません/], [{ inputState: null, modelFormState: null }, 'null', 'null', /含まれていません/], [{ modelFormState: { customMode: 'カスタム' } }, 'absent', 'invalid', /形式を確認できません/]]) {
    const f = fixture({ artifacts: [artifact({})], remote: [remoteArtifact(metadata)] }); f.start(); await settle(f);
    assert.equal(f.state.libraryInputReadback.source, 'remote'); assert.equal(f.state.libraryInputReadback.modernSettings, modern); assert.equal(f.state.libraryInputReadback.legacySettings, legacy);
    assert.equal(f.state.originalInputsAvailable, false); assert.equal(f.state.result.imageId, 'original-image'); assert.deepEqual(f.state.inputState, {}); assert.match(f.state.error, message);
  }
});
test('revoked owner context during an optional input lookup cannot expose or restore the old result', async () => {
  const f = fixture({ artifacts: [artifact({})], remote: authState => { authState.user = { id: 'other' }; return [remoteArtifact({ modelFormState: old })]; } }); f.start(); await settle(f);
  assert.equal(f.state.status, 'unavailable'); assert.equal(f.state.result, null); assert.equal(f.state.originalInputsAvailable, false); assert.deepEqual(f.state.inputState, {});
});
const originalRequestId='c3333333-3333-4333-8333-333333333333',originalProviderJob=`ai-${originalRequestId}`,originalProviderImage=`${originalProviderJob}-0`;
function requestFixture({ imageMetadata={},requestReply=null,pending=null }={}) {
  const remote={...remoteArtifact(imageMetadata),id:originalProviderImage,job_id:originalProviderJob,storage_path:`generated-images/${originalProviderImage}`};
  const local={...artifact(imageMetadata),id:originalProviderImage,sourceJobId:originalProviderJob,metadata:{toolId:'model-custom',imageId:originalProviderImage,storagePath:remote.storage_path,...imageMetadata}};
  return fixture({artifacts:[local],remote:[remote],resumeJob:originalProviderJob,requestReply,pending});
}
test('exact completed original request metadata restores actual legacy fields missing from the image record',async()=>{
  const f=requestFixture({requestReply:{...receipt(originalRequestId),featureType:'lightchain-model-custom',metadata:{lightchainWorkbenchState:{modelFormState:old,brief:'元の依頼',privateExtra:'excluded'},unrelatedRequestField:'excluded'}}});f.start();await settle(f);
  assert.equal(f.state.status,'saved');assert.equal(f.state.originalInputsAvailable,true);assert.deepEqual(f.state.inputState,library.readLegacyModelLibrarySettings(old));assert.equal(f.state.brief,'元の依頼');
  assert.equal(f.state.result.imageId,originalProviderImage);assert.equal(f.state.libraryInputReadback.source,'request');assert.equal(f.state.libraryInputReadback.requestLookup,'matched');assert.equal(f.state.libraryInputReadback.requestLegacySettings,'valid');
  assert.deepEqual(f.calls.reads,[originalRequestId]);assert.deepEqual(f.calls.generate,[]);assert.deepEqual(f.calls.persisted,[]);
  assert.equal(Object.hasOwn(f.bindings.restoredArtifact.current.artifact.metadata,'lightchainWorkbenchState'),false);assert.equal(Object.hasOwn(f.bindings.restoredArtifact.current.artifact.metadata,'unrelatedRequestField'),false);
});
test('complete source-free label request fields restore without manufacturing a missing optional brief',async()=>{
  const inputState=library.defaultModelLibrarySettings(),f=requestFixture({requestReply:{...receipt(originalRequestId),inputImageCount:0,metadata:{inputState}}});f.start();await settle(f);
  assert.equal(f.state.originalInputsAvailable,true);assert.deepEqual(f.state.inputState,inputState);assert.equal(f.state.slots.primary,null);assert.equal(f.state.libraryInputReadback.source,'request');assert.equal(Object.hasOwn(f.bindings.restoredArtifact.current.artifact.metadata,'brief'),false);
});
test('exact request recovery preserves actual custom fields and durable face reference',async()=>{
  const inputState={...library.chooseModelLibraryMode(library.defaultModelLibrarySettings(),'custom'),customPrompt:'元の背景'};
  const metadata={inputState,brief:'',materialSlots:[{key:'secondary',name:'Face',kind:'顔の参考図',sourceImageId:'face-0',sourceStoragePath:'generated-images/face-0',imageUrl:''}]};
  const f=requestFixture({requestReply:{...receipt(originalRequestId),metadata}});f.start();await settle(f);
  assert.equal(f.state.originalInputsAvailable,true);assert.deepEqual(f.state.inputState,inputState);assert.equal(f.state.slots.secondary.sourceImageId,'face-0');assert.equal(f.state.libraryInputReadback.requestModernSettings,'valid');assert.equal(f.state.result.imageId,originalProviderImage);
  assert.equal(f.bindings.restoredArtifact.current.artifact.metadata.materialSlots[0].key,'secondary');assert.equal(f.bindings.restoredArtifact.current.artifact.metadata.materialSlots[0].sourceImageId,'face-0');
});
test('request metadata recovery rejects different request, job, image, path, unfinished persistence and declared feature',async()=>{
  const good={...receipt(originalRequestId),metadata:{modelFormState:old}},image=good.images[0];
  for(const reply of [{...good,requestId:'other'},{...good,jobId:'ai-other'},{...good,images:[{...image,imageId:'other'}]},{...good,images:[{...image,storagePath:'generated-images/other'}]},{...good,success:false},{...good,state:'unknown'},{...good,persistenceStatus:'partial'},{...good,featureType:'lightchain-model-library'},{...good,metadata:{...good.metadata,toolId:'model-library'}}]){
    const f=requestFixture({requestReply:reply});f.start();await settle(f);assert.equal(f.state.originalInputsAvailable,false);assert.deepEqual(f.state.inputState,{});assert.equal(f.state.result.imageId,originalProviderImage);assert.equal(f.state.libraryInputReadback.requestLookup,'identity-mismatch');assert.deepEqual(f.calls.persisted,[]);
  }
});
test('missing, unsupported or unavailable request metadata leaves original settings unavailable without defaults',async()=>{
  for(const reply of [receipt(originalRequestId),{...receipt(originalRequestId),metadata:{modelFormState:{customMode:'カスタム'}}},{...receipt(originalRequestId),metadata:'invalid'},new Error('request unavailable')]){
    const f=requestFixture({requestReply:reply});f.start();await settle(f);assert.equal(f.state.originalInputsAvailable,false);assert.deepEqual(f.state.inputState,{});assert.equal(f.state.result.imageId,originalProviderImage);assert.deepEqual(f.calls.generate,[]);assert.deepEqual(f.calls.persisted,[]);
  }
});
test('valid current inputs, invalid-present inputs and retained unknown operations do not trigger request recovery',async()=>{
  const valid=requestFixture({imageMetadata:{inputState:library.defaultModelLibrarySettings(),brief:''}});valid.start();await settle(valid);assert.deepEqual(valid.calls.reads,[]);assert.deepEqual(valid.calls.lists,[]);
  const invalid=requestFixture({imageMetadata:{inputState:{bad:'data'}}});invalid.start();await settle(invalid);assert.deepEqual(invalid.calls.reads,[]);assert.equal(invalid.state.originalInputsAvailable,false);
  const pending={requestId:'d4444444-4444-4444-8444-444444444444',originJob:originalProviderJob,brief:'未照合の依頼',referenceNote:'',materialSlots:[],backendAction:'model-matrix'};
  const retained=requestFixture({pending});retained.start();await settle(retained);assert.deepEqual(retained.calls.reads,[]);assert.equal(retained.state.pendingId,pending.requestId);assert.equal(retained.state.status,'unknown');
});
test('revoked auth during the exact request metadata read cannot restore original fields or result',async()=>{
  const f=requestFixture({requestReply:(id,authState)=>{authState.user={id:'other'};return {...receipt(id),metadata:{modelFormState:old}};}});f.start();await settle(f);
  assert.equal(f.state.result,null);assert.equal(f.state.originalInputsAvailable,false);assert.deepEqual(f.state.inputState,{});
});
after(async () => { globalThis.sessionStorage = originalSession; await vite.close(); await fs.rm(cacheDir, { recursive: true, force: true }); });
