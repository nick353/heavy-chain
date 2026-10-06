import assert from 'node:assert/strict';
import test, { after } from 'node:test';
import fs from 'node:fs/promises';
import ts from 'typescript';
import { createServer } from 'vite';
import { createPendingIndexedDbHarness } from './verify-cloudflare-image-pending-store.test.mjs';

const root = new URL('..', import.meta.url).pathname;
const source = await fs.readFile(new URL('../src/pages/LightchainWorkbenchPage.tsx', import.meta.url), 'utf8');
const ast = ts.createSourceFile('workbench.tsx', source, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
const nodes = [];
const walk = n => { nodes.push(n); ts.forEachChild(n, walk); };
walk(ast);
const session = nodes.find(n => ts.isFunctionDeclaration(n) && n.name?.text === 'LightchainWorkbenchWorkspace');
const variable = name => nodes.find(n => ts.isVariableDeclaration(n) && n.name.getText(ast) === name);
const effect = nodes.find(n => ts.isCallExpression(n) && n.expression.getText(ast) === 'useEffect'
  && n.arguments[0].getText(ast).includes('const restoreLibraryArtifact = async'));
const statements = session.body.statements;
const start = statements.findIndex(n => n.getText(ast).startsWith('const libraryRenderContextKey ='));
const end = statements.findIndex((n, i) => i > start && ts.isExpressionStatement(n)
  && ts.isCallExpression(n.expression) && n.expression.expression.getText(ast) === 'useLayoutEffect');
assert.ok(start >= 0 && end > start, 'actual render/lifetime source is required');
const renderSource = statements.slice(start, end + 1).map(n => n.getText(ast)).join('\n');
const helperSource = ['captureCurrentAuthBrandFence', 'assertCurrentAuthBrandFence', 'metadataString']
  .map(name => variable(name).parent.parent.getText(ast)).join('\n');
const evaluate = (code, bindings) => new Function('bindings', `with(bindings){${ts.transpile(code, { target: ts.ScriptTarget.ES2022 })}}`)(new Proxy(bindings, {
  has: () => true,
  get: (o, key) => {
    if (key === Symbol.unscopables) return undefined;
    if (key in o) return o[key];
    if (['JSON', 'URLSearchParams'].includes(key)) return globalThis[key];
    throw new Error(`unexpected_workbench_binding:${String(key)}`);
  },
}));
const original = Object.fromEntries(['window', 'localStorage', 'indexedDB', 'FileReader', 'fetch', '__workbenchSign'].map(k => [k, Object.getOwnPropertyDescriptor(globalThis, k)]));
let externalAttempts = 0;
globalThis.fetch = () => { externalAttempts++; throw new Error('unexpected_external_effect'); };
globalThis.FileReader = class {
  readAsDataURL(blob) {
    blob.arrayBuffer().then(buffer => {
      this.result = `data:${blob.type};base64,${Buffer.from(buffer).toString('base64')}`;
      this.onload();
    }, () => this.onerror());
  }
};
const cacheDir = `/tmp/workbench-library-context-vite-${process.pid}`;
const vite = await createServer({ root, configFile: false, envFile: false, cacheDir, appType: 'custom', logLevel: 'silent',
  server: { middlewareMode: true }, plugins: [{ name: 'workbench-library-read-only-fixture', enforce: 'pre',
    resolveId(id) {
      if (/\/storage(?:\.ts)?$/.test(id)) return '\0workbench-storage';
      if (/\/cloudflareApi(?:\.ts)?$/.test(id)) return '\0workbench-cloudflare';
    },
    load(id) {
      if (id === '\0workbench-storage') return 'export const withSignedImageUrls=(...args)=>globalThis.__workbenchSign(...args);';
      if (id === '\0workbench-cloudflare') return 'export class ArtifactPersistenceContextError extends Error{}; export const cloudflareDataPlane=null;';
    },
  }] });
const assets = await vite.ssrLoadModule('/src/lib/canvasLocalAssets.ts');
const reader = await vite.ssrLoadModule('/src/lib/workspaceArtifactImageReadback.ts');
const auth = await vite.ssrLoadModule('/src/lib/authBrandSelection.ts');
const tick = () => new Promise(resolve => setImmediate(resolve));
const deferred = () => { let resolve, reject; const promise = new Promise((a, b) => { resolve = a; reject = b; }); return { promise, resolve, reject }; };
async function fixture(metadata = {}) {
  globalThis.indexedDB = createPendingIndexedDbHarness();
  const bytes = Buffer.from([0, 1, 255, 137, 80, 78, 71, 0, 99, 42]);
  const id = crypto.randomUUID();
  await assets.putLocalCanvasAsset(id, new Blob([bytes], { type: 'image/png' }));
  globalThis.__workbenchSign = () => { throw new Error('local_original_must_not_sign'); };
  return { bytes, artifact: { id: 'original-id', brandId: 'brand', scopeId: 'alice', featureType: 'library',
    title: 'original garment', prompt: 'original prompt', createdAt: '2026-10-04', imageUrl: assets.buildLocalCanvasAssetReference(id), metadata } };
}
function harness(f, { missing = false, previousText = '', previousNote = '' } = {}) {
  let context = { user: { id: 'alice' }, currentBrand: { id: 'brand' }, isAuthInitialized: true, isAuthLoading: false,
    brandState: { status: 'success_nonempty', userId: 'alice', requestGeneration: 1, confirmedBrandIds: ['brand'], error: null },
    selectedTool: { id: 'ai-fitting' }, isFeatureDetail: true,
    location: { pathname: '/model', search: '?libraryArtifactId=original-id', hash: '' } };
  let live = {};
  const refs = [];
  let refIndex = 0, layoutSetup, layoutCleanup, rendered, completed = 0;
  const reads = [], lookups = [], commits = [], state = { text: previousText, note: previousNote }, pending = deferred();
  const forbidden = () => { externalAttempts++; throw new Error('unexpected_provider_canvas_or_save'); };
  const setter = (name, key) => value => {
    state[key] = typeof value === 'function' ? value(state[key]) : value;
    commits.push([name, state[key]]);
  };
  const bindings = () => ({ ...context, searchParams: context.searchParams ?? new URLSearchParams(context.location.search),
    useRef: value => refs[refIndex++] ?? (refs[refIndex - 1] = { current: value }),
    useLayoutEffect: setup => { layoutSetup = setup; }, useAuthStore: { getState: () => live }, ...auth,
    listWorkspaceArtifacts: (brand, user) => { lookups.push([brand, user]); assert.equal(brand, f.artifact.brandId); assert.equal(user, f.artifact.scopeId); return missing ? [] : [f.artifact]; },
    readWorkspaceArtifactImage: async (...args) => {
      reads.push(args);
      try { await pending.promise; return await reader.readWorkspaceArtifactImage(...args); }
      finally { completed++; }
    },
    setMaterialSlotFiles: setter('slots', 'slots'), setGarmentImageUrl: setter('url', 'url'),
    setGarmentFileName: setter('name', 'name'), setGarmentCategory: setter('kind', 'kind'),
    setAnalysisStatus: setter('analysis', 'analysis'), setWorkspaceText: setter('text', 'text'),
    setReferenceNote: setter('note', 'note'), setResumeInputReadback: setter('status', 'status'),
    setLibraryContinuation: value => { state.libraryContinuation = value; },
    resetWorkbenchMaskState: () => commits.push(['mask-reset']),
    createProject: forbidden, addObject: forbidden, saveCurrentProject: forbidden, generateImage: forbidden,
  });
  function render() {
    refIndex = 0;
    live = { user: context.user, currentBrand: context.currentBrand, brandState: context.brandState,
      isInitialized: context.isAuthInitialized, isLoading: context.isAuthLoading };
    rendered = evaluate(`${renderSource}\nreturn { libraryRenderContextRef, libraryRenderRevision, libraryMountLifetimeRef };`, bindings());
  }
  render(); layoutCleanup = layoutSetup();
  function startEffect() {
    // Freeze this render's closure; the actual render/lifetime refs and fresh store remain shared.
    return evaluate(`${helperSource}\nreturn (${effect.arguments[0].getText(ast)});`, { ...bindings(), ...rendered })();
  }
  return { reads, lookups, commits, state, pending, startEffect,
    render: patch => { context = { ...context, ...patch }; render(); }, context: () => context,
    live: patch => { live = { ...live, ...patch }; }, unmount: () => layoutCleanup(),
    strictRemount: () => { layoutCleanup(); layoutCleanup = layoutSetup(); },
    async settle(fail = false) {
      fail ? pending.reject(new Error('read_failed')) : pending.resolve();
      for (let turn = 0; turn < 100 && completed < reads.length; turn++) await tick();
      assert.equal(completed, reads.length, 'every held production reader must finish'); await tick();
    },
  };
}
const fields = {
  owner: c => ({ user: { id: 'bob' } }), brand: c => ({ currentBrand: { id: 'other' } }),
  initialized: c => ({ isAuthInitialized: false }), loading: c => ({ isAuthLoading: true }),
  generation: c => ({ brandState: { ...c.brandState, requestGeneration: 2 } }),
  pathname: c => ({ location: { ...c.location, pathname: '/heavy/model' } }),
  query: c => ({ location: { ...c.location, search: `${c.location.search}&tab=reference` } }),
  hash: c => ({ location: { ...c.location, hash: '#other' } }),
  tool: c => ({ selectedTool: { id: 'ai-fitting-reference' } }),
  detail: c => ({ isFeatureDetail: false }),
  artifact: c => ({ searchParams: new URLSearchParams({ libraryArtifactId: 'other' }) }),
};
for (const [field, patch] of Object.entries(fields)) for (const fail of [false, true]) {
  test(`${field}: held ${fail ? 'failure' : 'success'} is silent before passive cleanup, including ABA`, async () => {
    for (const aba of [false, true]) {
      const h = harness(await fixture()); const cleanup = h.startEffect(); assert.equal(h.reads.length, 1);
      const before = h.context(); h.render(patch(before)); if (aba) h.render({ ...before, searchParams: before.searchParams });
      await h.settle(fail); assert.deepEqual(h.commits, []); cleanup(); h.unmount();
    }
  });
}
const liveFields = {
  initialized: () => ({ isInitialized: false }), loading: () => ({ isLoading: true }),
  owner: () => ({ user: { id: 'bob' } }), brand: () => ({ currentBrand: { id: 'other' } }),
  generation: c => ({ brandState: { ...c.brandState, requestGeneration: 2 } }),
  authorization: c => ({ brandState: { ...c.brandState, confirmedBrandIds: [] } }),
  status: c => ({ brandState: { ...c.brandState, status: 'pending' } }),
};
for (const [field, patch] of Object.entries(liveFields)) test(`fresh auth ${field} blocks held success and failure without render`, async () => {
  for (const fail of [false, true]) {
    const h = harness(await fixture()); h.startEffect(); h.live(patch(h.context())); await h.settle(fail);
    assert.deepEqual(h.commits, []); h.unmount();
  }
});
for (const kind of ['unmount', 'strictRemount', 'passive']) test(`${kind}: lifetime or cancellation suppresses success and failure`, async () => {
  for (const fail of [false, true]) {
    const h = harness(await fixture()); const cleanup = h.startEffect(); kind === 'passive' ? cleanup() : h[kind]();
    await h.settle(fail); assert.deepEqual(h.commits, []); h.unmount();
  }
});
test('StrictMode new setup restores while the old lifetime remains invalid', async () => {
  const h = harness(await fixture()); h.startEffect(); h.strictRemount(); h.startEffect(); await h.settle();
  assert.equal(h.reads.length, 2); assert.equal(h.commits.length, 9); assert.equal(h.state.status, 'restored'); h.unmount();
});
test('valid restoration preserves every setter, exact bytes, stable ID and local reference', async () => {
  const f = await fixture(), h = harness(f); h.startEffect(); await h.settle();
  const image = h.state.slots.primary;
  assert.deepEqual(Buffer.from(image.imageUrl.split(',')[1], 'base64'), f.bytes);
  assert.equal(image.localAssetRef, f.artifact.imageUrl); assert.equal(image.sourceStoragePath, null);
  assert.equal(image.sourceImageId, f.artifact.id); assert.equal(image.name, f.artifact.title); assert.equal(image.kind, 'library');
  assert.equal(h.state.slots.secondary, null); assert.equal(h.state.url, image.imageUrl);
  assert.equal(h.state.name, image.name); assert.equal(h.state.kind, image.kind); assert.equal(h.state.analysis, 'ready');
  assert.equal(h.state.text, f.artifact.prompt); assert.equal(h.state.note, 'Library素材: original garment');
  assert.equal(h.state.status, 'restored'); assert.equal(h.commits.length, 9); h.unmount();
});
test('metadata precedence and existing text/note are preserved', async () => {
  const f = await fixture({ sourceImageId: 'source', toolTitle: 'source tool' });
  const h = harness(f, { previousText: 'keep text', previousNote: 'keep note' }); h.startEffect(); await h.settle();
  assert.equal(h.state.slots.primary.sourceImageId, 'source'); assert.equal(h.state.slots.primary.kind, 'source tool');
  assert.equal(h.state.text, 'keep text'); assert.equal(h.state.note, 'keep note'); h.unmount();
});
test('canonical storage path remains authoritative and keeps original source identity', async () => {
  const f = await fixture({ sourceImageId: 'source', remoteStoragePath: 'generated-images/original' });
  f.artifact.imageUrl = 'https://expired.test/bearer'; let signs = 0;
  globalThis.__workbenchSign = async rows => { signs++; assert.deepEqual(rows, [{ storage_path: 'generated-images/original', image_url: '' }]); return [{ image_url: 'fresh-original' }]; };
  const h = harness(f); h.startEffect(); await h.settle();
  assert.equal(signs, 1); assert.equal(h.state.slots.primary.sourceStoragePath, 'generated-images/original');
  assert.equal(h.state.slots.primary.sourceImageId, 'source'); assert.equal(h.state.slots.primary.imageUrl, 'fresh-original');
  assert.equal('localAssetRef' in h.state.slots.primary, false); h.unmount();
});
test('invalid render auth or missing entry inputs cannot lookup or read', async () => {
  for (const patch of [{ isAuthInitialized: false }, { isAuthLoading: true }, { user: null }, { currentBrand: null },
    { searchParams: new URLSearchParams() }]) {
    const h = harness(await fixture()); h.render(patch); h.startEffect();
    assert.deepEqual(h.lookups, []); assert.deepEqual(h.reads, []); assert.deepEqual(h.commits, []); h.unmount();
  }
});
test('fresh fence must match render owner, brand, generation and valid auth before lookup/read', async () => {
  for (const patch of Object.values(liveFields)) {
    const h = harness(await fixture()); h.live(patch(h.context())); h.startEffect();
    assert.deepEqual(h.lookups, []); assert.deepEqual(h.reads, []); assert.deepEqual(h.commits, []); h.unmount();
  }
});
test('current rejected or missing-byte reader keeps unavailable behavior without restoration', async () => {
  for (const kind of ['rejected', 'missing-bytes']) {
    const f = await fixture(); if (kind === 'missing-bytes') f.artifact.imageUrl = assets.buildLocalCanvasAssetReference('missing');
    const h = harness(f); h.startEffect(); await h.settle(kind === 'rejected');
    assert.deepEqual(h.commits, [['status', 'unavailable']]); assert.equal(h.state.slots, undefined); h.unmount();
  }
});
test('current missing artifact keeps unavailable behavior and performs no read', async () => {
  const h = harness(await fixture(), { missing: true }); h.startEffect();
  assert.deepEqual(h.reads, []); assert.deepEqual(h.commits, [['status', 'unavailable']]); h.unmount();
});
test('Library restoration keeps its existing behavior when resumeJob is also present', async () => {
  const h = harness(await fixture()); h.render({ location: { ...h.context().location, search: '?libraryArtifactId=original-id&resumeJob=job' } });
  h.startEffect(); await h.settle(); assert.equal(h.state.status, 'restored'); assert.equal(h.reads.length, 1); h.unmount();
});
test('actual dependencies include full context and auth/lifetime revision; missing guard binding fails closed', () => {
  const dependencies = effect.arguments[1].elements.map(n => n.getText(ast));
  for (const name of ['libraryRenderContextKey', 'libraryRenderRevision', 'brandState.requestGeneration', 'isAuthInitialized', 'isAuthLoading']) assert.ok(dependencies.includes(name));
  assert.throws(() => evaluate('return captureCurrentAuthBrandFence;', {}), /unexpected_workbench_binding/);
  assert.equal(externalAttempts, 0);
});
after(async () => {
  await vite.close(); await fs.rm(cacheDir, { recursive: true, force: true });
  for (const [key, descriptor] of Object.entries(original)) descriptor ? Object.defineProperty(globalThis, key, descriptor) : delete globalThis[key];
});
