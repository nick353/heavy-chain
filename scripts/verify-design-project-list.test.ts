import assert from 'node:assert/strict';
import test from 'node:test';
import { chromium, type Page } from '@playwright/test';
import { createServer } from 'vite';

const fixtureSource = String.raw`
import React from 'react';
import { createRoot } from 'react-dom/client';
import { MemoryRouter, useLocation } from 'react-router-dom';
import { DesignConversationProjectList } from '/src/pages/LightchainParityPages.tsx';
import { useAuthStore } from '/src/stores/authStore.ts';
import { useCanvasStore } from '/src/stores/canvasStore.ts';
import { createEntryDraftStore } from '/src/features/designDetail/entryDraftStore.ts';
import { listDesignConversationProjects } from '/src/features/designDetail/designProjectList.ts';
import { DESIGN_ENTRY_DRAFT_DB } from '/src/features/designDetail/designEntryCoordinator.ts';
const h = React.createElement;
const scope = { userId: 'project-user-a', brandId: 'project-brand-a' };
const store = createEntryDraftStore({ idb: indexedDB, dbName: DESIGN_ENTRY_DRAFT_DB });
window.__store = store;
window.__scope = scope;
const seeded = sessionStorage.getItem('project-list-seed');
let seed;
if (seeded) seed = JSON.parse(seeded);
else {
  const drafts = [];
  for (let index = 0; index < 7; index++) {
    const draft = await store.reserve(scope, 'initial input ' + index, []);
    await store.mark(scope, draft.projectId, draft.conversationId, false);
    await store.mark(scope, draft.projectId, draft.conversationId, true);
    if (index === 0) await store.consume(scope, draft.projectId, draft.conversationId, crypto.randomUUID());
    drafts.push(draft);
  }
  const pending = await store.reserve(scope, 'unfinished input', []);
  const foreignScope = { userId: 'project-user-b', brandId: 'project-brand-a' };
  const foreign = await store.reserve(foreignScope, 'foreign input', []);
  await store.mark(foreignScope, foreign.projectId, foreign.conversationId, false);
  await store.mark(foreignScope, foreign.projectId, foreign.conversationId, true);
  const brandScope = { userId: scope.userId, brandId: 'project-brand-b' };
  const brand = await store.reserve(brandScope, 'other brand', []);
  await store.mark(brandScope, brand.projectId, brand.conversationId, false);
  await store.mark(brandScope, brand.projectId, brand.conversationId, true);
  const remote = (draft, owner_id = scope.userId, brand_id = scope.brandId) => ({
    id: draft.projectId, owner_id, brand_id, title: 'Conversation ' + draft.prompt,
    snapshot_version: 1, revision: 0, snapshot: { version: 1, projectId: draft.projectId, objects: [] },
    created_at: '2026-10-01T00:00:00.000Z', updated_at: '2026-10-01T00:00:00.000Z',
  });
  seed = { drafts, pending, foreign, brand, rows: [...drafts.map((draft) => remote(draft)), remote(pending), remote(foreign, foreignScope.userId), remote(brand, brandScope.userId, brandScope.brandId)] };
  sessionStorage.setItem('project-list-seed', JSON.stringify(seed));
}
window.__seed = seed;
window.__rows = seed.rows;
window.__calls = [];
window.__offline = false;
window.__hold = false;
window.__held = false;
let release;
window.__release = () => release?.();
const client = { async listCanvasDocumentsPage(brandId, limit, offset, context) {
  context.assertContext();
  window.__calls.push({ brandId, limit, offset, userId: context.userId });
  if (window.__hold) {
    window.__hold = false; window.__held = true;
    await new Promise((resolve) => { release = resolve; });
    window.__held = false;
  }
  if (window.__offline) throw new Error('project_remote_offline');
  // Deliberately return old and foreign rows: caller must fence/filter independently.
  return window.__rows;
} };
window.__list = (rows = window.__rows) => listDesignConversationProjects({ scope, drafts: store,
  client: { listCanvasDocumentsPage: async () => rows }, assertContext() {} });
useAuthStore.setState({ user: { id: scope.userId }, currentBrand: { id: scope.brandId } });
window.__setAuth = (userId, brandId) => useAuthStore.setState({ user: userId ? { id: userId } : null, currentBrand: brandId ? { id: brandId } : null });
window.__canvasBefore = useCanvasStore.getState().currentProjectId;
window.__canvasCurrent = () => useCanvasStore.getState().currentProjectId;
function App() {
  const location = useLocation();
  const [recent, setRecent] = React.useState(false);
  const [version, setVersion] = React.useState(0);
  const viewClient = React.useMemo(() => ({ ...client }), [version]);
  window.__refresh = () => setVersion((value) => value + 1);
  window.__recent = setRecent;
  React.useEffect(() => { window.__location = location.pathname + location.search; sessionStorage.setItem('project-list-location', window.__location); }, [location]);
  return h(React.Fragment, null, h(DesignConversationProjectList, { client: viewClient, recent }),
    h('p', { 'data-testid': 'existing-artifact' }, 'Existing image artifact remains'));
}
createRoot(document.getElementById('root')).render(h(MemoryRouter, { initialEntries: [sessionStorage.getItem('project-list-location') || '/designProduction'] }, h(App)));
window.__ready = true;
`;

