import assert from 'node:assert/strict';
import test from 'node:test';
import fs from 'node:fs/promises';
import ts from 'typescript';
import {normalizeGenerationSourceReferences} from '../src/lib/generationSourceReferences.ts';

// Execute the actual production component setup/effects and hook upload closure.
const pageSource = await fs.readFile(new URL('../src/pages/LightchainParityPages.tsx', import.meta.url), 'utf8');
const hookSource = await fs.readFile(new URL('../src/hooks/useCanonicalImageWorkspace.ts', import.meta.url), 'utf8');
const parse = (file, source, kind) => {
  const ast = ts.createSourceFile(file, source, ts.ScriptTarget.Latest, true, kind), nodes = [];
  const walk = node => { nodes.push(node); ts.forEachChild(node, walk); }; walk(ast);
  return { ast, nodes };
};
const page = parse('page.tsx', pageSource, ts.ScriptKind.TSX), hook = parse('hook.ts', hookSource, ts.ScriptKind.TS);
const component = page.nodes.find(n => ts.isFunctionDeclaration(n) && n.name?.text === 'LightchainPrintingWorkspace');
const setup = component.body.statements.slice(0, component.body.statements.findIndex(n => ts.isIfStatement(n) && n.expression.getText(page.ast) === "window.location.pathname === '/printing'")).map(n => n.getText(page.ast)).join('\n');
assert.ok(setup.includes('restorePrintInputState') && setup.includes('const handleFile='), 'extract all production setup through the pinned printing render branch');
const uploadNode = hook.nodes.find(n => ts.isVariableDeclaration(n) && n.name.getText(hook.ast) === 'upload');
const evaluate = (code, bindings) => new Function('bindings', `with(bindings){${ts.transpile(`return (${code});`, { target: ts.ScriptTarget.ES2022 })}}`)(new Proxy(bindings, {
  has: () => true, get: (object, key) => key === Symbol.unscopables ? undefined : key in object ? object[key] : globalThis[key],
}));
const idle = () => new Promise(resolve => setImmediate(resolve));
const settle = async () => { for (let i = 0; i < 8; i++) await idle(); };
const deferred = () => { let resolve, reject; const promise = new Promise((a, b) => { resolve = a; reject = b; }); return { promise, resolve, reject }; };
const snapshot = () => ({ garment: { url: 'draft-base', storagePath: 'generated-images/base' }, designs: [{ url: 'draft-design' }], editorState: { coverageMode: 'full' } });

function uploadFixture({ stage, gate, fail = false, toolId='printing-image' } = {}) {
  const calls = { dimensions: 0, metadata: 0, writes: [], commits: [], revoked: [], deleted: [], created: [] };
  let state = { slots: { primary: null, secondary: null }, pendingId: null, status: 'empty', error: null };
  const wait = async name => { if (stage === name) { await gate.promise; if (fail) throw new Error(`failed ${name}`); } };
  const b = {
    toolId, normalizeGenerationSourceReferences, mounted: { current: true }, scopeRef: { current: 'scope' }, busy: { current: false },
    stateRef: { current: state }, uploadSequence: { current: { primary: 0, secondary: 0 } }, releases: { current: {} },
    authSnapshot: () => ({ userId: 'alice', brandId: 'brand' }), assertAuthBrandFence: () => {},
    URL: { createObjectURL: () => { const url = `blob:upload-${calls.created.length}`; calls.created.push(url); return url; }, revokeObjectURL: url => calls.revoked.push(url) },
    dimensions: async () => { calls.dimensions++; await wait('dimensions'); return { width: 10, height: 10 }; },
    buildLocalUploadSourceMetadata: async () => { calls.metadata++; await wait('metadata'); return { sourceRevision: { revision: 'draft-revision' } }; },
    putLocalCanvasAsset: async (id, file) => { calls.writes.push([id, await file.text()]); await wait('idb'); },
    buildLocalCanvasAssetReference: id => `local-canvas-asset://${id}`,
    setState: next => { state = typeof next === 'function' ? next(state) : next; b.stateRef.current = state; calls.commits.push(state); },
    deleteLocalCanvasAsset: id => { calls.deleted.push(id); throw Error('forbidden delete'); },
  };
  return { b, calls, upload: evaluate(uploadNode.initializer.getText(hook.ast), b), get state() { return state; } };
}

