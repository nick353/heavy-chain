#!/usr/bin/env node

import fs from 'node:fs';
import path from 'node:path';
import { spawn } from 'node:child_process';
import { chromium } from '@playwright/test';

const args = parseArgs(process.argv.slice(2));
const baseUrl = trimTrailingSlash(args.baseUrl || process.env.HEAVY_CHAIN_BASE_URL || 'http://127.0.0.1:4173');
const authStatePath = args.authState || process.env.HEAVY_CHAIN_AUTH_STATE || 'output/playwright/prod-auth-refresh-20260625/auth-state.json';
const outDir = args.out || `output/playwright/lightchain-mask-layer-flow-${dateStamp()}`;
const canvasStoreKey = 'heavy-chain-canvas';
const viewport = { width: 1440, height: 1050 };
const fixtureSvg = `<svg xmlns="http://www.w3.org/2000/svg" width="300" height="180" viewBox="0 0 300 180">
  <rect width="300" height="180" fill="#f8fafc"/>
  <path d="M98 32h104l30 38-28 24-18-18v78H114V76L96 94 68 70z" fill="#111827"/>
  <rect x="126" y="82" width="48" height="42" rx="6" fill="#22d3ee"/>
  <path d="M132 96h36M132 110h36" stroke="#0f172a" stroke-width="5" stroke-linecap="round"/>
</svg>`;

fs.mkdirSync(outDir, { recursive: true });
const uploadPath = path.join(outDir, 'mask-layer-upload.svg');
fs.writeFileSync(uploadPath, fixtureSvg);

const evidence = {
  workflow: 'lightchain-mask-layer-flow',
  capturedAt: new Date().toISOString(),
  baseUrl,
  authState: authStatePath,
  outDir,
  uploadPath,
  screenshots: {},
  assertions: [],
  consoleMessages: [],
  pageErrors: [],
  requestFailures: [],
  cleanup: {
    contextClosed: false,
    browserClosed: false,
    previewStopped: false,
  },
};

let previewProcess = null;
let browser = null;
let context = null;

