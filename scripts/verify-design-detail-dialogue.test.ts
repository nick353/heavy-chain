import test from 'node:test';
import assert from 'node:assert/strict';
import { chromium, type Browser, type Page } from '@playwright/test';
import { createServer } from 'vite';

// This fixture mounts the real page in StrictMode with real browser IndexedDB,
// real L1/L2 stores and runner, and real scoped Canvas/CAS/controller adapters.
const source = String.raw`
import React from 'react';
import { createRoot } from 'react-dom/client';
import { MemoryRouter } from 'react-router-dom';
import DesignEntryDetailPage from '/src/features/designDetail/DesignEntryDetailPage.tsx';
import { useAuthStore } from '/src/stores/authStore.ts';
import { createDesignEntryCoordinator, DESIGN_ENTRY_DRAFT_DB } from '/src/features/designDetail/designEntryCoordinator.ts';
import { createEntryDraftStore } from '/src/features/designDetail/entryDraftStore.ts';
import { useCanvasStore } from '/src/stores/canvasStore.ts';
const key = 'design-detail-fixture-server';
const blank = () => ({ documents: {}, assistant: {}, images: {}, inputs: [], generations: [], posts: 0, reads: 0, patches: 0, acks: 0, events: [], assistantMode: 'completed', imageMode: 'complete', patchMode: 'normal' });
const load = () => JSON.parse(sessionStorage.getItem(key) || 'null') || blank();
const save = state => { sessionStorage.setItem(key, JSON.stringify(state)); window.__server = state; };
save(load());
const scope = { userId: 'owner', brandId: 'brand' };
useAuthStore.setState({ user: { id: scope.userId }, currentBrand: { id: scope.brandId, name: 'Heavy Chain Workspace' }, isLoading: false });
const svg = 'data:image/svg+xml,' + encodeURIComponent('<svg xmlns="http://www.w3.org/2000/svg" width="640" height="960"><rect width="640" height="960" fill="#a8cc55"/></svg>');
const assertContext = context => context?.assertContext();
let held;
window.__releaseAssistant = () => { held?.(); held = null; };
const receipt = input => ({ requestId: input.requestId, state: load().assistantMode, content: load().assistantMode === 'completed' ? '実際の応答: ' + input.prompt : undefined, provider: 'workers-ai', model: '@cf/meta/llama-4-scout-17b-16e-instruct', usage: { total_tokens: 12 } });
const client = {
  async createDocument(input, context) { assertContext(context); const state = load(); state.documents[input.documentId] = { id: input.documentId, ownerId: scope.userId, brandId: scope.brandId, title: input.title, snapshot: input.snapshot, snapshotVersion: 1, revision: 0, createdAt: '', updatedAt: '' }; save(state); return structuredClone(state.documents[input.documentId]); },
  async getDocument(id, brand, context) { assertContext(context); const state = load(); state.events.push('GET:' + id); if (state.failNextDocumentRead) { state.failNextDocumentRead = false; save(state); throw new Error('temporary_document_read_failed'); } save(state); const document = state.documents[id]; if (!document || brand !== document.brandId) throw new Error('not_found'); return structuredClone(document); },
  async updateDocument(input, context) {
    assertContext(context); const state = load(); state.patches++; state.events.push('CAS:' + input.expectedRevision);
    const document = state.documents[input.documentId];
    if (state.patchMode === 'conflict') { document.revision++; document.snapshot.objects.push({ id: 'foreign-' + document.revision, type: 'text', text: '他の編集を保持' }); save(state); throw new Error('revision_conflict'); }
    if (input.expectedRevision !== document.revision) throw new Error('revision_conflict');
    document.snapshot = structuredClone(input.snapshot); document.revision++;
    if (state.patchMode === 'partial') document.snapshot.objects.at(-1).metadata.jobId = 'incorrect-job';
    save(state); if (state.patchMode === 'lost') throw new Error('lost_patch'); return structuredClone(document);
  },
  async measureImage() { return { width: 640, height: 960 }; },
  async resolveImage() { return { ok: true, url: svg }; },
  async sendAssistant(input, context) {
    assertContext(context); const state = load(); state.posts++; state.inputs.push(structuredClone(input)); state.assistant[input.requestId] = receipt(input); save(state);
    if (window.__holdAssistant) { await new Promise(resolve => { held = resolve; }); assertContext(context); }
    return structuredClone(load().assistant[input.requestId]);
  },
  async readAssistant(input, context) { assertContext(context); const state = load(); state.reads++; save(state); if (!state.assistant[input.requestId]) throw new Error('request_not_found'); return structuredClone(state.assistant[input.requestId]); },
  async generate(input) {
    input.assertContext(); const state = load(); state.generations.push({ ...input, assertContext: undefined });
    const imageId = 'img-' + input.idempotencyKey; const jobId = 'job-' + input.idempotencyKey; const path = 'generated-images/' + imageId;
    const image = { id: imageId, imageId, storagePath: path, jobId, candidateIndex: 0, persistenceStatus: 'completed', imageUrl: svg };
    const output = state.imageMode === 'failed' ? { requestId: input.idempotencyKey, success: false, state: 'failed', status: 'failed' }
      : { requestId: input.idempotencyKey, success: true, state: 'completed', status: 'completed', persistenceStatus: 'completed', requestedCandidateCount: state.imageMode === 'partial' ? 2 : 1,
          persistedCandidateCount: 1, imageId, storagePath: path, imageUrl: svg, jobId, images: [image], clientRecoveryKey: 'recover:' + input.idempotencyKey };
    state.images[input.idempotencyKey] = output; save(state); return structuredClone(output);
  },
  async readImage(requestId) { const state = load(); state.events.push('IMAGE-GET:' + requestId); if (!state.images[requestId] && state.failReadAfterMissingImage) state.failNextDocumentRead = true; save(state); if (!state.images[requestId]) throw new Error('cloudflare_api_404_image_request_not_found'); return structuredClone(state.images[requestId]); },
  async acknowledgeImage(input) { const state = load(); const doc = state.documents[sessionStorage.getItem('project')]; const output = state.images[input.requestId];
    if (!doc.snapshot.objects.some(object => object.metadata?.imageId === output.imageId && object.metadata?.storagePath === output.storagePath && object.metadata?.jobId === output.jobId)) throw new Error('ack_before_verified_adoption');
    state.acks++; state.events.push('ACK:' + input.requestId); save(state); },
};
window.__setModes = values => { const state = load(); Object.assign(state, values); save(state); };
window.__switchBrand = () => useAuthStore.setState({ currentBrand: { id: 'other', name: 'Other' } });
window.__switchUser = () => useAuthStore.setState({ user: { id: 'other-user' } });
window.__completeAssistant = () => { const state = load(); for (const input of state.inputs) state.assistant[input.requestId] = { ...state.assistant[input.requestId], state: 'completed', content: '実際の応答: ' + input.prompt }; save(state); };
window.__reserveAgain = async () => {
  const draft = await createEntryDraftStore({ idb: indexedDB, dbName: DESIGN_ENTRY_DRAFT_DB }).reserve(scope, '最初のデザイン', window.__references);
  return { projectId: draft.projectId, conversationId: draft.conversationId, consumed: draft.consumed };
};
window.__concurrentInitial = async () => {
  const { createDesignDialogueController } = await import('/src/features/designDetail/designDialogueController.ts');
  const { createDialogueStore } = await import('/src/features/designDetail/dialogueStore.ts');
  const { createSessionStore } = await import('/src/features/designDetail/sessionStore.ts');
  const { DESIGN_ENTRY_SESSION_DB } = await import('/src/features/designDetail/designEntryCoordinator.ts');
  const drafts = createEntryDraftStore({ idb: indexedDB, dbName: DESIGN_ENTRY_DRAFT_DB });
  const projectId = sessionStorage.getItem('project'); const conversationId = sessionStorage.getItem('conversation');
  const draft = await drafts.get(scope, projectId, conversationId);
  const make = () => createDesignDialogueController({ scope, projectId, conversationId, drafts, dialogues: createDialogueStore({ idb: indexedDB }), sessions: createSessionStore({ idb: indexedDB, dbName: DESIGN_ENTRY_SESSION_DB }), client, assertContext: () => { if (useAuthStore.getState().currentBrand.id !== scope.brandId) throw new Error('stale'); }, publish() {} });
  await Promise.all([make().initialize(draft), make().initialize(draft)]);
};
const count = Number(new URL(location.href).searchParams.get('refs') || 16);
window.__references = Array.from({ length: count }, (_, order) => ({ order, kind: 'upload', imageId: 'ref-' + order, storagePath: 'generated-images/ref-' + order, name: '参考画像' + order }));
if (new URL(location.href).searchParams.get('running')) window.__setModes({ assistantMode: 'running' });
if (!sessionStorage.getItem('project')) {
  const coordinator = createDesignEntryCoordinator({ scope, client, assertScope() {} });
  const href = await coordinator.prepare('最初のデザイン', window.__references);
  const params = new URLSearchParams(href.split('?')[1]); sessionStorage.setItem('project', params.get('projectId')); sessionStorage.setItem('conversation', params.get('conversationId'));
}
const seedMode = new URL(location.href).searchParams.get('seed');
let seededNow = false;
if (seedMode && !sessionStorage.getItem('recovery-seeded')) {
  const { createDialogueStore } = await import('/src/features/designDetail/dialogueStore.ts');
  const { createSessionStore } = await import('/src/features/designDetail/sessionStore.ts');
  const { DESIGN_ENTRY_SESSION_DB } = await import('/src/features/designDetail/designEntryCoordinator.ts');
  const drafts = createEntryDraftStore({ idb: indexedDB, dbName: DESIGN_ENTRY_DRAFT_DB });
  const dialogues = createDialogueStore({ idb: indexedDB }); const sessions = createSessionStore({ idb: indexedDB, dbName: DESIGN_ENTRY_SESSION_DB });
  const projectId = sessionStorage.getItem('project'); const conversationId = sessionStorage.getItem('conversation');
  const first = (await dialogues.admit(scope, { brandId: scope.brandId, projectId, conversationId, prompt: '最初のデザイン', references: window.__references, history: [] }, true)).attempt;
  sessionStorage.setItem('seed-request', first.input.requestId); sessionStorage.setItem('seed-image-key', first.imageClientRequestKey);
  if (seedMode !== 'pre-send') {
    await drafts.consume(scope, projectId, conversationId, first.input.requestId);
    if (seedMode === 'consumed-unknown') {
      await dialogues.receipt(scope, first.input, { ...first.assistant, state: 'unknown' });
      const state = load(); state.assistant[first.input.requestId] = { ...first.assistant, state: 'unknown' }; save(state);
    } else {
      const firstReceipt = receipt(first.input); await dialogues.receipt(scope, first.input, firstReceipt);
      await dialogues.image(scope, first.input);
      const firstTurn = (await sessions.admitTurn(scope, { conversationId, clientRequestKey: first.imageClientRequestKey, prompt: first.input.prompt, references: first.input.references })).turn;
      const later = (await dialogues.admit(scope, { brandId: scope.brandId, projectId, conversationId, prompt: '後続の保存済みデザイン', references: [], history: [] }, false)).attempt;
      await dialogues.receipt(scope, later.input, receipt(later.input)); await dialogues.image(scope, later.input);
      const laterTurn = (await sessions.admitTurn(scope, { conversationId, clientRequestKey: later.imageClientRequestKey, prompt: later.input.prompt, references: later.input.references })).turn;
      const imageId = 'img-' + laterTurn.requestId; const jobId = 'job-' + laterTurn.requestId; const storagePath = 'generated-images/' + imageId;
      await sessions.updateTurn(scope, laterTurn.turnId, { status: 'succeeded', jobId, outputs: [{ imageId, storagePath, jobId, candidateIndex: 0 }] });
      const state = load(); state.assistant[first.input.requestId] = firstReceipt; state.assistant[later.input.requestId] = receipt(later.input);
      state.images[laterTurn.requestId] = { requestId: laterTurn.requestId, state: 'completed', status: 'completed', success: true, persistenceStatus: 'completed', requestedCandidateCount: 1, persistedCandidateCount: 1,
        imageId, storagePath, imageUrl: svg, jobId, images: [{ id: imageId, imageId, storagePath, imageUrl: svg, jobId, candidateIndex: 0, persistenceStatus: 'completed' }] };
      state.failReadAfterMissingImage = true; state.seedMissingRequest = firstTurn.requestId; save(state);
    }
  }
  sessionStorage.setItem('recovery-seeded', 'yes'); seededNow = true;
}
window.__recoveryDiagnostics = async () => {
  const { createDialogueStore } = await import('/src/features/designDetail/dialogueStore.ts');
  const drafts = createEntryDraftStore({ idb: indexedDB, dbName: DESIGN_ENTRY_DRAFT_DB });
  const projectId = sessionStorage.getItem('project'); const conversationId = sessionStorage.getItem('conversation');
  return { draft: await drafts.get(scope, projectId, conversationId), attempts: await createDialogueStore({ idb: indexedDB }).list(scope, projectId, conversationId) };
};
const baseline = useCanvasStore.getState();
window.__globalCanvasBefore = JSON.stringify({ objects: baseline.objects, currentProjectId: baseline.currentProjectId });
const target = '/designProduction/detail?' + new URLSearchParams({ projectId: sessionStorage.getItem('project'), conversationId: sessionStorage.getItem('conversation') });
const root = createRoot(document.getElementById('fixture-root'));
const mount = (next = target) => root.render(React.createElement(React.StrictMode, null, React.createElement(MemoryRouter, { key: next, initialEntries: [next] }, React.createElement(DesignEntryDetailPage, { client, dialogueClient: client }))));
window.__unmount = () => root.render(null);
window.__mount = mount;
window.__globalCanvasNow = () => { const value = useCanvasStore.getState(); return JSON.stringify({ objects: value.objects, currentProjectId: value.currentProjectId }); };
if (!seededNow) mount(); window.__ready = true;
`;