function printingFixture({ search = '', jobId = null, pendingId = null, restore, sign, fetcher, upload } = {}) {
  const calls = { reads: 0, signs: [], fetches: [], blobs: 0, uploads: [], writes: [], coverageWrites: [], forbidden: [] };
  const refs = [], states = [], effects = [], memos = []; let refIndex, stateIndex, effectIndex, memoIndex;
  const workspace = { jobId, pendingId, status: 'empty', slots: { primary: null, secondary: null }, inputState: { coverage: 'spot' }, brief: '',
    upload: async (key, file, current,identity) => { calls.uploads.push([key, await file.text(), Boolean(current),identity]); if (upload) await upload(key, file, current,identity); else if (!current || current()) workspace.slots[key] = { imageUrl: `uploaded:${key}` }; },
    setInputState: value => { workspace.inputState = value; }, clearSource: key => { workspace.slots[key] = null; },
  };
  workspace.generate = () => { calls.forbidden.push('provider generation'); throw Error('forbidden provider'); };
  const auth = { user: { id: 'alice' }, currentBrand: { id: 'brand' } }, location = { search };
  const b = {
    useCanonicalImageWorkspace: () => workspace, useAuthStore: () => auth, useNavigate: () => () => calls.forbidden.push('navigate'), useLocation: () => location,
    cloudflareDataPlane: null, window: { location: { origin: 'https://printing.test' } },
    useRef: initial => { const i = refIndex++; return refs[i] ??= { current: initial }; },
    useState: initial => { const i = stateIndex++; states[i] ??= initial; return [states[i], value => { states[i] = value; }]; },
    useMemo: (fn, deps) => { const i = memoIndex++; if (!memos[i] || deps.some((d, k) => !Object.is(d, memos[i].deps[k]))) memos[i] = { value: fn(), deps }; return memos[i].value; },
    useEffect: (fn, deps) => { const i = effectIndex++, old = effects[i]; if (!old || deps.some((d, k) => !Object.is(d, old.deps[k]))) effects[i] = { fn, deps, cleanup: old?.cleanup, scheduled: true }; },
    restorePrintInputState: async (...args) => { calls.reads++; return restore ? restore(...args) : snapshot(); },
    withSignedImageUrls: async rows => { calls.signs.push(rows); return sign ? sign(rows) : [{ image_url: 'fresh-base' }]; },
    fetch: async url => { calls.fetches.push(url); return fetcher ? fetcher(url) : { ok: true, blob: async () => { calls.blobs++; return new Blob([url], { type: 'image/png' }); } }; },
    persistPrintInputState: async (...args) => { args[4]?.assertContext?.(); calls.writes.push(args); },
    updatePrintInputCoverage: async (...args) => { args[2]?.assertContext?.(); calls.coverageWrites.push(args); },
    saveCanvas: () => { calls.forbidden.push('global Canvas/save'); throw Error('forbidden Canvas'); },
    persistProviderResultArtifact: () => { calls.forbidden.push('provider save'); throw Error('forbidden provider save'); },
  };
  b.useAuthStore.getState=()=>auth;
  const renderSetup = evaluate(`()=>{${setup}\nreturn {draftReady,draftEdited,draftSourceEdited,draftReadyContext,draftRestoreGeneration,draftContext,draftContextRef,beginDraftEdit,setCoverage,handleFile,handleCanonicalFiles,reset};}`, b);
  let view;
  const render = (flush = true) => { refIndex = stateIndex = effectIndex = memoIndex = 0; view = renderSetup(); if (flush) flushEffects(); return view; };
  const flushEffects = () => { for (const effect of effects) if (effect.scheduled) { effect.scheduled = false; effect.cleanup?.(); effect.cleanup = effect.fn(); } };
  const unmount = () => { for (const effect of effects) effect.cleanup?.(); };
  const safe = () => assert.deepEqual(calls.forbidden, []);
  return { calls, workspace, auth, location, refs, states, memos, render, flushEffects, unmount, safe, get view() { return view; } };
}