try {
  if (isLocalPreview(baseUrl)) previewProcess = await startPreviewServer(baseUrl);
  if (!fs.existsSync(authStatePath)) throw new Error(`auth_state_missing:${authStatePath}`);

  browser = await chromium.launch({ headless: true });
  context = await browser.newContext({
    storageState: buildStorageStateForBaseUrl(authStatePath, baseUrl),
    viewport,
    recordVideo: {
      dir: path.join(outDir, 'videos'),
      size: viewport,
    },
  });

  const page = await context.newPage();
  wirePageDiagnostics(page);
  await page.goto(`${baseUrl}/lightchain`, { waitUntil: 'networkidle' });
  await dismissBlockingOverlays(page);
  await page.evaluate((key) => window.localStorage.removeItem(key), canvasStoreKey);
  await screenshot(page, '01-lightchain-home');
  await verifyAllFeatureDetailRoutes(page);
  await verifyInvalidFeatureRouteRedirect(page);
  await page.goto(`${baseUrl}/lightchain`, { waitUntil: 'networkidle' });

  await page.goto(`${baseUrl}/lightchain/fitting-clothing-reference`, { waitUntil: 'networkidle' });
  await page.waitForURL(/\/lightchain\/fitting-clothing-reference$/, { timeout: 10_000 });
  addAssertion('feature_detail_screen_opened', /\/lightchain\/fitting-clothing-reference$/.test(page.url()), { url: page.url() });
  await screenshot(page, '01a-lightchain-feature-detail');
  await uploadMaterialAndWaitForMaskControls(page, uploadPath);
  await page.getByRole('button', { name: 'AIマスク認識' }).click();
  await page.getByRole('button', { name: '背景維持' }).click();
  const extractAfterKeepDisabled = await isButtonUnavailable(page, '抽出');
  await page.getByRole('button', { name: '手動マスク' }).click();
  const manualCandidateVisible = await page.getByRole('button', { name: '手動範囲' }).isVisible({ timeout: 1000 }).catch(() => false);
  await page.getByRole('button', { name: '手動範囲' }).click();
  await page.getByRole('button', { name: '抽出', exact: true }).click();
  await page.getByRole('button', { name: '次のステップ' }).click();
  await page.getByRole('button', { name: '自動カット' }).click();
  const extractAfterManualToAutoDisabled = await isButtonUnavailable(page, '抽出');
  await page.getByRole('button', { name: 'AIマスク認識' }).click();
  await page.getByRole('button', { name: 'トップス' }).click();
  await page.getByRole('button', { name: '抽出', exact: true }).click();
  await page.getByRole('button', { name: '次のステップ' }).click();
  await screenshot(page, '02-mask-extracted-next-step');

  await openDetails(page, 'レイヤー詳細');
  await page.getByRole('button', { name: 'プリント' }).click();
  const nextStepAfterLayerChangeDisabled = await isButtonUnavailable(page, '次のステップ');
  const layerChangeBody = await bodyText(page);
  await screenshot(page, '02a-after-layer-change-reset');
  await page.getByRole('button', { name: 'AIマスク認識' }).click();
  await page.getByRole('button', { name: 'トップス' }).click();
  await page.getByRole('button', { name: '抽出', exact: true }).click();
  await page.getByRole('button', { name: '次のステップ' }).click();

  await page.goto(`${baseUrl}/lightchain/fitting-background-reference`, { waitUntil: 'networkidle' });
  const toolSwitchBody = await bodyText(page);
  const nextStepDisabledAfterToolSwitch = await isButtonUnavailable(page, '次のステップ');
  await screenshot(page, '02a-after-tool-switch-reset');
  await page.goto(`${baseUrl}/lightchain/fitting-clothing-reference`, { waitUntil: 'networkidle' });
  await uploadMaterialAndWaitForMaskControls(page, uploadPath);
  await page.getByRole('button', { name: 'AIマスク認識' }).click();
  await page.getByRole('button', { name: 'トップス' }).click();
  await page.getByRole('button', { name: '抽出', exact: true }).click();
  await page.getByRole('button', { name: '次のステップ' }).click();

  await page.getByRole('button', { name: '柄' }).click();
  const nextStepAfterCandidateChangeDisabled = await page.getByRole('button', { name: '次のステップ' }).isDisabled();
  await screenshot(page, '02b-after-candidate-change-reset');
  await page.getByRole('button', { name: '抽出', exact: true }).click();
  await page.getByRole('button', { name: '次のステップ' }).click();
  await screenshot(page, '02c-reextracted-pattern-next-step');

  const configuredBody = await bodyText(page);
  addAssertion('ai_mask_candidate_visible', configuredBody.includes('トップス'), { bodyExcerpt: configuredBody.slice(0, 500) });
  addAssertion('keep_mode_disables_extract', extractAfterKeepDisabled, {});
  addAssertion('manual_mode_extracts_manual_range', manualCandidateVisible, {});
  addAssertion('manual_to_auto_clears_manual_candidate', extractAfterManualToAutoDisabled, {});
  addAssertion('layer_change_resets_next_step', nextStepAfterLayerChangeDisabled && !layerChangeBody.includes('次ステップ可'), {
    bodyExcerpt: layerChangeBody.slice(0, 800),
  });
  addAssertion('tool_switch_resets_extraction_state', nextStepDisabledAfterToolSwitch && !toolSwitchBody.includes('次ステップ可'), {
    bodyExcerpt: toolSwitchBody.slice(0, 800),
  });
  addAssertion('candidate_change_resets_next_step', nextStepAfterCandidateChangeDisabled, {
    selectedAfterReset: '柄',
  });
  addAssertion('extract_layer_status_visible', configuredBody.includes('抽出') || configuredBody.includes('抽出してレイヤー'), {
    bodyExcerpt: configuredBody.slice(0, 800),
  });
  addAssertion('next_step_ok_visible', configuredBody.includes('次ステップ可') || configuredBody.includes('OK'), {
    bodyExcerpt: configuredBody.slice(0, 800),
  });

  await page.getByRole('button', { name: /Canvasに注文票を保存/ }).click();
  await page.waitForURL(/\/canvas\//, { timeout: 20_000 });
  await page.waitForTimeout(1200);
  await screenshot(page, '03-canvas-after-save');

  const storage = await page.evaluate((key) => window.localStorage.getItem(key), canvasStoreKey);
  const parsedStorage = storage ? JSON.parse(storage) : null;
  fs.writeFileSync(path.join(outDir, '03-canvas-storage.json'), `${JSON.stringify(parsedStorage, null, 2)}\n`);
  const project = Array.isArray(parsedStorage?.state?.projects)
    ? parsedStorage.state.projects.find((item) => item?.id === parsedStorage?.state?.currentProjectId)
    : null;
  const objects = Array.isArray(project?.objects) ? project.objects : [];
  const materialObject = objects.find((object) => object?.metadata?.feature === 'lightchain-fitting-clothing-reference-material-reference');
  const originalBase = objects.find((object) => object?.metadata?.feature === 'lightchain-fitting-clothing-reference-original-base-layer');
  const overlayObject = objects.find((object) => object?.metadata?.feature === 'lightchain-fitting-clothing-reference-overlay-layer');
  const params = materialObject?.metadata?.parameters ?? {};
  const cutoutPixelReadback = materialObject?.src
    ? await inspectImageAlpha(page, materialObject.src)
    : null;

  addAssertion('canvas_route_opened', /\/canvas\//.test(page.url()), { url: page.url() });
  addAssertion('durable_project_objects_readback', Boolean(project?.id && materialObject?.id && overlayObject?.id), {
    currentProjectId: parsedStorage?.state?.currentProjectId ?? null,
    materialObjectId: materialObject?.id ?? null,
    overlayObjectId: overlayObject?.id ?? null,
  });
  addAssertion('original_base_layer_saved', Boolean(originalBase?.id), { id: originalBase?.id ?? null });
  addAssertion('extracted_cutout_layer_saved', params.layerRole === 'extracted-cutout', {
    id: materialObject?.id ?? null,
    layerRole: params.layerRole ?? null,
  });
  addAssertion('extracted_cutout_is_png_data_url', typeof materialObject?.src === 'string' && materialObject.src.startsWith('data:image/png'), {
    srcPrefix: typeof materialObject?.src === 'string' ? materialObject.src.slice(0, 32) : null,
  });
  addAssertion('extracted_cutout_has_real_transparency', Boolean(cutoutPixelReadback?.hasTransparentPixels), {
    cutoutPixelReadback,
  });
  addAssertion('extracted_cutout_records_bounds_and_engine', Boolean(params.cutoutBounds?.width && params.cutoutBounds?.height && params.maskEngine), {
    cutoutBounds: params.cutoutBounds ?? null,
    maskEngine: params.maskEngine ?? null,
  });
  addAssertion('material_reference_records_extracted_png', params.materialReference?.extractedImageUrl?.startsWith('data:image/png') && params.materialReference?.maskEngine, {
    materialReference: params.materialReference ?? null,
  });
  addAssertion('overlay_layer_still_saved', Boolean(overlayObject?.id), { id: overlayObject?.id ?? null });
  addAssertion('mask_metadata_has_candidates_and_selection', Array.isArray(params.maskPlan?.candidates) && params.maskPlan.candidates.includes('トップス') && params.maskPlan.selectedCandidate === '柄', {
    maskPlan: params.maskPlan ?? null,
  });
  addAssertion('layer_plan_records_stack', Array.isArray(params.layerPlan?.stack) && params.layerPlan.stack.includes('original-base') && params.layerPlan.stack.includes('extracted-cutout'), {
    layerPlan: params.layerPlan ?? null,
  });
  addAssertion('layer_plan_records_reextracted_candidate', params.layerPlan?.extractedLayer?.sourceCandidate === '柄' && params.layerPlan?.activeLayer === 'print', {
    layerPlan: params.layerPlan ?? null,
  });
  addAssertion('composition_preview_records_next_step', params.compositionPreview?.flow === 'next-step-ready', {
    compositionPreview: params.compositionPreview ?? null,
  });

  evidence.video = await closePageAndGetVideo(page);
  addAssertion('video_recorded', Boolean(evidence.video), { video: evidence.video });
} catch (error) {
  evidence.exactBlocker = error.message;
  addAssertion('route_exception_free', false, { error: error.message });
} finally {
  if (context) {
    await withTimeout(context.close(), 10000).then(() => {
      evidence.cleanup.contextClosed = true;
    }).catch((error) => {
      evidence.cleanup.contextCloseBlocker = error.message;
    });
  }
  if (browser) {
    await withTimeout(browser.close(), 10000).then(() => {
      evidence.cleanup.browserClosed = true;
    }).catch((error) => {
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

const diagnosticFailures = [
  ...evidence.consoleMessages.map((message) => `console_${message.type}:${message.text}`),
  ...evidence.pageErrors.map((message) => `page_error:${message}`),
  ...evidence.requestFailures.map((failure) => `request_failed:${failure.url}:${failure.failure}`),
];
if (!evidence.cleanup.contextClosed) diagnosticFailures.push(`context_cleanup:${evidence.cleanup.contextCloseBlocker ?? 'not_closed'}`);
if (!evidence.cleanup.browserClosed) diagnosticFailures.push(`browser_cleanup:${evidence.cleanup.browserCloseBlocker ?? 'not_closed'}`);
if (!evidence.cleanup.previewStopped) diagnosticFailures.push('preview_cleanup:not_stopped');
for (const failure of diagnosticFailures) addAssertion(failure, false);

evidence.ok = evidence.assertions.every((assertion) => assertion.ok);
evidence.failed = evidence.assertions.filter((assertion) => !assertion.ok).map((assertion) => assertion.id);
fs.writeFileSync(path.join(outDir, 'SUMMARY.json'), `${JSON.stringify(evidence, null, 2)}\n`);
console.log(JSON.stringify({
  ok: evidence.ok,
  failed: evidence.failed,
  outDir,
  summary: path.join(outDir, 'SUMMARY.json'),
}, null, 2));
process.exit(evidence.ok ? 0 : 1);

async function screenshot(page, name) {
  const file = path.join(outDir, `${name}.png`);
  await page.screenshot({ path: file, fullPage: true });
  evidence.screenshots[name] = file;
}

function addAssertion(id, ok, details = {}) {
  evidence.assertions.push({ id, ok: Boolean(ok), details });
}

function wirePageDiagnostics(page) {
  page.on('console', (message) => {
    if (['error', 'warning'].includes(message.type())) {
      evidence.consoleMessages.push({ type: message.type(), text: message.text() });
    }
  });
  page.on('pageerror', (error) => evidence.pageErrors.push(error.message));
  page.on('requestfailed', (request) => {
    const failure = request.failure()?.errorText ?? 'unknown';
    if (failure === 'net::ERR_ABORTED') return;
    evidence.requestFailures.push({
      url: request.url(),
      failure,
    });
  });
}

async function verifyAllFeatureDetailRoutes(page) {
  const ids = readLightchainToolIds();
  addAssertion('feature_catalog_ids_loaded', ids.length >= 20, { count: ids.length });
  for (const id of ids) {
    await page.goto(`${baseUrl}/lightchain/${id}`, { waitUntil: 'networkidle' });
    const body = await bodyText(page);
    addAssertion(`feature_detail_route:${id}`, page.url().endsWith(`/lightchain/${id}`) && body.includes('機能一覧'), {
      url: page.url(),
    });
  }
  await screenshot(page, '01b-all-feature-detail-routes-checked');
}

async function verifyInvalidFeatureRouteRedirect(page) {
  await page.goto(`${baseUrl}/lightchain/not-a-real-feature`, { waitUntil: 'networkidle' });
  await page.waitForURL(/\/lightchain$/, { timeout: 10_000 });
  addAssertion('invalid_feature_route_redirects_to_index', page.url().endsWith('/lightchain'), { url: page.url() });
}

function readLightchainToolIds() {
  const source = fs.readFileSync(path.join(process.cwd(), 'src/pages/LightchainWorkbenchPage.tsx'), 'utf8');
  const toolsBlock = source.match(/const tools: CompatTool\[] = \[([\s\S]+?)\];\n\nconst statusLabel/);
  if (!toolsBlock) return [];
  return [...toolsBlock[1].matchAll(/\bid: '([^']+)'/g)].map((match) => match[1]);
}

async function bodyText(page) {
  return page.locator('body').innerText({ timeout: 5000 }).catch(() => '');
}

async function dismissBlockingOverlays(page) {
  const candidates = ['閉じる', 'OK', 'Skip', 'スキップ'];
  for (const candidate of candidates) {
    const button = page.getByRole('button', { name: candidate });
    if (await button.first().isVisible({ timeout: 500 }).catch(() => false)) {
      await button.first().click();
      await page.waitForTimeout(300);
    }
  }
}

async function isButtonUnavailable(page, name) {
  const button = page.getByRole('button', { name, exact: true });
  if (!(await button.first().isVisible({ timeout: 1000 }).catch(() => false))) return true;
  return button.first().isDisabled();
}

async function openDetails(page, summaryText) {
  const summary = page.locator('summary').filter({ hasText: summaryText }).first();
  if (await summary.isVisible({ timeout: 1000 }).catch(() => false)) {
    const isOpen = await summary.evaluate((node) => node.parentElement?.hasAttribute('open') ?? false);
    if (!isOpen) await summary.click();
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

async function closePageAndGetVideo(page) {
  const video = page.video();
  await page.close();
  if (!video) return null;
  return video.path().catch(() => null);
}

async function inspectImageAlpha(page, imageUrl) {
  return page.evaluate(async (src) => {
    const image = await new Promise((resolve, reject) => {
      const element = new Image();
      element.onload = () => resolve(element);
      element.onerror = () => reject(new Error('image_alpha_read_failed'));
      element.src = src;
    });
    const canvas = document.createElement('canvas');
    canvas.width = image.naturalWidth || image.width;
    canvas.height = image.naturalHeight || image.height;
    const context = canvas.getContext('2d', { willReadFrequently: true });
    if (!context) throw new Error('canvas_context_missing');
    context.drawImage(image, 0, 0);
    const pixels = context.getImageData(0, 0, canvas.width, canvas.height).data;
    let transparent = 0;
    let opaque = 0;
    for (let index = 3; index < pixels.length; index += 4) {
      if (pixels[index] < 250) transparent += 1;
      if (pixels[index] > 4) opaque += 1;
    }
    return {
      width: canvas.width,
      height: canvas.height,
      transparent,
      opaque,
      hasTransparentPixels: transparent > 0 && opaque > 0,
    };
  }, imageUrl);
}

async function startPreviewServer(targetBaseUrl) {
  const { port } = new URL(targetBaseUrl);
  const child = spawn('npm', ['run', 'preview', '--', '--host', '127.0.0.1', '--port', port || '4173'], {
    stdio: ['ignore', 'pipe', 'pipe'],
    env: { ...process.env, BROWSER: 'none' },
  });
  await waitForUrl(targetBaseUrl, 30_000);
  return child;
}

async function waitForUrl(url, timeoutMs) {
  const started = Date.now();
  while (Date.now() - started < timeoutMs) {
    try {
      const response = await fetch(url);
      if (response.ok || response.status < 500) return;
    } catch {
      await new Promise((resolve) => setTimeout(resolve, 500));
    }
  }
  throw new Error(`preview_server_unavailable:${url}`);
}

function buildStorageStateForBaseUrl(storageStatePath, targetBaseUrl) {
  const raw = JSON.parse(fs.readFileSync(storageStatePath, 'utf8'));
  const targetOrigin = new URL(targetBaseUrl).origin;
  const origins = Array.isArray(raw.origins)
    ? raw.origins.map((origin) => ({ ...origin, origin: targetOrigin }))
    : [];
  return { ...raw, origins };
}

function isLocalPreview(url) {
  const parsed = new URL(url);
  return ['127.0.0.1', 'localhost', '::1'].includes(parsed.hostname);
}

function trimTrailingSlash(value) {
  return value.replace(/\/$/, '');
}

function dateStamp() {
  return new Date().toISOString().replace(/[-:]/g, '').replace(/\..+$/, 'Z');
}

function parseArgs(argv) {
  const parsed = {};
  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (!arg.startsWith('--')) continue;
    const key = arg.slice(2).replace(/-([a-z])/g, (_, letter) => letter.toUpperCase());
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

function withTimeout(promise, timeoutMs) {
  return Promise.race([
    promise,
    new Promise((_, reject) => setTimeout(() => reject(new Error('timeout')), timeoutMs)),
  ]);
}
