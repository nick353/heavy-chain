import assert from 'node:assert/strict';
import test from 'node:test';
import { createServer as createTcpServer } from 'node:net';
import { chromium, type Browser, type Page } from '@playwright/test';
import { createServer } from 'vite';

const fixtureEntrySource = String.raw`
import React from 'react';
import { createRoot } from 'react-dom/client';
import { MemoryRouter, useLocation, useNavigate } from 'react-router-dom';
import { LightchainDialogueParityPanel } from '/src/pages/LightchainParityPages.tsx';
import { useAuthStore } from '/src/stores/authStore.ts';
import DesignEntryDetailPage from '/src/features/designDetail/DesignEntryDetailPage.tsx';
import { createDesignEntryCoordinator, DESIGN_ENTRY_DRAFT_DB } from '/src/features/designDetail/designEntryCoordinator.ts';
import { createEntryDraftStore } from '/src/features/designDetail/entryDraftStore.ts';
import { useCanvasStore } from '/src/stores/canvasStore.ts';

const STORAGE_KEY = 'design-dialogue-test-server-state-v1';
const blankServerState = () => ({ receipts: {}, documents: {}, createCount: 0, documentReadCount: 0, saveCount: 0, readCount: 0, failNextSave: false, holdNextSave: false });
const loadServerState = () => {
  try { return { ...blankServerState(), ...JSON.parse(window.sessionStorage.getItem(STORAGE_KEY) || '{}') }; }
  catch { return blankServerState(); }
};
const saveServerState = (state) => window.sessionStorage.setItem(STORAGE_KEY, JSON.stringify(state));
window.__designDialogueServerState = loadServerState();
let releaseHeldSave = null;
window.__designDialogueSaveEntered = false;
window.__designDialogueReleaseSave = () => { releaseHeldSave?.(); };

const receiptFor = (requestId) => {
  const imageId = 'wa-' + requestId.toLowerCase();
  return { success: true, remote: { jobId: imageId, imageId, storagePath: 'generated-images/' + imageId } };
};
const mockReferenceClient = {
  async captureArtifactPersistenceContext({ assertContext } = {}) {
    await assertContext?.();
    return Object.freeze({ assertCurrent: async () => { await assertContext?.(); } });
  },
  async saveWorkspaceArtifact(input, _checkedRequest, context) {
    await context?.assertCurrent();
    const state = loadServerState();
    state.saveCount += 1;
    saveServerState(state);
    window.__designDialogueServerState = state;
    if (state.holdNextSave) {
      state.holdNextSave = false;
      saveServerState(state);
      window.__designDialogueSaveEntered = true;
      await new Promise((resolve) => { releaseHeldSave = resolve; });
      releaseHeldSave = null;
      window.__designDialogueSaveEntered = false;
      await context?.assertCurrent();
    }
    const current = loadServerState();
    if (current.failNextSave) {
      current.failNextSave = false;
      saveServerState(current);
      window.__designDialogueServerState = current;
      throw new Error('mock_save_failed');
    }
    const receipt = receiptFor(input.requestId);
    current.receipts[input.requestId] = receipt;
    saveServerState(current);
    window.__designDialogueServerState = current;
    await context?.assertCurrent();
    return receipt;
  },
  async readWorkspaceArtifact(requestId, _checkedRequest, _expectedPath, context) {
    await context?.assertCurrent();
    const state = loadServerState();
    state.readCount += 1;
    saveServerState(state);
    window.__designDialogueServerState = state;
    const receipt = state.receipts[requestId];
    if (!receipt) throw new Error('cloudflare_api_404_workspace_artifact_not_found');
    await context?.assertCurrent();
    return receipt;
  },
};

const entryDrafts = createEntryDraftStore({ idb: window.indexedDB, dbName: DESIGN_ENTRY_DRAFT_DB });
let releaseCreate = null;
window.__entryReleaseCreate = () => releaseCreate?.();
window.__entryHoldCreate = false;
window.__entryCreateEntered = false;
window.__entryFailCreate = false;
window.__entryLoseCreateResponse = false;
window.__entryForeignDocument = false;
window.__entryGetIds = [];
window.__entryCreateIds = [];
window.__entryCanvasBefore = useCanvasStore.getState().currentProjectId;
const mockEntryClient = {
  async createDocument(input, context) {
    context?.assertContext();
    window.__entryCreateIds.push(input.documentId);
    const state = loadServerState(); state.createCount += 1; saveServerState(state);
    if (window.__entryHoldCreate) {
      window.__entryCreateEntered = true;
      await new Promise((resolve) => { releaseCreate = resolve; });
      releaseCreate = null;
      window.__entryCreateEntered = false;
      context?.assertContext();
    }
    if (window.__entryFailCreate) throw new Error('mock_create_unknown');
    const auth = useAuthStore.getState();
    const document = { id: input.documentId, ownerId: auth.user.id, brandId: input.brandId, title: input.title,
      snapshot: input.snapshot, snapshotVersion: 1, revision: 0, createdAt: '2026-10-01', updatedAt: '2026-10-01' };
    const current = loadServerState(); current.documents[document.id] = document; saveServerState(current);
    if (window.__entryLoseCreateResponse) throw new Error('mock_create_response_lost');
    return document;
  },
  async getDocument(id, brandId, context) {
    context?.assertContext();
    window.__entryGetIds.push(id);
    const state = loadServerState(); state.documentReadCount += 1; saveServerState(state);
    const document = state.documents[id];
    if (!document) throw new Error('mock_document_not_found');
    return window.__entryForeignDocument ? { ...document, ownerId: 'foreign-user' } : document;
  },
};
window.__entryClient = mockEntryClient;
window.__entryDrafts = entryDrafts;
window.__entryCreateCoordinator = (assertScope = () => {}) => createDesignEntryCoordinator({
  scope: { userId: 'dialogue-user-a', brandId: 'dialogue-brand-a' }, client: mockEntryClient, assertScope,
});
useAuthStore.setState({ user: { id: 'dialogue-user-a' }, currentBrand: { id: 'dialogue-brand-a' } });
window.__designDialogueSetAuth = (userId, brandId) => useAuthStore.setState({
  user: userId ? { id: userId } : null,
  currentBrand: brandId ? { id: brandId } : null,
});

const h = React.createElement;
function RouteProbe() {
  const location = useLocation();
  const navigate = useNavigate();
  window.__entryNavigate = navigate;
  React.useEffect(() => {
    window.__designDialogueLocation = location.pathname + location.search;
    window.sessionStorage.setItem('entry-location', window.__designDialogueLocation);
    const params = new URLSearchParams(location.search);
    if (params.get('projectId') && params.get('conversationId')) {
      const auth = useAuthStore.getState();
      entryDrafts.get({ userId: auth.user?.id || '', brandId: auth.currentBrand?.id || '' }, params.get('projectId'), params.get('conversationId')).then((draft) => { window.__designDialogueSentDraft = draft; });
    }
  }, [location.pathname, location.search]);
  return location.pathname === '/designProduction/detail' ? h(DesignEntryDetailPage, { client: mockEntryClient }) : null;
}

let root = null;
const mount = () => {
  const fixtureRoot = document.getElementById('fixture-root');
  root = createRoot(fixtureRoot);
  root.render(h(MemoryRouter, { initialEntries: [window.sessionStorage.getItem('entry-location') || '/designProduction'] },
    h(React.Fragment, null,
      h(RouteProbe),
      h(LightchainDialogueParityPanel, {
        remainingUnits: 123,
        onProjectStart: () => { window.__designDialogueProjectStart = true; },
        referenceClient: mockReferenceClient,
        entryClient: mockEntryClient,
      }))));
};
mount();
window.__designDialogueUnmount = () => root?.render(null);
window.__designDialogueRemount = () => mount();
window.__designDialogueFailNextSave = () => {
  const state = loadServerState();
  state.failNextSave = true;
  saveServerState(state);
  window.__designDialogueServerState = state;
};
window.__designDialogueHoldNextSave = () => {
  const state = loadServerState();
  state.holdNextSave = true;
  saveServerState(state);
  window.__designDialogueServerState = state;
};
`;

