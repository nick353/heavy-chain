#!/usr/bin/env node

import fs from 'node:fs';
import path from 'node:path';
import http from 'node:http';
import { chromium } from '@playwright/test';

const args = parseArgs(process.argv.slice(2));
const baseUrl = trimTrailingSlash(args.baseUrl || process.env.HEAVY_CHAIN_BASE_URL || 'http://127.0.0.1:4183');
const authStatePath = args.authState || process.env.HEAVY_CHAIN_AUTH_STATE || 'output/playwright/prod-auth-refresh-20260625/auth-state.json';
const outDir = args.out || `output/playwright/lightchain-all-feature-workflows-${dateStamp()}`;
const canvasStoreKey = 'heavy-chain-canvas';
const desktopViewport = { width: 1440, height: 1050 };
const mobileViewport = { width: 390, height: 844 };
const fittingHandoffToolIds = new Set(['ai-fitting', 'ai-fitting-reference']);
const fixturePng =
  'iVBORw0KGgoAAAANSUhEUgAAASwAAACWCAIAAADrOSKFAAABfklEQVR4nO3VwQ2DMBQFQYp2/6mOBtYiHhSg2R+TR6VJ4FD3Yh8nAAAAAAAAAAAAAAAAAAAAAACwq3n7vQG8Lr3f93nP8xz7B2z67bLvG7BXn8z3/V6f8yP4nff4+v0G7NVd9j7f6wN4u9QzAAAAAAAAAAAAAAAAAADgT2EDAiwIsCDAggALAiysx8O+vV6vR3e73V6vV6vR6fP5/PL5fL1eL5fL5fL5fL5fK9Xq9Xq9Xq9Xq9Xq9Xq8vLy8vLy8vLy8vLy8vLy8vLy8vLy8vLy8vLy8vLy8vLy8vLw8Pj4+Pj4+Pj4+Pj4+Pj4+Pj4+Pj4+Pj4+Pj4+Pj4+Pj4+Pj4+Pg8PDw8PDw8PDw8PDw8PDw8PDw8PDw8PDw8PDw8PDw8PDw8PDw+Pj4+Pj4+Pj4+Pj4+Pj4+Pj4+Pj4+Pj4+Pj4+Pj4+Pj4+Pj4+Px8fn5+fn5+fn5+fn5+fn5+fn5+fn5+fn5+fn5+fn5+fn5+fn5+fAAAAAAAAAAAAAAAAAAAAAAD4O8EGAiwIsCDAggALAiysQw4oEJQ4AAAAAElFTkSuQmCC';

fs.mkdirSync(outDir, { recursive: true });
const uploadPath = path.join(outDir, 'all-feature-upload.png');
fs.writeFileSync(uploadPath, Buffer.from(fixturePng, 'base64'));

