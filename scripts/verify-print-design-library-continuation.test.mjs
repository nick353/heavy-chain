import assert from 'node:assert/strict';
import test, { after } from 'node:test';
import fs from 'node:fs/promises';
import React from 'react';
import ts from 'typescript';

// Execute the production render context, Library effect, validity helper and home JSX.
const source = await fs.readFile(new URL('../src/pages/LightchainWorkbenchPage.tsx', import.meta.url), 'utf8');
const ast = ts.createSourceFile('workbench.tsx', source, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
const nodes = [];
const walk = n => { nodes.push(n); ts.forEachChild(n, walk); };
walk(ast);
const session = nodes.find(n => ts.isFunctionDeclaration(n) && n.name?.text === 'LightchainWorkbenchWorkspace');
const variable = name => nodes.find(n => ts.isVariableDeclaration(n) && n.name.getText(ast) === name);
const effect = nodes.find(n => ts.isCallExpression(n) && n.expression.getText(ast) === 'useEffect'
  && n.arguments[0].getText(ast).includes('const restoreLibraryArtifact = async'));
const home = session.body.statements.find(n => ts.isIfStatement(n) && n.expression.getText(ast) === "selectedTool.id === 'print-design-project'");
const statements = session.body.statements;
const start = statements.findIndex(n => n.getText(ast).startsWith('const libraryRenderContextKey ='));
const end = statements.findIndex((n, i) => i > start && ts.isExpressionStatement(n)
  && ts.isCallExpression(n.expression) && n.expression.expression.getText(ast) === 'useLayoutEffect');
assert.ok(effect && home && start >= 0 && end > start);
const renderSource = statements.slice(start, end + 1).map(n => n.getText(ast)).join('\n');
const helpers = ['captureCurrentAuthBrandFence', 'assertCurrentAuthBrandFence', 'metadataString', 'isPrintDesignLibraryContinuationValid']
  .map(name => variable(name).parent.parent.getText(ast)).join('\n');
const authSource = await fs.readFile(new URL('../src/lib/authBrandSelection.ts', import.meta.url), 'utf8');
const auth = {};
new Function('exports', ts.transpileModule(authSource, { compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS } }).outputText)(auth);
function evaluate(code, bindings) {
  const compiled = ts.transpileModule(code, { fileName: 'production.tsx', compilerOptions: {
    target: ts.ScriptTarget.ES2022, jsx: ts.JsxEmit.React, module: ts.ModuleKind.CommonJS,
  } }).outputText;
  return new Function('bindings', `with(bindings){${compiled}}`)(new Proxy(bindings, {
    has: () => true,
    get: (object, key) => {
      if (key === Symbol.unscopables) return undefined;
      if (key in object) return object[key];
      if (['JSON', 'Math', 'URLSearchParams', 'encodeURIComponent'].includes(key)) return globalThis[key];
      throw new Error(`unexpected_production_binding:${String(key)}`);
    },
  }));
}
const originalFetch = globalThis.fetch;
let externalAttempts = 0;
const forbidden = () => { externalAttempts++; throw new Error('unexpected_external_effect'); };
globalThis.fetch = forbidden;
const tick = () => new Promise(resolve => setImmediate(resolve));
function elements(tree) {
  if (Array.isArray(tree)) return tree.flatMap(elements);
  if (!React.isValidElement(tree)) return [];
  return [tree, ...elements(tree.props.children)];
}
function harness({ search = '?libraryArtifactId=original-id&librarySlot=primary&tag=a&tag=b&keep=%2B%20', hash = '#exact%20anchor', missing = false, emptyImage = false } = {}) {
  let context = { user: { id: 'alice' }, currentBrand: { id: 'brand' }, isAuthInitialized: true, isAuthLoading: false,
    brandState: { status: 'success_nonempty', userId: 'alice', requestGeneration: 1, confirmedBrandIds: ['brand'], error: null },
    selectedTool: { id: 'print-design-project' }, isFeatureDetail: true,
    location: { pathname: '/editor/patternDesign', search, hash } };
  let live, rendered, layoutSetup, layoutCleanup, refIndex = 0, resolve, reject;
  const refs = [], calls = [], reads = [], transitions = [], state = { libraryContinuation: null, slots: { primary: null, secondary: null } };
  const pending = new Promise((a, b) => { resolve = a; reject = b; });
  const artifact = { id: 'original-id', title: 'Original', featureType: 'library', prompt: 'Original prompt', metadata: { sourceImageId: 'different-metadata-source-id' } };
  const setter = key => value => { state[key] = typeof value === 'function' ? value(state[key]) : value; };
  const bindings = () => ({ ...context, ...auth, React, searchParams: new URLSearchParams(context.location.search),
    libraryContinuation: state.libraryContinuation, materialSlotFiles: state.slots, lightchainGenerationRunning: state.generating ?? false,
    useAuthStore: { getState: () => live }, useRef: value => refs[refIndex++] ?? (refs[refIndex - 1] = { current: value }),
    useLayoutEffect: setup => { layoutSetup = setup; },
    setLibraryContinuation: value => { state.libraryContinuation = value; transitions.push(value); },
    listWorkspaceArtifacts: () => missing ? [] : [artifact],
    readWorkspaceArtifactImage: async (...args) => { reads.push(args); await pending; return { imageUrl: emptyImage ? '' : 'data:image/png;base64,b3JpZ2luYWw=', localAssetRef: 'local-canvas-asset://original', storagePath: null }; },
    setMaterialSlotFiles: setter('slots'), setGarmentImageUrl: setter('url'), setGarmentFileName: setter('name'),
    setGarmentCategory: setter('kind'), setAnalysisStatus: setter('analysis'), setWorkspaceText: setter('text'),
    setReferenceNote: setter('note'), setResumeInputReadback: setter('status'), resetWorkbenchMaskState: () => {},
    navigate: href => calls.push(href), generateImage: forbidden, createProject: forbidden, saveCurrentProject: forbidden,
    buildWorkspaceProjectCards: () => [
      { id: 'new', title: 'New', isNew: true },
      { id: 'persisted / project', title: 'Existing', age: 'today', imageUrl: 'fixture' },
    ], workspaceArtifacts: [], resumeReadbackAttributes: {}, currentDisplayTitle: 'Print Design',
    UNIFIED_FEATURE_WORKFLOW_CONTRACT_VERSION: 'fixture', selectedFeatureWorkflow: null,
    workflowLifecycle: 'ready', workflowSourceInputMode: 'library', workflowRetryPolicy: 'fixture', workflowRightsGate: 'fixture',
    lightchainResult: null, renderLightchainProviderGate: () => null, MoreVertical: 'more-vertical',
    printProjectMenuId: null, setPrintProjectMenuId: () => {},
  });
  function render(patch = {}) {
    context = { ...context, ...patch }; refIndex = 0;
    live = { user: context.user, currentBrand: context.currentBrand, brandState: context.brandState,
      isInitialized: context.isAuthInitialized, isLoading: context.isAuthLoading };
    rendered = evaluate(`${renderSource}\nreturn { libraryRenderContextRef, libraryRenderRevision, libraryMountLifetimeRef };`, bindings());
  }
  function closure() {
    return evaluate(`${helpers}\nreturn { captureCurrentAuthBrandFence, assertCurrentAuthBrandFence, isPrintDesignLibraryContinuationValid,
      start: (${effect.arguments[0].getText(ast)}), home: () => ${home.thenStatement.getText(ast)} };`, { ...bindings(), ...rendered });
  }
  render(); layoutCleanup = layoutSetup();
  return { calls, reads, transitions, state, artifact,
    render, context: () => context, refs: () => rendered,
    live: patch => { live = { ...live, ...patch }; },
    start: () => closure().start(), valid: () => closure().isPrintDesignLibraryContinuationValid(),
    home: () => { const all = elements(closure().home()); return { all, control: all.find(e => e.props['data-testid'] === 'lightchain-print-design-library-continue') }; },
    unmount: () => layoutCleanup(), remount: () => { layoutCleanup(); layoutCleanup = layoutSetup(); },
    async settle(fail = false) { fail ? reject(new Error('read_failed')) : resolve(); for (let i = 0; i < 4; i++) await tick(); },
  };
}
async function restored(options) { const h = harness(options); h.start(); await h.settle(); assert.equal(h.state.status, 'restored'); return h; }
function suppressed(h) { assert.equal(h.valid(), false); assert.equal(h.home().control, undefined); assert.deepEqual(h.calls, []); }

