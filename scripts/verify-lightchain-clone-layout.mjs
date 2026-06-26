#!/usr/bin/env node

import fs from 'node:fs';
import path from 'node:path';
import { chromium } from '@playwright/test';

const args = parseArgs(process.argv.slice(2));
const baseUrl = trimTrailingSlash(args.baseUrl || process.env.HEAVY_CHAIN_BASE_URL || 'https://heavy-chain.zeabur.app');
const authStatePath = args.authState || process.env.HEAVY_CHAIN_AUTH_STATE || 'output/playwright/prod-auth-refresh-20260625/auth-state.json';
const outDir = args.out || `output/playwright/lightchain-clone-layout-${dateStamp()}`;
const imagePath = args.image || process.env.HEAVY_CHAIN_QA_IMAGE || '/Users/nichikatanaka/Downloads/S__4235312(1).jpg';

const desktopViewport = { width: 1440, height: 1050 };
const mobileViewport = { width: 390, height: 844 };

const categoryLabels = ['おすすめ', '企画デザインツール', 'AIフィッティング', 'グラフィックツール'];
const directFeatures = [
  { key: 'planning-color', url: '/generate?feature=colorize&lcFeature=change-color', title: '色変更', category: '企画デザインツール' },
  { key: 'fitting-model', url: '/generate?feature=model-matrix&lcFeature=model-body-shape', title: '体型・サイズ変更', category: 'AIフィッティング' },
  { key: 'graphics-remove-bg', url: '/generate?feature=remove-bg&lcFeature=remove-background', title: '背景削除・切り抜き', category: 'グラフィックツール' },
  { key: 'graphics-variations', url: '/generate?feature=generate-variations&lcFeature=design-arrange', title: 'デザインアレンジ', category: 'グラフィックツール' },
  { key: 'graphics-image-variations', url: '/generate?feature=generate-variations&lcFeature=image-variations', title: '類似バリエーション生成', category: 'グラフィックツール' },
];

const evidence = {
  workflow: 'lightchain-clone-layout-parity',
  capturedAt: new Date().toISOString(),
  baseUrl,
  authState: authStatePath,
  targetKind: /^https?:\/\/(127\.0\.0\.1|localhost)/.test(baseUrl) ? 'local-preview' : 'deployed',
  imagePath,
  outDir,
  irreversibleActions: {
    generationSubmit: 'not_clicked',
    purchasePaymentCheckout: 'not_touched',
    externalPublish: 'not_touched',
    destructiveDelete: 'not_touched',
  },
  routes: [],
  consoleMessages: [],
  pageErrors: [],
  requestFailures: [],
  cleanup: {
    contextClosed: false,
    browserClosed: false,
  },
};

fs.mkdirSync(outDir, { recursive: true });

if (!fs.existsSync(authStatePath)) {
  failEarly(`auth_state_missing:${authStatePath}`);
}

if (!fs.existsSync(imagePath)) {
  failEarly(`qa_image_missing:${imagePath}`);
}

const browser = await chromium.launch({ headless: true });
let context;
let publicContext;

try {
  publicContext = await browser.newContext({
    viewport: desktopViewport,
    recordVideo: {
      dir: path.join(outDir, 'videos'),
      size: desktopViewport,
    },
  });
  evidence.routes.push(await verifyPublicRoute(publicContext, desktopViewport, {
    key: 'public-landing',
    route: '/',
    expected: ['HEAVY CHAIN AI', 'おすすめ', '企画デザインツール', 'AIフィッティング', 'グラフィックツール'],
  }));
  evidence.routes.push(await verifyPublicRoute(publicContext, desktopViewport, {
    key: 'public-login',
    route: '/login',
    expected: ['HEAVYCHAIN', 'アカウントIDを下に入力してログインをお願いします。', 'ログイン'],
  }));
  await withTimeout(publicContext.close(), 10000, 'public_context_close_timeout');
  publicContext = null;

  const storageState = buildStorageStateForBaseUrl(authStatePath, baseUrl);
  context = await browser.newContext({
    storageState,
    viewport: desktopViewport,
    recordVideo: {
      dir: path.join(outDir, 'videos'),
      size: desktopViewport,
    },
  });

  evidence.routes.push(await verifyHome(context, desktopViewport, 'desktop-home'));
  evidence.routes.push(await verifyFeatureFromHome(context, desktopViewport));
  for (const spec of directFeatures) {
    evidence.routes.push(await verifyFeature(context, desktopViewport, spec));
  }
  evidence.routes.push(await verifyHome(context, mobileViewport, 'mobile-home'));
  evidence.routes.push(await verifyFeature(context, mobileViewport, { ...directFeatures[2], key: 'mobile-graphics-remove-bg' }));
} finally {
  if (publicContext) {
    await withTimeout(publicContext.close(), 10000, 'public_context_close_timeout').catch((error) => {
      evidence.cleanup.publicContextCloseBlocker = error.message;
    });
  }
  if (context) {
    await withTimeout(context.close(), 10000, 'context_close_timeout')
      .then(() => {
        evidence.cleanup.contextClosed = true;
      })
      .catch((error) => {
        evidence.cleanup.closeBlocker = error.message;
      });
  }
  await withTimeout(browser.close(), 10000, 'browser_close_timeout')
    .then(() => {
      evidence.cleanup.browserClosed = true;
    })
    .catch((error) => {
      evidence.cleanup.browserCloseBlocker = error.message;
    });
}