const skippedToolIds = new Set(['video-workstation', 'video-detail']);
const catalog = readLightchainCatalog();
const localPreview = isLocalPreview(baseUrl);
const evidence = {
  workflow: 'lightchain-all-feature-workflows',
  capturedAt: new Date().toISOString(),
  baseUrl,
  authState: localPreview ? 'local-proof-jwt' : authStatePath,
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
  if (localPreview) previewProcess = await startPreviewServer(baseUrl);
  if (!localPreview && !fs.existsSync(authStatePath)) throw new Error(`auth_state_missing:${authStatePath}`);
  addAssertion('feature_catalog_loaded', catalog.tools.length >= 30, {
    count: catalog.tools.length,
    skippedToolIds: [...skippedToolIds],
    skippedCount: skippedToolIds.size,
  });

  browser = await chromium.launch({ headless: true });
  context = await browser.newContext(localPreview
    ? { viewport: desktopViewport }
    : {
      storageState: buildStorageStateForBaseUrl(authStatePath, baseUrl),
      viewport: desktopViewport,
    });
  if (localPreview) await installLocalProofAuth(context);

  let page = await context.newPage();
  page.setDefaultNavigationTimeout(15_000);
  page.setDefaultTimeout(15_000);
  wirePageDiagnostics(page, 'desktop');

  await page.goto(`${baseUrl}/lightchain`, { waitUntil: 'networkidle' });
  await dismissBlockingOverlays(page);
  await screenshot(page, 'desktop-index');
  await verifyGenerateEntrypointUsesFeatureDetail(page);
  await page.close();
  for (const tool of catalog.tools) {
    const routePage = await context.newPage();
    routePage.setDefaultNavigationTimeout(15_000);
    routePage.setDefaultTimeout(15_000);
    wirePageDiagnostics(routePage, `desktop:${tool.id}`);
    const result = await verifyFeatureWorkflow(routePage, tool);
    evidence.featureResults.push(result);
    await routePage.close();
  }
  await context.close();
  evidence.cleanup.contextClosed = true;
  context = null;
  await browser.close();
  evidence.cleanup.browserClosed = true;
  browser = null;

  browser = await chromium.launch({ headless: true });
  context = await browser.newContext(localPreview
    ? { viewport: mobileViewport }
    : {
      storageState: buildStorageStateForBaseUrl(authStatePath, baseUrl),
      viewport: mobileViewport,
    });
  if (localPreview) await installLocalProofAuth(context);
  const mobilePage = await context.newPage();
  mobilePage.setDefaultNavigationTimeout(15_000);
  mobilePage.setDefaultTimeout(15_000);
  wirePageDiagnostics(mobilePage, 'mobile');
  await mobilePage.setViewportSize(mobileViewport);
  await mobilePage.goto(`${baseUrl}/lightchain`, { waitUntil: 'networkidle' });
  await screenshot(mobilePage, 'mobile-index');
  await mobilePage.close();
  for (const tool of catalog.tools) {
    const routePage = await context.newPage();
    routePage.setDefaultNavigationTimeout(15_000);
    routePage.setDefaultTimeout(15_000);
    wirePageDiagnostics(routePage, `mobile:${tool.id}`);
    await routePage.setViewportSize(mobileViewport);
    await verifyMobileFeatureScreen(routePage, tool);
    await routePage.close();
  }

  const invalidPage = await context.newPage();
  invalidPage.setDefaultNavigationTimeout(15_000);
  invalidPage.setDefaultTimeout(15_000);
  wirePageDiagnostics(invalidPage, 'mobile:invalid');
  await invalidPage.setViewportSize(mobileViewport);
  await invalidPage.goto(`${baseUrl}/lightchain/not-a-real-feature`, { waitUntil: 'networkidle' });
  await invalidPage.waitForURL(/\/lightchain$/, { timeout: 10_000 });
  addAssertion('invalid_feature_redirects_to_index', invalidPage.url().endsWith('/lightchain'), { url: invalidPage.url() });
  await invalidPage.close();
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
    await withTimeout(browser.close(), 60000).then(() => {
      evidence.cleanup.browserClosed = true;
    }).catch((error) => {
      evidence.cleanup.browserCloseBlocker = error.message;
    });
  }
  if (previewProcess) {
    await stopPreviewServer(previewProcess).then(() => {
      evidence.cleanup.previewStopped = true;
    }).catch((error) => {
      evidence.cleanup.previewStopBlocker = error.message;
    });
  } else if (!localPreview) {
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
  await page.goto(`${baseUrl}/lightchain/${tool.id}`, { waitUntil: 'networkidle' });
  await page.evaluate((key) => window.localStorage.removeItem(key), canvasStoreKey);
  await waitForSettledRoute(page, tool.id);
  const body = await bodyText(page);
  recordFeatureAssertion(result, 'route_loaded_without_login', !page.url().includes('/login') && !body.includes('ログイン'), {
    url: page.url(),
    bodyExcerpt: body.slice(0, 600),
  });
  recordFeatureAssertion(result, 'heavy_shell_or_lightchain_reference_visible', body.includes('HEAVYCHAIN'), {
    bodyExcerpt: body.slice(0, 300),
  });
  recordFeatureAssertion(result, 'lightchain_screen_signature_visible', matchesLightchainSignature(tool, body), {
    expectedTitle: tool.title,
    bodyExcerpt: body.slice(0, 900),
  });

  const generateButton = page.getByRole('button', { name: /AI生成|更新|保存|開始/ }).first();
  const hasSafeLocalAction = await generateButton.isVisible({ timeout: 1000 }).catch(() => false);
  recordFeatureAssertion(result, 'safe_local_action_or_workspace_visible', hasSafeLocalAction || isReadOnlyWorkspaceTool(tool.id), {
    hasSafeLocalAction,
    toolId: tool.id,
  });

  await screenshot(page, `desktop-${tool.id}`);
  return result;
}