for (const search of ['?libraryArtifactId=original&librarySlot=printing-design', '?libraryArtifactId=missing&librarySlot=bad', '?libraryArtifactId=']) test(`explicit Library never reads/uploads/persists historical drafts (${search})`, async () => {
  const f = printingFixture({ search }); f.workspace.slots.secondary = { imageUrl: 'original-library-bytes' };
  f.render(); await settle(); f.workspace.status = 'unavailable'; f.render(); await settle();
  assert.equal(f.calls.reads, 0); assert.deepEqual(f.calls.uploads, []); assert.deepEqual(f.calls.writes, []); assert.equal(f.view.draftReady.current, false); f.safe(); f.unmount();
});
for (const mode of ['job', 'pending']) test(`${mode} blocks automatic draft reads and writes`, async () => {
  const f = printingFixture(mode === 'job' ? { jobId: 'saved-job' } : { pendingId: 'original-pending' });
  f.workspace.slots.primary = { imageUrl: 'current-input' }; f.render(); f.view.beginDraftEdit(); f.render(); await settle();
  assert.equal(f.calls.reads, 0); assert.deepEqual(f.calls.writes, []); f.safe(); f.unmount();
});

for (const boundary of ['read', 'sign', 'fetch', 'blob']) for (const rejects of [false, true]) test(`late ${boundary} ${rejects ? 'failure' : 'success'} is discarded on render before passive cleanup`, async () => {
  const gate = deferred(); let entered = false;
  const f = printingFixture({
    restore: boundary === 'read' ? () => { entered = true; return gate.promise; } : undefined,
    sign: boundary === 'sign' ? () => { entered = true; return gate.promise; } : undefined,
    fetcher: boundary === 'fetch' ? () => { entered = true; return gate.promise; } : boundary === 'blob' ? async () => ({ ok: true, blob: () => { entered = true; return gate.promise; } }) : undefined,
  });
  f.render(); await settle(); assert.equal(entered, true);
  f.location.search = '?libraryArtifactId=original&librarySlot=printing-design'; f.render(false);
  if (rejects) gate.reject(Error('late failure'));
  else gate.resolve(boundary === 'read' ? snapshot() : boundary === 'sign' ? [{ image_url: 'late-sign' }] : boundary === 'fetch' ? { ok: true, blob: () => { throw Error('stale blob must not run'); } } : new Blob(['late-blob'], { type: 'image/png' }));
  await settle(); assert.deepEqual(f.calls.uploads, []); assert.deepEqual(f.calls.writes, []);
  assert.equal(f.workspace.inputState.coverage, 'spot'); assert.equal(f.states[2], ''); assert.equal(f.view.draftReady.current, false);
  if (boundary === 'read') assert.equal(f.calls.signs.length, 0);
  f.flushEffects(); f.unmount(); f.safe();
});

for (const boundary of ['dimensions', 'metadata', 'idb']) test(`actual upload discards obsolete draft at ${boundary}; releases URL without deletion`, async () => {
  const gate = deferred(), u = uploadFixture({ stage: boundary, gate });
  const f = printingFixture({ upload: u.upload }); f.render(); await settle();
  assert.equal(u.calls.created.length, 1);
  f.location.search = '?libraryArtifactId=original&librarySlot=printing-design'; f.render(false); gate.resolve(); await settle();
  assert.deepEqual(u.calls.commits, []); assert.deepEqual(u.calls.revoked, u.calls.created); assert.deepEqual(u.calls.deleted, []);
  assert.equal(u.calls.writes.length, boundary === 'idb' ? 1 : 0);
  assert.equal(f.workspace.inputState.coverage, 'spot'); assert.equal(f.view.draftReady.current, false); f.unmount(); f.safe();
});
for (const boundary of ['dimensions', 'metadata']) test(`stale ${boundary} upload errors cannot replace current Library error`, async () => {
  const gate = deferred(), u = uploadFixture({ stage: boundary, gate, fail: true }); let current = true;
  const task = u.upload('secondary', new File(['draft'], 'old.png', { type: 'image/png' }), () => current);
  await settle(); current = false; gate.resolve(); await task;
  assert.deepEqual(u.calls.commits, []); assert.deepEqual(u.calls.revoked, u.calls.created); assert.equal(u.calls.writes.length, 0);
});
test('invalid guarded upload at entry creates no URL, metadata, asset or error', async () => {
  const u = uploadFixture(); await u.upload('secondary', new File(['bad'], 'bad.txt'), () => false);
  assert.deepEqual(u.calls.created, []); assert.deepEqual(u.calls.writes, []); assert.deepEqual(u.calls.commits, []);
});
test('ordinary two-argument upload remains persistent and previous URL is released', async () => {
  const u = uploadFixture(); let released = 0; u.b.releases.current.secondary = { release: () => released++ };
  await u.upload('secondary', new File(['new-manual-bytes'], 'new.png', { type: 'image/png' }));
  assert.equal(u.state.slots.secondary.name, 'new.png'); assert.equal(u.state.slots.secondary.persistenceStatus, 'persistent');
  assert.deepEqual(u.calls.writes, [['draft-revision', 'new-manual-bytes']]); assert.equal(released, 1); assert.deepEqual(u.calls.revoked, []);
  u.b.releases.current.secondary.release(); assert.deepEqual(u.calls.revoked, u.calls.created); assert.deepEqual(u.calls.deleted, []);
});