evidence.ok = computeOk(evidence);
evidence.failed = collectFailures(evidence);
const summaryPath = path.join(outDir, 'SUMMARY.json');
fs.writeFileSync(summaryPath, `${JSON.stringify(evidence, null, 2)}\n`);
console.log(JSON.stringify({ ok: evidence.ok, summaryPath, failed: evidence.failed }, null, 2));
process.exit(evidence.ok ? 0 : 1);

async function verifyHome(context, viewport, key) {
  const page = await newTrackedPage(context, key, viewport);
  const routeEvidence = newRouteEvidence(key, '/generate', viewport);
  try {
    await gotoAndSettle(page, '/generate');
    await captureBaseState(page, routeEvidence, {
      expected: ['HEAVY CHAIN AI', ...categoryLabels, 'マーケティングワークスペース', 'AIフィッティング'],
    });
    await assertHomeLayout(page, routeEvidence);
    await clickCategories(page, routeEvidence);
    await useCommandSearch(page, routeEvidence);
    routeEvidence.screenshot = await screenshot(page, `${key}.png`);
  } catch (error) {
    markException(routeEvidence, error);
  } finally {
    routeEvidence.video = await closePageAndGetVideo(page);
  }
  return routeEvidence;
}

async function verifyPublicRoute(context, viewport, spec) {
  const page = await newTrackedPage(context, spec.key, viewport);
  const routeEvidence = newRouteEvidence(spec.key, spec.route, viewport);
  try {
    await gotoAndSettle(page, spec.route);
    await captureBaseState(page, routeEvidence, { expected: spec.expected, allowLoginRoute: spec.route === '/login' });
    const body = await bodyText(page);
    addAssertion(routeEvidence, 'lightchain_public_shell_visible', body.includes('HEAVYCHAIN') || body.includes('HEAVY CHAIN AI'));
    addAssertion(routeEvidence, 'legacy_light_shell_absent', !/Lightchain互換\s+履歴\s+ジョブ\s+チーム/.test(body));
    routeEvidence.screenshot = await screenshot(page, `${spec.key}.png`);
  } catch (error) {
    markException(routeEvidence, error);
  } finally {
    routeEvidence.video = await closePageAndGetVideo(page);
  }
  return routeEvidence;
}