const SCENES = [
  {
    title: '生地パターン適用',
    prompt: '服装のデザインを変更せず、異なる生地を服装に適用してください',
    names: ['fabric1.jpg', 'fabric2.jpg', 'fabric3.jpg', 'fabric4.jpg', 'fabric5.png'],
  },
  {
    title: '線画から実写化',
    prompt: 'シャツを白黒線稿の服装デザイン図に変換し、白背景にしてください',
    names: ['draft1.png'],
  },
  {
    title: 'デザインミックス',
    prompt: '画像1の色と生地を変更せず、襟型を画像2の襟型に変更してください',
    names: ['multi1.jpg', 'multi2.jpg'],
  },
  {
    title: 'プリント修正',
    prompt: '画像1のアジサイ要素を参考に、四方連続のプリントパターンをデザインし、レイアウトとスタイルは画像2を参考にしてください',
    names: ['print1.png', 'print2.jpg'],
  },
];

const reserveFreePort = () => new Promise<number>((resolve, reject) => {
  const server = createTcpServer();
  server.once('error', reject);
  server.listen(0, '127.0.0.1', () => {
    const address = server.address();
    if (!address || typeof address === 'string') {
      server.close();
      reject(new Error('temporary Vite port could not be read'));
      return;
    }
    server.close((error) => error ? reject(error) : resolve(address.port));
  });
});