async function verifyGenerateEntrypointUsesFeatureDetail(page) {
  const generateCategoryIds = ['recommended', 'planning', 'fitting', 'graphics'];
  const featureLinkEntries = [];
  for (const categoryId of generateCategoryIds) {
    await page.goto(`${baseUrl}/generate?category=${categoryId}`, { waitUntil: 'domcontentloaded' });
    await page.waitForFunction(() => document.body.innerText.trim().length > 0, null, { timeout: 10_000 });
    await dismissBlockingOverlays(page);
    await page.locator('[data-testid="lightchain-tool-card"]').first().waitFor({ state: 'visible', timeout: 10_000 });
    const linksForCategory = await page
      .locator('a[href]')
      .evaluateAll((links) => links.map((link) => link.getAttribute('href')).filter(Boolean));
    featureLinkEntries.push(...linksForCategory.map((href) => ({ categoryId, href })));
  }
  const skippedVideoHrefs = featureLinkEntries
    .map((entry) => entry.href)
    .filter((href) => isVideoHref(href));
  const uniqueFeatureLinkEntries = [...new Map(
    featureLinkEntries
      .filter(({ href }) => isFeatureEntrypointHref(href) && !isVideoHref(href))
      .map((entry) => [entry.href, entry]),
  ).values()];
  const clickableFeatureDetailEntries = uniqueFeatureLinkEntries
    .filter((entry) => entry.href.startsWith('/lightchain/') || entry.href.startsWith('/generate?feature='))
    .slice(0, 3);
  addAssertion('generate_entrypoint_has_direct_feature_links', clickableFeatureDetailEntries.length >= 3, {
    count: clickableFeatureDetailEntries.length,
    featureLinks: clickableFeatureDetailEntries.map((entry) => entry.href),
    allEntrypointLinks: uniqueFeatureLinkEntries.map((entry) => entry.href),
    skippedVideoHrefs,
  });
  for (const { categoryId, href } of clickableFeatureDetailEntries) {
    await page.goto(`${baseUrl}/generate?category=${categoryId}`, { waitUntil: 'domcontentloaded' });
    await page.waitForFunction(() => document.body.innerText.trim().length > 0, null, { timeout: 10_000 });
    await dismissBlockingOverlays(page);
    await page.locator('[data-testid="lightchain-tool-card"]').first().waitFor({ state: 'visible', timeout: 10_000 });
    const link = page.locator(`a[href="${href}"]`).first();
    const visible = await link.isVisible({ timeout: 1500 }).catch(() => false);
    if (visible) {
      await link.click();
      await page.waitForLoadState('networkidle').catch(() => {});
      await waitForDirectFeatureDestination(page, href);
    }
    const targetBody = await bodyText(page);
    addAssertion(`generate_entrypoint_click:${href}`, visible && urlMatchesHref(page.url(), href) && directFeatureDestinationLoaded(href, targetBody), {
      url: page.url(),
      bodyExcerpt: targetBody.slice(0, 500),
    });
  }
  await page.goto(`${baseUrl}/lightchain`, { waitUntil: 'networkidle' });
}