async function verifyFeatureFromHome(context, viewport) {
  const page = await newTrackedPage(context, 'home-click-to-feature', viewport);
  const routeEvidence = newRouteEvidence('home-click-to-feature', '/generate', viewport);
  try {
    await gotoAndSettle(page, '/generate');
    await captureBaseState(page, routeEvidence, {
      expected: ['HEAVY CHAIN AI', ...categoryLabels, 'マーケティングワークスペース', 'AIフィッティング'],
    });
    const initialBody = await bodyText(page);
    addAssertion(routeEvidence, 'home_has_no_generation_input_panel_before_feature_click', !initialBody.includes('入力素材') && !initialBody.includes('AIアシスタント'));

    const graphicsButton = page.getByRole('button', { name: /グラフィックツール/ }).first();
    await graphicsButton.click();
    await page.waitForTimeout(250);
    routeEvidence.interactions.push({ type: 'category-click', label: 'グラフィックツール' });

    const featureLink = page.getByRole('link', { name: /背景削除・切り抜き/ }).first();
    const featureVisible = await featureLink.isVisible().catch(() => false);
    addAssertion(routeEvidence, 'feature_card_visible_after_category_click', featureVisible);
    const href = await featureLink.getAttribute('href').catch(() => null);
    addAssertion(routeEvidence, 'feature_card_link_targets_generate_detail', Boolean(href && href.includes('feature=remove-bg') && href.includes('lcFeature=remove-background')), { href });

    const variationsLink = page.getByRole('link', { name: /類似バリエーション生成/ }).first();
    const variationsVisible = await variationsLink.isVisible().catch(() => false);
    const variationsHref = await variationsLink.getAttribute('href').catch(() => null);
    addAssertion(routeEvidence, 'image_variations_visible_in_graphics_category', variationsVisible, { variationsHref });
    addAssertion(routeEvidence, 'image_variations_targets_generate_variations', Boolean(
      variationsHref
        && variationsHref.includes('feature=generate-variations')
        && variationsHref.includes('lcFeature=image-variations'),
    ), { variationsHref });

    if (featureVisible) {
      await Promise.all([
        page.waitForURL(/feature=remove-bg.*lcFeature=remove-background|lcFeature=remove-background.*feature=remove-bg/, { timeout: 15000 }),
        featureLink.click(),
      ]);
      await page.waitForLoadState('networkidle', { timeout: 15000 }).catch(() => undefined);
      await page.waitForTimeout(700);
      routeEvidence.interactions.push({ type: 'feature-card-click', label: '背景削除・切り抜き', href, finalUrl: page.url() });
    }

    const detailBody = await bodyText(page);
    addAssertion(routeEvidence, 'feature_start_click_opens_generation_input_panel', detailBody.includes('入力素材') && detailBody.includes('デザイン作成'));
    addAssertion(routeEvidence, 'result_panel_still_hidden_before_submit', !detailBody.includes('まだ生成結果はありません'));
    addAssertion(routeEvidence, 'detail_has_no_large_category_hero', !detailBody.includes('アパレル特化のAIデザインワークスペース。指示を入力するか'));
    routeEvidence.url = page.url();
    routeEvidence.domExcerpt = detailBody.slice(0, 1800);
    routeEvidence.screenshot = await screenshot(page, 'home-click-to-feature.png');
  } catch (error) {
    markException(routeEvidence, error);
  } finally {
    routeEvidence.video = await closePageAndGetVideo(page);
  }
  return routeEvidence;
}

async function verifyFeature(context, viewport, spec) {
  const page = await newTrackedPage(context, spec.key, viewport);
  const routeEvidence = newRouteEvidence(spec.key, spec.url, viewport);
  try {
    await gotoAndSettle(page, spec.url);
    await captureBaseState(page, routeEvidence, {
      expected: [spec.title, spec.category, '戻る', '選択', 'ドラッグ', '入力素材', 'デザイン作成', '運用状態・互換情報'],
    });
    await assertFeatureLayout(page, routeEvidence, spec);
    await uploadReferenceImage(page, routeEvidence);
    await fillPromptAndPlan(page, routeEvidence);
    await openOperationsDetails(page, routeEvidence);
    routeEvidence.screenshot = await screenshot(page, `${spec.key}.png`);
  } catch (error) {
    markException(routeEvidence, error);
  } finally {
    routeEvidence.video = await closePageAndGetVideo(page);
  }
  return routeEvidence;
}

async function newTrackedPage(context, routeKey, viewport) {
  const page = await context.newPage();
  await page.setViewportSize(viewport);
  page.on('console', (message) => recordConsole(message, routeKey));
  page.on('pageerror', (error) => evidence.pageErrors.push({ route: routeKey, message: error.message }));
  page.on('requestfailed', (request) => recordRequestFailure(request, routeKey));
  return page;
}

function newRouteEvidence(key, route, viewport) {
  return {
    key,
    route,
    viewport,
    url: null,
    title: null,
    screenshot: null,
    video: null,
    domExcerpt: null,
    assertions: [],
    interactions: [],
    exactBlocker: null,
  };
}

async function gotoAndSettle(page, route) {
  await page.goto(`${baseUrl}${route}`, { waitUntil: 'domcontentloaded', timeout: 45000 });
  await page.waitForLoadState('networkidle', { timeout: 15000 }).catch(() => undefined);
  await page.waitForTimeout(800);
  await page.waitForFunction(() => !document.body.innerText.includes('読み込み中...'), null, { timeout: 15000 }).catch(() => undefined);
}

