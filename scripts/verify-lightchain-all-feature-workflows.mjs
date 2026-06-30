#!/usr/bin/env node

import fs from 'node:fs';
import path from 'node:path';
import { spawn } from 'node:child_process';
import { chromium } from '@playwright/test';

const args = parseArgs(process.argv.slice(2));
const baseUrl = trimTrailingSlash(args.baseUrl || process.env.HEAVY_CHAIN_BASE_URL || 'http://127.0.0.1:4173');
const authStatePath = args.authState || process.env.HEAVY_CHAIN_AUTH_STATE || 'output/playwright/prod-auth-refresh-20260625/auth-state.json';
const outDir = args.out || `output/playwright/lightchain-all-feature-workflows-${dateStamp()}`;
const canvasStoreKey = 'heavy-chain-canvas';
const desktopViewport = { width: 1440, height: 1050 };
const mobileViewport = { width: 390, height: 844 };
const fixturePng =
  'iVBORw0KGgoAAAANSUhEUgAAASwAAACWCAIAAADrOSKFAAABfklEQVR4nO3VwQ2DMBQFQYp2/6mOBtYiHhSg2R+TR6VJ4FD3Yh8nAAAAAAAAAAAAAAAAAAAAAACwq3n7vQG8Lr3f93nP8xz7B2z67bLvG7BXn8z3/V6f8yP4nff4+v0G7NVd9j7f6wN4u9QzAAAAAAAAAAAAAAAAAADgT2EDAiwIsCDAggALAiysx8O+vV6vR3e73V6vV6vR6fP5/PL5fL1eL5fL5fL5fL5fK9Xq9Xq9Xq9Xq9Xq9Xq8vLy8vLy8vLy8vLy8vLy8vLy8vLy8vLy8vLy8vLy8vLy8vLw8Pj4+Pj4+Pj4+Pj4+Pj4+Pj4+Pj4+Pj4+Pj4+Pj4+Pj4+Pj4+Pg8PDw8PDw8PDw8PDw8PDw8PDw8PDw8PDw8PDw8PDw8PDw8PDw+Pj4+Pj4+Pj4+Pj4+Pj4+Pj4+Pj4+Pj4+Pj4+Pj4+Pj4+Pj4+Px8fn5+fn5+fn5+fn5+fn5+fn5+fn5+fn5+fn5+fn5+fn5+fn5+fAAAAAAAAAAAAAAAAAAAAAAD4O8EGAiwIsCDAggALAiysQw4oEJQ4AAAAAElFTkSuQmCC';

fs.mkdirSync(outDir, { recursive: true });
const uploadPath = path.join(outDir, 'all-feature-upload.png');
fs.writeFileSync(uploadPath, Buffer.from(fixturePng, 'base64'));

const catalog = readLightchainCatalog();
const evidence = {
  workflow: 'lightchain-all-feature-workflows',
  capturedAt: new Date().toISOString(),
  baseUrl,
  authState: authStatePath,
  outDir,
  featureCount: catalog.tools.length,
  uploadPath,
  screenshots: {},
  featureResults: [],
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
  addAssertion('feature_catalog_loaded', catalog.tools.length >= 30, { count: catalog.tools.length });

  browser = await chromium.launch({ headless: true });
  context = await browser.newContext({
    storageState: buildStorageStateForBaseUrl(authStatePath, baseUrl),
    viewport: desktopViewport,
  });

  const page = await context.newPage();
  wirePageDiagnostics(page, 'desktop');

  await page.goto(`${baseUrl}/lightchain`, { waitUntil: 'networkidle' });
  await dismissBlockingOverlays(page);
  await screenshot(page, 'desktop-index');
  await verifyGenerateEntrypointUsesFeatureDetail(page);

  for (const tool of catalog.tools) {
    const result = await verifyFeatureWorkflow(page, tool);
    evidence.featureResults.push(result);
  }

  await page.setViewportSize(mobileViewport);
  await page.goto(`${baseUrl}/lightchain`, { waitUntil: 'networkidle' });
  await screenshot(page, 'mobile-index');
  for (const tool of catalog.tools) {
    await verifyMobileFeatureScreen(page, tool);
  }

  await page.goto(`${baseUrl}/lightchain/not-a-real-feature`, { waitUntil: 'networkidle' });
  await page.waitForURL(/\/lightchain$/, { timeout: 10_000 });
  addAssertion('invalid_feature_redirects_to_index', page.url().endsWith('/lightchain'), { url: page.url() });

  await page.close();
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
    await withTimeout(browser.close(), 30000).then(() => {
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
  featureCount: catalog.tools.length,
  summaryPath: path.join(outDir, 'SUMMARY.json'),
}, null, 2));
process.exit(evidence.ok ? 0 : 1);