async function verifyMobileFeatureScreen(page, tool) {
  await page.goto(`${baseUrl}/lightchain/${tool.id}`, { waitUntil: 'networkidle' });
  await waitForSettledRoute(page, tool.id);
  const body = await bodyText(page);
  addAssertion(`mobile_screen:${tool.id}`, (
    !page.url().includes('/login')
    && !body.includes('ログイン')
    && matchesLightchainSignature(tool, body)
  ), {
    url: page.url(),
    bodyExcerpt: body.slice(0, 600),
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

function isReadOnlyWorkspaceTool(toolId) {
  return ['marketing-home', 'design-agent', 'lab', 'fashion-studio', 'print-design-project', 'wear-design-lab', 'custom-style'].includes(toolId);
}

function matchesLightchainSignature(tool, body) {
  if (tool.id === 'fashion-studio') return body.includes('ファッションスタジオ') && body.includes('生成履歴') && body.includes('360度表示');
  if (tool.id === 'marketing-home') return body.includes('マーケティングワークスペース') && body.includes('おすすめのシーン');
  if (tool.id === 'design-agent') return body.includes('Hello') && body.includes('企画案') && body.includes('AIグラフィックデザイン');
  if (tool.id === 'lab') return body.includes('Lightchain Lab') && body.includes('参考事例');
  if (tool.id === 'wear-design-lab') return body.includes('新規ファイル') && body.includes('参考事例');
  if (tool.id === 'wear-design-detail') return body.includes('ガイドを見る') && body.includes('ガイドを表示しない');
  if (tool.id === 'print-design-project') return body.includes('プリントデザイン') && body.includes('新規ファイル');
  if (tool.id === 'print-design-detail') return body.includes('ガイドを見る') && body.includes('ガイドを表示しない');
  if (tool.id === 'custom-style') return body.includes('カスタムスタイル') && body.includes('ラーニング素材');
  if (tool.id === 'marketing-detail') return body.includes('マーケティングワークスペース') && body.includes('AIアシスタント');
  if (['ai-fitting', 'ai-fitting-reference', 'fitting-clothing-reference', 'fitting-background-reference'].includes(tool.id)) {
    return body.includes('AIフィッティング') && body.includes('AI生成') && body.includes('生成履歴');
  }
  if (tool.id === 'model-library') return body.includes('モデルカスタマイズ') && body.includes('ラベル') && body.includes('性別');
  if (['model-face', 'model-change', 'body-shape', 'clothing-size', 'pose-change', 'background-change', 'angle-change', 'model-custom'].includes(tool.id)) {
    return body.includes(tool.title) && body.includes('AI生成') && body.includes('生成履歴');
  }
  if (tool.id === 'pattern-vector-pro') {
    return body.includes('パターンをベクター画像に変換（プロフェッショナル版）') && body.includes('AI生成') && body.includes('生成履歴');
  }
  if (['fabric-image', 'printing-image', 'line-generation', 'line-to-real', 'pattern-vector', 'image-repair', 'svg-convert'].includes(tool.id)) {
    return body.includes(tool.title) && body.includes('AI生成') && body.includes('生成履歴');
  }
  return body.includes(tool.title);
}

function isDirectFeatureHref(href) {
  if (!href || href.startsWith('/lightchain/')) return false;
  return [
    '/generate',
    '/marketing',
    '/fitting',
    '/lab',
    '/video',
    '/models',
    '/studio',
    '/patterns',
    '/brand/settings',
    '/canvas',
    '/workflows',
  ].some((prefix) => href === prefix || href.startsWith(`${prefix}/`) || href.startsWith(`${prefix}?`));
}

function isFeatureEntrypointHref(href) {
  return href?.startsWith('/lightchain/') || isDirectFeatureHref(href);
}

function isVideoHref(href) {
  return href === '/video' || href.startsWith('/video/') || href.startsWith('/video?');
}

function urlMatchesHref(url, href) {
  const parsed = new URL(url);
  const actual = `${parsed.pathname}${parsed.search}${parsed.hash}`;
  return actual === href || actual.startsWith(href);
}

function directFeatureDestinationLoaded(href, body) {
  if (href.startsWith('/generate?feature=')) {
    const params = new URLSearchParams(href.split('?')[1] || '');
    const lcTitle = params.get('lcTitle');
    return body.includes('生成') && (!lcTitle || body.includes(lcTitle) || body.includes('制作条件'));
  }
  if (href.startsWith('/lightchain/')) {
    const toolId = href.split('/').pop();
    const tool = catalog.tools.find((item) => item.id === toolId);
    return tool ? matchesLightchainSignature(tool, body) : body.trim().length > 0 && !body.includes('ログイン');
  }
  if (href.startsWith('/generate?category=')) return body.includes('HEAVY CHAIN AI') || body.includes('おすすめ');
  if (href === '/canvas/new') return body.includes('プロパティ') || body.includes('キャンバス');
  if (href.startsWith('/workflows/')) return body.includes('ワークフロー') || body.includes('生成');
  return body.trim().length > 0 && !body.includes('ログイン');
}

async function waitForDirectFeatureDestination(page, href) {
  if (href === '/canvas/new') {
    await page.getByText('画像を置いて、機能を選ぶ').first().waitFor({ state: 'visible', timeout: 15_000 }).catch(() => undefined);
    return;
  }
  if (href === '/fitting' || href.startsWith('/fitting#')) {
    await page.getByText(/高精度AI(で)?切り抜き?/).first().waitFor({ state: 'visible', timeout: 15_000 }).catch(() => undefined);
    return;
  }
  if (href.startsWith('/generate?feature=')) {
    await page.getByText('生成').first().waitFor({ state: 'visible', timeout: 10_000 }).catch(() => undefined);
  }
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
  await page.screenshot({ path: file, fullPage: false, timeout: 30_000 });
  evidence.screenshots[name] = file;
}

function addAssertion(id, ok, details = {}) {
  evidence.assertions.push({ id, ok: Boolean(ok), details });
}

function wirePageDiagnostics(page, route) {
  page.on('console', (message) => {
    if (['error', 'warning'].includes(message.type())) {
      if (localPreview && /Failed to load resource: the server responded with a status of 401/.test(message.text())) return;
      if (/Failed to fetch Runway MCP (approval|subscription)/.test(message.text())) return;
      if (/Remote workspace artifact save failed; falling back to localStorage/.test(message.text())) return;
      if (/Falling back to table usage summary/.test(message.text())) return;
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

async function waitForSettledRoute(page, toolId) {
  await page.waitForFunction((currentToolId) => {
    const text = document.body.innerText.trim();
    if (currentToolId === 'fashion-studio' && text.includes('ファッションスタジオ') && text.includes('生成履歴')) return true;
    if (['ai-fitting', 'ai-fitting-reference', 'fitting-clothing-reference', 'fitting-background-reference'].includes(currentToolId)) {
      return text.includes('AIフィッティング') && !text.includes('ログイン');
    }
    return text.length > 0
      && !text.includes('MATERIAL WORKBENCH')
      && !text.includes('素材ワークベンチを準備しています');
  }, toolId, { timeout: 20_000 });
}

function readLightchainCatalog() {
  const source = fs.readFileSync(path.join(process.cwd(), 'src/pages/LightchainWorkbenchPage.tsx'), 'utf8');
  const toolsBlock = source.match(/const tools: CompatTool\[] = \[([\s\S]+?)\];\n\nconst statusLabel/);
  const categoryBlock = source.match(/const categoryWorkbenchLabels:[\s\S]+?= \{([\s\S]+?)\n\};\n\nconst encodeSvgDataUrl/);
  const tools = [];
  if (toolsBlock) {
    for (const match of toolsBlock[1].matchAll(/\{\s*id: '([^']+)'[\s\S]+?title: '([^']+)'[\s\S]+?category: '([^']+)'/g)) {
      if (skippedToolIds.has(match[1])) continue;
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
  const distDir = path.join(process.cwd(), 'dist');
  const server = http.createServer((request, response) => {
    const requestUrl = new URL(request.url || '/', targetBaseUrl);
    const pathname = decodeURIComponent(requestUrl.pathname).replace(/^\/+/, '');
    const candidatePath = path.resolve(distDir, pathname);
    const safePath = candidatePath.startsWith(`${distDir}${path.sep}`) || candidatePath === distDir
      ? candidatePath
      : path.join(distDir, 'index.html');
    const filePath = fs.existsSync(safePath) && fs.statSync(safePath).isFile()
      ? safePath
      : path.join(distDir, 'index.html');
    response.setHeader('Cache-Control', 'no-store');
    response.setHeader('Content-Type', contentTypeForPath(filePath));
    fs.readFile(filePath, (error, data) => {
      if (!error) {
        response.end(data);
        return;
      }
      const fallbackPath = path.join(distDir, 'index.html');
      response.setHeader('Content-Type', contentTypeForPath(fallbackPath));
      fs.readFile(fallbackPath, (fallbackError, fallbackData) => {
        if (fallbackError) {
          response.statusCode = 500;
          response.end(`static_server_read_error:${fallbackError.code || fallbackError.message}`);
          return;
        }
        response.end(fallbackData);
      });
    });
  });
  await new Promise((resolve, reject) => {
    server.once('error', reject);
    server.listen(Number(port || '4173'), '127.0.0.1', resolve);
  });
  return server;
}

async function stopPreviewServer(server) {
  await new Promise((resolve, reject) => {
    server.close((error) => (error ? reject(error) : resolve()));
  });
}

function contentTypeForPath(filePath) {
  if (filePath.endsWith('.html')) return 'text/html; charset=utf-8';
  if (filePath.endsWith('.js')) return 'text/javascript; charset=utf-8';
  if (filePath.endsWith('.css')) return 'text/css; charset=utf-8';
  if (filePath.endsWith('.json')) return 'application/json; charset=utf-8';
  if (filePath.endsWith('.svg')) return 'image/svg+xml';
  if (filePath.endsWith('.png')) return 'image/png';
  if (filePath.endsWith('.wasm')) return 'application/wasm';
  return 'application/octet-stream';
}

async function waitForUrl(url, timeoutMs) {
  const started = Date.now();
  while (Date.now() - started < timeoutMs) {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 2000);
    try {
      const response = await fetch(url, { signal: controller.signal });
      if (response.ok || response.status < 500) return;
    } catch {
      await new Promise((resolve) => setTimeout(resolve, 500));
    } finally {
      clearTimeout(timeout);
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

async function installLocalProofAuth(browserContext) {
  const supabaseUrl = readEnvValue('VITE_SUPABASE_URL');
  if (!supabaseUrl) throw new Error('local_proof_supabase_url_missing');
  const projectRef = new URL(supabaseUrl).host.split('.')[0];
  const userId = '00000000-0000-4000-8000-000000000033';
  const email = 'lightchain-all-feature-local-proof@example.test';
  const token = makeLocalJwt(userId, email);
  await browserContext.addInitScript(({ userId, email, projectRef, token }) => {
    const key = `sb-${projectRef}-auth-token`;
    window.localStorage.setItem(key, JSON.stringify({
      access_token: token,
      token_type: 'bearer',
      expires_at: Math.floor(Date.now() / 1000) + 60 * 60,
      expires_in: 60 * 60,
      refresh_token: 'local-proof-refresh',
      user: {
        id: userId,
        aud: 'authenticated',
        role: 'authenticated',
        email,
        user_metadata: { name: 'Local Proof User' },
        app_metadata: {},
      },
    }));
  }, { userId, email, projectRef, token });
}

function readEnvValue(name) {
  if (process.env[name]) return process.env[name];
  for (const file of ['.env.local', '.env.production.local', '.env']) {
    try {
      const text = fs.readFileSync(file, 'utf8');
      const line = text.split(/\r?\n/).filter((entry) => entry.startsWith(`${name}=`)).pop();
      if (line) return line.slice(name.length + 1).trim().replace(/^["']|["']$/g, '');
    } catch {
      // Try the next conventional Vite env file.
    }
  }
  return null;
}

function base64url(input) {
  return Buffer.from(JSON.stringify(input)).toString('base64url');
}

function makeLocalJwt(userId, email) {
  const now = Math.floor(Date.now() / 1000);
  return [
    base64url({ alg: 'none', typ: 'JWT' }),
    base64url({
      aud: 'authenticated',
      exp: now + 60 * 60,
      iat: now,
      role: 'authenticated',
      sub: userId,
      email,
      user_metadata: { name: 'Local Proof User' },
      app_metadata: {},
    }),
    'local-proof',
  ].join('.');
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