const createFixture = async (): Promise<{ browser: Browser; page: Page; close: () => Promise<void> }> => {
  const port = await reserveFreePort();
  const vite = await createServer({
    configFile: new URL('../vite.config.ts', import.meta.url).pathname,
    server: { host: '127.0.0.1', port, strictPort: true },
    optimizeDeps: { include: ['react', 'react-dom/client'] },
    plugins: [{
      name: 'design-dialogue-wiring-virtual-fixture',
      resolveId(source) {
        if (source === '/__design-dialogue-wiring-fixture__.tsx') return '\0__design-dialogue-wiring-fixture__.tsx';
        return null;
      },
      load(id) {
        if (id === '\0__design-dialogue-wiring-fixture__.tsx') return fixtureEntrySource;
        return null;
      },
    }],
    logLevel: 'silent',
  });
  let browser: Browser | null = null;
  try {
    await vite.listen();
    const address = vite.httpServer?.address();
    assert.ok(address && typeof address === 'object');
    const baseUrl = `http://127.0.0.1:${address.port}`;
    browser = await chromium.launch({ headless: true });
    const context = await browser.newContext({ viewport: { width: 1424, height: 632 }, deviceScaleFactor: 2, serviceWorkers: 'block' });
    const page = await context.newPage();
    await page.route('**/*', (route) => {
      const requestUrl = new URL(route.request().url());
      if (requestUrl.origin === baseUrl && requestUrl.pathname === '/__design-dialogue-wiring-test__') {
        return route.fulfill({
          status: 200,
          contentType: 'text/html',
          body: '<!doctype html><html><head><meta name="viewport" content="width=device-width, initial-scale=1"><link rel="stylesheet" href="/src/index.css"></head><body><div id="fixture-root"></div></body></html>',
        });
      }
      return requestUrl.origin === baseUrl ? route.continue() : route.abort();
    });
    await page.goto(`${baseUrl}/__design-dialogue-wiring-test__`, { waitUntil: 'domcontentloaded' });
    await installFixtureInPage(page);
    await page.getByTestId('design-dialogue-editor').waitFor({ state: 'visible' });
    await page.waitForFunction(() => window.__designDialogueReferenceReady === true
      || document.querySelector('[data-testid="design-dialogue-send"]') !== null);
    return {
      browser,
      page,
      close: async () => { await browser?.close(); await vite.close(); },
    };
  } catch (error) {
    await browser?.close();
    await vite.close();
    throw error;
  }
};

const installFixtureInPage = async (page: Page) => page.evaluate(async () => {
  const RefreshModule = await import('/@react-refresh');
  const RefreshRuntime = RefreshModule.default ?? RefreshModule;
  RefreshRuntime.injectIntoGlobalHook(window);
  window.$RefreshReg$ = () => {};
  window.$RefreshSig$ = () => (type) => type;
  window.__vite_plugin_react_preamble_installed__ = true;
  await import('/__design-dialogue-wiring-fixture__.tsx');
});