test('passive draft restoration keeps stored sources and placement without rewriting them', async () => {
  const saved={...snapshot(),designs:[{url:'draft-design'},{url:'second-design'}],editorState:{coverageMode:'full',outputScale:2,placementConfirmed:true,layers:[{layerId:'first',designIndex:0,transform:{x:14,y:18,scale:1.3,rotation:20}},{layerId:'second',designIndex:1,transform:{x:42,y:9,scale:0.7,rotation:-10}}]}};
  const original=structuredClone(saved);
  const f = printingFixture({restore:async()=>saved}); f.render(); assert.deepEqual(f.calls.writes, []); await settle();
  assert.deepEqual(f.calls.uploads.map(([key, bytes, guarded]) => [key, bytes, guarded]), [['primary', 'fresh-base', true], ['secondary', 'draft-design', true]]);
  assert.equal(f.workspace.inputState.coverage, 'full'); assert.equal(f.view.draftReady.current, true);
  assert.equal(f.view.draftReadyContext.current, f.view.draftContext); f.render(); await settle();
  assert.deepEqual(f.calls.writes, [], 'restoration must not replace the saved editor state or drop additional layers');
  assert.deepEqual(saved,original);
  f.view.setCoverage('spot'); f.render(); await settle();
  assert.deepEqual(f.calls.writes, [], 'coverage-only edits must not rewrite the source/layer snapshot');
  assert.equal(f.calls.coverageWrites.length,1);assert.equal(f.calls.coverageWrites[0][1],'spot'); f.safe(); f.unmount();
});
for (const failure of ['read', 'sign']) test(`ordinary ${failure} failure blocks automatic persistence until explicit edit`, async () => {
  const f = printingFixture({ restore: failure === 'read' ? async () => { throw Error('read offline'); } : undefined, sign: failure === 'sign' ? async () => { throw Error('sign offline'); } : undefined });
  f.render(); await settle(); f.render(); assert.equal(f.view.draftReady.current, false); assert.deepEqual(f.calls.writes, []); assert.match(f.states[2], /取得できません/);
  f.view.handleFile({ target: { files: [new File(['manual'], 'manual.png', { type: 'image/png' })] } }, 'base'); await settle(); f.render(); await settle();
  assert.equal(f.calls.writes.length, 1); assert.equal(f.view.draftReady.current, true); f.safe(); f.unmount();
});
for (const change of ['artifact', 'slot', 'remove', 'owner', 'brand', 'origin', 'job', 'pending']) test(`readiness from prior context cannot persist during ${change} render`, async () => {
  const f = printingFixture({ search: '?libraryArtifactId=first&librarySlot=printing-design' });
  f.workspace.slots.secondary = { imageUrl: 'first-original' }; f.render(); f.view.beginDraftEdit(); assert.equal(f.view.draftReady.current, true);
  if (change === 'artifact') f.location.search = '?libraryArtifactId=second&librarySlot=printing-design';
  if (change === 'slot') f.location.search = '?libraryArtifactId=first&librarySlot=primary';
  if (change === 'remove') f.location.search = '';
  if (change === 'owner') f.auth.user.id = 'bob';
  if (change === 'brand') f.auth.currentBrand.id = 'other';
  // Exercise a new persistence scope as well as route/auth/workspace identities.
  const oldContext = f.view.draftContext;
  if (change === 'origin') f.memos[0].value = { ...f.memos[0].value, origin: 'https://other-printing.test' };
  if (change === 'job') f.workspace.jobId = 'saved-job';
  if (change === 'pending') f.workspace.pendingId = 'retained-pending';
  f.render(false); assert.notEqual(f.view.draftContext, oldContext);
  assert.notEqual(f.view.draftReadyContext.current, f.view.draftContext);
  // Run the scheduled persistence effect before restoration invalidation as well.
  // Its actual conditions independently reject old readiness.
  const persistenceEffect = page.nodes.find(n => ts.isCallExpression(n) && n.expression.getText(page.ast) === 'useEffect' && n.arguments[0].getText(page.ast).includes('persistPrintInputState(currentBrand.id,referenceImage'));
  const bindings = { ...f.view, workspace: f.workspace, user: f.auth.user, currentBrand: f.auth.currentBrand,
    referenceImage: null, printImage: { url: 'first-original' }, coverage: 'spot', persistenceScope: { origin: 'https://printing.test', userId: f.auth.user.id }, persistPrintInputState: (...args) => { f.calls.writes.push(args); return Promise.resolve(); } };
  evaluate(persistenceEffect.arguments[0].getText(page.ast), bindings)(); assert.deepEqual(f.calls.writes, []);
  f.unmount(); f.safe();
});

