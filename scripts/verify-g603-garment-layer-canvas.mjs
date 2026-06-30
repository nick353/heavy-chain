#!/usr/bin/env node

import fs from 'node:fs';
import path from 'node:path';
import { spawn } from 'node:child_process';
import { chromium } from '@playwright/test';

const args = parseArgs(process.argv.slice(2));
const baseUrl = trimTrailingSlash(args.baseUrl || process.env.HEAVY_CHAIN_BASE_URL || 'http://127.0.0.1:4173');
const authStatePath = args.authState || process.env.HEAVY_CHAIN_AUTH_STATE || 'output/playwright/prod-auth-refresh-20260625/auth-state.json';
const outDir = args.out || `output/playwright/g603-garment-layer-canvas-${dateStamp()}`;
const canvasStoreKey = 'heavy-chain-canvas';
const viewport = { width: 1440, height: 1050 };
const fixturePng =
  'iVBORw0KGgoAAAANSUhEUgAAASwAAACWCAIAAADrOSKFAAABfklEQVR4nO3VwQ2DMBQFQYp2/6mOBtYiHhSg2R+TR6VJ4FD3Yh8nAAAAAAAAAAAAAAAAAAAAAACwq3n7vQG8Lr3f93nP8xz7B2z67bLvG7BXn8z3/V6f8yP4nff4+v0G7NVd9j7f6wN4u9QzAAAAAAAAAAAAAAAAAADgT2EDAiwIsCDAggALAiysx8O+vV6vR3e73V6vV6vR6fP5/PL5fL1eL5fL5fL5fL5fK9Xq9Xq9Xq9Xq9Xq9Xq8vLy8vLy8vLy8vLy8vLy8vLy8vLy8vLy8vLy8vLy8vLy8vLw8Pj4+Pj4+Pj4+Pj4+Pj4+Pj4+Pj4+Pj4+Pj4+Pj4+Pj4+Pj4+Pg8PDw8PDw8PDw8PDw8PDw8PDw8PDw8PDw8PDw8PDw8PDw8PDw+Pj4+Pj4+Pj4+Pj4+Pj4+Pj4+Pj4+Pj4+Pj4+Pj4+Pj4+Pj4+Px8fn5+fn5+fn5+fn5+fn5+fn5+fn5+fn5+fn5+fn5+fn5+fn5+fAAAAAAAAAAAAAAAAAAAAAAD4O8EGAiwIsCDAggALAiysQw4oEJQ4AAAAAElFTkSuQmCC';

fs.mkdirSync(outDir, { recursive: true });
const uploadPath = path.join(outDir, 'g603-garment-upload.png');
fs.writeFileSync(uploadPath, Buffer.from(fixturePng, 'base64'));

let previewProcess = null;
let browser = null;
let context = null;

