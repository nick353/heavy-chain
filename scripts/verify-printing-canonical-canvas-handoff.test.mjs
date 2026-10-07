import assert from 'node:assert/strict';
import test from 'node:test';
import fs from 'node:fs/promises';
import ts from 'typescript';

// Execute the production component, actual auth fence and actual canonical path
// validator. Router navigation is observed; provider/global Canvas calls fail.
const source = await fs.readFile(new URL('../src/pages/LightchainParityPages.tsx', import.meta.url), 'utf8');
const ast = ts.createSourceFile('page.tsx', source, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
const component = ast.statements.find(n => ts.isFunctionDeclaration(n) && n.name?.text === 'LightchainPrintingWorkspace');
assert.ok(component);
const evaluate = (expression, bindings) => new Function('bindings', `with(bindings){${ts.transpile(`return (${expression});`, {target: ts.ScriptTarget.ES2022, jsx: ts.JsxEmit.React})}}`)(new Proxy(bindings, {
  has: () => true, get: (object, key) => key === Symbol.unscopables ? undefined : key in object ? object[key] : globalThis[key],
}));
const authSource = await fs.readFile(new URL('../src/lib/authBrandSelection.ts', import.meta.url), 'utf8');
const authExports = {};
new Function('exports', ts.transpile(authSource, {target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS}))(authExports);
const storageSource = await fs.readFile(new URL('../src/lib/storagePathSafety.ts', import.meta.url), 'utf8');
const storageExports = {};
new Function('exports', ts.transpile(storageSource, {target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS}))(storageExports);
const imageId = 'bcba6450-94ac-4bd5-aaf1-precise-image-001';
const savedResult = () => ({imageId, storagePath: `generated-images/${imageId}`, jobId: 'saved-print-job', imageUrl: 'blob:retained-output'});
const savedRow = () => ({id: imageId, storage_path: `generated-images/${imageId}`, job_id: 'saved-print-job', brand_id: 'brand', user_id: 'alice'});
const deferred = () => {let resolve, reject; const promise = new Promise((a, b) => {resolve = a; reject = b;}); return {promise, resolve, reject};};
const settle = async () => {await new Promise(resolve => setImmediate(resolve)); await new Promise(resolve => setImmediate(resolve));};
const findButton = tree => {
  if (!tree || typeof tree !== 'object') return null;
  if (tree.type === 'button' && tree.props.children.includes('Canvasで再編集')) return tree;
  for (const child of tree.props?.children?.flat(Infinity) ?? []) {const found = findButton(child); if (found) return found;}
  return null;
};
function fixture({pathname = '/tools/printing', rows, list} = {}) {
  const calls = {lists: [], navigation: [], forbidden: []}, states = [], refs = [], effects = [];
  let stateIndex, refIndex, effectIndex;
  const forbid = name => () => {calls.forbidden.push(name); throw Error(`forbidden ${name}`);};
  const workspace = {toolId: 'printing-image', jobId: 'saved-print-job', pendingId: null, status: 'unavailable',
    slots: {primary: null, secondary: null}, result: savedResult(), originalInputsAvailable: false, inputsAvailable: false,
    brief: 'retained original brief', inputState: {coverage: 'spot'}, generate: forbid('generation'), upload: forbid('upload'),
    clearSource: forbid('clear'), setInputState: forbid('input rewrite')};
  const auth = {user: {id: 'alice'}, currentBrand: {id: 'brand'}, brandState: {status: 'success_nonempty', userId: 'alice', requestGeneration: 3, confirmedBrandIds: ['brand'], error: null}};
  const useAuthStore = () => auth; useAuthStore.getState = () => auth;
  const b = {
    React: {createElement: (type, props, ...children) => ({type, props: {...props, children}})},
    useCanonicalImageWorkspace: () => workspace, useAuthStore, useNavigate: () => value => calls.navigation.push(value),
    useLocation: () => ({search: '?resumeJob=saved-print-job', pathname}), window: {location: {pathname, origin: 'https://fixture.test'}},
    useState: initial => {const i = stateIndex++; if (!(i in states)) states[i] = initial; return [states[i], value => {states[i] = value;}];},
    useRef: initial => {const i = refIndex++; return refs[i] ??= {current: initial};},
    useMemo: fn => fn(), useEffect: fn => {effects[effectIndex++] = fn;},
    cloudflareDataPlane: {origin: 'https://fixture.test', listGeneratedImages: async (...args) => {calls.lists.push(args); return list ? list(...args) : rows ?? [savedRow()];}},
    ...authExports, ...storageExports, persistPrintInputState: forbid('draft save'), restorePrintInputState: forbid('draft restore'),
    saveCanvas: forbid('global Canvas write'), fetch: forbid('media fetch'),
  };
  const renderComponent = evaluate(component.getText(ast), b);
  let button;
  const render = () => {stateIndex = refIndex = effectIndex = 0; button = findButton(renderComponent()); return button;};
  const click = () => {assert.ok(button, 'saved result button exists'); button.props.onClick();};
  render();
  // Production restore/persistence effects exit for the retained saved job.
  const cleanups = effects.map(effect => effect()).filter(value => typeof value === 'function');
  return {workspace, auth, b, calls, states, render, click, unmount: () => cleanups.forEach(fn => fn()),
    get button() {return button;}, safe: () => assert.deepEqual(calls.forbidden, [])};
}

for (const pathname of ['/tools/printing', '/printing']) test(`retained output with unavailable inputs navigates through exact importer (${pathname})`, async () => {
  const f = fixture({pathname}), result = f.workspace.result, input = f.workspace.inputState;
  assert.equal(f.button.props.disabled, false); f.click(); await settle();
  assert.deepEqual(f.calls.lists, [['brand', {limit: 100, order: 'newest'}]]);
  assert.deepEqual(f.calls.navigation, [`/canvas/new?galleryImageId=${encodeURIComponent(imageId)}`]);
  assert.equal(f.workspace.result, result); assert.equal(f.workspace.inputState, input);
  assert.equal(f.workspace.originalInputsAvailable, false); assert.equal(f.workspace.inputsAvailable, false);
  assert.equal(f.workspace.brief, 'retained original brief'); f.safe();
});
for (const status of ['loading', 'running', 'unknown']) test(`${status} disables handoff and dispatches no list or navigation`, async () => {
  const f = fixture(); f.workspace.status = status; f.render(); assert.equal(f.button.props.disabled, true);
  f.click(); await settle(); assert.deepEqual(f.calls.lists, []); assert.deepEqual(f.calls.navigation, []); f.safe();
});
test('pending operation disables saved output handoff', async () => {
  const f = fixture(); f.workspace.pendingId = 'original-unknown-request'; f.render(); assert.equal(f.button.props.disabled, true);
  f.click(); await settle(); assert.deepEqual(f.calls.lists, []); assert.deepEqual(f.calls.navigation, []); f.safe();
});
test('no output exposes no Canvas handoff', () => {const f = fixture(); f.workspace.result = null; assert.equal(f.render(), null); f.safe();});
for (const mutate of [r => {r.imageId = null;}, r => {r.jobId = null;}, r => {r.storagePath = null;}, r => {r.storagePath = 'generated-images/other';}, r => {r.imageId = 'bad?id'; r.storagePath = 'generated-images/bad?id';}]) test('missing or noncanonical output identity stops without fallback', async () => {
  const f = fixture(); mutate(f.workspace.result); f.render(); assert.equal(f.button.props.disabled, true); f.click(); await settle();
  assert.deepEqual(f.calls.lists, []); assert.deepEqual(f.calls.navigation, []); f.safe();
});
for (const [name, mutate] of [
  ['auth user', f => {f.auth.user = {id: 'bob'};}],
  ['brand', f => {f.auth.currentBrand = {id: 'foreign'};}],
  ['auth generation', f => {f.auth.brandState = {...f.auth.brandState, requestGeneration: 4};}],
  ['result replacement', f => {f.workspace.result = {...savedResult()};}],
  ['workspace job', f => {f.workspace.jobId = 'different-context-job';}],
  ['workspace feature', f => {f.workspace.toolId = 'model-library';}],
  ['route', f => {f.b.useLocation = () => ({pathname: '/tools/printing', search: '?resumeJob=other'});}],
  ['image in-place', f => {f.workspace.result.imageId = 'other';}],
  ['path in-place', f => {f.workspace.result.storagePath = 'generated-images/other';}],
  ['job in-place', f => {f.workspace.result.jobId = 'other';}],
  ['pending', f => {f.workspace.pendingId = 'new-operation';}],
  ['unknown', f => {f.workspace.status = 'unknown';}],
  ['loading', f => {f.workspace.status = 'loading';}],
  ['running', f => {f.workspace.status = 'running';}],
]) test(`late list completion rejects changed ${name}`, async () => {
  const gate = deferred(), f = fixture({list: () => gate.promise}); f.click(); mutate(f); f.render(); gate.resolve([savedRow()]); await settle();
  assert.equal(f.calls.lists.length, 1); assert.deepEqual(f.calls.navigation, []); f.safe();
});
test('changed auth without another render is rejected by fresh auth fence', async () => {
  const gate = deferred(), f = fixture({list: () => gate.promise}); f.click(); f.auth.user = {id: 'bob'}; gate.resolve([savedRow()]); await settle();
  assert.deepEqual(f.calls.navigation, []); f.safe();
});
test('unmounted original context cannot hand off a late result', async () => {
  const gate = deferred(), f = fixture({list: () => gate.promise}); f.click(); f.unmount(); gate.resolve([savedRow()]); await settle();
  assert.deepEqual(f.calls.navigation, []); f.safe();
});
test('synchronous double activation and in-flight rerender cause only one validation/navigation', async () => {
  const gate = deferred(), f = fixture({list: () => gate.promise}); f.click(); f.click(); f.render(); assert.equal(f.button.props.disabled, true); f.click();
  assert.equal(f.calls.lists.length, 1); gate.resolve([savedRow()]); await settle(); f.render(); f.click();
  assert.deepEqual(f.calls.navigation, [`/canvas/new?galleryImageId=${encodeURIComponent(imageId)}`]); assert.equal(f.calls.lists.length, 1); f.safe();
});
for (const [name, rows] of [
  ['absent', []], ['prefix card', [{...savedRow(), id: imageId.slice(0, 8)}]], ['duplicate', [savedRow(), savedRow()]],
  ['job', [{...savedRow(), job_id: 'foreign-job'}]], ['path', [{...savedRow(), storage_path: 'generated-images/other'}]],
  ['missing path', [{...savedRow(), storage_path: null, image_url: 'https://old-url.test/image'}]],
  ['brand', [{...savedRow(), brand_id: 'foreign-brand'}]], ['user', [{...savedRow(), user_id: 'foreign-user'}]],
]) test(`saved list ${name} mismatch stops with no alternate source/card`, async () => {
  const f = fixture({rows}); f.click(); await settle(); assert.equal(f.calls.lists.length, 1); assert.deepEqual(f.calls.navigation, []); f.safe();
});
test('failed list is visible, preserves output/inputs and never generates', async () => {
  const f = fixture({list: async () => {throw Error('offline');}}), result = f.workspace.result; f.click(); await settle();
  assert.deepEqual(f.calls.navigation, []); assert.equal(f.workspace.result, result); assert.equal(f.workspace.originalInputsAvailable, false);
  assert.ok(f.states.some(s => typeof s === 'string' && s.includes('Canvasには移動していません'))); f.safe();
});
test('unconfirmed auth cannot read the saved-image list', async () => {
  const f = fixture(); f.auth.brandState = {...f.auth.brandState, status: 'pending'}; f.click(); await settle();
  assert.deepEqual(f.calls.lists, []); assert.deepEqual(f.calls.navigation, []); f.safe();
});

for (const field of ['user', 'currentBrand']) test(`missing ${field} disables handoff before list`, async () => {
  const f = fixture(); f.auth[field] = null; f.render(); assert.equal(f.button.props.disabled, true); f.click(); await settle();
  assert.deepEqual(f.calls.lists, []); assert.deepEqual(f.calls.navigation, []); f.safe();
});
