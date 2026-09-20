#!/usr/bin/env node

import fs from 'node:fs';
import { createHash } from 'node:crypto';
import path from 'node:path';
import { spawn } from 'node:child_process';
import { chromium } from '@playwright/test';

const args = parseArgs(process.argv.slice(2));
const baseUrl = trimTrailingSlash(args.baseUrl || process.env.HEAVY_CHAIN_BASE_URL || 'http://127.0.0.1:4173');
const authStatePath = args.authState || process.env.HEAVY_CHAIN_AUTH_STATE || 'output/playwright/prod-auth-refresh-20260625/auth-state.json';
const outDir = args.out || `output/playwright/g603-garment-layer-canvas-${dateStamp()}`;
const canvasStoreKey = 'heavy-chain-canvas';
const viewport = { width: 1440, height: 1050 };
const localPreview = isLocalPreview(baseUrl);
const fixturePng =
  'iVBORw0KGgoAAAANSUhEUgAAASwAAACWCAIAAADrOSKFAAABfklEQVR4nO3VwQ2DMBQFQYp2/6mOBtYiHhSg2R+TR6VJ4FD3Yh8nAAAAAAAAAAAAAAAAAAAAAACwq3n7vQG8Lr3f93nP8xz7B2z67bLvG7BXn8z3/V6f8yP4nff4+v0G7NVd9j7f6wN4u9QzAAAAAAAAAAAAAAAAAADgT2EDAiwIsCDAggALAiysx8O+vV6vR3e73V6vV6vR6fP5/PL5fL1eL5fL5fL5fL5fK9Xq9Xq9Xq9Xq9Xq9Xq8vLy8vLy8vLy8vLy8vLy8vLy8vLy8vLy8vLy8vLy8vLy8vLw8Pj4+Pj4+Pj4+Pj4+Pj4+Pj4+Pj4+Pj4+Pj4+Pj4+Pj4+Pj4+Pg8PDw8PDw8PDw8PDw8PDw8PDw8PDw8PDw8PDw8PDw8PDw8PDw+Pj4+Pj4+Pj4+Pj4+Pj4+Pj4+Pj4+Pj4+Pj4+Pj4+Pj4+Pj4+Px8fn5+fn5+fn5+fn5+fn5+fn5+fn5+fn5+fn5+fn5+fn5+fn5+fAAAAAAAAAAAAAAAAAAAAAAD4O8EGAiwIsCDAggALAiysQw4oEJQ4AAAAAElFTkSuQmCC';

fs.mkdirSync(outDir, { recursive: true });
const uploadPath = path.join(outDir, 'g603-garment-upload.png');
const fixtureBytes = Buffer.from(fixturePng, 'base64');
const expectedFixtureSha256 = createHash('sha256').update(fixtureBytes).digest('hex');
const expectedFixtureRevision = `sha256:${expectedFixtureSha256}`;
fs.writeFileSync(uploadPath, fixtureBytes);

let previewProcess = null;
let browser = null;
let context = null;

const evidence = {
  workflow: 'g603-garment-cut-layer-canvas',
  capturedAt: new Date().toISOString(),
  baseUrl,
  authState: localPreview ? 'local-proof-jwt' : authStatePath,
  outDir,
  uploadPath,
  screenshots: {},
  video: null,
  download: null,
  consoleMessages: [],
  pageErrors: [],
  requestFailures: [],
  assertions: [],
  cleanup: {
    contextClosed: false,
    browserClosed: false,
    previewStopped: false,
  },
};

