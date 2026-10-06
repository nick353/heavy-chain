import assert from 'node:assert/strict';
import test from 'node:test';
import { createServer as createTcpServer } from 'node:net';
import { chromium, type Browser, type Page } from '@playwright/test';
import { createServer } from 'vite';

const fixtureEntrySource = String.raw`
import '/src/index.css';
import React from 'react';
import { createRoot } from 'react-dom/client';
import { MemoryRouter, Route, Routes, UNSAFE_NavigationContext, useLocation, useNavigate } from 'react-router-dom';
import { CanvasEditorPage } from '/src/pages/CanvasEditorPage.tsx';
import { useAuthStore } from '/src/stores/authStore.ts';
import { useCanvasStore } from '/src/stores/canvasStore.ts';
import { cloudflareDataPlane } from '/src/lib/cloudflareApi.ts';
import { readCanvasSaveDiagnosticReceipt } from '/src/lib/canvasSaveDiagnostic.ts';
import { readCanvasSaveRecovery } from '/src/lib/canvasDocumentSaveRecovery.ts';

const api = cloudflareDataPlane;
if (!api) throw new Error('canvas_save_diagnostic_fixture_client_missing');
const userId = 'canvas-save-diagnostic-user';
const brandId = 'canvas-save-diagnostic-brand';
const localProjectId = 'canvas-save-diagnostic-local-project';
const now = new Date().toISOString();
const user = { id: userId, email: 'fixture@example.test', name: 'Fixture' };
const brand = { id: brandId, owner_id: userId, name: 'Heavy Chain', brand_colors: [], logo_url: null,
  tone_description: null, target_audience: null, created_at: now, updated_at: now };
const recoveryScope = { origin: api.origin, userId, brandId };
const recoveryObservation = (documentId) => {
  const entry = readCanvasSaveRecovery(recoveryScope, documentId);
  return entry ? {
    documentId: entry.documentId,
    ownerId: entry.ownerId,
    revision: entry.revision,
    title: entry.title,
    snapshot: cloneFixtureValue(entry.snapshot),
    pending: entry.pending ? cloneFixtureValue(entry.pending) : null,
  } : null;
};
useAuthStore.setState({ user, currentBrand: brand, accessibleBrands: [brand], isInitialized: true, isLoading: false,
  brandState: { status: 'success_nonempty', userId, requestGeneration: 1, confirmedBrandIds: [brandId], error: null } });
localStorage.setItem('heavy_chain_canvas_guide_completed:' + userId, 'true');
useCanvasStore.getState().hydrateProject({ id: localProjectId, name: 'Diagnostic fixture', brandId, objects: [],
  createdAt: now, updatedAt: now, view: { zoom: 1, panX: 0, panY: 0 } });

window.__canvasSaveDiagnosticCalls = { get: 0, create: 0, update: 0 };
window.__canvasSaveDiagnosticInputs = { get: [], create: [], update: [] };
window.__canvasSaveDiagnosticPendingAtCreate = [];
window.__canvasSaveDiagnosticGetOutcomes = [];
window.__canvasSaveDiagnosticCreateOutcome = null;
window.__canvasSaveDiagnosticServerDocument = null;
window.__canvasSaveDiagnosticMode = 'error';
window.__canvasSaveDiagnosticGateEntered = false;
let gateArmed = false;
let releaseGate = null;
const cloneFixtureValue = (value) => structuredClone(value);
const committedRoutes = [];
const routeWaiters = [];
const routeWaitObservations = [];
let routeTraceOrder = 0;
const nextRouteTraceOrder = () => ++routeTraceOrder;
const navigatorCalls = [];
const layoutCommits = [];
const profilerCommits = [];
let routeContextNavigator = null;
window.__canvasSaveDiagnosticNavigatorInstalled = false;
window.__canvasSaveDiagnosticNavigatorCalls = navigatorCalls;
window.__canvasSaveDiagnosticLayoutCommits = layoutCommits;
window.__canvasSaveDiagnosticProfilerCommits = profilerCommits;
const recordRoutesProfilerCommit = (_id, phase) => {
  let pathname = null;
  try { pathname = routeContextNavigator?.location?.pathname ?? null; } catch { pathname = null; }
  profilerCommits.push({
    order: nextRouteTraceOrder(),
    phase: phase === 'mount' || phase === 'update' || phase === 'nested-update' ? phase : 'other',
    pathname,
    navigatorCallCount: navigatorCalls.length,
  });
};
window.__canvasSaveDiagnosticCommittedRoutes = committedRoutes;
window.__canvasSaveDiagnosticRouteWaitObservations = routeWaitObservations;
window.__waitForCanvasSaveDiagnosticRoute = (pathname, timeout = 6000) => {
  const committed = committedRoutes.find((entry) => entry.pathname === pathname);
  const observation = {
    registrationOrder: nextRouteTraceOrder(),
    registeredAfterCommitCount: committedRoutes.length,
    preexistingCommitOrder: committed?.order ?? null,
    outcome: committed ? 'already_committed' : 'pending',
    resolvedCommitOrder: committed?.order ?? null,
  };
  routeWaitObservations.push({ pathname, observation });
  if (committed) return Promise.resolve(committed);
  return new Promise((resolve, reject) => {
    const waiter = { pathname, resolve, reject, timeoutId: null, observation };
    waiter.timeoutId = setTimeout(() => {
      const index = routeWaiters.indexOf(waiter);
      if (index >= 0) routeWaiters.splice(index, 1);
      observation.outcome = 'timed_out';
      reject(new Error('canvas_save_diagnostic_route_commit_timeout'));
    }, timeout);
    routeWaiters.push(waiter);
  });
};
window.__setCanvasSaveDiagnosticMode = (mode) => { window.__canvasSaveDiagnosticMode = mode; };
window.__armCanvasSaveDiagnosticGetGate = () => { gateArmed = true; };
window.__releaseCanvasSaveDiagnosticGetGate = () => { releaseGate?.(); };
window.__readOriginalCanvasSaveDiagnosticReceipt = () => readCanvasSaveDiagnosticReceipt({ user, brand });
window.__readCanvasSaveDiagnosticRecovery = (documentId) => recoveryObservation(documentId);
window.__publishCanvasSaveDiagnosticPending = (documentId) => {
  const entry = readCanvasSaveRecovery(recoveryScope, documentId);
  if (!entry?.pending) throw new Error('fixture_pending_create_missing');
  const serverDocument = {
    id: documentId,
    ownerId: entry.ownerId,
    brandId,
    title: entry.pending.title,
    snapshot: cloneFixtureValue(entry.pending.snapshot),
    snapshotVersion: 1,
    revision: 0,
    createdAt: now,
    updatedAt: now,
  };
  window.__canvasSaveDiagnosticServerDocument = cloneFixtureValue(serverDocument);
  return cloneFixtureValue(serverDocument);
};
window.__forceCanvasSaveDiagnosticSameScopeRerender = () => {
  const priorProfilerCommits = profilerCommits.length;
  useCanvasStore.setState((state) => ({ ...state }));
  return priorProfilerCommits;
};
window.__canvasSaveDiagnosticState = () => ({
  calls: { ...window.__canvasSaveDiagnosticCalls },
  inputs: cloneFixtureValue(window.__canvasSaveDiagnosticInputs),
  pendingAtCreate: cloneFixtureValue(window.__canvasSaveDiagnosticPendingAtCreate),
  getOutcomes: cloneFixtureValue(window.__canvasSaveDiagnosticGetOutcomes),
  createOutcome: cloneFixtureValue(window.__canvasSaveDiagnosticCreateOutcome),
  serverDocument: cloneFixtureValue(window.__canvasSaveDiagnosticServerDocument),
  committedRoutes: cloneFixtureValue(committedRoutes),
  layoutCommits: cloneFixtureValue(layoutCommits),
  profilerCommits: cloneFixtureValue(profilerCommits),
  navigatorInstalled: window.__canvasSaveDiagnosticNavigatorInstalled,
  navigatorCalls: cloneFixtureValue(navigatorCalls),
  routeWaitObservations: cloneFixtureValue(routeWaitObservations),
  route: window.__canvasSaveDiagnosticRoute ?? null,
  canvasId: useCanvasStore.getState().currentProjectId,
  auth: { userId: useAuthStore.getState().user?.id, brandId: useAuthStore.getState().currentBrand?.id },
});
window.__changeCanvasSaveDiagnosticScope = (kind) => {
  if (kind === 'user') {
    const nextUserId = 'canvas-save-diagnostic-other-user';
    const nextUser = { ...user, id: nextUserId };
    const nextBrand = { ...brand, owner_id: nextUserId };
    useAuthStore.setState({ user: nextUser, currentBrand: nextBrand, accessibleBrands: [nextBrand],
      brandState: { status: 'success_nonempty', userId: nextUserId, requestGeneration: 2,
        confirmedBrandIds: [brandId], error: null } });
  } else if (kind === 'brand') {
    const nextBrand = { ...brand, id: 'canvas-save-diagnostic-other-brand' };
    useAuthStore.setState({ currentBrand: nextBrand, accessibleBrands: [brand, nextBrand],
      brandState: { status: 'success_nonempty', userId, requestGeneration: 1,
        confirmedBrandIds: [brandId, nextBrand.id], error: null } });
  }
};

api.listPendingProtectedImageEdits = async () => [];
api.getCanvasDocument = async (documentId) => {
  window.__canvasSaveDiagnosticCalls.get += 1;
  window.__canvasSaveDiagnosticInputs.get.push(documentId);
  if (gateArmed) {
    gateArmed = false;
    window.__canvasSaveDiagnosticGateEntered = true;
    await new Promise((resolve) => { releaseGate = resolve; });
  }
  const serverDocument = window.__canvasSaveDiagnosticServerDocument;
  if (serverDocument?.id === documentId) {
    window.__canvasSaveDiagnosticGetOutcomes.push({ documentId, outcome: 'canonical' });
    return cloneFixtureValue(serverDocument);
  }
  window.__canvasSaveDiagnosticGetOutcomes.push({ documentId, outcome: 'not_found' });
  throw new Error('cloudflare_api_404_not_found');
};
api.createCanvasDocument = async (input) => {
  window.__canvasSaveDiagnosticCalls.create += 1;
  window.__canvasSaveDiagnosticInputs.create.push(cloneFixtureValue(input));
  window.__canvasSaveDiagnosticCreateOutcome = { state: 'pending', errorName: null };
  if (typeof input.id !== 'string' || !input.id) throw new Error('unexpected_canvas_document_create_without_id');
  const recovery = readCanvasSaveRecovery(recoveryScope, input.id);
  if (!recovery?.pending || recovery.pending.kind !== 'create') throw new Error('unexpected_canvas_create_without_pending');
  window.__canvasSaveDiagnosticPendingAtCreate.push({
    documentId: input.id,
    writeId: recovery.pending.writeId,
    kind: recovery.pending.kind,
    expectedRevision: recovery.pending.expectedRevision,
    title: recovery.pending.title,
    snapshot: cloneFixtureValue(recovery.pending.snapshot),
  });
  const serverDocument = {
    id: input.id,
    ownerId: userId,
    brandId: input.brand_id,
    title: input.title,
    snapshot: cloneFixtureValue(input.snapshot),
    snapshotVersion: 1,
    revision: 0,
    createdAt: now,
    updatedAt: now,
  };
  if (window.__canvasSaveDiagnosticMode === 'success') {
    window.__canvasSaveDiagnosticServerDocument = cloneFixtureValue(serverDocument);
    window.__canvasSaveDiagnosticCreateOutcome = { state: 'resolved', errorName: null };
    return cloneFixtureValue(serverDocument);
  }
  if (window.__canvasSaveDiagnosticMode === 'lost-response') {
    window.__canvasSaveDiagnosticServerDocument = cloneFixtureValue(serverDocument);
    window.__canvasSaveDiagnosticCreateOutcome = { state: 'lost_response', errorName: 'TypeError' };
    throw new TypeError('canvas_save_response_lost');
  }
  if (window.__canvasSaveDiagnosticMode === 'lost-not-found') {
    window.__canvasSaveDiagnosticCreateOutcome = { state: 'rejected', errorName: 'TypeError' };
    throw new TypeError('canvas_save_transport_unavailable');
  }
  const error = new Error('FixtureSaveFailure token=fixture-secret-token cookie=fixture-secret-cookie user=fixture-secret-user id=fixture-secret-id signed=https://example.invalid/private?sig=fixture-secret-signature');
  error.name = 'FixtureSecretError';
  error.code = 'fixture-secret-code';
  error.status = 409;
  window.__canvasSaveDiagnosticCreateOutcome = { state: 'rejected', errorName: 'FixtureSecretError' };
  throw error;
};
api.updateCanvasDocument = async (input) => {
  window.__canvasSaveDiagnosticCalls.update += 1;
  window.__canvasSaveDiagnosticInputs.update.push(cloneFixtureValue(input));
  throw new Error('unexpected_fixture_update');
};

function RouterControls() {
  const location = useLocation();
  const navigate = useNavigate();
  const navigationContext = React.useContext(UNSAFE_NavigationContext);
  const navigator = navigationContext?.navigator;
  React.useLayoutEffect(() => {
    if (!navigator) return undefined;
    const restorers = [];
    for (const method of ['push', 'replace']) {
      const originalDescriptor = Object.getOwnPropertyDescriptor(navigator, method);
      const original = navigator[method];
      if (typeof original !== 'function') continue;
      const wrapper = function (...args) {
        const call = { order: nextRouteTraceOrder(), kind: method, target: args[0], locationAfter: null, returned: false, threw: false };
        navigatorCalls.push(call);
        try {
          const result = original.apply(this, args);
          call.returned = true;
          try { call.locationAfter = navigator.location?.pathname ?? null; } catch { call.locationAfter = null; }
          return result;
        } catch (error) {
          call.threw = true;
          throw error;
        }
      };
      try {
        navigator[method] = wrapper;
        if (navigator[method] === wrapper) {
          restorers.push(() => {
            if (navigator[method] !== wrapper) return;
            if (originalDescriptor) Object.defineProperty(navigator, method, originalDescriptor);
            else delete navigator[method];
          });
        }
      } catch {
        // Installation is reported as false; do not change the original method.
      }
    }
    routeContextNavigator = navigator;
    window.__canvasSaveDiagnosticNavigatorInstalled = restorers.length === 2;
    return () => {
      restorers.reverse().forEach((restore) => {
        try { restore(); } catch { /* Preserve the original navigation methods. */ }
      });
      window.__canvasSaveDiagnosticNavigatorInstalled = false;
      if (routeContextNavigator === navigator) routeContextNavigator = null;
    };
  }, [navigator]);
  React.useLayoutEffect(() => {
    layoutCommits.push({
      order: nextRouteTraceOrder(),
      pathname: location.pathname,
      key: location.key,
    });
  }, [location.pathname, location.key]);
  React.useEffect(() => {
    const latest = committedRoutes.at(-1);
    if (!latest || latest.pathname !== location.pathname || latest.key !== location.key) {
      const committed = { pathname: location.pathname, key: location.key, order: nextRouteTraceOrder() };
      committedRoutes.push(committed);
      window.__canvasSaveDiagnosticRoute = location.pathname;
      for (let index = routeWaiters.length - 1; index >= 0; index -= 1) {
        const waiter = routeWaiters[index];
        if (waiter.pathname !== committed.pathname) continue;
        routeWaiters.splice(index, 1);
        clearTimeout(waiter.timeoutId);
        waiter.observation.outcome = 'resolved';
        waiter.observation.resolvedCommitOrder = committed.order;
        waiter.resolve(cloneFixtureValue(committed));
      }
    }
  }, [location.pathname, location.key]);
  window.__navigateCanvasSaveDiagnostic = (path) => navigate(path);
  return null;
}

const mount = (initialPath) => {
  const root = createRoot(document.getElementById('fixture-root'));
  root.render(React.createElement(MemoryRouter, { initialEntries: [initialPath] },
    React.createElement(React.Fragment, null,
      React.createElement(RouterControls),
      React.createElement(React.Profiler, { id: 'canvas-routes', onRender: recordRoutesProfilerCommit },
        React.createElement(Routes, null,
          React.createElement(Route, { path: '/canvas/:projectId', element: React.createElement(CanvasEditorPage) }))))));
  return root;
};
let root = mount('/canvas/' + localProjectId);
window.__remountCanvasSaveDiagnosticPage = () => {
  const path = window.__canvasSaveDiagnosticRoute || '/canvas/' + localProjectId;
  root.unmount();
  root = mount(path);
};
`;

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
    configFile: false,
    envFile: false,
    appType: 'custom',
    logLevel: 'silent',
    define: {
      'import.meta.env.VITE_CLOUDFLARE_AUTH_ENABLED': '"true"',
      'import.meta.env.VITE_CLOUDFLARE_API_ENABLED': '"true"',
      'import.meta.env.VITE_CLOUDFLARE_API_BASE_URL': '"https://canvas-save-diagnostic.invalid"',
    },
    esbuild: { jsx: 'automatic' },
    optimizeDeps: { include: ['react', 'react-dom/client'] },
    plugins: [{
      name: 'canvas-save-diagnostic-virtual-fixture',
      resolveId(source) {
        if (source === '/__canvas-save-diagnostic-fixture__.tsx') return '\0__canvas-save-diagnostic-fixture__.tsx';
        return null;
      },
      load(id) {
        if (id === '\0__canvas-save-diagnostic-fixture__.tsx') return fixtureEntrySource;
        return null;
      },
    }],
    server: { host: '127.0.0.1', port, strictPort: true },
  });
  let browser: Browser | null = null;
  try {
    await vite.listen();
    const address = vite.httpServer?.address();
    assert.ok(address && typeof address === 'object');
    const baseUrl = `http://127.0.0.1:${address.port}`;
    browser = await chromium.launch({ headless: true });
    const page = await browser.newPage({ serviceWorkers: 'block' });
    await page.route('**/*', (route) => {
      const requestUrl = new URL(route.request().url());
      if (requestUrl.origin === baseUrl && requestUrl.pathname === '/__canvas-save-diagnostic-test__') {
        return route.fulfill({
          status: 200,
          contentType: 'text/html',
          body: '<!doctype html><html><head><meta name="viewport" content="width=device-width, initial-scale=1"></head><body><div id="fixture-root"></div></body></html>',
        });
      }
      return requestUrl.origin === baseUrl ? route.continue() : route.abort();
    });
    await page.goto(`${baseUrl}/__canvas-save-diagnostic-test__`, { waitUntil: 'domcontentloaded' });
    await page.evaluate(async () => import('/__canvas-save-diagnostic-fixture__.tsx'));
    await page.getByTestId('canvas-save').waitFor({ state: 'visible' });
    await page.waitForFunction(() => document.querySelector('[data-testid="canvas-persistence-status"]')?.textContent?.includes('未保存'), undefined, { timeout: 6000 });
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

const readOriginalReceipt = (page: Page) => page.evaluate(() => (
  (window as any).__readOriginalCanvasSaveDiagnosticReceipt()
));

const waitForOriginalReceipt = async (page: Page) => {
  await page.waitForFunction(() => Boolean(
    (window as any).__readOriginalCanvasSaveDiagnosticReceipt?.(),
  ), undefined, { timeout: 6000 });
  return readOriginalReceipt(page);
};

const assertNoDiagnosticSecrets = (observed: string) => {
  for (const secret of [
    'fixture-secret-token',
    'fixture-secret-cookie',
    'fixture-secret-user',
    'fixture-secret-id',
    'fixture-secret-signature',
    'fixture-secret-code',
    'FixtureSecretError',
    'https://example.invalid',
    'FixtureSaveFailure',
  ]) assert.equal(observed.includes(secret), false, `diagnostic exposed ${secret}`);
};

test('Case A: actual CanvasEditorPage saves and commits the canonical route through the real MemoryRouter', async () => {
  const fixture = await createFixture();
  let pageErrorCount = 0;
  let consoleErrorCount = 0;
  const consoleErrorCategories = {
    'act-warning': 0,
    'navigate-outside-effect': 0,
    'suspense/lazy': 0,
    'max-update-depth': 0,
    'network/fetch': 0,
    'key/prop': 0,
    other: 0,
  };
  fixture.page.on('pageerror', () => { pageErrorCount += 1; });
  fixture.page.on('console', (message) => {
    if (message.type() !== 'error') return;
    consoleErrorCount += 1;
    const text = message.text();
    const category = /not wrapped in act|act\(\)/i.test(text) ? 'act-warning'
      : /navigate.{0,80}(effect|render)|(?:effect|render).{0,80}navigate|while rendering/i.test(text) ? 'navigate-outside-effect'
        : /suspend|suspense|lazy/i.test(text) ? 'suspense/lazy'
          : /maximum update depth|too many re-renders/i.test(text) ? 'max-update-depth'
            : /network|fetch|failed to load|net::/i.test(text) ? 'network/fetch'
              : /unique.{0,40}key|unknown prop|validateDOMNesting/i.test(text) ? 'key/prop'
                : 'other';
    consoleErrorCategories[category] += 1;
  });
  try {
    const before = await fixture.page.evaluate(() => (window as any).__canvasSaveDiagnosticState());
    assert.equal(before.navigatorInstalled, true);
    assert.equal(before.route, '/canvas/' + before.canvasId);
    await fixture.page.evaluate(() => (window as any).__setCanvasSaveDiagnosticMode('success'));
    await fixture.page.getByTestId('canvas-save').click();
    await fixture.page.waitForFunction(
      () => (window as any).__canvasSaveDiagnosticInputs?.create?.length === 1,
      undefined,
      { timeout: 6000 },
    );

    const afterCreate = await fixture.page.evaluate(() => (window as any).__canvasSaveDiagnosticState());
    assert.equal(afterCreate.calls.create, 1);
    const createInput = afterCreate.inputs.create[0];
    assert.ok(createInput.id);
    assert.equal(createInput.brand_id, before.auth.brandId);
    assert.equal(typeof createInput.title, 'string');
    assert.ok(createInput.snapshot && Array.isArray(createInput.snapshot.objects));

    const expectedPath = '/canvas/' + createInput.id;
    const committedRoute = await fixture.page.evaluate(
      (pathname) => (window as any).__waitForCanvasSaveDiagnosticRoute(pathname, 6000),
      expectedPath,
    );
    await fixture.page.waitForFunction(
      () => document.querySelector('[data-testid="canvas-persistence-status"]')?.textContent?.includes('サーバー確認済み'),
      undefined,
      { timeout: 6000 },
    );
    await fixture.page.evaluate(() => new Promise((resolve) => requestAnimationFrame(() => resolve(null))));

    const finalState = await fixture.page.evaluate(() => (window as any).__canvasSaveDiagnosticState());
    const serverDocument = finalState.serverDocument;
    const diagnosticAttribute = await fixture.page.getByTestId('canvas-save-diagnostic').getAttribute('data-receipt');
    assert.equal(committedRoute.pathname, expectedPath);
    assert.equal(finalState.route, expectedPath);
    assert.deepEqual(finalState.committedRoutes.map((entry: any) => entry.pathname), [before.route, expectedPath]);
    assert.notEqual(finalState.committedRoutes[0].key, finalState.committedRoutes[1].key);
    assert.equal(finalState.canvasId, createInput.id);
    assert.equal(diagnosticAttribute, '');
    assert.equal(finalState.calls.create, 1);
    assert.ok(finalState.calls.get >= 1);
    assert.ok(finalState.inputs.get.includes(createInput.id));
    assert.equal(finalState.calls.update, 0);
    assert.deepEqual(serverDocument, {
      id: createInput.id,
      ownerId: before.auth.userId,
      brandId: createInput.brand_id,
      title: createInput.title,
      snapshot: createInput.snapshot,
      snapshotVersion: 1,
      revision: 0,
      createdAt: serverDocument.createdAt,
      updatedAt: serverDocument.updatedAt,
    });
    assert.deepEqual(serverDocument.snapshot, createInput.snapshot);
    assert.deepEqual(
      { title: serverDocument.title, snapshot: serverDocument.snapshot },
      { title: createInput.title, snapshot: createInput.snapshot },
    );
  } finally {
    try {
      const capture = await fixture.page.evaluate(() => {
        const state = (window as any).__canvasSaveDiagnosticState();
        const createInput = state.inputs.create[0] ?? null;
        const createdId = createInput?.id ?? null;
        const classifyRoute = (pathname: string | null) => {
          if (!pathname) return 'unknown';
          if (pathname === '/canvas/canvas-save-diagnostic-local-project') return 'local';
          if (createdId && pathname === '/canvas/' + createdId) return 'created-id';
          return 'other';
        };
        const routeLog = state.committedRoutes.map((entry: any, index: number) => ({
          order: entry.order ?? index + 1,
          classification: classifyRoute(entry.pathname),
          keyChanged: index > 0 ? entry.key !== state.committedRoutes[index - 1].key : false,
        }));
        const classifyTarget = (target: any) => {
          const pathname = typeof target === 'string' ? target : target?.pathname ?? null;
          return classifyRoute(pathname);
        };
        const navigatorLog = state.navigatorCalls.map((call: any) => ({
          order: call.order,
          kind: call.kind === 'push' || call.kind === 'replace' ? call.kind : 'other',
          targetClassification: classifyTarget(call.target),
          locationAfterClassification: classifyRoute(call.locationAfter),
          returned: call.returned,
          threw: call.threw,
        }));
        const layoutCommitLog = state.layoutCommits.map((entry: any, index: number) => ({
          order: entry.order ?? index + 1,
          classification: classifyRoute(entry.pathname),
          keyChanged: index > 0 ? entry.key !== state.layoutCommits[index - 1].key : false,
        }));
        const profilerCommitLog = state.profilerCommits.map((entry: any) => ({
          order: entry.order,
          phase: entry.phase === 'mount' || entry.phase === 'update' || entry.phase === 'nested-update' ? entry.phase : 'other',
          classification: classifyRoute(entry.pathname),
          navigatorCallCountAtCommit: entry.navigatorCallCount,
        }));
        const profilerCommitsAfterEachNavigatorCall = navigatorLog.map((call: any, index: number) => ({
          navigatorCallOrder: call.order,
          profilerCommitCountAfterCall: profilerCommitLog.filter((commit: any) => commit.navigatorCallCount >= index + 1).length,
        }));
        const statusText = document.querySelector('[data-testid="canvas-persistence-status"]')?.textContent ?? '';
        const saveStatus = statusText.includes('サーバー確認済み') ? 'saved'
          : statusText.includes('保存中') ? 'saving'
            : statusText.includes('保存を確認中') ? 'verifying'
              : statusText.includes('競合') ? 'conflict'
                : statusText.includes('保存失敗') ? 'failed'
                  : statusText.includes('未保存') ? 'unsaved'
                    : statusText ? 'other' : 'missing';
        const diagnosticElement = document.querySelector('[data-testid="canvas-save-diagnostic"]');
        const rawDiagnostic = diagnosticElement?.getAttribute('data-receipt') ?? '';
        const allowedStages = ['validate', 'scope', 'id', 'cachedRead', 'retainDraft', 'hydrate', 'navigate', 'save', 'readback', 'finalize'];
        const allowedFlags = ['authMismatch', 'brandMismatch', 'canvasMismatch', 'routeMismatch', 'epochMismatch',
          'renderedBetween', 'routeRefIsCaptured', 'storeIsCaptured'];
        let diagnostic = { present: Boolean(rawDiagnostic), stage: null as string | null,
          contextRejected: null as boolean | null, mismatchFlags: null as Record<string, boolean | null> | null };
        if (rawDiagnostic) {
          try {
            const parsed = JSON.parse(rawDiagnostic);
            diagnostic = {
              present: true,
              stage: allowedStages.includes(parsed.stage) ? parsed.stage : 'other',
              contextRejected: typeof parsed.contextRejected === 'boolean' ? parsed.contextRejected : null,
              mismatchFlags: Object.fromEntries(allowedFlags.map((flag) => [
                flag, typeof parsed.contextMismatch?.[flag] === 'boolean' ? parsed.contextMismatch[flag] : null,
              ])),
            };
          } catch {
            diagnostic = { present: true, stage: 'unparseable', contextRejected: null, mismatchFlags: null };
          }
        }
        const serverDocument = state.serverDocument;
        const canvasReadiness = document.body.textContent?.includes('キャンバスを読み込み中')
          || document.body.textContent?.includes('派生ツリーを読み込み中') ? 'fallback'
          : document.querySelector('.konvajs-content, canvas') ? 'canvas-stage'
            : 'neither';
        const getOutcomes = state.getOutcomes.map((entry: any, index: number) => ({
          order: index + 1,
          idMatchesCreate: Boolean(createdId && entry.documentId === createdId),
          outcome: entry.outcome === 'canonical' || entry.outcome === 'not_found' ? entry.outcome : 'other',
        }));
        const canonicalRead = Boolean(createdId && state.getOutcomes.some((entry: any) =>
          entry.documentId === createdId && entry.outcome === 'canonical'));
        const route = state.route;
        const storeId = state.canvasId;
        return {
          navigatorInstalled: state.navigatorInstalled,
          navigatorLog,
          routeLog,
          layoutCommitLog,
          profilerCommitLog,
          profilerCommitsAfterEachNavigatorCall,
          routeWaits: state.routeWaitObservations.map((entry: any) => ({
            registrationOrder: entry.observation.registrationOrder,
            routeClassification: classifyRoute(entry.pathname),
            registeredAfterCommitCount: entry.observation.registeredAfterCommitCount,
            preexistingCommitOrder: entry.observation.preexistingCommitOrder,
            outcome: entry.observation.outcome,
            resolvedCommitOrder: entry.observation.resolvedCommitOrder,
          })),
          finalRouteClassification: classifyRoute(route),
          pageMounted: Boolean(document.querySelector('[data-testid="canvas-save"]')),
          finalRouteMatchesCreateId: Boolean(createdId && route === '/canvas/' + createdId),
          storeMatchesCreateId: Boolean(createdId && storeId === createdId),
          routeMatchesStore: Boolean(storeId && route === '/canvas/' + storeId),
          apiCounts: state.calls,
          createOutcome: state.createOutcome?.state === 'resolved' ? { state: 'resolved', errorName: null }
            : state.createOutcome?.state === 'rejected'
              ? { state: 'rejected', errorName: state.createOutcome.errorName === 'FixtureSecretError' ? 'FixtureSecretError' : 'OtherError' }
              : { state: state.createOutcome?.state ?? 'not_called', errorName: null },
          getOutcomes,
          canonicalReadbackObserved: canonicalRead,
          canonicalRecord: {
            exists: Boolean(serverDocument),
            idMatchesCreate: Boolean(createdId && serverDocument?.id === createdId),
            ownerMatchesFixture: Boolean(serverDocument?.ownerId === state.auth.userId),
            brandMatchesCreate: Boolean(createInput && serverDocument?.brandId === createInput.brand_id),
            titleMatchesCreate: Boolean(createInput && serverDocument?.title === createInput.title),
            snapshotMatchesCreate: Boolean(createInput && JSON.stringify(serverDocument?.snapshot) === JSON.stringify(createInput.snapshot)),
            revisionIsZero: serverDocument?.revision === 0,
          },
          visibleSaveStatus: saveStatus,
          canvasReadiness,
          diagnostic,
        };
      });
      console.log('CANVAS_CASE_A_TERMINAL_CAPTURE', JSON.stringify({
        ...capture,
        pageErrorCount,
        consoleErrorCount,
        consoleErrorCategories,
      }));
    } catch {
      console.log('CANVAS_CASE_A_TERMINAL_CAPTURE', JSON.stringify({
        captureAvailable: false,
        pageErrorCount,
        consoleErrorCount,
        consoleErrorCategories,
      }));
    }
    try {
      const lazyProbe = await fixture.page.evaluate(async () => {
        let timeoutId: number | null = null;
        try {
          await Promise.race([
            import('/src/components/canvas/InfiniteCanvas.tsx'),
            new Promise((_, reject) => {
              timeoutId = window.setTimeout(() => reject(new Error('post_terminal_lazy_probe_timeout')), 6000);
            }),
          ]);
          return 'resolved';
        } catch (error) {
          return error instanceof Error && error.message === 'post_terminal_lazy_probe_timeout' ? 'timeout' : 'rejected';
        } finally {
          if (timeoutId !== null) window.clearTimeout(timeoutId);
        }
      });
      console.log('CANVAS_POST_TERMINAL_LAZY_PROBE', JSON.stringify({ outcome: lazyProbe }));
    } catch {
      console.log('CANVAS_POST_TERMINAL_LAZY_PROBE', JSON.stringify({ outcome: 'unavailable' }));
    }
    await fixture.close();
  }
});

test('Case B: actual save error is reached and secret-shaped details stay redacted', async () => {
  const fixture = await createFixture();
  try {
    const consoleLines: string[] = [];
    const warnings: string[] = [];
    fixture.page.on('console', (message) => {
      if (message.type() === 'warning' || message.type() === 'error') consoleLines.push(message.text());
      if (message.type() === 'warning' && message.text().startsWith('[canvas-save-diagnostic]')) warnings.push(message.text());
    });
    const before = await fixture.page.evaluate(() => (window as any).__canvasSaveDiagnosticState());
    assert.equal(before.navigatorInstalled, true);
    await fixture.page.evaluate(() => (window as any).__setCanvasSaveDiagnosticMode('error'));
    await fixture.page.getByTestId('canvas-save').click();
    await fixture.page.waitForFunction(() => (window as any).__canvasSaveDiagnosticInputs?.create?.length === 1, undefined, { timeout: 6000 });
    const receipt = await waitForOriginalReceipt(fixture.page);
    const rawReceipt = await fixture.page.getByTestId('canvas-save-diagnostic').getAttribute('data-receipt');
    const state = await fixture.page.evaluate(() => (window as any).__canvasSaveDiagnosticState());
    const visibleText = await fixture.page.locator('body').innerText();
    assert.ok(rawReceipt);
    assert.equal(state.calls.create, 1, 'the injected transport error must be reached');
    assert.equal(state.createOutcome.state, 'rejected');
    assert.equal(state.calls.update, 0);
    assert.equal(receipt.stage, 'save');
    assert.equal(receipt.idSource, 'derived');
    assert.equal(receipt.contextRejected, false);
    assert.equal(receipt.errorName, 'UnknownError');
    assert.equal(receipt.knownCode, null);
    assert.equal(receipt.httpStatus, 409);
    assert.equal(receipt.hasPendingEntry, true);
    assert.equal(receipt.baseRevisionPresent, false);
    assert.equal(warnings.length, 1);
    assert.match(warnings[0], /^\[canvas-save-diagnostic\]/);
    assertNoDiagnosticSecrets(`${rawReceipt}\n${warnings.join('\n')}\n${consoleLines.join('\n')}\n${visibleText}`);
  } finally {
    await fixture.close();
  }
});

test('Case C: a same-scope rerender during the held read does not reject the in-flight save', async () => {
  const fixture = await createFixture();
  try {
    const before = await fixture.page.evaluate(() => (window as any).__canvasSaveDiagnosticState());
    await fixture.page.evaluate(() => {
      (window as any).__setCanvasSaveDiagnosticMode('success');
      (window as any).__armCanvasSaveDiagnosticGetGate();
    });
    await fixture.page.getByTestId('canvas-save').click();
    await fixture.page.waitForFunction(() => (window as any).__canvasSaveDiagnosticGateEntered === true, undefined, { timeout: 6000 });

    const priorProfilerCommits = await fixture.page.evaluate(() => (
      (window as any).__forceCanvasSaveDiagnosticSameScopeRerender()
    ));
    await fixture.page.waitForFunction((priorCount) => (
      (window as any).__canvasSaveDiagnosticState().profilerCommits.length > priorCount
    ), priorProfilerCommits, { timeout: 6000 });
    const whileHeld = await fixture.page.evaluate(() => (window as any).__canvasSaveDiagnosticState());
    const heldDocumentId = whileHeld.inputs.get[0];
    assert.ok(heldDocumentId, 'the held actual GET identifies the current save destination');
    const heldRoute = '/canvas/' + heldDocumentId;
    const heldCommit = await fixture.page.evaluate((path) => (
      (window as any).__waitForCanvasSaveDiagnosticRoute(path, 6000)
    ), heldRoute);
    const afterHeldCommit = await fixture.page.evaluate(() => (window as any).__canvasSaveDiagnosticState());
    assert.deepEqual(whileHeld.auth, before.auth);
    assert.equal(heldCommit.pathname, heldRoute);
    assert.equal(afterHeldCommit.route, heldRoute);
    assert.equal(afterHeldCommit.calls.create, 0);
    await fixture.page.evaluate(() => (window as any).__releaseCanvasSaveDiagnosticGetGate());

    await fixture.page.waitForFunction(() => (window as any).__canvasSaveDiagnosticInputs?.create?.length === 1, undefined, { timeout: 6000 });
    const createInput = await fixture.page.evaluate(() => (window as any).__canvasSaveDiagnosticInputs.create[0]);
    const expectedRoute = '/canvas/' + createInput.id;
    const committed = await fixture.page.evaluate((path) => (
      (window as any).__waitForCanvasSaveDiagnosticRoute(path, 6000)
    ), expectedRoute);
    await fixture.page.waitForFunction(
      () => document.querySelector('[data-testid="canvas-persistence-status"]')?.textContent?.includes('サーバー確認済み'),
      undefined,
      { timeout: 6000 },
    );
    const after = await fixture.page.evaluate(() => (window as any).__canvasSaveDiagnosticState());
    const pathnames = after.committedRoutes.map((entry: any) => entry.pathname);
    const keys = after.committedRoutes.map((entry: any) => entry.key);
    const tail = pathnames.slice(1);
    const replaceCalls = after.navigatorCalls.filter((call: any) => call.kind === 'replace');
    const pushCalls = after.navigatorCalls.filter((call: any) => call.kind === 'push');
    const routeEvidence = JSON.stringify({
      pathnames,
      keys,
      navigatorCalls: after.navigatorCalls.map((call: any) => ({
        kind: call.kind,
        targetPathname: call.target?.pathname ?? null,
        returned: call.returned,
        threw: call.threw,
      })),
    });
    const finalCreateInput = after.inputs.create[0];
    assert.equal(committed.pathname, expectedRoute);
    assert.equal(after.route, expectedRoute);
    assert.equal(pathnames[0], before.route, routeEvidence);
    assert.ok(tail.length >= 1 && tail.length <= replaceCalls.length, routeEvidence);
    assert.ok(tail.every((pathname: string) => pathname === expectedRoute), routeEvidence);
    assert.equal(keys[0], before.committedRoutes[0].key, routeEvidence);
    assert.ok(keys.slice(1).every((key: string) => key !== keys[0]), routeEvidence);
    assert.equal(replaceCalls.length, 2, routeEvidence);
    assert.equal(pushCalls.length, 0, routeEvidence);
    assert.ok(replaceCalls.every((call: any) => call.target?.pathname === expectedRoute && call.returned && !call.threw), routeEvidence);
    assert.deepEqual(after.auth, before.auth);
    assert.equal(finalCreateInput.id, expectedRoute.slice('/canvas/'.length));
    assert.equal(after.canvasId, finalCreateInput.id);
    assert.equal(after.serverDocument.id, finalCreateInput.id);
    assert.equal(after.serverDocument.revision, 0);
    assert.ok(after.inputs.get.includes(finalCreateInput.id));
    assert.ok(after.getOutcomes.some((entry: any) => entry.documentId === finalCreateInput.id && entry.outcome === 'canonical'));
    assert.equal(after.calls.create, 1);
    assert.equal(after.calls.update, 0);
    assert.equal(after.createOutcome.state, 'resolved');
  } finally {
    await fixture.close();
  }
});

for (const kind of ['user', 'brand', 'route'] as const) {
  test(`Case D: actual CanvasEditorPage rejects a ${kind} context change during the held read with no adopted write`, async () => {
    const fixture = await createFixture();
    try {
      await fixture.page.evaluate(() => (window as any).__armCanvasSaveDiagnosticGetGate());
      await fixture.page.getByTestId('canvas-save').click();
      await fixture.page.waitForFunction(() => (window as any).__canvasSaveDiagnosticGateEntered === true, undefined, { timeout: 6000 });

      if (kind === 'route') {
        const targetRoute = '/canvas/canvas-save-diagnostic-route-switch';
        await fixture.page.evaluate((path) => (window as any).__navigateCanvasSaveDiagnostic(path), targetRoute);
        await fixture.page.evaluate((path) => (window as any).__waitForCanvasSaveDiagnosticRoute(path, 6000), targetRoute);
      } else {
        await fixture.page.evaluate((changeKind) => (window as any).__changeCanvasSaveDiagnosticScope(changeKind), kind);
      }
      await fixture.page.evaluate(() => (window as any).__releaseCanvasSaveDiagnosticGetGate());
      const receipt = await waitForOriginalReceipt(fixture.page);
      const state = await fixture.page.evaluate(() => (window as any).__canvasSaveDiagnosticState());

      assert.equal(receipt.contextRejected, true);
      assert.ok(receipt.contextMismatch);
      if (kind === 'user') {
        assert.equal(receipt.contextMismatch.authMismatch, true);
        assert.equal(receipt.contextMismatch.brandMismatch, false);
      } else if (kind === 'brand') {
        assert.equal(receipt.contextMismatch.authMismatch, true);
        assert.equal(receipt.contextMismatch.brandMismatch, true);
      } else {
        assert.equal(receipt.contextMismatch.authMismatch, false);
        assert.equal(receipt.contextMismatch.routeMismatch, true);
        assert.equal(receipt.contextMismatch.routeRefIsCaptured, false);
      }
      assert.equal(state.calls.create, 0);
      assert.equal(state.calls.update, 0);
      assert.equal(receipt.hasPendingEntry, false);
      const documentId = state.inputs.get[0];
      if (documentId) {
        const recovery = await fixture.page.evaluate((id) => (window as any).__readCanvasSaveDiagnosticRecovery(id), documentId);
        assert.equal(recovery?.pending ?? null, null);
      }
      if (kind !== 'route') {
        assert.equal(await fixture.page.getByTestId('canvas-save-diagnostic').getAttribute('data-receipt'), '');
      }
    } finally {
      await fixture.close();
    }
  });
}

test('Case E: a committed create with a lost response reconciles the same pending identity without another create', async () => {
  const fixture = await createFixture();
  try {
    const before = await fixture.page.evaluate(() => (window as any).__canvasSaveDiagnosticState());
    await fixture.page.evaluate(() => (window as any).__setCanvasSaveDiagnosticMode('lost-response'));
    await fixture.page.getByTestId('canvas-save').click();
    await fixture.page.waitForFunction(() => (window as any).__canvasSaveDiagnosticInputs?.create?.length === 1, undefined, { timeout: 6000 });
    await fixture.page.waitForFunction(
      () => document.querySelector('[data-testid="canvas-persistence-status"]')?.textContent?.includes('サーバー確認済み'),
      undefined,
      { timeout: 6000 },
    );

    const afterCreateObserved = await fixture.page.evaluate(() => (window as any).__canvasSaveDiagnosticState());
    const createInput = afterCreateObserved.inputs.create[0];
    const originalPending = afterCreateObserved.pendingAtCreate[0];
    const expectedRoute = '/canvas/' + createInput.id;
    const committedRoute = await fixture.page.evaluate((path) => (
      (window as any).__waitForCanvasSaveDiagnosticRoute(path, 6000)
    ), expectedRoute);
    const afterFirstSave = await fixture.page.evaluate(() => (window as any).__canvasSaveDiagnosticState());
    assert.equal(afterFirstSave.calls.create, 1);
    assert.equal(afterFirstSave.calls.update, 0);
    assert.equal(afterFirstSave.createOutcome.state, 'lost_response');
    assert.equal(originalPending.documentId, createInput.id);
    assert.equal(originalPending.kind, 'create');
    assert.equal(originalPending.expectedRevision, null);
    assert.equal(originalPending.title, createInput.title);
    assert.deepEqual(originalPending.snapshot, createInput.snapshot);
    assert.ok(afterFirstSave.getOutcomes.some((entry: any) => entry.outcome === 'canonical'));
    assert.equal(committedRoute.pathname, expectedRoute);
    assert.equal(afterFirstSave.route, expectedRoute);
    assert.deepEqual(afterFirstSave.committedRoutes.map((entry: any) => entry.pathname), [before.route, expectedRoute]);

    const recoveryAfterReconcile = await fixture.page.evaluate((id) => (
      (window as any).__readCanvasSaveDiagnosticRecovery(id)
    ), createInput.id);
    assert.equal(recoveryAfterReconcile.documentId, originalPending.documentId);
    assert.equal(recoveryAfterReconcile.revision, 0);
    assert.equal(recoveryAfterReconcile.pending, null);
    assert.equal(recoveryAfterReconcile.title, createInput.title);
    assert.deepEqual(recoveryAfterReconcile.snapshot, createInput.snapshot);

    await fixture.page.evaluate(() => (window as any).__remountCanvasSaveDiagnosticPage());
    await fixture.page.getByTestId('canvas-save').waitFor({ state: 'visible' });
    await fixture.page.waitForFunction(
      () => document.querySelector('[data-testid="canvas-persistence-status"]')?.textContent?.includes('サーバー確認済み'),
      undefined,
      { timeout: 6000 },
    );
    const afterRemount = await fixture.page.evaluate(() => (window as any).__canvasSaveDiagnosticState());
    assert.equal(afterRemount.route, expectedRoute);
    assert.equal(afterRemount.calls.create, 1, 'remount must not replay a completed write');

    await fixture.page.getByTestId('canvas-save').click();
    await fixture.page.waitForFunction(
      () => document.querySelector('[data-testid="canvas-persistence-status"]')?.textContent?.includes('サーバー確認済み'),
      undefined,
      { timeout: 6000 },
    );
    const afterExplicitRetry = await fixture.page.evaluate(() => (window as any).__canvasSaveDiagnosticState());
    assert.equal(afterExplicitRetry.calls.create, 1, 'explicit reconciliation must not duplicate the canonical create');
    assert.equal(afterExplicitRetry.calls.update, 0);
    assert.equal(afterExplicitRetry.route, expectedRoute, 'local route effects must not overwrite the saved route');
    assert.equal(afterExplicitRetry.canvasId, createInput.id);
    assert.deepEqual(afterExplicitRetry.pendingAtCreate[0], originalPending);
  } finally {
    await fixture.close();
  }
});

test('Case F: double-click and remount preserve one pending identity; explicit retry does not auto-replay', async () => {
  const fixture = await createFixture();
  try {
    await fixture.page.evaluate(() => {
      (window as any).__setCanvasSaveDiagnosticMode('lost-not-found');
      (window as any).__armCanvasSaveDiagnosticGetGate();
    });
    await fixture.page.getByTestId('canvas-save').click();
    await fixture.page.waitForFunction(() => (window as any).__canvasSaveDiagnosticGateEntered === true, undefined, { timeout: 6000 });
    await fixture.page.evaluate(() => {
      const button = document.querySelector('[data-testid="canvas-save"]');
      if (!(button instanceof HTMLButtonElement)) throw new Error('fixture_save_button_missing');
      button.dispatchEvent(new MouseEvent('click', { bubbles: true }));
      button.dispatchEvent(new MouseEvent('click', { bubbles: true }));
    });
    const whileHeld = await fixture.page.evaluate(() => (window as any).__canvasSaveDiagnosticState());
    assert.equal(whileHeld.calls.get, 1);
    assert.equal(whileHeld.calls.create, 0);
    await fixture.page.evaluate(() => (window as any).__releaseCanvasSaveDiagnosticGetGate());
    await fixture.page.waitForFunction(() => (window as any).__canvasSaveDiagnosticInputs?.create?.length === 1, undefined, { timeout: 6000 });
    const receipt = await waitForOriginalReceipt(fixture.page);
    assert.equal(receipt.contextRejected, false);
    assert.equal(receipt.hasPendingEntry, true);

    const firstAttempt = await fixture.page.evaluate(() => (window as any).__canvasSaveDiagnosticState());
    const createInput = firstAttempt.inputs.create[0];
    const originalPending = firstAttempt.pendingAtCreate[0];
    assert.equal(firstAttempt.calls.create, 1, 'repeated click events while save is active must not start another write');
    assert.equal(firstAttempt.createOutcome.state, 'rejected');
    assert.equal(originalPending.documentId, createInput.id);
    assert.equal(originalPending.kind, 'create');
    assert.equal(originalPending.expectedRevision, null);
    assert.deepEqual(originalPending.snapshot, createInput.snapshot);
    const pendingBeforeRemount = await fixture.page.evaluate((id) => (
      (window as any).__readCanvasSaveDiagnosticRecovery(id)
    ), createInput.id);
    assert.equal(pendingBeforeRemount.pending.writeId, originalPending.writeId);

    await fixture.page.evaluate(() => (window as any).__remountCanvasSaveDiagnosticPage());
    await fixture.page.getByTestId('canvas-save').waitFor({ state: 'visible' });
    await fixture.page.waitForFunction(() => {
      const status = document.querySelector('[data-testid="canvas-persistence-status"]')?.textContent ?? '';
      return status.includes('未保存') || status.includes('保存失敗') || status.includes('競合') || status.includes('サーバー確認済み');
    }, undefined, { timeout: 6000 });
    const afterRemount = await fixture.page.evaluate(() => (window as any).__canvasSaveDiagnosticState());
    const pendingAfterRemount = await fixture.page.evaluate((id) => (
      (window as any).__readCanvasSaveDiagnosticRecovery(id)
    ), createInput.id);
    assert.equal(afterRemount.calls.create, 1, 'remount must not replay an uncertain write');
    assert.equal(pendingAfterRemount.pending.writeId, originalPending.writeId);
    assert.equal(pendingAfterRemount.pending.documentId ?? pendingAfterRemount.documentId, createInput.id);
    assert.deepEqual(pendingAfterRemount.pending.snapshot, originalPending.snapshot);

    await fixture.page.evaluate((id) => (window as any).__publishCanvasSaveDiagnosticPending(id), createInput.id);
    await fixture.page.getByTestId('canvas-save').click();
    await fixture.page.waitForFunction(
      () => document.querySelector('[data-testid="canvas-persistence-status"]')?.textContent?.includes('サーバー確認済み'),
      undefined,
      { timeout: 6000 },
    );
    const finalState = await fixture.page.evaluate(() => (window as any).__canvasSaveDiagnosticState());
    const finalRecovery = await fixture.page.evaluate((id) => (
      (window as any).__readCanvasSaveDiagnosticRecovery(id)
    ), createInput.id);
    assert.equal(finalState.calls.create, 1, 'explicit retry must reconcile the late canonical record without another create');
    assert.equal(finalState.calls.update, 0);
    assert.equal(finalState.route, '/canvas/' + createInput.id);
    assert.equal(finalState.canvasId, createInput.id);
    assert.equal(finalRecovery.pending, null);
    assert.equal(finalRecovery.revision, 0);
    assert.equal(finalState.pendingAtCreate.length, 1);
    assert.equal(finalState.pendingAtCreate[0].writeId, originalPending.writeId);
  } finally {
    await fixture.close();
  }
});