const readSentReferences = async (page: Page) => page.evaluate(() => {
  const href = window.__designDialogueLocation ?? '';
  const params = new URLSearchParams(href.split('?')[1] ?? '');
  const draft = window.__designDialogueSentDraft;
  return { path: href.split('?')[0], projectId: params.get('projectId'), conversationId: params.get('conversationId'),
    prompt: draft?.prompt, references: draft?.references ?? [] };
});

const waitForReadyReferences = async (page: Page, count: number) => {
  await page.waitForFunction((expected) => {
    const chips = [...document.querySelectorAll('[data-testid="design-dialogue-reference-chip"]')];
    return chips.length === expected && chips.every((chip) => chip.querySelector('[data-design-dialogue-reference-status]')?.textContent === '準備完了');
  }, count, { timeout: 15_000 });
};

test('rendered scene selections persist their evidenced ordered references and map every ID into the owned detail draft', async () => {
  const fixture = await createFixture();
  try {
    const { page } = fixture;
    const prompt = page.getByTestId('design-dialogue-prompt');
    const send = page.getByRole('button', { name: '送信' });
    for (const scene of SCENES) {
      await page.getByTestId(`design-dialogue-scene-${scene.title}`).click();
      await waitForReadyReferences(page, scene.names.length);
      assert.equal(await prompt.inputValue(), scene.prompt, `${scene.title} preserves the fresh Light prompt`);
      assert.deepEqual(await page.locator('[data-testid="design-dialogue-reference-chip"] [data-design-dialogue-reference-name]').allTextContents(), scene.names);
      assert.equal(await send.isDisabled(), false, `${scene.title} can send only after every selected reference is ready`);
      const chipOrder = await page.locator('[data-testid="design-dialogue-reference-chip"]').evaluateAll((chips) => chips.map((chip) => chip.getAttribute('data-reference-id')));
      assert.equal(new Set(chipOrder).size, scene.names.length, 'each scene reference has a distinct canonical request identity');
      await send.click();
      await page.waitForFunction((expectedPrompt) => {
        return window.__designDialogueSentDraft?.prompt === expectedPrompt;
      }, scene.prompt, { timeout: 5_000 });
      const sent = await readSentReferences(page);
      assert.equal(sent.path, '/designProduction/detail');
      assert.ok(sent.projectId && sent.conversationId);
      await page.getByTestId('design-entry-draft').waitFor();
      assert.equal(sent.prompt, scene.prompt);
      assert.equal(sent.references.length, scene.names.length);
      assert.deepEqual(sent.references.map((reference: { name: string }) => reference.name), scene.names);
      assert.ok(sent.references.every((reference: { imageId?: string; storagePath?: string }) => reference.imageId && reference.storagePath));
      assert.equal(await page.getByTestId('design-dialogue-editor').count(), 1, 'the existing panel remains mounted after handoff navigation');
    }
  } finally {
    await fixture.close();
  }
});

test('multiple file upload, remove compaction, and failed-save retry block partial handoff', async () => {
  const fixture = await createFixture();
  try {
    const { page } = fixture;
    await page.getByTestId('design-dialogue-prompt').fill('複数の参考画像を使う');
    await page.getByTestId('design-dialogue-file-input').setInputFiles([
      { name: 'shirt.png', mimeType: 'image/png', buffer: Buffer.from([137, 80, 78, 71, 13, 10, 26, 10, 1]) },
      { name: 'fabric.jpg', mimeType: 'image/jpeg', buffer: Buffer.from([255, 216, 255, 1]) },
    ]);
    await waitForReadyReferences(page, 2);
    const firstId = await page.locator('[data-testid="design-dialogue-reference-chip"]').first().getAttribute('data-reference-id');
    await page.locator('[data-testid="design-dialogue-reference-chip"]').first().getByTestId('design-dialogue-reference-remove').click();
    await waitForReadyReferences(page, 1);
    const remainingId = await page.locator('[data-testid="design-dialogue-reference-chip"]').first().getAttribute('data-reference-id');
    assert.notEqual(remainingId, firstId);
    await page.getByRole('button', { name: '送信' }).click();
    await page.waitForFunction(() => {
      return window.__designDialogueSentDraft?.references.some((reference) => reference.name === 'fabric.jpg');
    }, undefined, { timeout: 5_000 });
    const uploaded = await readSentReferences(page);
    assert.equal(uploaded.references.length, 1, 'deletion removes one item instead of truncating or reusing the previous first reference');
    assert.equal(uploaded.references[0].name, 'fabric.jpg');

    await page.evaluate(() => window.__designDialogueFailNextSave());
    await page.getByTestId('design-dialogue-scene-線画から実写化').click();
    await page.getByTestId('design-dialogue-reference-chip').waitFor({ state: 'visible' });
    await page.getByTestId('design-dialogue-reference-retry').waitFor({ state: 'visible' });
    const send = page.getByRole('button', { name: '送信' });
    assert.equal(await send.isDisabled(), true, 'a failed selected reference can never be silently omitted');
    assert.equal((await readSentReferences(page)).references.length, 1, 'failed selection did not navigate with a partial reference list');
    await page.getByRole('button', { name: 'draft1.pngを再試行' }).click();
    await waitForReadyReferences(page, 1);
    await send.click();
    await page.waitForFunction(() => {
      return window.__designDialogueSentDraft?.references.some((reference) => reference.name === 'draft1.png');
    }, undefined, { timeout: 5_000 });
    const retried = await readSentReferences(page);
    assert.equal(retried.references.length, 1);
    assert.equal(retried.references[0].name, 'draft1.png');
  } finally {
    await fixture.close();
  }
});