try {
  if (localPreview) {
    previewProcess = await startPreviewServer(baseUrl);
  }

  if (!localPreview && !fs.existsSync(authStatePath)) {
    throw new Error(`auth_state_missing:${authStatePath}`);
  }

  browser = await chromium.launch({ headless: true });
  context = await browser.newContext({
    ...(localPreview ? {} : { storageState: buildStorageStateForBaseUrl(authStatePath, baseUrl) }),
    viewport,
    acceptDownloads: true,
    recordVideo: {
      dir: path.join(outDir, 'videos'),
      size: viewport,
    },
  });
  if (localPreview) {
    await installLocalRequestGuard(context, baseUrl);
    await installLocalProofAuth(context);
    await installLocalCloudflareMocks(context);
  }

  const page = await context.newPage();
  wirePageDiagnostics(page, 'g603');

  await page.goto(`${baseUrl}/lightchain/fitting-clothing-reference`, { waitUntil: 'networkidle' });
  await dismissBlockingOverlays(page);
  await page.evaluate((key) => window.localStorage.removeItem(key), canvasStoreKey);
  await page.screenshot({ path: path.join(outDir, '01-lightchain-home.png'), fullPage: true });
  evidence.screenshots.home = path.join(outDir, '01-lightchain-home.png');

  const fittingHeading = page.getByRole('heading', { name: 'AIフィッティング' }).first();
  const garmentImageText = page.getByText(/衣服の画像/).first();
  await fittingHeading.waitFor({ state: 'visible', timeout: 10_000 });
  await garmentImageText.waitFor({ state: 'visible', timeout: 10_000 });
  addAssertion('garment_reference_workbench_direct_route_visible', page.url().includes('/lightchain/fitting-clothing-reference') && await fittingHeading.isVisible() && await garmentImageText.isVisible());
  await uploadMaterialAndWaitForMaskControls(page, uploadPath);
  const maskControls = page.locator('[data-testid="lightchain-fitting-mask-controls"]');
  await maskControls
    .getByRole('button', { name: '手動マスク', exact: true })
    .click();
  const layerControls = page.locator('[data-testid="lightchain-fitting-layer-controls"]');
  await openDetails(layerControls, 'レイヤー詳細');
  const printLayerClicked = await clickFirstVisible(page, layerControls, [/プリント/]);
  if (!printLayerClicked) throw new Error('print_layer_button_missing');
  const placementSelect = layerControls.locator('select').first();
  await placementSelect.selectOption({ label: '背面大判' });
  if (await placementSelect.inputValue() !== '背面大判') throw new Error('placement_select_failed');
  const noteInput = page.getByLabel(/参考|条件|メモ/).first();
  if (await noteInput.isVisible({ timeout: 1000 }).catch(() => false)) {
    await noteInput.fill('G603 proof: garment recognized, manual mask, print layer on back large placement.');
  }
  await page.screenshot({ path: path.join(outDir, '02-garment-workbench-configured.png'), fullPage: true });
  evidence.screenshots.configured = path.join(outDir, '02-garment-workbench-configured.png');

  const canvasSaveButton = page.locator('[data-testid="lightchain-fitting-canvas-save"]');
  const canvasSaveCount = await canvasSaveButton.count();
  const canvasSaveVisible = canvasSaveCount === 1 && await canvasSaveButton.isVisible();
  const canvasSaveEnabled = canvasSaveVisible && await canvasSaveButton.isEnabled();
  addAssertion('canvas_save_button_direct_test_id_ready', canvasSaveCount === 1 && canvasSaveVisible && canvasSaveEnabled, {
    count: canvasSaveCount,
    visible: canvasSaveVisible,
    enabled: canvasSaveEnabled,
  });
  if (!canvasSaveEnabled) throw new Error('canvas_save_button_not_ready');
  await canvasSaveButton.click();
  await page.waitForURL(/\/canvas\//, { timeout: 20_000 });
  await page.waitForTimeout(1500);
  await page.screenshot({ path: path.join(outDir, '03-canvas-after-save.png'), fullPage: true });
  evidence.screenshots.canvas = path.join(outDir, '03-canvas-after-save.png');

  addAssertion('canvas_route_opened', /\/canvas\//.test(page.url()), { url: page.url() });
  const canvasAfterSave = await waitForRenderedCanvasImages(page, 'after_save');
  await selectMaterialAndOpenProperties(page, canvasAfterSave, 'before_reload');

  await page.reload({ waitUntil: 'networkidle' });
  await page.waitForTimeout(1500);
  const canvasAfterReload = await waitForRenderedCanvasImages(page, 'after_reload');
  await selectMaterialAndOpenProperties(page, canvasAfterReload, 'after_reload');

  const body = await bodyText(page);
  fs.writeFileSync(path.join(outDir, '03-canvas-body.txt'), body);
  const storage = await page.evaluate((key) => window.localStorage.getItem(key), canvasStoreKey);
  const parsedStorage = storage ? JSON.parse(storage) : null;
  fs.writeFileSync(path.join(outDir, '03-canvas-storage.json'), `${JSON.stringify(parsedStorage, null, 2)}\n`);

  const currentObjects = Array.isArray(parsedStorage?.state?.objects) ? parsedStorage.state.objects : [];
  const materialObject = currentObjects.find((object) => object?.metadata?.feature === 'lightchain-fitting-clothing-reference-material-reference');
  const overlayObject = currentObjects.find((object) => object?.metadata?.feature === 'lightchain-fitting-clothing-reference-overlay-layer');
  const overlayParameters = overlayObject?.metadata?.parameters ?? {};
  const materialMetadata = materialObject?.metadata ?? {};
  const materialParameters = {
    ...(materialMetadata.parameters ?? {}),
    sourceIdentity: materialMetadata.sourceIdentity,
    sourceRevision: materialMetadata.sourceRevision,
    sourceReadback: materialMetadata.sourceReadback,
    persistenceStatus: materialMetadata.persistenceStatus,
  };

  addAssertion('properties_panel_shows_material_layer_info', body.includes('素材・レイヤー情報') && body.includes('認識素材') && body.includes('編集設計'));
  addAssertion('material_object_saved', Boolean(materialObject?.id), { id: materialObject?.id ?? null });
  addAssertion('overlay_object_saved', Boolean(overlayObject?.id), { id: overlayObject?.id ?? null });
  addAssertion('overlay_links_to_material', Boolean(overlayObject?.derivedFrom && overlayObject.derivedFrom === materialObject?.id), {
    derivedFrom: overlayObject?.derivedFrom ?? null,
    materialId: materialObject?.id ?? null,
  });
  addAssertion('cut_mode_applied_to_canvas_png', materialParameters.processedImageKind === 'masked-transparent-png' && typeof materialObject?.src === 'string' && materialObject.src.startsWith('local-canvas-asset://') && materialObject.src.length > 'local-canvas-asset://'.length, {
    processedImageKind: materialParameters.processedImageKind ?? null,
    srcPrefix: materialObject?.src?.slice(0, 22) ?? null,
  });
  addAssertion('canvas_source_identity_hash_matches_fixture', materialParameters.sourceIdentity?.hash === expectedFixtureSha256, {
    expectedHash: expectedFixtureSha256,
    actualHash: materialParameters.sourceIdentity?.hash ?? null,
  });
  addAssertion('canvas_source_revision_hash_matches_fixture', materialParameters.sourceRevision?.hash === expectedFixtureSha256, {
    expectedHash: expectedFixtureSha256,
    actualHash: materialParameters.sourceRevision?.hash ?? null,
  });
  addAssertion('canvas_source_revision_matches_fixture', materialParameters.sourceRevision?.revision === expectedFixtureRevision, {
    expectedRevision: expectedFixtureRevision,
    actualRevision: materialParameters.sourceRevision?.revision ?? null,
  });
  addAssertion('canvas_source_readback_consistent', materialParameters.sourceReadback?.sourceIdentity?.hash === materialParameters.sourceIdentity?.hash
    && materialParameters.sourceReadback?.hash === materialParameters.sourceRevision?.hash
    && materialParameters.sourceReadback?.revision === materialParameters.sourceRevision?.revision
    && materialParameters.sourceReadback?.status === 'verified', {
    sourceIdentityHash: materialParameters.sourceIdentity?.hash ?? null,
    sourceRevisionHash: materialParameters.sourceRevision?.hash ?? null,
    sourceRevision: materialParameters.sourceRevision?.revision ?? null,
    readback: materialParameters.sourceReadback ?? null,
  });
  addAssertion('canvas_source_persistence_status_persistent', materialParameters.persistenceStatus === 'persistent', {
    persistenceStatus: materialParameters.persistenceStatus ?? null,
  });
  addAssertion('placement_changes_overlay_position', overlayObject?.x === 220 && overlayObject?.y === 285 && (overlayObject?.fontSize ?? 0) >= 24, {
    x: overlayObject?.x ?? null,
    y: overlayObject?.y ?? null,
    fontSize: overlayObject?.fontSize ?? null,
  });
  addAssertion('material_metadata_has_reference_layer_mask_preview', hasStructuredMaterialParameters(materialParameters), {
    materialReference: materialParameters.materialReference ?? null,
    layerPlan: materialParameters.layerPlan ?? null,
    maskPlan: materialParameters.maskPlan ?? null,
    compositionPreview: materialParameters.compositionPreview ?? null,
  });
  addAssertion('overlay_metadata_has_reference_layer_mask_preview', hasStructuredMaterialParameters(overlayParameters), {
    materialReference: overlayParameters.materialReference ?? null,
    layerPlan: overlayParameters.layerPlan ?? null,
    maskPlan: overlayParameters.maskPlan ?? null,
    compositionPreview: overlayParameters.compositionPreview ?? null,
  });

  const downloadPromise = page.waitForEvent('download', { timeout: 12_000 });
  await page.locator('button[title="エクスポート"]').first().click();
  const download = await downloadPromise;
  const exportPath = path.join(outDir, 'g603-canvas-export.png');
  await download.saveAs(exportPath);
  const exportBytes = fs.statSync(exportPath).size;
  evidence.download = exportPath;
  addAssertion('png_export_downloaded', exportBytes > 1000, { exportPath, exportBytes });

  evidence.video = await closePageAndGetVideo(page);
  addAssertion('video_recorded', Boolean(evidence.video), { video: evidence.video });
} catch (error) {
  evidence.exactBlocker = error.message;
  addAssertion('route_exception_free', false, { error: error.message });
} finally {
  if (context) {
    await withTimeout(context.close(), 10000, 'context_close_timeout')
      .then(() => {
        evidence.cleanup.contextClosed = true;
      })
      .catch((error) => {
        evidence.cleanup.contextCloseBlocker = error.message;
      });
  }
  if (browser) {
    await withTimeout(browser.close(), 30000, 'browser_close_timeout')
      .then(() => {
        evidence.cleanup.browserClosed = true;
      })
      .catch((error) => {
        evidence.cleanup.browserCloseBlocker = error.message;
      });
  }
  if (previewProcess) {
    previewProcess.kill('SIGTERM');
    evidence.cleanup.previewStopped = true;
  } else {
    evidence.cleanup.previewStopped = true;
  }
}

evidence.ok = evidence.assertions.every((assertion) => assertion.passed)
  && evidence.cleanup.contextClosed
  && evidence.cleanup.browserClosed
  && evidence.cleanup.previewStopped
  && evidence.consoleMessages.length === 0
  && evidence.pageErrors.length === 0
  && evidence.requestFailures.length === 0;
evidence.failed = evidence.assertions.filter((assertion) => !assertion.passed).map((assertion) => assertion.name);
fs.writeFileSync(path.join(outDir, 'SUMMARY.json'), `${JSON.stringify(evidence, null, 2)}\n`);
console.log(JSON.stringify({ ok: evidence.ok, summaryPath: path.join(outDir, 'SUMMARY.json'), failed: evidence.failed }, null, 2));
process.exit(evidence.ok ? 0 : 1);

function hasStructuredMaterialParameters(parameters) {
  return Boolean(
    parameters?.materialReference?.materialKind
      && parameters?.materialReference?.maskMode
      && parameters?.layerPlan?.activeLayer
      && parameters?.layerPlan?.placement
      && parameters?.maskPlan?.mode
      && parameters?.maskPlan?.appliedToCanvasImage === true
      && parameters?.compositionPreview?.summary,
  );
}

function addAssertion(name, passed, details = {}) {
  evidence.assertions.push({ name, passed: Boolean(passed), details });
  if (!passed && !evidence.exactBlocker) {
    evidence.exactBlocker = name;
  }
}

async function clickFirstVisible(page, root, patterns) {
  for (const pattern of patterns) {
    const button = root.getByRole('button', { name: pattern }).first();
    if (await button.isVisible({ timeout: 600 }).catch(() => false)) {
      await button.click();
      await page.waitForTimeout(150);
      return true;
    }
  }
  return false;
}

function buildStorageStateForBaseUrl(filePath, targetBaseUrl) {
  const state = JSON.parse(fs.readFileSync(filePath, 'utf8'));
  const targetOrigin = new URL(targetBaseUrl).origin;
  if (isLocalPreview(targetOrigin)) {
    const sourceOrigin = state.origins?.find((origin) => origin.origin === 'https://heavy-chain.zeabur.app') ?? state.origins?.[0];
    if (sourceOrigin?.localStorage) {
      state.origins = [
        ...(state.origins ?? []).filter((origin) => origin.origin !== targetOrigin),
        { origin: targetOrigin, localStorage: sourceOrigin.localStorage },
      ];
    }
  }
  return state;
}

async function installLocalProofAuth(browserContext) {
  const userId = '00000000-0000-4000-8000-000000000033';
  const payload = {
    user: { id: userId, email: 'heavy-chain-local-proof@example.test', name: 'Local Proof User', emailVerified: true, createdAt: new Date(0).toISOString() },
    session: { token: 'local-cloudflare-proof-token', expiresAt: new Date(Date.now() + 3600000).toISOString() },
  };
  await browserContext.route('**/api/auth/ok', async (route) => route.fulfill({ status: 200, contentType: 'application/json', body: '{}' }));
  await browserContext.route('**/api/auth/get-session', async (route) => {
    await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(payload) });
  });
  await browserContext.route('**/api/auth/**', async (route) => {
    await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(payload) });
  });
}