async function verifyFeatureWorkflow(page, tool) {
  const result = { id: tool.id, category: tool.category, title: tool.title, assertions: [] };
  await page.evaluate((key) => window.localStorage.removeItem(key), canvasStoreKey);
  await page.goto(`${baseUrl}/lightchain/${tool.id}`, { waitUntil: 'networkidle' });
  await page.getByRole('heading', { name: exactText(tool.title) }).first().waitFor({ state: 'visible', timeout: 10_000 });

  const body = await bodyText(page);
  recordFeatureAssertion(result, 'screen_title_visible', body.includes(tool.title), { title: tool.title });
  recordFeatureAssertion(result, 'stage_tabs_visible', ['素材入力', 'マスク/レイヤー', 'Canvas保存'].every((label) => body.includes(label)));
  recordFeatureAssertion(result, 'upload_first_state_hides_advanced_controls', (
    !body.includes('AIマスク認識')
    && !body.includes('Canvasに注文票を保存')
    && !body.includes('レイヤー詳細')
  ), { bodyExcerpt: body.slice(0, 800) });

  await uploadMaterialAndWaitForMaskControls(page, uploadPath);
  await page.getByRole('button', { name: /Canvasに注文票を保存/ }).waitFor({ state: 'visible', timeout: 10_000 });
  const uploadedBody = await bodyText(page);
  recordFeatureAssertion(result, 'workbench_controls_visible_after_upload', uploadedBody.includes('AIマスク認識') && uploadedBody.includes('Canvasに注文票を保存'));
  await openDetails(page, 'レイヤー詳細');
  const layerLabel = firstLayerLabelForCategory(tool.category);
  const layerButton = page.getByRole('button', { name: exactText(layerLabel) }).first();
  const layerVisible = await layerButton.isVisible({ timeout: 1000 }).catch(() => false);
  recordFeatureAssertion(result, 'advanced_layer_control_visible_after_open', layerVisible, { layerLabel });
  if (layerVisible) await layerButton.click();
  const expectedPlacement = await selectLastPlacement(page);
  await page.getByRole('button', { name: /^AIマスク認識$/ }).click();
  await selectMaskCandidate(page, '柄');
  await page.getByRole('button', { name: /^抽出$/ }).click();
  await page.getByRole('button', { name: /^次のステップ$/ }).click();

  const configuredBody = await bodyText(page);
  recordFeatureAssertion(result, 'upload_and_mask_ready', configuredBody.includes('次ステップ可') && configuredBody.includes('OK'), {
    bodyExcerpt: configuredBody.slice(0, 800),
  });

  await page.getByRole('button', { name: /Canvasに注文票を保存/ }).click();
  await page.waitForURL(/\/canvas\//, { timeout: 20_000 });
  await page.waitForTimeout(500);

  const storage = await page.evaluate((key) => window.localStorage.getItem(key), canvasStoreKey);
  const parsedStorage = storage ? JSON.parse(storage) : null;
  const objects = Array.isArray(parsedStorage?.state?.objects) ? parsedStorage.state.objects : [];
  const project = Array.isArray(parsedStorage?.state?.projects)
    ? parsedStorage.state.projects.find((item) => item?.id === parsedStorage?.state?.currentProjectId)
    : null;
  const projectObjects = Array.isArray(project?.objects) ? project.objects : [];
  const materialObject = objects.find((object) => object?.metadata?.feature === `lightchain-${tool.id}-material-reference`);
  const overlayObject = objects.find((object) => object?.metadata?.feature === `lightchain-${tool.id}-overlay-layer`);
  const projectMaterialObject = projectObjects.find((object) => object?.metadata?.feature === `lightchain-${tool.id}-material-reference`);
  const projectOverlayObject = projectObjects.find((object) => object?.metadata?.feature === `lightchain-${tool.id}-overlay-layer`);
  const params = projectMaterialObject?.metadata?.parameters ?? {};
  const validLayerIds = catalog.categoryLayers[tool.category] ?? [];
  recordFeatureAssertion(result, 'canvas_route_opened', /\/canvas\//.test(page.url()), { url: page.url() });
  recordFeatureAssertion(result, 'material_object_saved', Boolean(materialObject?.id), { objectId: materialObject?.id ?? null });
  recordFeatureAssertion(result, 'overlay_object_saved', Boolean(overlayObject?.id), { objectId: overlayObject?.id ?? null });
  recordFeatureAssertion(result, 'project_objects_saved', Boolean(projectMaterialObject?.id && projectOverlayObject?.id), {
    currentProjectId: parsedStorage?.state?.currentProjectId ?? null,
    materialObjectId: projectMaterialObject?.id ?? null,
    overlayObjectId: projectOverlayObject?.id ?? null,
  });
  recordFeatureAssertion(result, 'lightchain_compat_metadata_saved', projectMaterialObject?.metadata?.lightchainCompat?.lightchainFeatureId === tool.id, {
    lightchainCompat: projectMaterialObject?.metadata?.lightchainCompat ?? null,
  });
  recordFeatureAssertion(result, 'lightchain_task_code_is_feature_id_not_route', (
    projectMaterialObject?.metadata?.lightchainCompat?.lightchainTaskCodes?.[0] === tool.id
    && projectMaterialObject?.metadata?.lightchainCompat?.lightchainTaskSteps?.[0]?.taskCode === tool.id
    && !String(projectMaterialObject?.metadata?.lightchainCompat?.lightchainTaskCodes?.[0] ?? '').startsWith('/')
  ), {
    lightchainCompat: projectMaterialObject?.metadata?.lightchainCompat ?? null,
  });
  recordFeatureAssertion(result, 'active_layer_is_valid_for_category', validLayerIds.includes(params.layerPlan?.activeLayer), {
    activeLayer: params.layerPlan?.activeLayer ?? null,
    validLayerIds,
  });
  recordFeatureAssertion(result, 'placement_selection_persisted', Boolean(expectedPlacement) && params.layerPlan?.placement === expectedPlacement, {
    expectedPlacement,
    savedPlacement: params.layerPlan?.placement ?? null,
    compositionPreview: params.compositionPreview ?? null,
  });
  recordFeatureAssertion(result, 'mask_and_composition_metadata_saved', Boolean(params.maskPlan?.selectedCandidate && params.compositionPreview?.flow), {
    maskPlan: params.maskPlan ?? null,
    compositionPreview: params.compositionPreview ?? null,
  });

  await screenshot(page, `desktop-${tool.id}`);
  return result;
}

async function verifyGenerateEntrypointUsesFeatureDetail(page) {
  await page.goto(`${baseUrl}/generate`, { waitUntil: 'networkidle' });
  await dismissBlockingOverlays(page);
  const detailLinkEntries = [];
  for (const categoryLabel of ['おすすめ', '企画デザインツール', 'AIフィッティング', 'グラフィックツール']) {
    await page.getByRole('button', { name: new RegExp(escapeRegExp(categoryLabel)) }).click();
    const linksForCategory = await page
      .locator('a[href^="/lightchain/"], a[href*="/lightchain/"]')
      .evaluateAll((links) => links.map((link) => link.getAttribute('href')).filter(Boolean));
    detailLinkEntries.push(...linksForCategory.map((href) => ({ categoryLabel, href })));
  }
  const uniqueDetailLinkEntries = [...new Map(
    detailLinkEntries
      .filter(({ href }) => href.startsWith('/lightchain/'))
      .map((entry) => [entry.href, entry]),
  ).values()];
  addAssertion('generate_entrypoint_has_lightchain_detail_links', uniqueDetailLinkEntries.length >= 8, {
    count: uniqueDetailLinkEntries.length,
    detailLinks: uniqueDetailLinkEntries.map((entry) => entry.href),
  });
  for (const { categoryLabel, href } of uniqueDetailLinkEntries) {
    await page.goto(`${baseUrl}/generate`, { waitUntil: 'networkidle' });
    await dismissBlockingOverlays(page);
    await page.getByRole('button', { name: new RegExp(escapeRegExp(categoryLabel)) }).click();
    const link = page.locator(`a[href="${href}"]`).first();
    const visible = await link.isVisible({ timeout: 5000 }).catch(() => false);
    if (visible) {
      await link.click();
      await page.waitForURL(new RegExp(`${escapeRegExp(href)}$`), { timeout: 10_000 });
    }
    addAssertion(`generate_entrypoint_click:${href}`, visible && page.url().endsWith(href), { url: page.url() });
  }
  await page.goto(`${baseUrl}/lightchain`, { waitUntil: 'networkidle' });
}

async function verifyMobileFeatureScreen(page, tool) {
  await page.goto(`${baseUrl}/lightchain/${tool.id}`, { waitUntil: 'networkidle' });
  await page.getByRole('heading', { name: exactText(tool.title) }).first().waitFor({ state: 'visible', timeout: 10_000 });
  const body = await bodyText(page);
  addAssertion(`mobile_screen:${tool.id}`, (
    body.includes(tool.title)
    && body.includes('素材入力')
    && !body.includes('AIマスク認識')
    && !body.includes('Canvasに注文票を保存')
  ), {
    url: page.url(),
  });
}

function recordFeatureAssertion(result, name, ok, details = {}) {
  const id = `${result.id}:${name}`;
  result.assertions.push({ id, ok: Boolean(ok), details });
  addAssertion(id, ok, details);
}

async function uploadMaterialAndWaitForMaskControls(page, filePath) {
  for (let attempt = 0; attempt < 3; attempt += 1) {
    await page.locator('input[type="file"]').first().setInputFiles(filePath);
    await page.waitForTimeout(500);
    const ready = await page.getByRole('button', { name: 'AIマスク認識' }).first().isEnabled({ timeout: 3000 }).catch(() => false);
    if (ready) return;
  }
  throw new Error('material_upload_did_not_enable_mask_controls');
}

async function selectLastPlacement(page) {
  await openDetails(page, 'レイヤー詳細');
  const select = page.locator('select').first();
  if (!(await select.isVisible({ timeout: 1000 }).catch(() => false))) throw new Error('placement_select_missing_after_opening_layer_details');
  const labels = await select.locator('option').evaluateAll((options) => options.map((option) => option.textContent || '').filter(Boolean));
  if (labels.length === 0) throw new Error('placement_options_missing');
  const expectedPlacement = labels[labels.length - 1];
  await select.selectOption({ label: expectedPlacement });
  return expectedPlacement;
}

async function selectMaskCandidate(page, candidate) {
  const panel = page
    .getByText('保存したい範囲を選択してください')
    .first()
    .locator('xpath=ancestor::div[contains(@class, "rounded-lg")][1]');
  await panel.getByRole('button', { name: exactText(candidate) }).click();
}

function firstLayerLabelForCategory(category) {
  return catalog.categoryLayerLabels[category]?.[0] ?? '素材ベース';
}

async function openDetails(page, summaryText) {
  const summary = page.locator('summary').filter({ hasText: summaryText }).first();
  if (await summary.isVisible({ timeout: 1000 }).catch(() => false)) {
    const isOpen = await summary.evaluate((node) => node.parentElement?.hasAttribute('open') ?? false);
    if (!isOpen) await summary.click();
  }
}

async function screenshot(page, name) {
  const file = path.join(outDir, `${name}.png`);
  await page.screenshot({ path: file, fullPage: true });
  evidence.screenshots[name] = file;
}

function addAssertion(id, ok, details = {}) {
  evidence.assertions.push({ id, ok: Boolean(ok), details });
}

function wirePageDiagnostics(page, route) {
  page.on('console', (message) => {
    if (['error', 'warning'].includes(message.type())) {
      if (/Failed to fetch Runway MCP (approval|subscription)/.test(message.text())) return;
      evidence.consoleMessages.push({ route, type: message.type(), text: message.text() });
    }
  });
  page.on('pageerror', (error) => evidence.pageErrors.push({ route, message: error.message }));
  page.on('requestfailed', (request) => {
    const failure = request.failure()?.errorText ?? 'unknown';
    if (failure === 'net::ERR_ABORTED') return;
    evidence.requestFailures.push({
      route,
      url: request.url(),
      failure,
    });
  });
}

async function dismissBlockingOverlays(page) {
  await page.keyboard.press('Escape').catch(() => {});
  for (const text of ['スキップ', '閉じる', 'あとで', '完了', 'OK']) {
    const button = page.getByRole('button', { name: text }).first();
    if (await button.isVisible({ timeout: 500 }).catch(() => false)) {
      await button.click().catch(() => {});
      await page.waitForTimeout(250);
    }
  }
}

async function bodyText(page) {
  return page.locator('body').innerText({ timeout: 5000 }).catch(() => '');
}

function readLightchainCatalog() {
  const source = fs.readFileSync(path.join(process.cwd(), 'src/pages/LightchainWorkbenchPage.tsx'), 'utf8');
  const toolsBlock = source.match(/const tools: CompatTool\[] = \[([\s\S]+?)\];\n\nconst statusLabel/);
  const categoryBlock = source.match(/const categoryWorkbenchLabels:[\s\S]+?= \{([\s\S]+?)\n\};\n\nconst textArtifactPreview/);
  const tools = [];
  if (toolsBlock) {
    for (const match of toolsBlock[1].matchAll(/\{\s*id: '([^']+)'[\s\S]+?title: '([^']+)'[\s\S]+?category: '([^']+)'/g)) {
      tools.push({ id: match[1], title: match[2], category: match[3] });
    }
  }
  const categoryLayers = {};
  const categoryLayerLabels = {};
  if (categoryBlock) {
    const categories = ['home', 'marketing', 'fitting', 'planning', 'graphics', 'model', 'video', 'lab'];
    for (const category of categories) {
      const block = extractObjectBlock(categoryBlock[1], category);
      const layersLine = block?.match(/layers: \[(.+)\],/)?.[1] ?? '';
      const layerPairs = [...layersLine.matchAll(/\['([^']+)', '([^']+)'\]/g)];
      categoryLayers[category] = layerPairs.map((pair) => pair[1]);
      categoryLayerLabels[category] = layerPairs.map((pair) => pair[2]);
    }
  }
  return { tools, categoryLayers, categoryLayerLabels };
}

function extractObjectBlock(source, key) {
  const start = source.indexOf(`${key}: {`);
  if (start === -1) return null;
  const bodyStart = source.indexOf('{', start);
  let depth = 0;
  for (let index = bodyStart; index < source.length; index += 1) {
    const char = source[index];
    if (char === '{') depth += 1;
    if (char === '}') depth -= 1;
    if (depth === 0) return source.slice(bodyStart + 1, index);
  }
  return null;
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

function exactText(value) {
  return new RegExp(`^${escapeRegExp(value)}$`);
}

function escapeRegExp(value) {
  return String(value).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
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

function withTimeout(promise, timeoutMs) {
  return Promise.race([
    promise,
    new Promise((_, reject) => setTimeout(() => reject(new Error('timeout')), timeoutMs)),
  ]);
}