test('reload restores the exact canonical IDs by readback without resaving references', async () => {
  const fixture = await createFixture();
  try {
    const { page } = fixture;
    await page.getByTestId('design-dialogue-scene-プリント修正').click();
    await waitForReadyReferences(page, 2);
    const beforeIds = await page.locator('[data-testid="design-dialogue-reference-chip"]').evaluateAll((chips) => chips.map((chip) => chip.getAttribute('data-reference-id')));
    const beforeCounts = await page.evaluate(() => ({ ...window.__designDialogueServerState }));
    await page.reload({ waitUntil: 'domcontentloaded' });
    await installFixtureInPage(page);
    await page.getByTestId('design-dialogue-editor').waitFor({ state: 'visible' });
    await waitForReadyReferences(page, 2);
    const afterIds = await page.locator('[data-testid="design-dialogue-reference-chip"]').evaluateAll((chips) => chips.map((chip) => chip.getAttribute('data-reference-id')));
    const afterCounts = await page.evaluate(() => ({ ...window.__designDialogueServerState }));
    assert.deepEqual(afterIds, beforeIds, 'the same IDs are restored in the same order');
    assert.equal(afterCounts.saveCount, beforeCounts.saveCount, 'reload restores with canonical readback and does not re-upload');
    assert.ok(afterCounts.readCount > beforeCounts.readCount, 'reload performs exact-ID readback');
  } finally {
    await fixture.close();
  }
});

test('scope changes during an awaited save fence the old selection before any partial send', async () => {
  for (const nextScope of [
    { userId: 'dialogue-user-a', brandId: 'dialogue-brand-b' },
    { userId: null, brandId: null },
  ]) {
    const fixture = await createFixture();
    try {
      const { page } = fixture;
      await page.evaluate(() => window.__designDialogueHoldNextSave());
      await page.getByTestId('design-dialogue-scene-線画から実写化').click();
      await page.waitForFunction(() => window.__designDialogueSaveEntered === true, undefined, { timeout: 10_000 });
      await page.evaluate(({ userId, brandId }) => window.__designDialogueSetAuth(userId, brandId), nextScope);
      await page.waitForFunction(() => document.querySelectorAll('[data-testid="design-dialogue-reference-chip"]').length === 0, undefined, { timeout: 5_000 });
      await page.evaluate(() => window.__designDialogueReleaseSave());
      await page.waitForFunction(() => window.__designDialogueSaveEntered === false, undefined, { timeout: 5_000 });
      await page.getByTestId('design-dialogue-prompt').fill('新しい範囲のテキストのみ');
      await page.getByRole('button', { name: '送信' }).click();
      const sent = await readSentReferences(page);
      assert.deepEqual(sent.references, [], 'a late old-scope save is never attached to the new user/brand or logout send');
      const state = await page.evaluate(() => window.__designDialogueServerState);
      assert.equal(Object.keys(state.receipts).length, 0, 'the stale awaited write did not become a committed canonical receipt');
    } finally {
      await fixture.close();
    }
  }
});