async function installLocalCloudflareMocks(browserContext) {
  const userId = '00000000-0000-4000-8000-000000000033';
  const now = new Date().toISOString();
  const brand = { id: '00000000-0000-4000-8000-000000000133', owner_id: userId, name: 'Heavy Chain Local Proof', slug: 'heavy-chain-local-proof', created_at: now, updated_at: now };
  const profile = { id: userId, email: 'heavy-chain-local-proof@example.test', name: 'Local Proof User', language: 'ja', is_admin: false, created_at: now, updated_at: now };
  await browserContext.route('**/v1/**', async (route) => {
    const pathname = new URL(route.request().url()).pathname;
    if (pathname.endsWith('/profile')) return route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(profile) });
    if (/\/v1\/brands(?:\/.*)?$/.test(pathname)) return route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify([brand]) });
    if (/\/v1\/collections(?:\/.*)?$/.test(pathname)) return route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify([]) });
    if (/\/v1\/generated-images(?:\/.*)?$/.test(pathname)) return route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify([]) });
    return route.fulfill({ status: 200, contentType: 'application/json', body: '{}' });
  });
}

async function installLocalRequestGuard(browserContext, targetBaseUrl) {
  const targetOrigin = new URL(targetBaseUrl).origin;
  await browserContext.route('**/*', async (route) => {
    const requestUrl = new URL(route.request().url());
    if (requestUrl.origin === targetOrigin) return route.continue();
    await route.abort('blockedbyclient');
  });
}