type Fixture = { browser: Browser; page: Page; close(): Promise<void> };
async function fixture(query = ''): Promise<Fixture> {
  const vite = await createServer({ configFile: new URL('../vite.config.ts', import.meta.url).pathname,
    server: { host: '127.0.0.1', port: 0 }, optimizeDeps: { include: ['react', 'react-dom/client'] }, logLevel: 'silent',
    plugins: [{ name: 'design-detail-fixture', resolveId(id) { return id === '/__design-detail-fixture__.tsx' ? '\0design-detail-fixture.tsx' : undefined; },
      load(id) { return id === '\0design-detail-fixture.tsx' ? source : undefined; } }] });
  let browser: Browser | undefined;
  try {
    await vite.listen(); const address = vite.httpServer!.address(); assert.ok(address && typeof address === 'object');
    const origin = `http://127.0.0.1:${address.port}`;
    browser = await chromium.launch({ headless: true }); const context = await browser.newContext({ viewport: { width: 1440, height: 900 } }); const page = await context.newPage();
    await page.route('**/*', route => { const url = new URL(route.request().url());
      if (url.origin === origin && url.pathname === '/__design-detail-test__') return route.fulfill({ contentType: 'text/html', body: `<!doctype html><html><head><link rel="stylesheet" href="/src/index.css"></head><body><div id="fixture-root"></div><script type="module">import RefreshRuntime from '/@react-refresh';RefreshRuntime.injectIntoGlobalHook(window);window.$RefreshReg$=()=>{};window.$RefreshSig$=()=>type=>type;window.__vite_plugin_react_preamble_installed__=true;await import('/__design-detail-fixture__.tsx');</script></body></html>` });
      return url.origin === origin || url.protocol === 'data:' ? route.continue() : route.abort(); });
    await page.goto(origin + '/__design-detail-test__' + query);
    await page.waitForFunction(() => (window as any).__ready);
    return { browser, page, close: async () => { await browser?.close(); await vite.close(); } };
  } catch (error) { await browser?.close(); await vite.close(); throw error; }
}
const server = (page: Page) => page.evaluate(() => (window as any).__server);
const complete = (page: Page) => page.waitForFunction(() => (window as any).__server.acks === 1);
const mode = (page: Page, values: Record<string, unknown>) => page.evaluate(values => (window as any).__setModes(values), values);
async function send(page: Page, prompt: string) { await page.getByTestId('design-followup-prompt').fill(prompt); await page.getByTestId('design-followup-send').click(); }

