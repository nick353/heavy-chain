import assert from 'node:assert/strict';
import test from 'node:test';
import { readFile } from 'node:fs/promises';
import ts from 'typescript';
import { encodeLibraryCanvasClipboard, readLibraryCanvasClipboard, copyLibraryCanvasReference, pasteLibraryCanvasReference } from '../src/lib/libraryCanvasClipboard.ts';

const scope = { origin: 'https://heavy-api.test', userId: 'user', brandId: 'brand' };
const source = { kind: 'artifact' as const, id: 'local-generated-ai-original-3' };
const encoded = encodeLibraryCanvasClipboard(scope, source);
const image = { userId: 'user', brandId: 'brand', url: 'generated-images/ai-original-3', label: 'Actual source',
  metadata: { feature: 'library-import', generation: 0, imageId: 'ai-original-3', jobId: 'ai-original', storagePath: 'generated-images/ai-original-3' } };
const deferred = () => { let resolve!: (value: unknown) => void; const promise = new Promise<unknown>(yes => { resolve = yes; }); return { promise, resolve }; };

test('clipboard contains a detached owner reference without media bytes, tokens or signed URLs', () => {
  assert.deepEqual(readLibraryCanvasClipboard(encoded, scope), { scope, source });
  assert.doesNotMatch(encoded, /data:|token=|media\/read|imageUrl|storagePath/);
  assert.equal(readLibraryCanvasClipboard('ordinary text', scope), null);
  assert.equal(readLibraryCanvasClipboard('https://other.test/image.png', scope), null);
  for (const target of [{ ...scope, userId: 'other' }, { ...scope, brandId: 'other' }, { ...scope, origin: 'https://other.test' }]) {
    assert.throws(() => readLibraryCanvasClipboard(encoded, target), /scope_mismatch/);
  }
  assert.throws(() => encodeLibraryCanvasClipboard(scope, { ...source, id: 'https://foreign.test/token?x=1' }), /source_invalid/);
  assert.throws(() => readLibraryCanvasClipboard('heavy-library-canvas:v1:{bad', scope));
});

test('paste retains exact identity and places once only after resolving and loading the same owner source', async () => {
  const calls: string[] = [];
  await pasteLibraryCanvasReference(encoded, scope, {
    assertCurrent: () => calls.push('guard'), resolve: async reference => { assert.deepEqual(reference, { scope, source }); calls.push('resolve'); return image; },
    loadImage: async url => { assert.equal(url, image.url); calls.push('load'); return { naturalWidth: 1024, naturalHeight: 1536 }; },
    place: (value, size) => { assert.deepEqual(value, image); assert.deepEqual(size, { width: 1024, height: 1536 }); calls.push('place'); },
  });
  assert.deepEqual(calls, ['guard', 'resolve', 'guard', 'load', 'guard', 'place']);
});

for (const stage of ['resolve', 'load'] as const) test(`a changed document during ${stage} cannot receive an image`, async () => {
  const gate = deferred(); let current = true, placed = 0;
  const task = pasteLibraryCanvasReference(encoded, scope, {
    assertCurrent: () => { if (!current) throw Error('document_changed'); },
    resolve: async () => { if (stage === 'resolve') await gate.promise; return image; },
    loadImage: async () => { if (stage === 'load') await gate.promise; return { width: 1024, height: 1024 }; }, place: () => { placed++; },
  });
  await new Promise(resolve => setImmediate(resolve)); current = false; gate.resolve(null);
  await assert.rejects(task, /document_changed/); assert.equal(placed, 0);
});

test('foreign records, failed image reads and invalid sizes never place or write anything', async () => {
  let loads = 0, placed = 0;
  const options = { assertCurrent: () => {}, resolve: async () => image,
    loadImage: async () => { loads++; return { width: 100, height: 100 }; }, place: () => { placed++; } };
  await assert.rejects(pasteLibraryCanvasReference(encoded, scope, { ...options, resolve: async () => ({ ...image, userId: 'other' }) }), /record_scope_mismatch/);
  assert.equal(loads, 0);
  await assert.rejects(pasteLibraryCanvasReference(encoded, scope, { ...options, loadImage: async () => { throw Error('unreadable'); } }), /unreadable/);
  await assert.rejects(pasteLibraryCanvasReference(encoded, scope, { ...options, loadImage: async () => ({ width: NaN, height: 100 }) }), /image_invalid/);
  assert.equal(placed, 0);
});

test('copy executes one clipboard write; changed context does not replay the write', async () => {
  const gate = deferred(); let current = true, writes = 0;
  const task = copyLibraryCanvasReference(scope, source, { assertCurrent: () => { if (!current) throw Error('changed'); },
    writeText: async text => { writes++; assert.equal(text, encoded); await gate.promise; } });
  current = false; gate.resolve(null); await assert.rejects(task, /changed/); assert.equal(writes, 1);
});

const librarySource = await readFile(new URL('../src/pages/LightchainLibraryPage.tsx', import.meta.url), 'utf8');
const canvasSource = await readFile(new URL('../src/pages/CanvasEditorPage.tsx', import.meta.url), 'utf8');
const parse = (name: string, code: string) => { const ast = ts.createSourceFile(name, code, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX); const nodes: ts.Node[] = [];
  const walk = (node: ts.Node) => { nodes.push(node); ts.forEachChild(node, walk); }; walk(ast); return { ast, nodes }; };