async function startPreviewServer(targetBaseUrl) {
  const url = new URL(targetBaseUrl);
  const port = url.port || '4173';
  const child = spawn('npm', ['run', 'preview', '--', '--host', '127.0.0.1', '--port', port], {
    stdio: ['ignore', 'pipe', 'pipe'],
    env: { ...process.env, BROWSER: 'none' },
  });
  const logs = [];
  child.stdout.on('data', (chunk) => logs.push(chunk.toString()));
  child.stderr.on('data', (chunk) => logs.push(chunk.toString()));
  const deadline = Date.now() + 30_000;
  while (Date.now() < deadline) {
    try {
      const response = await fetch(targetBaseUrl);
      if (response.ok || response.status < 500) return child;
    } catch {
      await new Promise((resolve) => setTimeout(resolve, 500));
    }
  }
  child.kill('SIGTERM');
  throw new Error(`preview_start_timeout:${logs.join('').slice(-1000)}`);
}

async function dismissBlockingOverlays(page) {
  await page.keyboard.press('Escape').catch(() => {});
  for (const text of ['スキップ', '閉じる', 'あとで', '完了']) {
    const button = page.getByRole('button', { name: text }).first();
    if (await button.isVisible({ timeout: 500 }).catch(() => false)) {
      await button.click().catch(() => {});
      await page.waitForTimeout(250);
    }
  }
}