test('StrictMode initial entry sends once, renders actual response and all 16 ordered refs, verifies CAS before ack', async () => {
  const f = await fixture(); try {
    await complete(f.page); const state = await server(f.page);
    assert.equal(state.posts, 1); assert.equal(state.generations.length, 1); assert.equal(state.patches, 1);
    assert.match(await f.page.getByTestId('design-assistant-message').innerText(), /実際の応答: 最初のデザイン/);
    assert.equal(await f.page.getByTestId('design-entry-reference').count(), 16);
    assert.deepEqual(state.inputs[0].references.map((ref: any) => ref.order), Array.from({ length: 16 }, (_, i) => i));
    assert.deepEqual(state.generations[0].references, state.inputs[0].references);
    assert.equal(state.generations[0].prompt, '最初のデザイン'); assert.equal(state.generations[0].retainUntilAcknowledged, true);
    assert.match(state.inputs[0].requestId, /^[\da-f-]{36}$/); assert.notEqual(state.generations[0].idempotencyKey, state.inputs[0].requestId);
    const ackIndex = state.events.findIndex((event: string) => event.startsWith('ACK:'));
    assert.ok(state.events[ackIndex - 1].startsWith('GET:'));
    const doc = Object.values(state.documents)[0] as any;
    assert.equal(doc.snapshot.objects[0].width / doc.snapshot.objects[0].height, 2 / 3);
    assert.equal(await f.page.getByTestId('design-full-editor').getAttribute('href'), '/canvas/' + doc.id);
    assert.equal(await f.page.evaluate(() => (window as any).__globalCanvasNow()), await f.page.evaluate(() => (window as any).__globalCanvasBefore));
  } finally { await f.close(); }
});