test('unmount disposes the reference controller while its write is awaiting', async () => {
  const fixture = await createFixture();
  try {
    const { page } = fixture;
    await page.evaluate(() => window.__designDialogueHoldNextSave());
    await page.getByTestId('design-dialogue-scene-線画から実写化').click();
    await page.waitForFunction(() => window.__designDialogueSaveEntered === true, undefined, { timeout: 10_000 });
    await page.evaluate(() => window.__designDialogueUnmount());
    await page.getByTestId('design-dialogue-editor').waitFor({ state: 'detached' });
    await page.evaluate(() => window.__designDialogueReleaseSave());
    await page.waitForFunction(() => window.__designDialogueSaveEntered === false, undefined, { timeout: 5_000 });
    const state = await page.evaluate(() => window.__designDialogueServerState);
    assert.equal(Object.keys(state.receipts).length, 0, 'disposed controller rejects the late persistence result');
  } finally {
    await fixture.close();
  }
});


test('entry double click creates once, verifies revision zero, and reload preserves prompt and all ordered IDs without upload or provider calls', async () => {
  const fixture = await createFixture();
  try {
    const { page } = fixture;
    const providerRequests: string[] = [];
    page.on('request', (request) => { if (/\/(?:generate-image|image-api|chat-completions|ai\/|generation\/)/.test(new URL(request.url()).pathname)) providerRequests.push(request.url()); });
    await page.getByTestId('design-dialogue-scene-生地パターン適用').click();
    await waitForReadyReferences(page, 5);
    await page.getByTestId('design-dialogue-prompt').fill('初回のプロンプトをそのまま保存');
    await page.evaluate(() => {
      const button = document.querySelector('[data-testid="design-dialogue-send"]') as HTMLButtonElement;
      button.click(); button.click();
    });
    await page.getByTestId('design-entry-draft').waitFor();
    const before = await readSentReferences(page);
    const beforeState = await page.evaluate(() => JSON.parse(window.sessionStorage.getItem('design-dialogue-test-server-state-v1')!));
    assert.equal(beforeState.createCount, 1);
    assert.equal(beforeState.documents[before.projectId!].revision, 0, 'matches actual canonical create revision');
    assert.equal(beforeState.documents[before.projectId!].ownerId, 'dialogue-user-a');
    assert.equal(beforeState.documents[before.projectId!].brandId, 'dialogue-brand-a');
    assert.equal(before.references.length, 5);
    assert.deepEqual(before.references.map((reference: { order: number }) => reference.order), [0, 1, 2, 3, 4]);
    assert.equal(before.prompt, '初回のプロンプトをそのまま保存');
    await page.reload({ waitUntil: 'domcontentloaded' });
    await installFixtureInPage(page);
    await page.getByTestId('design-entry-draft').waitFor();
    const after = await readSentReferences(page);
    const afterState = await page.evaluate(() => JSON.parse(window.sessionStorage.getItem('design-dialogue-test-server-state-v1')!));
    assert.deepEqual(after, before);
    assert.equal(afterState.createCount, 1);
    assert.equal(afterState.saveCount, beforeState.saveCount);
    assert.ok(afterState.documentReadCount > beforeState.documentReadCount);
    assert.deepEqual(await page.getByTestId('design-entry-reference').evaluateAll((nodes) => nodes.map((node) => node.getAttribute('data-image-id'))), before.references.map((reference: { imageId: string }) => reference.imageId));
    const canvasUnchanged = await page.evaluate(async () => {
      const { useCanvasStore } = await import('/src/stores/canvasStore.ts');
      return useCanvasStore.getState().currentProjectId === window.__entryCanvasBefore;
    });
    assert.equal(canvasUnchanged, true, 'entry does not switch the global Canvas');
    assert.deepEqual(providerRequests, [], 'entry and reload dispatch zero image/text providers');
  } finally { await fixture.close(); }
});

