import assert from 'node:assert/strict';
import test, { after } from 'node:test';
import fs from 'node:fs/promises';
import ts from 'typescript';
import { createServer } from 'vite';
import { createPendingIndexedDbHarness } from './verify-cloudflare-image-pending-store.test.mjs';

const root = new URL('..', import.meta.url).pathname;
const source = await fs.readFile(new URL('../src/pages/FittingPage.tsx', import.meta.url), 'utf8');
const ast = ts.createSourceFile('fitting.tsx', source, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
const nodes = [];
const walk = node => { nodes.push(node); ts.forEachChild(node, walk); };
walk(ast);
const session = nodes.find(node => ts.isFunctionDeclaration(node) && node.name?.text === 'FittingWorkspace');
const variable = name => nodes.find(node => ts.isVariableDeclaration(node) && node.name.getText(ast) === name);
const effect = nodes.find(node => ts.isCallExpression(node) && node.expression.getText(ast) === 'useEffect'
  && node.arguments[0].getText(ast).includes('const restoreLibraryArtifact = async'));
const statements = session.body.statements;
const start = statements.findIndex(node => node.getText(ast).startsWith('const libraryRenderContextKey ='));
const end = statements.findIndex((node, index) => index > start && ts.isExpressionStatement(node)
  && ts.isCallExpression(node.expression) && node.expression.expression.getText(ast) === 'useLayoutEffect');
assert.ok(start >= 0 && end > start, 'actual production render/lifetime declarations are required');
const renderSource = statements.slice(start, end + 1).map(node => node.getText(ast)).join('\n');
const helperSource = ['captureCurrentAuthBrandFence', 'assertCurrentAuthBrandFence']
  .map(name => variable(name).parent.parent.getText(ast)).join('\n');
const initialSource = variable('initialMaterialReference').parent.parent.getText(ast);
const evaluate = (code, bindings) => new Function('bindings', `with(bindings){${ts.transpile(code, { target: ts.ScriptTarget.ES2022 })}}`)(new Proxy(bindings, {
  has: () => true,
  get: (object, key) => {
    if (key === Symbol.unscopables) return undefined;
    if (key in object) return object[key];
    if (key === 'JSON') return JSON;
    throw new Error(`unexpected_fitting_binding:${String(key)}`);
  },
}));
const initialMaterialReference = evaluate(`${initialSource}\nreturn initialMaterialReference;`, {});
const original = Object.fromEntries(['window', 'localStorage', 'indexedDB', 'FileReader', 'fetch', '__fittingSign']
  .map(key => [key, Object.getOwnPropertyDescriptor(globalThis, key)]));
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
const cacheDir = `/tmp/fitting-library-context-vite-${process.pid}`;
const vite = await createServer({ root, configFile: false, envFile: false, cacheDir, appType: 'custom', logLevel: 'silent',
  server: { middlewareMode: true }, plugins: [{ name: 'fitting-library-read-only-fixture', enforce: 'pre',
    resolveId(id) {
      if (/\/storage(?:\.ts)?$/.test(id)) return '\0fitting-storage';
      if (/\/cloudflareApi(?:\.ts)?$/.test(id)) return '\0fitting-cloudflare';
    },
    load(id) {
      if (id === '\0fitting-storage') return 'export const withSignedImageUrls=(...args)=>globalThis.__fittingSign(...args);';
      if (id === '\0fitting-cloudflare') return 'export class ArtifactPersistenceContextError extends Error{}; export const cloudflareDataPlane=null;';
    },
  }] });
const assets = await vite.ssrLoadModule('/src/lib/canvasLocalAssets.ts');
const reader = await vite.ssrLoadModule('/src/lib/workspaceArtifactImageReadback.ts');
const auth = await vite.ssrLoadModule('/src/lib/authBrandSelection.ts');
const tick = () => new Promise(resolve => setImmediate(resolve));
const deferred = () => { let resolve; const promise = new Promise(done => { resolve = done; }); return { promise, resolve }; };
async function fixture(metadata = {}) {
  globalThis.indexedDB = createPendingIndexedDbHarness();
  const bytes = Buffer.from([0, 1, 255, 137, 80, 78, 71, 0, 99, 42]);
  const id = crypto.randomUUID();
  await assets.putLocalCanvasAsset(id, new Blob([bytes], { type: 'image/png' }));
  globalThis.__fittingSign = () => { throw new Error('local_original_must_not_sign'); };
  return { bytes, artifact: { id: 'original-id', brandId: 'brand', scopeId: 'alice', featureType: 'library',
    title: 'original garment', prompt: 'original prompt', createdAt: '2026-10-04', imageUrl: assets.buildLocalCanvasAssetReference(id), metadata } };
}
function harness(f, { missing = false, readFailure = false, onLookup = null, onResult = null } = {}) {
  let context = { user: { id: 'alice' }, currentBrand: { id: 'brand' }, isAuthInitialized: true, isAuthLoading: false,
    brandState: { status: 'success_nonempty', userId: 'alice', requestGeneration: 1, confirmedBrandIds: ['brand'], error: null },
    location: { pathname: '/fitting', search: '?libraryArtifactId=original-id', hash: '' } };
  let live = {};
  const refs = [];
  let refIndex = 0, layoutSetup, layoutCleanup, rendered, completed = 0;
  const reads = [], outcomes = [], lookups = [], commits = [], state = {}, pending = deferred();
  const forbidden = () => { externalAttempts++; throw new Error('unexpected_provider_canvas_or_save'); };
  const setter = key => value => { state[key] = value; commits.push([key, value]); };
  const bindings = () => ({ ...context,
    libraryArtifactId: (context.searchParams ?? new URLSearchParams(context.location.search)).get('libraryArtifactId'),
    useRef: value => refs[refIndex++] ?? (refs[refIndex - 1] = { current: value }),
    useLayoutEffect: setup => { layoutSetup = setup; }, useAuthStore: { getState: () => live }, ...auth, initialMaterialReference,
    listWorkspaceArtifacts: (brand, user) => {
      lookups.push([brand, user]); assert.equal(brand, f.artifact.brandId); assert.equal(user, f.artifact.scopeId);
      onLookup?.(() => { live = { ...live, isLoading: true }; });
      return missing ? [] : [f.artifact];
    },
    readWorkspaceArtifactImage: async (...args) => {
      reads.push(args);
      // Hold the actual production reader's result or error until the test releases it.
      const artifact = readFailure ? { ...args[0], imageUrl: assets.buildLocalCanvasAssetReference('missing') } : args[0];
      const outcome = await reader.readWorkspaceArtifactImage(artifact, args[1]).then(value => ({ value }), error => ({ error }));
      outcomes.push(outcome);
      await pending.promise;
      completed++;
      onResult?.(() => { live = { ...live, isLoading: true }; });
      if (outcome.error) throw outcome.error;
      return outcome.value;
    },
    setMaterialReference: setter('reference'), setErrorMessage: setter('error'), setResumeInputReadback: setter('readback'),
    setFittingDraftPersistenceStatus: setter('persistence'), setFittingDraftPersistenceMessage: setter('message'),
    createProject: forbidden, addObject: forbidden, saveCurrentProject: forbidden, generateModelMatrix: forbidden,
  });
  function render() {
    refIndex = 0;
    live = { user: context.user, currentBrand: context.currentBrand, brandState: context.brandState,
      isInitialized: context.isAuthInitialized, isLoading: context.isAuthLoading };
    rendered = evaluate(`${renderSource}\nreturn { libraryRenderContextRef, libraryRenderRevision, libraryMountLifetimeRef };`, bindings());
  }
  render(); layoutCleanup = layoutSetup();
  function startEffect() {
    // Freeze the production render closure while sharing its refs and the fresh store.
    return evaluate(`${helperSource}\nreturn (${effect.arguments[0].getText(ast)});`, { ...bindings(), ...rendered })();
  }
  return { reads, outcomes, lookups, commits, state, startEffect,
    render: patch => { context = { ...context, ...patch }; render(); }, context: () => context,
    live: patch => { live = { ...live, ...patch }; }, unmount: () => layoutCleanup(),
    strictRemount: () => { layoutCleanup(); layoutCleanup = layoutSetup(); },
    async settle() {
      pending.resolve();
      for (let turn = 0; turn < 100 && completed < reads.length; turn++) await tick();
      assert.equal(completed, reads.length, 'every held production reader must finish'); await tick();
    },
  };
}
const fields = {
  owner: () => ({ user: { id: 'bob' } }), brand: () => ({ currentBrand: { id: 'other' } }),
  initialized: () => ({ isAuthInitialized: false }), loading: () => ({ isAuthLoading: true }),
  generation: context => ({ brandState: { ...context.brandState, requestGeneration: 2 } }),
  pathname: context => ({ location: { ...context.location, pathname: '/heavy/fitting' } }),
  query: context => ({ location: { ...context.location, search: `${context.location.search}&tab=reference` } }),
  hash: context => ({ location: { ...context.location, hash: '#other' } }),
  artifact: () => ({ searchParams: new URLSearchParams({ libraryArtifactId: 'other' }) }),
};
for (const [field, patch] of Object.entries(fields)) for (const readFailure of [false, true]) {
  test(`${field}: actual held ${readFailure ? 'error' : 'success'} is silent before passive cleanup, including ABA`, async () => {
    for (const aba of [false, true]) {
      const h = harness(await fixture(), { readFailure }); const cleanup = h.startEffect(); assert.equal(h.reads.length, 1);
      const before = h.context(); h.render(patch(before)); if (aba) h.render({ ...before, searchParams: before.searchParams });
      await h.settle(); assert.equal(Boolean(h.outcomes[0].error), readFailure); assert.deepEqual(h.commits, []);
      cleanup(); h.unmount();
    }
  });
}
const liveFields = {
  initialized: () => ({ isInitialized: false }), loading: () => ({ isLoading: true }),
  owner: () => ({ user: { id: 'bob' } }), brand: () => ({ currentBrand: { id: 'other' } }),
  generation: context => ({ brandState: { ...context.brandState, requestGeneration: 2 } }),
  authorization: context => ({ brandState: { ...context.brandState, confirmedBrandIds: [] } }),
  status: context => ({ brandState: { ...context.brandState, status: 'pending' } }),
};
for (const [field, patch] of Object.entries(liveFields)) test(`fresh auth ${field} blocks actual success and error without render`, async () => {
  for (const readFailure of [false, true]) {
    const h = harness(await fixture(), { readFailure }); h.startEffect(); h.live(patch(h.context())); await h.settle();
    assert.deepEqual(h.commits, []); h.unmount();
  }
});
for (const kind of ['unmount', 'strictRemount', 'passive']) test(`${kind}: lifetime or cancellation suppresses actual success and error`, async () => {
  for (const readFailure of [false, true]) {
    const h = harness(await fixture(), { readFailure }); const cleanup = h.startEffect(); kind === 'passive' ? cleanup() : h[kind]();
    await h.settle(); assert.deepEqual(h.commits, []); h.unmount();
  }
});
test('StrictMode current setup restores while the old lifetime remains invalid', async () => {
  const h = harness(await fixture()); h.startEffect(); h.strictRemount(); h.startEffect(); await h.settle();
  assert.equal(h.reads.length, 2); assert.equal(h.commits.length, 5); assert.equal(h.state.readback, 'restored'); h.unmount();
});
test('valid restoration preserves exact bytes, every material field and restored statuses', async () => {
  const f = await fixture(), h = harness(f); h.startEffect(); await h.settle();
  const imageUrl = h.state.reference.imageUrl;
  assert.deepEqual(Buffer.from(imageUrl.split(',')[1], 'base64'), f.bytes);
  assert.deepEqual(h.state.reference, { ...initialMaterialReference, imageUrl, fileName: f.artifact.title,
    sourceImageId: f.artifact.id, sourceStoragePath: null, materialKind: 'Library衣服素材', nextStepReady: false, extractedLayerReady: false });
  assert.deepEqual(h.state, { reference: h.state.reference, error: '', readback: 'restored', persistence: 'restored',
    message: 'Library素材を読み込みました。入力条件を確認して次へ進めます。' });
  assert.equal(h.commits.length, 5); h.unmount();
});
test('source metadata keeps existing sourceImageId, remoteImageId and artifact fallback precedence', async () => {
  for (const [metadata, expected] of [[{ sourceImageId: 'source', remoteImageId: 'remote' }, 'source'],
    [{ remoteImageId: 'remote' }, 'remote'], [{ sourceImageId: 123, remoteImageId: 'remote' }, 'original-id'], [{}, 'original-id']]) {
    const h = harness(await fixture(metadata)); h.startEffect(); await h.settle(); assert.equal(h.state.reference.sourceImageId, expected); h.unmount();
  }
});
test('canonical storage path is authoritative and preserves source metadata', async () => {
  const f = await fixture({ sourceImageId: 'source', remoteStoragePath: 'generated-images/original' });
  f.artifact.imageUrl = 'https://expired.test/bearer'; let signs = 0;
  globalThis.__fittingSign = async rows => { signs++; assert.deepEqual(rows, [{ storage_path: 'generated-images/original', image_url: '' }]); return [{ image_url: 'fresh-original' }]; };
  const h = harness(f); h.startEffect(); await h.settle(); assert.equal(signs, 1);
  assert.equal(h.state.reference.sourceStoragePath, 'generated-images/original'); assert.equal(h.state.reference.sourceImageId, 'source');
  assert.equal(h.state.reference.imageUrl, 'fresh-original'); h.unmount();
});
test('invalid rendered entry cannot lookup or read', async () => {
  for (const patch of [{ isAuthInitialized: false }, { isAuthLoading: true }, { user: null }, { currentBrand: null },
    { searchParams: new URLSearchParams() }]) {
    const h = harness(await fixture()); h.render(patch); h.startEffect();
    assert.deepEqual(h.lookups, []); assert.deepEqual(h.reads, []); assert.deepEqual(h.commits, []); h.unmount();
  }
});
test('entry fence must match rendered owner, brand, generation and current auth before lookup', async () => {
  for (const patch of Object.values(liveFields)) {
    const h = harness(await fixture()); h.live(patch(h.context())); h.startEffect();
    assert.deepEqual(h.lookups, []); assert.deepEqual(h.reads, []); assert.deepEqual(h.commits, []); h.unmount();
  }
});
test('fresh invalidation during lookup blocks the reader and missing-artifact commits', async () => {
  for (const missing of [false, true]) {
    const h = harness(await fixture(), { missing, onLookup: invalidate => invalidate() }); h.startEffect();
    assert.equal(h.lookups.length, 1); assert.deepEqual(h.reads, []); assert.deepEqual(h.commits, []); h.unmount();
  }
});
test('fresh invalidation at actual reader return blocks post-await writes', async () => {
  for (const readFailure of [false, true]) {
    const h = harness(await fixture(), { readFailure, onResult: invalidate => invalidate() }); h.startEffect(); await h.settle();
    assert.deepEqual(h.commits, []); h.unmount();
  }
});
test('current missing-byte or signing error preserves unavailable statuses and message', async () => {
  for (const kind of ['missing-bytes', 'signing-error']) {
    const f = await fixture();
    if (kind === 'signing-error') { f.artifact.metadata.remoteStoragePath = 'generated-images/original'; globalThis.__fittingSign = async () => { throw new Error('signing_failed'); }; }
    const h = harness(f, { readFailure: kind === 'missing-bytes' }); h.startEffect(); await h.settle();
    assert.ok(h.outcomes[0].error); assert.deepEqual(h.state, { readback: 'unavailable', persistence: 'unavailable',
      message: 'Library素材の元画像を読み込めませんでした。素材を選び直してください。' }); assert.equal(h.commits.length, 3); h.unmount();
  }
});
test('current missing artifact preserves unavailable statuses and performs no read', async () => {
  const h = harness(await fixture(), { missing: true }); h.startEffect();
  assert.deepEqual(h.reads, []); assert.deepEqual(h.state, { readback: 'unavailable', persistence: 'unavailable',
    message: 'Library素材を読み込めませんでした。Libraryから素材を選び直してください。' }); assert.equal(h.commits.length, 3); h.unmount();
});
test('Library restoration preserves existing behavior with simultaneous resumeJob', async () => {
  const h = harness(await fixture()); h.render({ location: { ...h.context().location, search: '?libraryArtifactId=original-id&resumeJob=job' } });
  h.startEffect(); await h.settle(); assert.equal(h.state.readback, 'restored'); assert.equal(h.reads.length, 1); h.unmount();
});
test('actual full-context dependencies and guard bindings are required; external effects stay zero', () => {
  const dependencies = effect.arguments[1].elements.map(node => node.getText(ast));
  for (const name of ['currentBrand?.id', 'user?.id', 'libraryArtifactId', 'libraryRenderContextKey', 'libraryRenderRevision',
    'brandState.requestGeneration', 'isAuthInitialized', 'isAuthLoading']) assert.ok(dependencies.includes(name));
  assert.throws(() => evaluate('return captureCurrentAuthBrandFence;', {}), /unexpected_fitting_binding/);
  assert.equal(externalAttempts, 0);
});
after(async () => {
  await vite.close(); await fs.rm(cacheDir, { recursive: true, force: true });
  for (const [key, descriptor] of Object.entries(original)) descriptor ? Object.defineProperty(globalThis, key, descriptor) : delete globalThis[key];
});