async function uploadMaterialAndWaitForMaskControls(page, uploadPath) {
  const fittingFlow = page.locator('[data-testid="lightchain-fitting-input-flow"]');
  const fittingFlowCount = await fittingFlow.count();
  if (fittingFlowCount !== 1) {
    addAssertion('lightchain_garment_input_scope_resolved', false, { fittingFlowCount });
    throw new Error(`garment_input_scope_missing_or_ambiguous:${fittingFlowCount}`);
  }

  const garmentInputs = fittingFlow.locator('input[type="file"]');
  const garmentInputCount = await garmentInputs.count();
  addAssertion('lightchain_garment_input_scope_resolved', garmentInputCount === 1, { garmentInputCount });
  if (garmentInputCount !== 1) {
    throw new Error(`garment_input_target_missing_or_ambiguous:${garmentInputCount}`);
  }

  const garmentInput = garmentInputs;
  await garmentInput.setInputFiles(uploadPath);

  const expectedName = path.basename(uploadPath);
  const countLocator = page.locator('[data-testid="lightchain-fitting-garment-count"]');
  const nameLocator = page.locator('[data-testid="lightchain-fitting-garment-selection"]');
  const deadline = Date.now() + 15_000;
  let observedCount = null;
  let observedName = null;
  while (Date.now() < deadline) {
    observedCount = await countLocator.getAttribute('data-count', { timeout: 500 }).catch(() => null);
    observedName = (await nameLocator.innerText({ timeout: 500 }).catch(() => '')).trim() || null;
    if (observedCount === '1/4' && observedName === expectedName) break;
    await page.waitForTimeout(250);
  }

  const garmentCommitted = observedCount === '1/4' && observedName === expectedName;
  addAssertion('lightchain_garment_commit_observed', garmentCommitted, {
    expectedCount: '1/4',
    observedCount,
    expectedName,
    observedName,
  });
  if (!garmentCommitted) {
    throw new Error(`garment_commit_not_observed:${JSON.stringify({ observedCount, observedName, expectedCount: '1/4', expectedName })}`);
  }

  const lightchainWorkbench = page.locator('main[data-workflow-feature="fitting-clothing-reference"]');
  const lightchainWorkbenchCount = await lightchainWorkbench.count();
  if (lightchainWorkbenchCount !== 1) {
    addAssertion('lightchain_mask_route_scope_resolved', false, { lightchainWorkbenchCount });
    addAssertion('lightchain_mask_capability_available', false, { lightchainWorkbenchCount });
    throw new Error(`lightchain_mask_capability_unavailable:${lightchainWorkbenchCount}`);
  }

  const controlNames = ['自動カット', '手動マスク', '背景維持', 'クリッピング', 'AIマスク認識'];
  const controlState = {};
  for (const name of controlNames) {
    const locator = page.locator('[data-testid="lightchain-fitting-mask-controls"]')
      .getByRole('button', { name, exact: true });
    const count = await locator.count();
    const visible = count === 1 && await locator.isVisible({ timeout: 500 }).catch(() => false);
    const enabled = visible && await locator.isEnabled({ timeout: 500 }).catch(() => false);
    controlState[name] = { count, visible, enabled };
  }
  const maskControlsReady = controlNames.every((name) => (
    controlState[name].count === 1
    && controlState[name].visible === true
    && controlState[name].enabled === true
  ));
  addAssertion('lightchain_mask_route_scope_resolved', true, { lightchainWorkbenchCount });
  addAssertion('lightchain_mask_capability_available', maskControlsReady, { controls: controlState });
  addAssertion('lightchain_mask_controls_ready', maskControlsReady, { controls: controlState });
  if (!maskControlsReady) {
    throw new Error(`lightchain_mask_capability_unavailable:${JSON.stringify(controlState)}`);
  }
}