async function captureBaseState(page, routeEvidence, { expected, allowLoginRoute = false }) {
  routeEvidence.url = page.url();
  routeEvidence.title = await page.title();
  const body = await bodyText(page);
  routeEvidence.domExcerpt = body.slice(0, 1800);
  addAssertion(routeEvidence, 'not_unexpected_login_redirect', allowLoginRoute || (!isLoginBody(body) && !routeEvidence.url.includes('/login')), {
    url: routeEvidence.url,
  });
  addAssertion(routeEvidence, 'meaningful_page_content', body.trim().length > 120, {
    bodyLength: body.trim().length,
  });
  addAssertion(routeEvidence, 'expected_text_visible', expected.every((text) => body.includes(text)), { expected });
  addAssertion(routeEvidence, 'no_framework_overlay', !hasFrameworkOverlay(body));
  addAssertion(routeEvidence, 'no_horizontal_overflow', await hasNoHorizontalOverflow(page));
}

async function assertHomeLayout(page, routeEvidence) {
  const buttons = await page.locator('button').evaluateAll((nodes) => nodes.map((node) => node.textContent?.trim() ?? ''));
  const categoriesPresent = categoryLabels.every((label) => buttons.some((text) => text.includes(label)));
  addAssertion(routeEvidence, 'four_lightchain_categories_present', categoriesPresent, { buttons });
  const cardCount = await page.locator('a[href]').filter({ hasText: /マーケティング|AIフィッティング|ウェア|動画|モデル|ファッション|デザイン|Heavy Chain Lab/ }).count();
  addAssertion(routeEvidence, 'lightchain_like_workspace_cards_present', cardCount >= 4, { cardCount });
  const nestedSidebarText = await page.locator('body').innerText();
  addAssertion(routeEvidence, 'no_duplicate_vertical_sidebar_labels', !/動画\s+ラボ\s+Lightchain互換\s+履歴\s+ジョブ\s+チーム/.test(nestedSidebarText));
}

async function clickCategories(page, routeEvidence) {
  for (const label of categoryLabels) {
    const button = page.getByRole('button', { name: new RegExp(label) }).first();
    const visible = await button.isVisible().catch(() => false);
    addAssertion(routeEvidence, `category_${label}_button_visible`, visible);
    if (!visible) continue;
    await button.click();
    await page.waitForTimeout(250);
    const body = await bodyText(page);
    routeEvidence.interactions.push({ type: 'category-click', label, reflected: body.includes(label) });
    addAssertion(routeEvidence, `category_${label}_click_reflected`, body.includes(label));
  }
}

async function useCommandSearch(page, routeEvidence) {
  const input = page.getByPlaceholder(/指示を入力してください/).first();
  const visible = await input.isVisible().catch(() => false);
  addAssertion(routeEvidence, 'command_input_visible', visible);
  if (!visible) return;
  await input.fill('背景削除してCanvasで編集');
  const startLink = page.getByRole('link', { name: /開始/ }).first();
  const href = await startLink.getAttribute('href').catch(() => null);
  routeEvidence.interactions.push({ type: 'command-route-suggestion', href });
  addAssertion(routeEvidence, 'command_start_link_targets_background_removal', Boolean(href && href.includes('feature=remove-bg') && href.includes('lcFeature=remove-background')));
}