test('removing Library starts ordinary restoration; switching artifact cancels that work before cleanup', async () => {
  const gate = deferred(), f = printingFixture({ search: '?libraryArtifactId=first', restore: () => gate.promise });
  f.render(); assert.equal(f.calls.reads, 0); f.location.search = ''; f.render(); assert.equal(f.calls.reads, 1);
  f.location.search = '?libraryArtifactId=second&librarySlot=printing-design'; f.render(false); gate.resolve(snapshot()); await settle();
  assert.deepEqual(f.calls.uploads, []); assert.deepEqual(f.calls.signs, []); assert.deepEqual(f.calls.writes, []); f.unmount(); f.safe();
});
for (const edit of ['coverage', 'file', 'canonical-files', 'reset', 'cancel-picker']) test(`explicit Library preserves manual ${edit} behavior`, async () => {
  const f = printingFixture({ search: '?libraryArtifactId=original&librarySlot=printing-design' });
  f.workspace.slots.secondary = { imageUrl: 'original-library' }; f.render(); const file = new File(['manual-input'], 'manual.png', { type: 'image/png' });
  if (edit === 'coverage') f.view.setCoverage('full');
  if (edit === 'file') f.view.handleFile({ target: { files: [file] } }, 'base');
  if (edit === 'canonical-files') f.view.handleCanonicalFiles({ target: { files: [file, file] } });
  if (edit === 'reset') f.view.reset();
  if (edit === 'cancel-picker') { f.view.handleFile({ target: { files: [] } }, 'base'); f.view.handleCanonicalFiles({ target: { files: [] } }); }
  await settle(); f.render(); await settle(); assert.equal(f.calls.reads, 0);
  if (edit === 'cancel-picker') { assert.equal(f.view.draftReady.current, false); assert.deepEqual(f.calls.writes, []); }
  else { assert.equal(f.view.draftReady.current, true); assert.equal(f.calls.writes.length, 1); }
  if (edit === 'coverage') assert.equal(f.calls.writes[0][4].editorState.coverageMode, 'full');
  if (edit === 'reset') { assert.equal(f.workspace.slots.primary, null); assert.equal(f.workspace.slots.secondary, null); assert.equal(f.calls.writes[0][1], null); assert.deepEqual(f.calls.writes[0][2], []); }
  f.unmount(); f.safe();
});

test('manual edit during an ordinary deferred upload cancels stale draft without deleting assets', async () => {
  const gate = deferred(), u = uploadFixture({ stage: 'metadata', gate });
  const f = printingFixture({ upload: u.upload }); f.render(); await settle();
  f.view.setCoverage('spot'); gate.resolve(); await settle();
  assert.deepEqual(u.calls.commits, []); assert.deepEqual(u.calls.writes, []); assert.deepEqual(u.calls.deleted, []); assert.deepEqual(u.calls.revoked, u.calls.created);
  assert.equal(f.workspace.inputState.coverage, 'spot'); assert.equal(f.view.draftReady.current, true); f.unmount(); f.safe();
});