test('reload and concurrent initial consumers do no additional assistant POST or image generation', async () => {
  const f = await fixture(); try {
    await complete(f.page); await f.page.evaluate(() => (window as any).__concurrentInitial());
    const readsBeforeReload = (await server(f.page)).reads;
    await f.page.reload(); await f.page.getByTestId('design-assistant-message').waitFor();
    await f.page.waitForFunction((prior) => (window as any).__server.reads > prior, readsBeforeReload);
    const state = await server(f.page); assert.equal(state.posts, 1); assert.equal(state.generations.length, 1); assert.equal(state.acks, 1); assert.ok(state.reads > readsBeforeReload);
    assert.equal(await f.page.getByTestId('design-canvas-layer').count(), 1);
  } finally { await f.close(); }
});

test('consumption releases identical entry to fresh project/conversation IDs', async () => {
  const f = await fixture(); try {
    await complete(f.page); const prior = Object.keys((await server(f.page)).documents)[0];
    const next = await f.page.evaluate(() => (window as any).__reserveAgain());
    assert.notEqual(next.projectId, prior); assert.notEqual(next.conversationId, await f.page.evaluate(() => sessionStorage.getItem('conversation'))); assert.equal(next.consumed, false);
  } finally { await f.close(); }
});

test('selected output followup uses canonical verified image IDs, retains previous result, editable prompt and duplicate click sends once', async () => {
  const f = await fixture(); try {
    await complete(f.page); await f.page.getByTestId('design-layer-select').click();
    await f.page.getByTestId('design-followup-prompt').fill('色を青に変更');
    await f.page.getByTestId('design-followup-send').evaluate((button: HTMLButtonElement) => { button.click(); button.click(); });
    await f.page.waitForFunction(() => (window as any).__server.acks === 2);
    const state = await server(f.page); assert.equal(state.posts, 2); assert.equal(state.generations.length, 2);
    assert.equal(state.inputs[1].prompt, '色を青に変更'); assert.equal(state.inputs[1].references.length, 1);
    const first = state.generations[0].idempotencyKey;
    assert.equal(state.inputs[1].references[0].imageId, 'img-' + first); assert.equal(state.inputs[1].references[0].storagePath, 'generated-images/img-' + first);
    assert.ok(state.inputs[1].history.some((message: any) => message.role === 'assistant' && message.content === '実際の応答: 最初のデザイン'));
    assert.equal(await f.page.getByTestId('design-canvas-layer').count(), 2);
    const zoom = await f.page.getByTestId('design-zoom').innerText(); await f.page.getByRole('button', { name: '拡大', exact: true }).click(); assert.notEqual(await f.page.getByTestId('design-zoom').innerText(), zoom);
  } finally { await f.close(); }
});