async function assertFeatureLayout(page, routeEvidence, spec) {
  const body = await bodyText(page);
  const projectPanel = page.getByTestId('lightchain-project-panel');
  const detailTabs = page.getByTestId('lightchain-detail-tabs');
  const toolbar = page.getByTestId('lightchain-canvas-toolbar');
  const inputPanel = page.getByTestId('lightchain-input-material-panel');
  const projectText = await projectPanel.innerText({ timeout: 5000 }).catch(() => '');
  const tabsLinks = await detailTabs.locator('a[href]').evaluateAll((nodes) => nodes.map((node) => ({
    text: node.textContent?.trim() ?? '',
    href: node.getAttribute('href') ?? '',
  }))).catch(() => []);
  const toolbarText = await toolbar.innerText({ timeout: 5000 }).catch(() => '');
  const inputText = await inputPanel.innerText({ timeout: 5000 }).catch(() => '');

  addAssertion(routeEvidence, 'lightchain_project_panel_present', projectText.includes('Untitled') && projectText.includes('作業モード'), {
    projectText: projectText.slice(0, 500),
  });
  addAssertion(routeEvidence, 'lightchain_detail_tabs_present', tabsLinks.length > 0 && tabsLinks.every((link) => link.href.startsWith('/generate?')), {
    tabsLinks,
  });
  addAssertion(routeEvidence, 'lightchain_canvas_toolbar_present', toolbarText.includes('選択') && toolbarText.includes('ドラッグ') && toolbarText.includes('前にステップ') && toolbarText.includes('次のステップ'), {
    toolbarText,
  });
  addAssertion(routeEvidence, 'middle_input_panel_present', inputText.includes('入力素材') || inputText.includes('モデル/デザイン画像') || inputText.includes('参考画像'), {
    inputText: inputText.slice(0, 500),
  });
  addAssertion(routeEvidence, 'empty_result_panel_hidden_before_generation', !body.includes('まだ生成結果はありません'));
  addAssertion(routeEvidence, 'large_category_hero_absent_on_detail', !body.includes('アパレル特化のAIデザインワークスペース。指示を入力するか'));
  addAssertion(routeEvidence, 'operational_details_collapsed_present', body.includes('運用状態・互換情報'));
}

async function uploadReferenceImage(page, routeEvidence) {
  const upload = page.locator('input[type="file"]').first();
  const count = await upload.count();
  routeEvidence.interactions.push({ type: 'upload-input-count', count });
  addAssertion(routeEvidence, 'upload_input_present', count > 0);
  if (!count) return;
  await upload.setInputFiles(imagePath);
  await page.waitForTimeout(700);
  const body = await bodyText(page);
  const reflected = /S__4235312|読込済み|選択中|画像|素材/.test(body);
  routeEvidence.interactions.push({ type: 'upload-image', reflected });
  addAssertion(routeEvidence, 'upload_reflected_in_ui', reflected);
  routeEvidence.uploadScreenshot = await screenshot(page, `${routeEvidence.key}-uploaded.png`);
}

async function fillPromptAndPlan(page, routeEvidence) {
  const designSummary = page.getByText('デザイン作成').first();
  const designSummaryVisible = await designSummary.isVisible().catch(() => false);
  if (designSummaryVisible) {
    await designSummary.click();
    await page.waitForTimeout(250);
    routeEvidence.interactions.push({ type: 'open-design-create-panel' });
  }
  const assistant = page.getByPlaceholder(/例:|モデル|SNS|背景|生成/).first();
  const visible = await assistant.isVisible().catch(() => false);
  routeEvidence.interactions.push({ type: 'assistant-prompt-present', visible });
  addAssertion(routeEvidence, 'assistant_prompt_visible', visible);
  if (visible) {
    await assistant.fill('黒のチェーン柄フーディーをECとSNSで使える高級感のある見せ方にしてください');
  }
  const planButton = page.getByRole('button', { name: /生成計画を作る/ }).first();
  const planVisible = await planButton.isVisible().catch(() => false);
  routeEvidence.interactions.push({ type: 'planning-button-present', planVisible });
  if (planVisible) {
    await planButton.click();
    await page.waitForTimeout(700);
    const body = await bodyText(page);
    const planReflected = body.includes('生成計画') && /商品ヒーロー|着用|固定要素|比較|背景/.test(body);
    routeEvidence.interactions.push({ type: 'planning-preview-created', planReflected });
    addAssertion(routeEvidence, 'planning_preview_created_without_submit', planReflected);
  }
}

async function openOperationsDetails(page, routeEvidence) {
  const summary = page.getByText('運用状態・互換情報').first();
  const visible = await summary.isVisible().catch(() => false);
  routeEvidence.interactions.push({ type: 'operations-details-present', visible });
  addAssertion(routeEvidence, 'operations_details_visible', visible);
  if (!visible) return;
  await summary.click();
  await page.waitForTimeout(300);
  const body = await bodyText(page);
  addAssertion(routeEvidence, 'operations_details_expands', /Runway|ローカル|Lightchain互換|履歴|Gallery|Canvas/.test(body));
}