test('captured prior-context persistence effect is invalidated by the render-updated ref', async () => {
  const f = printingFixture({ search: '?libraryArtifactId=first' }); f.render(); f.view.beginDraftEdit();
  const oldView = f.view; f.location.search = '?libraryArtifactId=second'; f.render(false);
  const effect = page.nodes.find(n => ts.isCallExpression(n) && n.expression.getText(page.ast) === 'useEffect' && n.arguments[0].getText(page.ast).includes('persistPrintInputState(currentBrand.id,referenceImage'));
  evaluate(effect.arguments[0].getText(page.ast), { ...oldView, workspace: f.workspace, user: f.auth.user, currentBrand: f.auth.currentBrand, referenceImage: { url: 'old-source' }, printImage: null, coverage: 'spot', persistenceScope: { origin: 'https://printing.test', userId: 'alice' }, persistPrintInputState: (...args) => { f.calls.writes.push(args); return Promise.resolve(); } })();
  assert.deepEqual(f.calls.writes, []); f.unmount(); f.safe();
});

for (const boundary of ['read', 'upload']) test(`Library arrival then removal before effect cleanup cannot revive old ${boundary}`, async () => {
  const gate = deferred(), u = uploadFixture({ stage: 'metadata', gate });
  const f = printingFixture(boundary === 'read' ? { restore: () => gate.promise } : { upload: u.upload });
  f.render(); await settle(); const originalGeneration = f.view.draftRestoreGeneration.current;
  f.location.search = '?libraryArtifactId=first&librarySlot=printing-design'; f.render(false);
  f.location.search = ''; f.render(false); assert.ok(f.view.draftRestoreGeneration.current > originalGeneration);
  gate.resolve(snapshot()); await settle();
  assert.equal(f.workspace.inputState.coverage, 'spot'); assert.equal(f.view.draftReady.current, false);
  assert.deepEqual(f.calls.writes, []); assert.deepEqual(u.calls.commits, []); assert.deepEqual(u.calls.writes, []);
  if (boundary === 'read') assert.deepEqual(f.calls.uploads, []);
  if (boundary === 'upload') assert.deepEqual(u.calls.revoked, u.calls.created);
  f.unmount(); f.safe();
});

// Run the actual optional source-edit hook used by the printing controls.
const controlsSource=await fs.readFile(new URL('../src/components/CanonicalImageWorkspaceControls.tsx',import.meta.url),'utf8');
const controls=parse('controls.tsx',controlsSource,ts.ScriptKind.TSX);
const additionalInput=controls.nodes.find(n=>ts.isJsxSelfClosingElement(n)&&n.tagName.getText(controls.ast)==='input'&&n.attributes.properties.some(p=>ts.isJsxAttribute(p)&&p.name.getText(controls.ast)==='aria-label'&&p.initializer?.getText(controls.ast)==='"追加の参考画像"'));
const additionalHandler=additionalInput.attributes.properties.find(p=>ts.isJsxAttribute(p)&&p.name.getText(controls.ast)==='onChange').initializer.expression;
for(const selected of [false,true])test(`printing extra-reference ${selected?'selection saves':'cancel preserves'} a passively restored draft`,async()=>{
 const f=printingFixture();f.render();await settle();f.render();await settle();assert.deepEqual(f.calls.writes,[]);
 const onChange=evaluate(additionalHandler.getText(controls.ast),{workspace:f.workspace,onSourceEdit:f.view.beginDraftEdit});
 const event={target:{files:selected?[new File(['extra-reference'],'extra.png',{type:'image/png'})]:[],value:'filename'}};onChange(event);await settle();f.render();await settle();
 assert.equal(event.target.value,'');assert.equal(f.calls.writes.length,selected?1:0);
 if(selected)assert.equal(f.calls.uploads.at(-1)[1],'extra-reference');f.safe();f.unmount();
});