test('CAS conflict retains prior and generated outputs; explicit same-output reconciliation preserves concurrent edits before ack', async () => {
  const f = await fixture(); try {
    await complete(f.page); const before = await server(f.page); const docId = Object.keys(before.documents)[0];
    await mode(f.page, { patchMode: 'conflict' }); await send(f.page, '別のデザイン');
    await f.page.getByTestId('design-attempt-reconcile').waitFor(); const blocked = await server(f.page);
    assert.equal(blocked.acks, 1); assert.equal(blocked.generations.length, 2); assert.deepEqual(blocked.documents[docId].snapshot.objects[0], before.documents[docId].snapshot.objects[0]);
    assert.equal(await f.page.getByTestId('design-canvas-layer').count(), 1);
    await mode(f.page, { patchMode: 'normal' }); await f.page.getByTestId('design-attempt-reconcile').click();
    await f.page.waitForFunction(() => (window as any).__server.acks === 2);
    const reconciled = await server(f.page); assert.equal(reconciled.generations.length, 2); assert.equal(reconciled.posts, 2);
    assert.ok(reconciled.documents[docId].snapshot.objects.some((object: any) => object.text === '他の編集を保持'));
    assert.equal(await f.page.getByTestId('design-canvas-layer').count(), 2);
  } finally { await f.close(); }
});

