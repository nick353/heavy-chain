import assert from 'node:assert/strict';
import test, { after } from 'node:test';
import fs from 'node:fs/promises';
import ts from 'typescript';
import { createServer } from 'vite';
import { createPendingIndexedDbHarness } from './verify-cloudflare-image-pending-store.test.mjs';

const root = new URL('..', import.meta.url).pathname;
const source = await fs.readFile(new URL('../src/pages/LightchainMaterialWorkbenchPage.tsx', import.meta.url), 'utf8');
const ast = ts.createSourceFile('material.tsx', source, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
const session = ast.statements.find(n => ts.isFunctionDeclaration(n) && n.name?.text === 'LightchainMaterialWorkbenchSession');
const nodes = [];
const walk = n => { nodes.push(n); ts.forEachChild(n, walk); };
walk(session);
const variable = name => nodes.find(n => ts.isVariableDeclaration(n) && n.name.getText(ast) === name);
const effect = nodes.find(n => ts.isCallExpression(n) && n.expression.getText(ast) === 'useEffect'
  && n.arguments[0].getText(ast).includes('const restoreLibraryMaterial = async'));
const statements = session.body.statements;
const start = statements.findIndex(n => n.getText(ast).startsWith('const libraryRenderContextKey ='));
const end = statements.findIndex((n, i) => i > start && ts.isExpressionStatement(n)
  && ts.isCallExpression(n.expression) && n.expression.expression.getText(ast) === 'useLayoutEffect');
assert.ok(start >= 0 && end > start, 'actual render/lifetime source is required');
const renderSource = [variable('libraryHandoff').parent.parent.getText(ast),
  ...statements.slice(start, end + 1).map(n => n.getText(ast))].join('\n');
const helperSource = ['captureCurrentAuthBrandFence', 'assertCurrentAuthBrandFence']
  .map(name => variable(name).parent.parent.getText(ast)).join('\n');
const evaluate = (code, bindings) => new Function('bindings', `with(bindings){${ts.transpile(code, { target: ts.ScriptTarget.ES2022 })}}`)(new Proxy(bindings, {
  has: () => true,
  get: (o, key) => {
    if (key === Symbol.unscopables) return undefined;
    if (key in o) return o[key];
    if (['JSON', 'URLSearchParams'].includes(key)) return globalThis[key];
    throw new Error(`unexpected_effect_binding:${String(key)}`);
  },
}));
const original = Object.fromEntries(['window', 'localStorage', 'indexedDB', 'FileReader', 'fetch', '__materialSign'].map(k => [k, Object.getOwnPropertyDescriptor(globalThis, k)]));
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
const cacheDir = `/tmp/material-library-context-vite-${process.pid}`;
const vite = await createServer({ root, configFile: false, envFile: false, cacheDir, appType: 'custom', logLevel: 'silent',
  server: { middlewareMode: true }, plugins: [{ name: 'material-library-read-only-fixture', enforce: 'pre',
    resolveId(id) {
      if (/\/storage(?:\.ts)?$/.test(id)) return '\0material-storage';
      if (/\/cloudflareApi(?:\.ts)?$/.test(id)) return '\0material-cloudflare';
    },
    load(id) {
      if (id === '\0material-storage') return 'export const withSignedImageUrls=(...args)=>globalThis.__materialSign(...args);';
      if (id === '\0material-cloudflare') return 'export class ArtifactPersistenceContextError extends Error{}; export const cloudflareDataPlane=null;';
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
  globalThis.__materialSign = () => { throw new Error('local_original_must_not_sign'); };
  return { bytes, artifact: { id: 'original-id', brandId: 'brand', scopeId: 'alice', featureType: 'library',
    title: 'original', prompt: null, createdAt: '2026-10-04', imageUrl: assets.buildLocalCanvasAssetReference(id), metadata } };
}
function harness(f, { slot = 'fabric-design', printing = false, addResult } = {}) {
  let context = { user: { id: 'alice' }, currentBrand: { id: 'brand' }, isAuthInitialized: true, isAuthLoading: false,
    brandState: { status: 'success_nonempty', userId: 'alice', requestGeneration: 1, confirmedBrandIds: ['brand'], error: null },
    isPrinting: printing, location: { pathname: printing ? '/printing-image' : '/fabric-image',
      search: `?libraryArtifactId=original-id${slot === null ? '' : `&librarySlot=${slot}`}` } };
  let live = {};
  const refs = [];
  let refIndex = 0, layoutSetup, layoutCleanup, rendered;
  const reads = [], commits = [], errors = [], pending = deferred();
  const forbidden = () => { externalAttempts++; throw new Error('unexpected_provider_canvas_or_save'); };
  const bindings = () => ({ ...context, useMemo: fn => fn(),
    useRef: value => refs[refIndex++] ?? (refs[refIndex - 1] = { current: value }),
    useLayoutEffect: setup => { layoutSetup = setup; },
    useAuthStore: { getState: () => live }, ...auth,
    listWorkspaceArtifacts: (brand, user) => { assert.equal(brand, f.artifact.brandId); assert.equal(user, f.artifact.scopeId); return [f.artifact]; },
    readWorkspaceArtifactImage: async (...args) => { reads.push(args); await pending.promise; return reader.readWorkspaceArtifactImage(...args); },
    setFabricBase: value => commits.push(['base', value]), setFabricDesign: value => commits.push(['design', value]),
    selectPrintGarment: value => commits.push(['garment', value]),
    addDesigns: async value => { commits.push(['printing-design', value[0]]); return addResult ? addResult.promise : { ok: true }; },
    PRINT_DESIGN_ASSET_PURPOSE: 'print-design', toast: { error: value => errors.push(value) },
    createProject: forbidden, addObject: forbidden, saveCurrentProject: forbidden, generateImage: forbidden,
  });
  function render() {
    refIndex = 0;
    live = { user: context.user, currentBrand: context.currentBrand, brandState: context.brandState,
      isInitialized: context.isAuthInitialized, isLoading: context.isAuthLoading };
    rendered = evaluate(`${renderSource}\nreturn { libraryHandoff, libraryRenderContextRef, libraryRenderRevision, libraryMountLifetimeRef };`, bindings());
  }
  render();
  layoutCleanup = layoutSetup();
  function startEffect() {
    // Freeze this render's values in the actual effect closure; refs and live store remain current.
    return evaluate(`${helperSource}\nreturn (${effect.arguments[0].getText(ast)});`, { ...bindings(), ...rendered })();
  }
  return { reads, commits, errors, refs, pending, startEffect,
    render: patch => { context = { ...context, ...patch }; render(); },
    context: () => context,
    live: patch => { live = { ...live, ...patch }; },
    unmount: () => layoutCleanup(),
    strictRemount: () => { layoutCleanup(); layoutCleanup = layoutSetup(); },
    async settle(fail = false) { fail ? pending.reject(new Error('read_failed')) : pending.resolve(); await tick(); await tick(); },
  };
}
const fields = {
  user: c => ({ user: { id: 'bob' } }),
  brand: c => ({ currentBrand: { id: 'other' } }),
  initialized: c => ({ isAuthInitialized: false }),
  loading: c => ({ isAuthLoading: true }),
  generation: c => ({ brandState: { ...c.brandState, requestGeneration: 2 } }),
  artifact: c => ({ location: { ...c.location, search: '?libraryArtifactId=other&librarySlot=fabric-design' } }),
  slot: c => ({ location: { ...c.location, search: '?libraryArtifactId=original-id&librarySlot=fabric-base' } }),
  printing: c => ({ isPrinting: !c.isPrinting }),
  pathname: c => ({ location: { ...c.location, pathname: '/heavy/fabric-image' } }),
};
for (const [field, patch] of Object.entries(fields)) {
  for (const fail of [false, true]) {
    test(`${field}: delayed ${fail ? 'failure' : 'success'} is silent before passive cleanup, including ABA`, async () => {
      for (const aba of [false, true]) {
        const h = harness(await fixture());
        h.startEffect();
        assert.equal(h.reads.length, 1);
        const before = h.context();
        h.render(patch(before));
        if (aba) h.render(before);
        await h.settle(fail);
        assert.deepEqual(h.commits, []);
        assert.deepEqual(h.errors, []);
        h.unmount();
      }
    });
  }
}
for (const [name, patch] of Object.entries({
  initialized: () => ({ isInitialized: false }), loading: () => ({ isLoading: true }),
  user: () => ({ user: { id: 'bob' } }), brand: () => ({ currentBrand: { id: 'other' } }),
  generation: c => ({ brandState: { ...c.brandState, requestGeneration: 2 } }),
  authorization: c => ({ brandState: { ...c.brandState, confirmedBrandIds: [] } }),
  status: c => ({ brandState: { ...c.brandState, status: 'pending' } }),
})) test(`fresh auth store ${name} invalidates success and failure without a render`, async () => {
  for (const fail of [false, true]) {
    const h = harness(await fixture()); h.startEffect(); h.live(patch(h.context())); await h.settle(fail);
    assert.deepEqual(h.commits, []); assert.deepEqual(h.errors, []); h.unmount();
  }
});
for (const kind of ['unmount', 'strictRemount', 'passive']) test(`${kind}: synchronous lifetime/cancellation blocks pending success and errors`, async () => {
  for (const fail of [false, true]) {
    const h = harness(await fixture()); const cleanup = h.startEffect();
    kind === 'passive' ? cleanup() : h[kind]();
    await h.settle(fail); assert.deepEqual(h.commits, []); assert.deepEqual(h.errors, []); h.unmount();
  }
});
test('StrictMode new lifetime restores while old effect stays invalid before passive cleanup', async () => {
  const h = harness(await fixture()); h.startEffect(); h.strictRemount(); h.startEffect(); await h.settle();
  assert.equal(h.reads.length, 2); assert.equal(h.commits.length, 1); assert.equal(h.commits[0][0], 'design'); h.unmount();
});
for (const slot of ['fabric-base', 'fabric-design', null]) test(`valid ${slot ?? 'default'} restores exact original bytes and artifact identity`, async () => {
  const f = await fixture(), h = harness(f, { slot }); h.startEffect(); await h.settle();
  assert.equal(h.commits.length, 1); const [branch, image] = h.commits[0];
  assert.equal(branch, slot === 'fabric-base' ? 'base' : 'design');
  assert.deepEqual(Buffer.from(image.url.split(',')[1], 'base64'), f.bytes);
  assert.equal(image.galleryImageId, f.artifact.id); assert.equal(image.referenceType, 'base'); assert.equal(image.fromGallery, true);
  assert.equal('storagePath' in image, false); assert.equal(f.artifact.imageUrl.startsWith('local-canvas-asset://'), true);
  assert.deepEqual(h.errors, []); h.unmount();
});
for (const [metadata, expected] of [[{ sourceImageId: 'source', remoteImageId: 'remote' }, 'source'],
  [{ remoteImageId: 'remote' }, 'remote'], [{ sourceImageId: 0, remoteImageId: 'remote' }, 'original-id']]) {
  test(`canonical storage path and source-ID precedence ${expected}/${JSON.stringify(metadata)} are preserved`, async () => {
    const f = await fixture({ ...metadata, remoteStoragePath: 'generated-images/original' });
    f.artifact.imageUrl = 'https://expired.test/original';
    let signCount = 0;
    globalThis.__materialSign = async rows => { signCount++; assert.deepEqual(rows, [{ storage_path: 'generated-images/original', image_url: '' }]); return [{ image_url: 'fresh-original-url' }]; };
    const h = harness(f); h.startEffect(); await h.settle();
    assert.equal(signCount, 1); assert.equal(h.commits[0][1].storagePath, 'generated-images/original');
    assert.equal(h.commits[0][1].galleryImageId, expected); assert.equal(h.commits[0][1].url, 'fresh-original-url'); h.unmount();
  });
}
test('auth fence must match rendered user, brand and generation before any read', async () => {
  for (const patch of [{ user: { id: 'bob' } }, { currentBrand: { id: 'other' } },
    { brandState: { status: 'success_nonempty', userId: 'alice', requestGeneration: 2, confirmedBrandIds: ['brand'], error: null } }]) {
    const h = harness(await fixture()); h.live(patch); h.startEffect(); assert.equal(h.reads.length, 0); h.unmount();
  }
});
test('valid read failure reports an error; no input is adopted', async () => {
  const h = harness(await fixture()); h.startEffect(); await h.settle(true);
  assert.deepEqual(h.commits, []); assert.equal(h.errors.length, 1); h.unmount();
});
test('production reader missing bytes reports an error without alternate input', async () => {
  const f = await fixture(); f.artifact.imageUrl = assets.buildLocalCanvasAssetReference('missing');
  const h = harness(f); h.startEffect(); await h.settle();
  assert.deepEqual(h.commits, []); assert.equal(h.errors.length, 1); h.unmount();
});
for (const slot of ['printing-design', 'printing-garment']) test(`printing ${slot} preserves branch mapping and guard before entry`, async () => {
  const h = harness(await fixture(), { slot, printing: true }); h.startEffect(); await h.settle();
  assert.equal(h.commits[0][0], slot === 'printing-design' ? 'printing-design' : 'garment');
  assert.equal(h.commits[0][1].referenceType, slot === 'printing-design' ? 'pattern' : 'base');
  if (slot === 'printing-design') assert.equal(h.commits[0][1].printDesignAssetPurpose, 'print-design');
  h.unmount();
  const stale = harness(await fixture(), { slot, printing: true }); stale.startEffect(); stale.render({ isAuthLoading: true });
  await stale.settle(); assert.deepEqual(stale.commits, []); stale.unmount();
});
test('printing registration errors are currentness guarded after await addDesigns', async () => {
  for (const kind of ['valid', ...Object.keys(fields), 'unmount', 'strictRemount', 'reject']) {
    const add = deferred(), h = harness(await fixture(), { slot: 'printing-design', printing: true, addResult: add });
    h.startEffect(); await h.settle(); assert.equal(h.commits.length, 1);
    if (kind in fields) h.render(fields[kind](h.context()));
    if (kind === 'unmount' || kind === 'strictRemount') h[kind]();
    if (kind === 'reject') { h.unmount(); add.reject(new Error('registration_failed')); }
    else add.resolve({ ok: false, reason: 'registration_failed' });
    await tick(); assert.equal(h.errors.length, kind === 'valid' ? 1 : 0, kind); h.unmount();
  }
});
test('Library artifact takes precedence over resumeJob in actual fabric and printing resume effects', () => {
  const resumeEffects = nodes.filter(n => ts.isCallExpression(n) && n.expression.getText(ast) === 'useEffect'
    && n.arguments[0].getText(ast).includes('libraryHandoff.artifactId')
    && (n.arguments[0].getText(ast).includes('!resumeJob') || n.arguments[0].getText(ast).includes('!printInputScope')));
  assert.equal(resumeEffects.length, 2);
  for (const resumeEffect of resumeEffects) for (const printing of [false, true]) {
    evaluate(`return (${resumeEffect.arguments[0].getText(ast)});`, {
      isPrinting: printing, resumeJob: 'job', libraryHandoff: { artifactId: 'original-id' },
      isAuthInitialized: true, isAuthLoading: false, currentBrand: { id: 'brand' }, user: { id: 'alice' },
      materialResumeHydrationGenerationRef: { current: 0 },
      setMaterialResumeReadback: value => assert.equal(value, 'idle'),
    })(); // Every other missing binding throws: the guard must exit before reading resume inputs.
  }
});
test('actual dependencies include render revision and auth generation; external effects stay absent', () => {
  const dependencies = effect.arguments[1].elements.map(n => n.getText(ast));
  assert.ok(dependencies.includes('libraryRenderRevision')); assert.ok(dependencies.includes('brandState.requestGeneration'));
  assert.equal(externalAttempts, 0);
});
after(async () => {
  await vite.close(); await fs.rm(cacheDir, { recursive: true, force: true });
  for (const [key, descriptor] of Object.entries(original)) descriptor ? Object.defineProperty(globalThis, key, descriptor) : delete globalThis[key];
});