test('unknown create is durable and reconciles the same ID with GET only across reload; independent input remains usable', async () => {
  const fixture = await createFixture();
  try {
    const { page } = fixture;
    await page.evaluate(() => { window.__entryFailCreate = true; });
    await page.getByTestId('design-dialogue-prompt').fill('作成結果が不明な初回入力');
    await page.getByRole('button', { name: '送信' }).click();
    await page.getByTestId('design-dialogue-error').waitFor();
    const before = await page.evaluate(() => ({ id: window.__entryCreateIds[0], state: JSON.parse(window.sessionStorage.getItem('design-dialogue-test-server-state-v1')!) }));
    assert.equal(before.state.createCount, 1);
    await page.reload({ waitUntil: 'domcontentloaded' });
    await installFixtureInPage(page);
    await page.getByTestId('design-dialogue-prompt').fill('作成結果が不明な初回入力');
    await page.getByRole('button', { name: '送信' }).click();
    await page.getByTestId('design-dialogue-error').waitFor();
    const retried = await page.evaluate(() => ({ ids: window.__entryGetIds, state: JSON.parse(window.sessionStorage.getItem('design-dialogue-test-server-state-v1')!) }));
    assert.equal(retried.state.createCount, 1, 'reload cannot replay an uncertain create');
    assert.deepEqual(retried.ids, [before.id], 'reconciliation uses the same proposed ID');
    await page.getByTestId('design-dialogue-prompt').fill('別の独立した初回入力');
    await page.getByRole('button', { name: '送信' }).click();
    await page.getByTestId('design-entry-draft').waitFor();
    const independent = await readSentReferences(page);
    assert.notEqual(independent.projectId, before.id);
    assert.equal(independent.prompt, '別の独立した初回入力');
    assert.equal(await page.evaluate(() => JSON.parse(window.sessionStorage.getItem('design-dialogue-test-server-state-v1')!).createCount), 2);
    const oldRetry = await page.evaluate(async () => {
      const coordinator = window.__entryCreateCoordinator();
      let error = '';
      try { await coordinator.prepare('作成結果が不明な初回入力', []); } catch (failure) { error = failure.message; }
      return { error, lastId: window.__entryGetIds.at(-1), count: JSON.parse(window.sessionStorage.getItem('design-dialogue-test-server-state-v1')!).createCount };
    });
    assert.equal(oldRetry.error, 'mock_document_not_found');
    assert.equal(oldRetry.lastId, before.id, 'another entry cannot hide or replace the original uncertain identity');
    assert.equal(oldRetry.count, 2);
  } finally { await fixture.close(); }
});

test('a lost create response validates same-ID canonical GET and foreign ownership is rejected', async () => {
  const fixture = await createFixture();
  try {
    const result = await fixture.page.evaluate(async () => {
      window.__entryLoseCreateResponse = true;
      const coordinator = window.__entryCreateCoordinator();
      const href = await coordinator.prepare('応答を失った初回入力', []);
      window.__entryForeignDocument = true;
      let error = '';
      try { await coordinator.prepare('応答を失った初回入力', []); } catch (failure) { error = failure.message; }
      return { href, error, createIds: window.__entryCreateIds, getIds: window.__entryGetIds,
        state: JSON.parse(window.sessionStorage.getItem('design-dialogue-test-server-state-v1')!) };
    });
    assert.equal(result.state.createCount, 1);
    assert.equal(result.error, 'design_entry_document_unverified');
    assert.ok(result.href.startsWith('/designProduction/detail?'));
    assert.deepEqual(result.getIds, [result.createIds[0], result.createIds[0]]);
  } finally { await fixture.close(); }
});

test('detail rejects foreign or missing project/conversation associations without leaking the stored prompt', async () => {
  const fixture = await createFixture();
  try {
    const { page } = fixture;
    await page.getByTestId('design-dialogue-prompt').fill('所有者だけに見えるプロンプト');
    await page.getByRole('button', { name: '送信' }).click();
    await page.getByTestId('design-entry-draft').waitFor();
    const before = await readSentReferences(page);
    for (const url of [
      `/designProduction/detail?projectId=${before.projectId}&conversationId=foreign-conversation`,
      `/designProduction/detail?projectId=foreign-project&conversationId=${before.conversationId}`,
      '/designProduction/detail',
    ]) {
      await page.evaluate((href) => window.__entryNavigate(href), url);
      await page.getByTestId('design-entry-recovery').waitFor();
      assert.equal(await page.getByTestId('design-entry-prompt').count(), 0);
      assert.equal(await page.getByTestId('design-entry-reference').count(), 0);
    }
    await page.evaluate((href) => { window.__entryForeignDocument = true; window.__entryNavigate(href); }, `/designProduction/detail?projectId=${before.projectId}&conversationId=${before.conversationId}`);
    await page.getByTestId('design-entry-recovery').waitFor();
    assert.equal(await page.getByTestId('design-entry-prompt').count(), 0);
    assert.equal(await page.evaluate(() => JSON.parse(window.sessionStorage.getItem('design-dialogue-test-server-state-v1')!).createCount), 1);
  } finally { await fixture.close(); }
});