const lib = parse('library.tsx', librarySource), canvas = parse('canvas.tsx', canvasSource);
const copyNode = lib.nodes.find(node => ts.isVariableDeclaration(node) && node.name.getText(lib.ast) === 'handleCopyToBoard') as ts.VariableDeclaration;
const pasteEffect = canvas.nodes.find(node => ts.isCallExpression(node) && node.expression.getText(canvas.ast) === 'useEffect'
  && node.arguments[0]?.getText(canvas.ast).includes("window.addEventListener('paste', handlePaste)")) as ts.CallExpression;
const evaluate = (code: string, bindings: Record<string, unknown>) => new Function('bindings', `with(bindings){${ts.transpile(`return (${code});`, { target: ts.ScriptTarget.ES2022 })}}`)(new Proxy(bindings, {
  has: () => true, get: (object, key) => key === Symbol.unscopables ? undefined : key in object ? object[key as string] : (globalThis as unknown as Record<PropertyKey, unknown>)[key],
}));

for (const kind of ['local', 'remote']) test(`actual ${kind} Library board-copy callback writes a reference without navigation or persistence`, async () => {
  const writes: string[] = [], forbidden: string[] = [], auth = { user: { id: 'user' }, currentBrand: { id: 'brand' }, brandState: {} };
  const scopeKey = JSON.stringify(['brand', 'user']);
  const bindings = { currentBrand: auth.currentBrand, user: auth.user, libraryScope: scopeKey, boardScopeRef: { current: scopeKey }, boardCopyRef: { current: null },
    useAuthStore: { getState: () => auth }, captureAuthBrandFence: () => true, assertAuthBrandFence: () => {}, copyLibraryCanvasReference,
    cloudflareDataPlane: { origin: scope.origin }, window: { location: { origin: 'https://heavy.test' } },
    navigator: { clipboard: { writeText: async (text: string) => { writes.push(text); } } }, toast: { success: () => {}, error: () => {} },
    navigate: () => { forbidden.push('navigate'); }, handleImportRemote: () => { forbidden.push('remote import'); }, saveWorkspaceArtifactPersisted: () => { forbidden.push('save'); },
  };
  const callback = evaluate(copyNode.initializer!.getText(lib.ast), bindings);
  const card = kind === 'local' ? { kind, artifact: { id: source.id, brandId: 'brand', scopeId: 'user' } } : { kind, asset: { remoteImageId: 'ai-original-3' } };
  await callback(card); assert.equal(writes.length, 1); assert.deepEqual(readLibraryCanvasClipboard(writes[0], scope)?.source,
    kind === 'local' ? source : { kind: 'generated-image', id: 'ai-original-3' }); assert.deepEqual(forbidden, []);
});

test('actual Canvas paste listener keeps existing objects, adds the exact source and leaves text editing alone', async () => {
  let listener!: (event: unknown) => void; const added: unknown[] = [], original = [{ id: 'original-1', x: 464 }, { id: 'original-2', x: 464 }], store = [...original];
  const bindings = { heavyWorkspaceReady: true, user: { id: 'user' }, currentBrand: { id: 'brand' }, cloudflareDataPlane: { origin: scope.origin },
    window: { location: { origin: 'https://heavy.test' }, addEventListener: (_type: string, fn: (event: unknown) => void) => { listener = fn; }, removeEventListener: () => {} },
    isLibraryCanvasPasteTarget: (target: unknown) => target !== 'textarea', isLibraryCanvasClipboard: (text: string) => text.startsWith('heavy-library-canvas:v1:'), pasteLibraryCanvasReference,
    captureCanvasImageEditContext: () => () => {}, listWorkspaceArtifacts: () => [{ id: source.id, scopeId: 'user', brandId: 'brand', title: 'Actual source', imageUrl: '', metadata: { imageId: 'ai-original-3' }, sourceJobId: 'ai-original' }],
    getWorkspaceArtifactCanonicalStoragePath: () => image.url, loadLibraryCanvasImage: async () => ({ naturalWidth: 1024, naturalHeight: 1024 }),
    canvasSize: { width: 1000, height: 1000 }, addObject: (object: unknown) => { added.push(object); store.push({ id: 'new-paste', x: 280 }); return 'new-paste'; }, selectObject: () => {}, toast: { success: () => {}, error: () => {} },
  };
  const cleanup = evaluate(pasteEffect.arguments[0].getText(canvas.ast), bindings)();
  let prevented = 0;
  const event = { defaultPrevented: false, target: 'canvas', clipboardData: { getData: () => encoded }, preventDefault: () => { prevented++; } };
  listener({ ...event, target: 'textarea' }); await new Promise(resolve => setImmediate(resolve)); assert.equal(prevented, 0); assert.equal(added.length, 0);
  listener(event); await new Promise(resolve => setImmediate(resolve)); assert.equal(prevented, 1); assert.equal(added.length, 1); assert.deepEqual(store.slice(0, 2), original);
  const placed = added[0] as { src: string; metadata: { imageId: string; jobId: string; parameters: { sourceArtifactId: string } } };
  assert.equal(placed.src, image.url); assert.equal(placed.metadata.imageId, 'ai-original-3'); assert.equal(placed.metadata.jobId, 'ai-original'); assert.equal(placed.metadata.parameters.sourceArtifactId, source.id); cleanup();
});