async function openDetails(root, summaryText) {
  const summary = root.locator('summary').filter({ hasText: summaryText }).first();
  if (await summary.isVisible({ timeout: 1000 }).catch(() => false)) {
    const isOpen = await summary.evaluate((node) => node.parentElement?.hasAttribute('open') ?? false);
    if (!isOpen) await summary.click();
  }
}

function wirePageDiagnostics(page, route) {
  page.on('pageerror', (error) => evidence.pageErrors.push({ route, message: error.message }));
  page.on('console', (message) => {
    if (['error', 'warning'].includes(message.type())) {
      const text = message.text();
      if (localPreview && /net::ERR_BLOCKED_BY_CLIENT/.test(text)) return;
      if (/Remote workspace artifact save failed; falling back to localStorage/.test(text)) return;
      if (/^Canvas render state \{/.test(text)) return;
      if (!/Download the React DevTools|favicon/.test(text)) {
        evidence.consoleMessages.push({ route, type: message.type(), text });
      }
    }
  });
  page.on('requestfailed', (request) => {
    const url = request.url();
    if (localPreview && /net::ERR_BLOCKED_BY_CLIENT/.test(request.failure()?.errorText ?? '')) return;
    if (!url.includes('favicon')) {
      evidence.requestFailures.push({ route, url, failure: request.failure()?.errorText ?? null });
    }
  });
}

async function bodyText(page) {
  return page.locator('body').innerText({ timeout: 8000 }).catch(() => '');
}

async function waitForRenderedCanvasImages(page, phase) {
  const canvas = page.locator('canvas').first();
  const canvasCount = await page.locator('canvas').count();
  addAssertion(`${phase}_canvas_exists`, canvasCount > 0, { canvasCount });
  if (canvasCount === 0) throw new Error(`${phase}_canvas_missing`);

  await page.waitForFunction(() => {
    try {
      const state = JSON.parse(document.body.dataset.canvasRenderState ?? '{}');
      return state.totalImageObjects >= 1 && state.loadedImageObjects >= state.totalImageObjects;
    } catch {
      return false;
    }
  }, undefined, { timeout: 10_000 });

  const renderState = await page.locator('body').getAttribute('data-canvas-render-state');
  const parsedRenderState = renderState ? JSON.parse(renderState) : null;
  const imagesRendered = parsedRenderState?.totalImageObjects >= 1
    && parsedRenderState.loadedImageObjects >= parsedRenderState.totalImageObjects;
  addAssertion(`${phase}_material_and_overlay_render`, imagesRendered, {
    renderState: parsedRenderState,
  });
  return canvas;
}

async function selectMaterialAndOpenProperties(page, canvas, phase) {
  const canvases = page.locator('canvas');
  const canvasCount = await canvases.count();
  if (canvasCount === 0) throw new Error(`${phase}_canvas_missing`);

  let canvasBounds = null;
  for (let index = canvasCount - 1; index >= 0; index -= 1) {
    const candidate = canvases.nth(index);
    if (await candidate.isVisible().catch(() => false)) {
      canvasBounds = await candidate.boundingBox();
      if (canvasBounds) break;
    }
  }
  if (!canvasBounds) throw new Error(`${phase}_canvas_bounds_missing`);
  await page.mouse.click(canvasBounds.x + 160, canvasBounds.y + 160);
  const propertiesButton = page.locator('button[title="プロパティ"]').first();
  await propertiesButton.waitFor({ state: 'visible', timeout: 10_000 });
  await propertiesButton.click();
  await page.locator('aside h3').filter({ hasText: 'プロパティ' }).first().waitFor({ state: 'visible', timeout: 10_000 });
  const renderStateText = await page.locator('body').getAttribute('data-canvas-render-state');
  const renderState = renderStateText ? JSON.parse(renderStateText) : null;
  addAssertion(`${phase}_material_and_overlay_render_after_selection`, renderState?.totalImageObjects >= 1
    && renderState.loadedImageObjects >= renderState.totalImageObjects, { renderState });
  const body = await bodyText(page);
  addAssertion(`properties_panel_shows_material_layer_info_${phase}`, body.includes('素材・レイヤー情報')
    && body.includes('認識素材')
    && body.includes('編集設計'));
  return body;
}

async function closePageAndGetVideo(page) {
  const video = page.video();
  await withTimeout(page.close(), 8000, 'page_close_timeout').catch(() => undefined);
  if (!video) return null;
  return withTimeout(video.path(), 8000, 'video_path_timeout').catch(() => null);
}

async function withTimeout(promise, timeoutMs, message) {
  let timer;
  try {
    return await Promise.race([
      promise,
      new Promise((_, reject) => {
        timer = setTimeout(() => reject(new Error(message)), timeoutMs);
      }),
    ]);
  } finally {
    clearTimeout(timer);
  }
}

function isLocalPreview(value) {
  try {
    const parsed = new URL(value);
    return ['http:', 'https:'].includes(parsed.protocol) && ['127.0.0.1', 'localhost'].includes(parsed.hostname);
  } catch {
    return false;
  }
}

function trimTrailingSlash(value) {
  return value.replace(/\/$/, '');
}

function dateStamp() {
  return new Date().toISOString().replace(/[-:]/g, '').replace(/\..+/, 'Z');
}

function parseArgs(argv) {
  const parsed = {};
  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (!arg.startsWith('--')) continue;
    const key = arg.slice(2);
    const next = argv[index + 1];
    if (!next || next.startsWith('--')) {
      parsed[key] = true;
    } else {
      parsed[key] = next;
      index += 1;
    }
  }
  return parsed;
}