async function fixture() {
  const vite = await createServer({
    configFile: new URL('../vite.config.ts', import.meta.url).pathname,
    server: { host: '127.0.0.1', port: 0 }, logLevel: 'silent',
    plugins: [{
      name: 'design-project-list-fixture',
      resolveId(source) { return source === '/__project-list-entry.tsx' ? '\0__project-list-entry.tsx' : null; },
      load(id) { return id === '\0__project-list-entry.tsx' ? fixtureSource : null; },
      configureServer(server) {
        server.middlewares.use('/__project-list', async (_req, res, next) => {
          try {
            const html = await server.transformIndexHtml('/__project-list', '<!DOCTYPE html><html><body><div id="root"></div><script type="module" src="/__project-list-entry.tsx"></script></body></html>');
            res.setHeader('Content-Type', 'text/html'); res.end(html);
          } catch (error) { next(error); }
        });
      },
    }],
  });
  await vite.listen();
  const address = vite.httpServer!.address(); assert.ok(address && typeof address === 'object');
  const origin = `http://127.0.0.1:${address.port}`;
  const browser = await chromium.launch({ headless: true });
  const page = await browser.newPage();
  const requests: { method: string; path: string }[] = [];
  const errors: string[] = [];
  page.on('pageerror', (error) => errors.push(error.message));
  page.on('request', (request) => requests.push({ method: request.method(), path: new URL(request.url()).pathname }));
  await page.route('**/*', (route) => new URL(route.request().url()).origin === origin ? route.continue() : route.abort());
  try {
    await page.goto(`${origin}/__project-list`);
    await page.waitForFunction(() => window.__ready === true, undefined, { timeout: 20000 });
    await page.getByTestId('design-conversation-project-card').first().waitFor();
    assert.deepEqual(errors, []);
    return { page, requests, close: async () => { await browser.close(); await vite.close(); } };
  } catch (error) { await browser.close(); await vite.close(); throw new Error(`${String(error)}; browser errors: ${errors.join('; ')}`); }
}
const waitCardCount = (page: Page, expected: number) => page.waitForFunction((count) => document.querySelectorAll('[data-testid="design-conversation-project-card"]').length === count, expected);

test('real IndexedDB ready/consumed associations join only strict owned canonical documents, including zero images, read-only', async () => {
  const app = await fixture();
  try {
    const result = await app.page.evaluate(async () => {
      const before = await window.__store.list(window.__scope);
      const valid = await window.__list();
      const mutations = [
        { owner_id: 'foreign-owner' }, { brand_id: 'foreign-brand' }, { id: 'blob:fake-project' },
        { snapshot_version: 2 }, { revision: -1 }, { revision: 1.5 },
        { snapshot: { version: 2, objects: [] } }, { snapshot: { version: 1, objects: 'invalid' } },
        { created_at: 'invalid' }, { updated_at: '' }, { title: '' },
      ];
      const invalidCounts = [];
      for (const patch of mutations) invalidCounts.push((await window.__list([{ ...window.__seed.rows[0], ...patch }])).length);
      return { before, after: await window.__store.list(window.__scope), valid, invalidCounts, calls: window.__calls };
    });
    assert.equal(result.before.length, 7);
    assert.equal(result.before.filter((draft: { consumed: boolean }) => draft.consumed).length, 1);
    assert.deepEqual(result.after, result.before, 'list performs no draft mutation or consumption');
    assert.equal(result.valid.length, 7, 'foreign owner/brand and unfinished draft excluded; all zero-image projects included');
    assert.deepEqual(result.invalidCounts, Array(11).fill(0));
    assert.deepEqual(result.calls[0], { brandId: 'project-brand-a', limit: 100, offset: 0, userId: 'project-user-a' });
    for (const row of result.valid) assert.ok(result.before.some((draft: { projectId: string; conversationId: string }) => draft.projectId === row.projectId && draft.conversationId === row.conversationId));
  } finally { await app.close(); }
});