test('auth changes while canonical creation awaits fence old-scope navigation and session readiness', async () => {
  const fixture = await createFixture();
  try {
    const { page } = fixture;
    await page.evaluate(() => { window.__entryHoldCreate = true; });
    await page.getByTestId('design-dialogue-prompt').fill('旧ブランドの入力');
    await page.getByRole('button', { name: '送信' }).click();
    await page.waitForFunction(() => window.__entryCreateEntered === true);
    const ids = await page.evaluate(() => [...window.__entryCreateIds]);
    await page.evaluate(() => window.__designDialogueSetAuth('dialogue-user-a', 'dialogue-brand-b'));
    await page.waitForFunction(() => (document.querySelector('[data-testid="design-dialogue-prompt"]') as HTMLTextAreaElement).value === '');
    await page.evaluate(() => window.__entryReleaseCreate());
    await page.waitForFunction(() => window.__entryCreateEntered === false);
    const result = await page.evaluate(async (projectId) => {
      const db = await new Promise<IDBDatabase>((resolve) => { const request = window.indexedDB.open('heavy-design-entry-drafts-v1', 1); request.onsuccess = () => resolve(request.result); });
      const all = await new Promise<any[]>((resolve) => { const request = db.transaction('drafts').objectStore('drafts').getAll(); request.onsuccess = () => resolve(request.result); });
      db.close();
      return { draft: all.find((draft) => draft.projectId === projectId), href: window.__designDialogueLocation, reads: window.__entryGetIds };
    }, ids[0]);
    assert.equal(result.draft.ready, false);
    assert.equal(result.draft.scope.brandId, 'dialogue-brand-a');
    assert.equal(result.href, '/designProduction');
    assert.deepEqual(result.reads, []);
  } finally { await fixture.close(); }
});


test('draft reserve and create claim abort if scope becomes stale inside the IndexedDB callback before writing', async () => {
  const fixture = await createFixture();
  try {
    const result = await fixture.page.evaluate(async () => {
      const { createEntryDraftStore } = await import('/src/features/designDetail/entryDraftStore.ts');
      const store = createEntryDraftStore({ idb: window.indexedDB, dbName: 'entry-scope-callback-test' });
      const scope = { userId: 'dialogue-user-a', brandId: 'dialogue-brand-a' };
      let checks = 0;
      let reserveError = '';
      try { await store.reserve(scope, '書き込み前に古くなる入力', [], () => { if (++checks > 1) throw new Error('scope_stale'); }); }
      catch (error) { reserveError = error.message; }
      const db = await new Promise<IDBDatabase>((resolve) => { const request = window.indexedDB.open('entry-scope-callback-test', 1); request.onsuccess = () => resolve(request.result); });
      const count = await new Promise<number>((resolve) => { const request = db.transaction('drafts').objectStore('drafts').count(); request.onsuccess = () => resolve(request.result); });
      db.close();
      const draft = await store.reserve(scope, '有効な入力', []);
      let markError = '';
      try { await store.mark(scope, draft.projectId, draft.conversationId, false, () => { throw new Error('scope_stale'); }); }
      catch (error) { markError = error.message; }
      return { reserveError, count, markError, stored: await store.get(scope, draft.projectId, draft.conversationId) };
    });
    assert.equal(result.reserveError, 'scope_stale');
    assert.equal(result.count, 0, 'stale reserve commits no local draft');
    assert.equal(result.markError, 'scope_stale');
    assert.equal(result.stored.createAttempted, false, 'stale claim cannot mark a remote effect as attempted');
  } finally { await fixture.close(); }
});