test('partial image receipt and incorrect Canvas metadata never ack, never replace previous result', async () => {
  const f = await fixture(); try {
    await complete(f.page); const before = await server(f.page); const docId = Object.keys(before.documents)[0];
    await mode(f.page, { imageMode: 'partial' }); await send(f.page, '複数の候補'); await f.page.getByTestId('design-attempt-reconcile').waitFor();
    let state = await server(f.page); assert.equal(state.acks, 1); assert.equal(state.patches, 1); assert.deepEqual(state.documents[docId].snapshot.objects, before.documents[docId].snapshot.objects);
    await mode(f.page, { imageMode: 'complete', patchMode: 'partial' }); await send(f.page, '次の候補');
    await f.page.waitForFunction(() => (window as any).__server.generations.length === 3 && (window as any).__server.patches === 2);
    state = await server(f.page); assert.equal(state.acks, 1); assert.deepEqual(state.documents[docId].snapshot.objects[0], before.documents[docId].snapshot.objects[0]);
  } finally { await f.close(); }
});

test('running assistant reload only GETs, completed read exposes explicit image continuation without a dead end', async () => {
  const f = await fixture('?running=1'); try {
    await f.page.getByTestId('design-attempt-reconcile').waitFor(); assert.equal((await server(f.page)).generations.length, 0);
    await f.page.reload(); await f.page.getByTestId('design-attempt-reconcile').waitFor();
    await f.page.evaluate(() => (window as any).__completeAssistant()); await f.page.getByTestId('design-attempt-reconcile').click();
    await f.page.getByRole('button', { name: '画像を作成', exact: true }).waitFor(); const state = await server(f.page); assert.equal(state.posts, 1); assert.equal(state.generations.length, 0);
    await f.page.getByRole('button', { name: '画像を作成', exact: true }).click(); await complete(f.page); assert.equal((await server(f.page)).generations.length, 1);
  } finally { await f.close(); }
});

test('brand switch during assistant await fences image generation and obsolete response publication', async () => {
  const f = await fixture(); try {
    await complete(f.page); await f.page.evaluate(() => { (window as any).__holdAssistant = true; }); await send(f.page, '待機中の指示');
    await f.page.waitForFunction(() => (window as any).__server.posts === 2); await f.page.evaluate(() => { (window as any).__switchBrand(); (window as any).__releaseAssistant(); });
    await f.page.waitForFunction(() => !document.querySelector('[data-testid="design-assistant-message"]'));
    assert.equal((await server(f.page)).generations.length, 1); assert.equal(await f.page.getByTestId('design-canvas-layer').count(), 0);
  } finally { await f.close(); }
});

test('user switch during assistant await fences image generation and old own-document view', async () => {
  const f = await fixture(); try {
    await complete(f.page); await f.page.evaluate(() => { (window as any).__holdAssistant = true; }); await send(f.page, 'ユーザー変更前');
    await f.page.waitForFunction(() => (window as any).__server.posts === 2); await f.page.evaluate(() => { (window as any).__switchUser(); (window as any).__releaseAssistant(); });
    await f.page.waitForFunction(() => !document.querySelector('[data-testid="design-assistant-message"]'));
    assert.equal((await server(f.page)).generations.length, 1);
  } finally { await f.close(); }
});