for(const change of ['owner','brand','brand-state','edit'])test(`queued coverage update rejects a later ${change} without source snapshot rewrite`,async()=>{
 const f=printingFixture();f.render();await settle();f.render();f.view.setCoverage('spot');f.render();await settle();
 assert.equal(f.calls.coverageWrites.length,1);assert.deepEqual(f.calls.writes,[]);const options=f.calls.coverageWrites[0][2];
 if(change==='owner')f.auth.user.id='different';if(change==='brand')f.auth.currentBrand.id='other';if(change==='brand-state')f.auth.brandState={phase:'switching'};if(change==='edit')f.view.beginDraftEdit();
 assert.throws(()=>options.assertContext(),/context_changed/);f.safe();f.unmount();
});

test('explicit printing Library selection keeps its provided ID and storage path in a deliberate draft save',async()=>{
 const f=printingFixture({search:'?libraryArtifactId=original&librarySlot=printing-design'});f.workspace.slots.secondary={imageUrl:'selected-library',sourceImageId:'ai-pattern-0',sourceStoragePath:'generated-images/ai-pattern-0'};f.render();f.view.setCoverage('full');f.render();await settle();
 assert.equal(f.calls.writes.length,1);const design=f.calls.writes[0][2][0];assert.equal(design.galleryImageId,'ai-pattern-0');assert.equal(design.storagePath,'generated-images/ai-pattern-0');f.safe();f.unmount();
});
test('saved printing identities survive the actual guarded upload closure during draft restoration',async()=>{
 const u=uploadFixture();const f=printingFixture({upload:u.upload,restore:async()=>({garment:{url:'old',galleryImageId:'ai-garment-0',storagePath:'generated-images/ai-garment-0'},designs:[{url:'pattern',galleryImageId:'ai-pattern-0',storagePath:'generated-images/ai-pattern-0'}],editorState:{coverageMode:'spot'}})});
 f.render();await settle();assert.equal(u.state.slots.primary.sourceImageId,'ai-garment-0');assert.equal(u.state.slots.primary.sourceStoragePath,'generated-images/ai-garment-0');assert.equal(u.state.slots.secondary.sourceImageId,'ai-pattern-0');assert.equal(u.state.slots.secondary.sourceStoragePath,'generated-images/ai-pattern-0');assert.deepEqual(f.calls.writes,[]);f.safe();f.unmount();
});

test('restored identity is cloned before asynchronous image work and a later manual file clears it',async()=>{
 const gate=deferred(),u=uploadFixture({stage:'dimensions',gate});const identity={sourceImageId:'original',sourceStoragePath:'generated-images/original'};const task=u.upload('primary',new File(['old'],'old.png',{type:'image/png'}),()=>true,identity);
 await settle();identity.sourceImageId='changed';identity.sourceStoragePath='generated-images/changed';gate.resolve();await task;assert.equal(u.state.slots.primary.sourceImageId,'original');assert.equal(u.state.slots.primary.sourceStoragePath,'generated-images/original');
 await u.upload('primary',new File(['manual'],'new.png',{type:'image/png'}));assert.equal(u.state.slots.primary.sourceImageId,undefined);assert.equal(u.state.slots.primary.sourceStoragePath,undefined);
});
for(const mode of ['missing-guard','wrong-tool','url-id','unsafe-path'])test(`restored printing source ${mode} is rejected before URLs, metadata or asset writes`,async()=>{
 const u=uploadFixture({toolId:mode==='wrong-tool'?'lab':'printing-image'}),identity={sourceImageId:mode==='url-id'?'https://unsafe.test':'original',sourceStoragePath:mode==='unsafe-path'?'https://unsafe.test':'generated-images/original'};
 await assert.rejects(u.upload('primary',new File(['bytes'],'file.png',{type:'image/png'}),mode==='missing-guard'?undefined:()=>true,identity),/identity_invalid/);assert.deepEqual(u.calls.created,[]);assert.deepEqual(u.calls.writes,[]);assert.deepEqual(u.calls.commits,[]);
});
test('a stored path without a historical ID stays path-only; no ID is inferred',async()=>{const u=uploadFixture();await u.upload('primary',new File(['bytes'],'source.png',{type:'image/png'}),()=>true,{sourceStoragePath:'generated-images/original'});assert.equal(u.state.slots.primary.sourceImageId,undefined);assert.equal(u.state.slots.primary.sourceStoragePath,'generated-images/original');});