const evidence = {
  workflow: 'g603-garment-cut-layer-canvas',
  capturedAt: new Date().toISOString(),
  baseUrl,
  authState: authStatePath,
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
  if (isLocalPreview(baseUrl)) {
    previewProcess = await startPreviewServer(baseUrl);
  }

  if (!fs.existsSync(authStatePath)) {
    throw new Error(`auth_state_missing:${authStatePath}`);
  }

  const storageState = buildStorageStateForBaseUrl(authStatePath, baseUrl);
  browser = await chromium.launch({ headless: true });
  context = await browser.newContext({
    storageState,
    viewport,
    acceptDownloads: true,
    recordVideo: {
      dir: path.join(outDir, 'videos'),
      size: viewport,
    },
  });

  const page = await context.newPage();
  wirePageDiagnostics(page, 'g603');

  await page.goto(`${baseUrl}/lightchain`, { waitUntil: 'networkidle' });
  await dismissBlockingOverlays(page);
  await page.evaluate((key) => window.localStorage.removeItem(key), canvasStoreKey);
  await page.screenshot({ path: path.join(outDir, '01-lightchain-home.png'), fullPage: true });
  evidence.screenshots.home = path.join(outDir, '01-lightchain-home.png');

  await page.getByRole('button', { name: /^AIフィッティング\s*\d*$/ }).first().click();
  await page.getByRole('button', { name: /衣服参考ライブラリ/ }).first().click();
  await page.waitForURL(/\/lightchain\/fitting-clothing-reference$/, { timeout: 10_000 });
  await uploadMaterialAndWaitForMaskControls(page, uploadPath);
  await page.getByRole('button', { name: /手動/ }).click();
  await openDetails(page, 'レイヤー詳細');
  const printLayerClicked = await clickFirstVisible(page, [/プリント/]);
  if (!printLayerClicked) throw new Error('print_layer_button_missing');
  const placementSelect = page.locator('select').first();
  await placementSelect.selectOption({ label: '背面大判' });
  if (await placementSelect.inputValue() !== '背面大判') throw new Error('placement_select_failed');
  const noteInput = page.getByLabel(/参考|条件|メモ/).first();
  if (await noteInput.isVisible({ timeout: 1000 }).catch(() => false)) {
    await noteInput.fill('G603 proof: garment recognized, manual mask, print layer on back large placement.');
  }
  await page.screenshot({ path: path.join(outDir, '02-garment-workbench-configured.png'), fullPage: true });
  evidence.screenshots.configured = path.join(outDir, '02-garment-workbench-configured.png');

  await page.getByRole('button', { name: /Canvasに注文票を保存/ }).click();
  await page.waitForURL(/\/canvas\//, { timeout: 20_000 });
  await page.waitForTimeout(1500);
  await page.screenshot({ path: path.join(outDir, '03-canvas-after-save.png'), fullPage: true });
  evidence.screenshots.canvas = path.join(outDir, '03-canvas-after-save.png');

  const body = await bodyText(page);
  fs.writeFileSync(path.join(outDir, '03-canvas-body.txt'), body);
  const storage = await page.evaluate((key) => window.localStorage.getItem(key), canvasStoreKey);
  const parsedStorage = storage ? JSON.parse(storage) : null;
  fs.writeFileSync(path.join(outDir, '03-canvas-storage.json'), `${JSON.stringify(parsedStorage, null, 2)}\n`);

  const currentObjects = Array.isArray(parsedStorage?.state?.objects) ? parsedStorage.state.objects : [];
  const materialObject = currentObjects.find((object) => object?.metadata?.feature === 'lightchain-fitting-clothing-reference-material-reference');
  const overlayObject = currentObjects.find((object) => object?.metadata?.feature === 'lightchain-fitting-clothing-reference-overlay-layer');
  const overlayParameters = overlayObject?.metadata?.parameters ?? {};
  const materialParameters = materialObject?.metadata?.parameters ?? {};

  addAssertion('canvas_route_opened', /\/canvas\//.test(page.url()), { url: page.url() });
  addAssertion('properties_panel_shows_material_layer_info', body.includes('素材・レイヤー情報') && body.includes('認識素材') && body.includes('編集設計'));
  addAssertion('material_object_saved', Boolean(materialObject?.id), { id: materialObject?.id ?? null });
  addAssertion('overlay_object_saved', Boolean(overlayObject?.id), { id: overlayObject?.id ?? null });
  addAssertion('overlay_links_to_material', Boolean(overlayObject?.derivedFrom && overlayObject.derivedFrom === materialObject?.id), {
    derivedFrom: overlayObject?.derivedFrom ?? null,
    materialId: materialObject?.id ?? null,
  });
  addAssertion('cut_mode_applied_to_canvas_png', materialParameters.processedImageKind === 'masked-transparent-png' && materialObject?.src?.startsWith('data:image/png'), {
    processedImageKind: materialParameters.processedImageKind ?? null,
    srcPrefix: materialObject?.src?.slice(0, 22) ?? null,
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
    await withTimeout(browser.close(), 10000, 'browser_close_timeout')
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

async function clickFirstVisible(page, patterns) {
  for (const pattern of patterns) {
    const button = page.getByRole('button', { name: pattern }).first();
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
  if (/^https?:\/\/(127\.0\.0\.1|localhost)/.test(targetOrigin)) {
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
  for (let attempt = 0; attempt < 3; attempt += 1) {
    await page.locator('input[type="file"]').first().setInputFiles(uploadPath);
    await page.waitForTimeout(500);
    const maskReady = await page.getByRole('button', { name: 'AIマスク認識' }).first().isEnabled({ timeout: 3000 }).catch(() => false);
    if (maskReady) return;
  }
  throw new Error('material_upload_did_not_enable_mask_controls');
}

async function openDetails(page, summaryText) {
  const summary = page.locator('summary').filter({ hasText: summaryText }).first();
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
      if (!/Download the React DevTools|favicon/.test(text)) {
        evidence.consoleMessages.push({ route, type: message.type(), text });
      }
    }
  });
  page.on('requestfailed', (request) => {
    const url = request.url();
    if (!url.includes('favicon')) {
      evidence.requestFailures.push({ route, url, failure: request.failure()?.errorText ?? null });
    }
  });
}

async function bodyText(page) {
  return page.locator('body').innerText({ timeout: 8000 }).catch(() => '');
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
  return /^https?:\/\/(127\.0\.0\.1|localhost)/.test(value);
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