test('failed image preserves prior output and fresh independent prompt remains usable', async () => {
  const f = await fixture('?refs=0'); try {
    await complete(f.page); await mode(f.page, { imageMode: 'failed' }); await send(f.page, '失敗する指示');
    await f.page.getByText('画像を作成できませんでした。以前の画像はそのまま使用できます。').waitFor();
    assert.equal(await f.page.getByTestId('design-canvas-layer').count(), 1);
    await mode(f.page, { imageMode: 'complete' }); await send(f.page, '新しい指示'); await f.page.waitForFunction(() => (window as any).__server.acks === 2);
    const state = await server(f.page); assert.equal(state.posts, 3); assert.equal(state.generations.length, 3); assert.equal(await f.page.getByTestId('design-canvas-layer').count(), 2);
  } finally { await f.close(); }
});

test('unknown image followed by definite request 404 remains read-only across reconciliation and reload', async () => {
  const f = await fixture(); try {
    await complete(f.page); await mode(f.page, { imageMode: 'partial' }); await send(f.page, '結果が不明な指示');
    await f.page.getByTestId('design-attempt-reconcile').waitFor();
    await f.page.evaluate(() => { const state = (window as any).__server; delete state.images[state.generations[1].idempotencyKey]; sessionStorage.setItem('design-detail-fixture-server', JSON.stringify(state)); });
    await f.page.getByTestId('design-attempt-reconcile').click();
    await f.page.waitForFunction(() => !document.querySelector('[data-testid="design-followup-send"]')?.textContent?.includes('作成中'));
    assert.equal((await server(f.page)).generations.length, 2);
    await f.page.reload(); await f.page.getByTestId('design-attempt-reconcile').waitFor();
    const state = await server(f.page); assert.equal(state.posts, 2); assert.equal(state.generations.length, 2); assert.equal(state.acks, 1);
  } finally { await f.close(); }
});

test('lost CAS response acknowledges only the exact verified readback and keeps both outputs', async () => {
  const f = await fixture(); try {
    await complete(f.page); await mode(f.page, { patchMode: 'lost' }); await send(f.page, '応答だけが失われる保存');
    await f.page.waitForFunction(() => (window as any).__server.acks === 2);
    const state = await server(f.page); assert.equal(state.posts, 2); assert.equal(state.generations.length, 2); assert.equal(state.patches, 2);
    assert.equal(await f.page.getByTestId('design-canvas-layer').count(), 2);
    const index = state.events.findLastIndex((event: string) => event.startsWith('ACK:')); assert.ok(state.events[index - 1].startsWith('GET:'));
  } finally { await f.close(); }
});

test('missing URL and foreign remote owner show recovery without draft text, references or another dispatch', async () => {
  const f = await fixture(); try {
    await complete(f.page);
    await f.page.evaluate(() => (window as any).__mount('/designProduction/detail'));
    await f.page.getByTestId('design-entry-recovery').waitFor();
    assert.equal(await f.page.getByTestId('design-entry-prompt').count(), 0); assert.equal(await f.page.getByTestId('design-entry-reference').count(), 0);
    await f.page.evaluate(() => { const state = (window as any).__server; Object.values(state.documents).forEach((document: any) => { document.ownerId = 'foreign-owner'; }); sessionStorage.setItem('design-detail-fixture-server', JSON.stringify(state)); (window as any).__mount(); });
    await f.page.getByTestId('design-entry-recovery').waitFor();
    assert.equal(await f.page.getByTestId('design-entry-prompt').count(), 0); assert.equal(await f.page.getByTestId('design-assistant-message').count(), 0); assert.equal(await f.page.getByTestId('design-entry-reference').count(), 0);
    const state = await server(f.page); assert.equal(state.posts, 1); assert.equal(state.generations.length, 1);
  } finally { await f.close(); }
});