test('recent/all cards open exact IDs and reload without inference, Canvas changes or losing existing artifacts', async () => {
  const app = await fixture();
  try {
    await waitCardCount(app.page, 7);
    const href = await app.page.getByTestId('design-conversation-project-card').first().getAttribute('href');
    const ids = await app.page.getByTestId('design-conversation-project-card').first().evaluate((node) => ({ projectId: node.getAttribute('data-project-id'), conversationId: node.getAttribute('data-conversation-id') }));
    const params = new URLSearchParams(href!.split('?')[1]);
    assert.equal(params.get('projectId'), ids.projectId);
    assert.equal(params.get('conversationId'), ids.conversationId);
    await app.page.getByTestId('design-conversation-project-card').first().click();
    await app.page.waitForFunction((expected) => window.__location === expected, href);
    await app.page.reload();
    await app.page.waitForFunction(() => window.__ready === true);
    await waitCardCount(app.page, 7);
    assert.equal(await app.page.evaluate(() => window.__location), href);
    await app.page.evaluate(() => window.__recent(true));
    await waitCardCount(app.page, 5);
    await app.page.evaluate(() => window.__recent(false));
    await waitCardCount(app.page, 7);
    assert.equal(await app.page.getByTestId('existing-artifact').textContent(), 'Existing image artifact remains');
    assert.equal(await app.page.evaluate(() => window.__canvasCurrent()), await app.page.evaluate(() => window.__canvasBefore));
    assert.equal(app.requests.filter((request) => request.method !== 'GET').length, 0);
    assert.equal(app.requests.filter((request) => /\/(?:design-assistant|generate-image|image-api|ai\/)/.test(request.path)).length, 0);
  } finally { await app.close(); }
});

test('offline refresh exposes retry while retaining cards and stale awaited scope never publishes old projects', async () => {
  const app = await fixture();
  try {
    await app.page.evaluate(() => { window.__offline = true; window.__refresh(); });
    await app.page.getByTestId('design-conversation-project-error').waitFor();
    await waitCardCount(app.page, 7);
    assert.match(await app.page.getByTestId('design-conversation-project-error').textContent() ?? '', /project_remote_offline/);
    await app.page.evaluate(() => { window.__offline = false; });
    await app.page.getByTestId('design-conversation-project-retry').click();
    await app.page.getByTestId('design-conversation-project-error').waitFor({ state: 'detached' });
    await waitCardCount(app.page, 7);
    await app.page.evaluate(() => { window.__offline = true; window.__setAuth('project-user-a', 'project-brand-b'); });
    await app.page.getByTestId('design-conversation-project-error').waitFor();
    await waitCardCount(app.page, 0);
    await app.page.evaluate(() => { window.__offline = false; window.__setAuth('project-user-a', 'project-brand-a'); });
    await waitCardCount(app.page, 7);
    // Force an error without changing scope via the retry action, using a held initial error.
    await app.page.evaluate(() => { window.__offline = true; window.__setAuth('project-user-a', 'project-brand-b'); });
    await app.page.getByTestId('design-conversation-project-error').waitFor();
    await app.page.evaluate(() => { window.__offline = false; });
    await app.page.getByTestId('design-conversation-project-retry').click();
    await waitCardCount(app.page, 1);
    await app.page.evaluate(() => { window.__hold = true; window.__setAuth('project-user-a', 'project-brand-a'); });
    await app.page.waitForFunction(() => window.__held === true);
    await app.page.evaluate(() => window.__setAuth('project-user-b', 'project-brand-a'));
    await waitCardCount(app.page, 1);
    await app.page.evaluate(() => window.__release());
    await app.page.waitForFunction(() => window.__held === false);
    const displayed = await app.page.getByTestId('design-conversation-project-card').getAttribute('data-project-id');
    assert.equal(displayed, await app.page.evaluate(() => window.__seed.foreign.projectId));
    await app.page.evaluate(() => { window.__offline = true; window.__hold = true; window.__setAuth('project-user-a', 'project-brand-a'); });
    await app.page.waitForFunction(() => window.__held === true);
    await app.page.evaluate(() => window.__setAuth('project-user-b', 'project-brand-a'));
    await app.page.evaluate(() => window.__release());
    await app.page.getByTestId('design-conversation-project-error').waitFor();
    await waitCardCount(app.page, 0);
    assert.equal(await app.page.getByTestId('existing-artifact').count(), 1);
    assert.equal(app.requests.filter((request) => request.method !== 'GET').length, 0);
  } finally { await app.close(); }
});