test('production nullable provenance starts empty; loading hides continuation', () => {
  const declaration = variable('[libraryContinuation, setLibraryContinuation]');
  assert.ok(declaration);
  assert.equal(declaration.initializer.arguments[0].kind, ts.SyntaxKind.NullKeyword);
  const h = harness(); suppressed(h); h.start(); assert.deepEqual(h.transitions, [null]); suppressed(h); h.unmount();
});
test('actual Library effect binds artifact identity, nextItem object, context, lifetime and real auth fence', async () => {
  const h = await restored(); const p = h.state.libraryContinuation;
  assert.equal(p.libraryArtifactId, h.artifact.id);
  assert.equal(p.material, h.state.slots.primary);
  assert.equal(p.material.sourceImageId, 'different-metadata-source-id');
  assert.equal(p.contextKey, h.refs().libraryRenderContextRef.current.key);
  assert.equal(p.renderRevision, h.refs().libraryRenderRevision);
  assert.equal(p.mountLifetime, h.refs().libraryMountLifetimeRef.current.revision);
  assert.deepEqual(p.authBrandFence, auth.captureAuthBrandFence(h.context().brandState, 'alice', 'brand'));
  assert.deepEqual(h.transitions, [null, p]); assert.equal(h.valid(), true); h.unmount();
});
test('actual JSX renders independent button before home grid and click forwards query/hash bytes exactly', async () => {
  const h = await restored(); const { all, control } = h.home();
  assert.ok(control); assert.equal(control.type, 'button'); assert.equal(control.props.type, 'button');
  assert.equal(control.props.disabled, false); assert.equal(control.props.children, 'Libraryの元画像で続ける');
  const grid = all.find(e => e.props.className === 'mt-5 grid gap-4 sm:grid-cols-2 lg:grid-cols-3');
  assert.ok(all.indexOf(control) < all.indexOf(grid));
  control.props.onClick(); assert.deepEqual(h.calls, ['/editor/patternDesign/detail' + h.context().location.search + h.context().location.hash]);
  assert.equal(h.state.slots.primary.sourceImageId, 'different-metadata-source-id'); h.unmount();
});
const contextChanges = {
  pathname: c => ({ location: { ...c.location, pathname: '/printing' } }),
  search: c => ({ location: { ...c.location, search: c.location.search + '&changed=1' } }),
  hash: c => ({ location: { ...c.location, hash: '#changed' } }),
  owner: () => ({ user: { id: 'bob' } }), brand: () => ({ currentBrand: { id: 'other' } }),
  renderGeneration: c => ({ brandState: { ...c.brandState, requestGeneration: 2 } }),
  tool: () => ({ selectedTool: { id: 'print-design-detail' } }),
};
for (const [name, patch] of Object.entries(contextChanges)) {
  test(`${name}: completed provenance and stale JSX are invalid after render and ABA`, async () => {
    const h = await restored(); const button = h.home().control, before = h.context();
    h.render(patch(before)); suppressed(h); button.props.onClick(); assert.deepEqual(h.calls, []);
    h.render(before); suppressed(h); button.props.onClick(); assert.deepEqual(h.calls, []); h.unmount();
  });
  test(`${name}: stale held effect success/failure cannot commit or clear newer provenance`, async () => {
    for (const fail of [false, true]) {
      const h = harness(); h.start(); const before = h.context(); h.render(patch(before)); h.render(before);
      const newer = { sentinel: 'newer context' }; h.state.libraryContinuation = newer;
      await h.settle(fail); assert.equal(h.state.libraryContinuation, newer);
      assert.equal(h.state.slots.primary, null); assert.deepEqual(h.transitions, [null]); h.unmount();
    }
  });
}
for (const kind of ['unmount', 'remount']) test(`${kind}: same mount lifetime is required at render and click`, async () => {
  const h = await restored(); const button = h.home().control; h[kind](); suppressed(h);
  button.props.onClick(); assert.deepEqual(h.calls, []); h.unmount();
});
test('fresh StrictMode lifetime restoration creates valid provenance while old read stays silent', async () => {
  const h = harness(); h.start(); h.remount(); h.start(); await h.settle();
  assert.equal(h.reads.length, 2); assert.equal(h.transitions.length, 3); assert.equal(h.valid(), true);
  assert.equal(h.state.libraryContinuation.mountLifetime, h.refs().libraryMountLifetimeRef.current.revision); h.unmount();
});
for (const kind of ['failure', 'missing', 'emptyImage']) test(`${kind}: current read leaves continuation null and unavailable`, async () => {
  const h = harness({ missing: kind === 'missing', emptyImage: kind === 'emptyImage' }); h.start(); await h.settle(kind === 'failure');
  assert.equal(h.state.libraryContinuation, null); assert.equal(h.state.status, 'unavailable'); suppressed(h); h.unmount();
});
for (const search of ['?libraryArtifactId=original-id&resumeJob=job', '?libraryArtifactId=original-id&resumeJob=']) test(`resume presence ${search}: restore precedence unchanged but continuation suppressed`, async () => {
  const h = await restored({ search }); assert.equal(h.reads.length, 1); suppressed(h); h.unmount();
});
for (const search of ['', '?libraryArtifactId=', '?libraryArtifactId=other']) test(`invalid Library ID ${search}: continuation suppressed`, async () => {
  const h = await restored(); h.render({ location: { ...h.context().location, search } }); suppressed(h); h.unmount();
});
test('manual primary replacement or reset invalidates object identity; secondary-only replacement preserves it', async () => {
  const h = await restored(), original = h.state.slots.primary;
  h.state.slots = { primary: original, secondary: { imageUrl: 'secondary' } }; assert.equal(h.valid(), true);
  h.state.slots = { primary: original, secondary: null }; assert.equal(h.valid(), true);
  h.state.slots = { primary: { ...original }, secondary: null }; suppressed(h);
  h.state.slots = { primary: null, secondary: null }; suppressed(h); h.unmount();
});
test('generation running suppresses render and click; idle state permits continuation', async () => {
  const h = await restored(); h.state.generating = true; suppressed(h);
  h.state.generating = false; assert.ok(h.home().control); h.unmount();
});
for (const name of ['isAuthInitialized', 'isAuthLoading']) test(`${name}: render authentication flags suppress continuation`, async () => {
  const h = await restored(); h.render({ [name]: name === 'isAuthLoading' }); suppressed(h); h.unmount();
});
const freshChanges = {
  initialized: () => ({ isInitialized: false }), loading: () => ({ isLoading: true }),
  owner: () => ({ user: { id: 'bob' } }), brand: () => ({ currentBrand: { id: 'other' } }),
  generation: c => ({ brandState: { ...c.brandState, requestGeneration: 2 } }),
  authorization: c => ({ brandState: { ...c.brandState, confirmedBrandIds: [] } }),
  status: c => ({ brandState: { ...c.brandState, status: 'pending' } }),
};
for (const [name, patch] of Object.entries(freshChanges)) test(`fresh auth ${name} between render and click revalidates real fence`, async () => {
  const h = await restored(); const button = h.home().control; assert.ok(button);
  h.live(patch(h.context())); button.props.onClick(); suppressed(h); h.unmount();
});
test('helper directly rejects mismatched artifact/key/revision provenance without relying on render changes', async () => {
  const h = await restored(); const original = h.state.libraryContinuation;
  for (const patch of [{ libraryArtifactId: 'wrong' }, { contextKey: 'wrong' }, { renderRevision: original.renderRevision + 1 }]) {
    h.state.libraryContinuation = { ...original, ...patch }; suppressed(h);
  }
  h.unmount();
});
test('actual ordinary new, existing/reference project, menu and example navigation remain unchanged', async () => {
  const h = await restored(); const { all } = h.home();
  const newCard = all.find(e => e.type === 'div' && e.props.onClick && elements(e).some(c => c.props.children === '新規ファイル'));
  assert.ok(newCard); newCard.props.onClick(); assert.equal(h.calls.at(-1), '/editor/patternDesign/detail');
  const projectControls = all.filter(e => e.props['data-testid'] === 'lightchain-print-project-open');
  assert.equal(projectControls.length, 14);
  projectControls[0].props.onClick(); assert.equal(h.calls.at(-1), '/editor/patternDesign/detail?boardProjectCode=persisted%20%2F%20project&boardProjectType=custom');
  projectControls[1].props.onClick(); assert.equal(h.calls.at(-1), '/editor/patternDesign/detail?boardProjectCode=source-print-untitled-1&boardProjectType=custom');
  const examples = all.filter(e => e.type === 'div' && e.props.onClick && elements(e).some(c => ['ファッションアプリケーション', 'ホームテキスタイル用途'].includes(c.props.children)));
  assert.equal(examples.length, 2); for (const example of examples) { example.props.onClick(); assert.equal(h.calls.at(-1), '/editor/patternDesign/detail'); }
  h.unmount();
});
after(() => { globalThis.fetch = originalFetch; assert.equal(externalAttempts, 0, 'no external/provider/Canvas effects'); });