function buildStorageStateForBaseUrl(filePath, targetBaseUrl) {
  const state = JSON.parse(fs.readFileSync(filePath, 'utf8'));
  const targetOrigin = new URL(targetBaseUrl).origin;
  if (/^https?:\/\/(127\.0\.0\.1|localhost)/.test(targetOrigin)) {
    const prodOrigin = state.origins?.find((origin) => origin.origin === 'https://heavy-chain.zeabur.app') ?? state.origins?.[0];
    if (prodOrigin?.localStorage) {
      state.origins = [
        ...(state.origins ?? []).filter((origin) => origin.origin !== targetOrigin),
        { origin: targetOrigin, localStorage: prodOrigin.localStorage },
      ];
    }
  }
  return state;
}

async function bodyText(page) {
  return page.locator('body').innerText({ timeout: 8000 }).catch(() => '');
}

async function hasNoHorizontalOverflow(page) {
  return page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth + 2).catch(() => false);
}

async function screenshot(page, fileName) {
  const filePath = path.join(outDir, fileName);
  await page.screenshot({ path: filePath, fullPage: true });
  return filePath;
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

function addAssertion(routeEvidence, name, passed, details = {}) {
  routeEvidence.assertions.push({ name, passed: Boolean(passed), details });
  if (!passed && !routeEvidence.exactBlocker) {
    routeEvidence.exactBlocker = name;
  }
}

function markException(routeEvidence, error) {
  routeEvidence.exactBlocker = `route_exception:${error.message}`;
  addAssertion(routeEvidence, 'route_exception_free', false, { error: error.message });
}

function recordConsole(message, route) {
  if (!['error', 'warning'].includes(message.type())) return;
  const text = message.text();
  if (/Download the React DevTools|favicon/.test(text)) return;
  evidence.consoleMessages.push({ route, type: message.type(), text });
}

function recordRequestFailure(request, route) {
  const url = request.url();
  if (url.includes('favicon')) return;
  const failureText = request.failure()?.errorText ?? null;
  if (failureText === 'net::ERR_ABORTED' && url.includes('/storage/v1/object/sign/')) return;
  evidence.requestFailures.push({ route, url, failure: failureText });
}

function computeOk(result) {
  return result.routes.every((route) => route.assertions.every((assertion) => assertion.passed))
    && result.routes.every((route) => Boolean(route.video))
    && result.cleanup.contextClosed === true
    && result.cleanup.browserClosed === true
    && !result.cleanup.closeBlocker
    && !result.cleanup.browserCloseBlocker
    && result.consoleMessages.length === 0
    && result.pageErrors.length === 0
    && result.requestFailures.length === 0;
}

function collectFailures(result) {
  return [
    ...result.routes.flatMap((route) => route.assertions
      .filter((assertion) => !assertion.passed)
      .map((assertion) => `${route.key}:${assertion.name}`)),
    ...result.routes.filter((route) => !route.video).map((route) => `${route.key}:video_missing`),
    ...(result.cleanup.contextClosed ? [] : ['cleanup:context_close_failed']),
    ...(result.cleanup.browserClosed ? [] : ['cleanup:browser_close_failed']),
    ...(result.cleanup.closeBlocker ? [`cleanup:${result.cleanup.closeBlocker}`] : []),
    ...(result.cleanup.browserCloseBlocker ? [`cleanup:${result.cleanup.browserCloseBlocker}`] : []),
    ...result.consoleMessages.map((message) => `${message.route}:console:${message.text}`),
    ...result.pageErrors.map((error) => `${error.route}:pageerror:${error.message}`),
    ...result.requestFailures.map((failure) => `${failure.route}:requestfailed:${failure.url}`),
  ];
}

function isLoginBody(body) {
  return /アカウントにログインしてください|Googleでログイン|メールアドレス\nパスワード/.test(body);
}

function hasFrameworkOverlay(body) {
  return /Internal Server Error|Unhandled Runtime Error|ReferenceError|TypeError|Vite Error|Something went wrong/i.test(body);
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

function failEarly(message) {
  fs.mkdirSync(outDir, { recursive: true });
  const summaryPath = path.join(outDir, 'SUMMARY.json');
  fs.writeFileSync(summaryPath, `${JSON.stringify({
    workflow: 'lightchain-clone-layout-parity',
    capturedAt: new Date().toISOString(),
    ok: false,
    exactBlocker: message,
    baseUrl,
    authState: authStatePath,
    outDir,
  }, null, 2)}\n`);
  console.error(message);
  process.exit(1);
}