test('admitted pre-consumption crash reload takes scoped cross-tab lock and sends the exact existing request once', async () => {
  const f = await fixture('?seed=pre-send'); let peer: Page | undefined;
  try {
    const before = await f.page.evaluate(() => (window as any).__recoveryDiagnostics());
    assert.equal(before.draft.consumed, false); assert.equal(before.attempts.length, 1); assert.equal((await server(f.page)).posts, 0);
    const requestId = before.attempts[0].input.requestId;
    const lock = 'heavy-design-initial:' + JSON.stringify(['owner', 'brand', before.draft.projectId, before.draft.conversationId, requestId]);
    peer = await f.page.context().newPage();
    const control = new URL('/__lock-control__', f.page.url()).href;
    await peer.route(control, route => route.fulfill({ contentType: 'text/html', body: '<!doctype html><html><body></body></html>' }));
    await peer.goto(control);
    await peer.evaluate(name => { (window as any).__lock = navigator.locks.request(name, () => new Promise<void>(resolve => { (window as any).__releaseLock = resolve; (window as any).__lockHeld = true; })); }, lock);
    await peer.waitForFunction(() => (window as any).__lockHeld);
    await f.page.reload(); await f.page.waitForFunction(() => (window as any).__ready);
    await f.page.waitForFunction(async name => (await navigator.locks.query()).pending?.some(item => item.name === name), lock);
    assert.equal((await server(f.page)).posts, 0, 'another tab holds the full-scope dispatch decision lock');
    await f.page.evaluate(() => { (window as any).__joiningInitial = (window as any).__concurrentInitial(); });
    await peer.evaluate(() => (window as any).__releaseLock());
    await complete(f.page); await f.page.evaluate(() => (window as any).__joiningInitial);
    const state = await server(f.page); const after = await f.page.evaluate(() => (window as any).__recoveryDiagnostics());
    assert.equal(state.posts, 1); assert.equal(state.inputs[0].requestId, requestId); assert.equal(state.generations.length, 1);
    assert.equal(after.attempts.length, 1); assert.equal(after.attempts[0].imageClientRequestKey, before.attempts[0].imageClientRequestKey);
    assert.equal(after.draft.initialRequestId, requestId); assert.equal(after.draft.consumed, true);
    await f.page.reload(); await f.page.getByTestId('design-assistant-message').waitFor();
    assert.equal((await server(f.page)).posts, 1); assert.equal((await server(f.page)).generations.length, 1);
  } finally { await peer?.close(); await f.close(); }
});

test('consumed unknown initial stays GET-only on reload and allows a new independent prompt', async () => {
  const f = await fixture('?seed=consumed-unknown'); try {
    const before = await f.page.evaluate(() => (window as any).__recoveryDiagnostics());
    await f.page.reload(); await f.page.getByTestId('design-attempt-reconcile').waitFor();
    await f.page.waitForFunction(() => !document.querySelector('[data-testid="design-followup-send"]')?.textContent?.includes('作成中'));
    assert.equal((await server(f.page)).posts, 0); assert.equal((await server(f.page)).generations.length, 0);
    const after = await f.page.evaluate(() => (window as any).__recoveryDiagnostics()); assert.equal(after.attempts[0].input.requestId, before.attempts[0].input.requestId);
    await send(f.page, '独立した新しい指示'); await complete(f.page);
    assert.equal((await server(f.page)).posts, 1); assert.equal((await server(f.page)).generations.length, 1);
  } finally { await f.close(); }
});

test('pending L2 missing receipt and one attempt read failure do not strand the later completed attempt or independent send', async () => {
  const f = await fixture('?seed=pending-later'); try {
    await f.page.reload(); await f.page.getByTestId('design-canvas-layer').waitFor();
    await f.page.getByTestId('design-followup-prompt').fill('独立した指示');
    await f.page.waitForFunction(() => !(document.querySelector('[data-testid="design-followup-send"]') as HTMLButtonElement)?.disabled);
    const state = await server(f.page); const diagnostics = await f.page.evaluate(() => (window as any).__recoveryDiagnostics());
    assert.equal(state.posts, 0); assert.equal(state.generations.length, 0); assert.equal(state.acks, 0);
    assert.ok(state.events.some((event: string) => event === 'IMAGE-GET:' + state.seedMissingRequest));
    assert.equal(diagnostics.attempts[0].imageResult, 'unknown'); assert.equal(diagnostics.attempts[1].imageResult, 'ack-deferred');
    assert.equal(await f.page.getByTestId('design-entry-recovery').count(), 0); assert.equal(await f.page.getByTestId('design-canvas-layer').count(), 1);
    await f.page.getByTestId('design-followup-send').click(); await complete(f.page);
    assert.equal((await server(f.page)).posts, 1); assert.equal((await server(f.page)).generations.length, 1);
    assert.equal(await f.page.getByTestId('design-canvas-layer').count(), 2);
  } finally { await f.close(); }
});
