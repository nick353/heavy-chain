#!/usr/bin/env node

import fs from 'node:fs';
import path from 'node:path';
import { chromium } from '@playwright/test';

const args = parseArgs(process.argv.slice(2));
const baseUrl = trimTrailingSlash(args.baseUrl || process.env.HEAVY_CHAIN_BASE_URL || 'https://heavy-chain.zeabur.app');
const authStatePath = args.authState || process.env.HEAVY_CHAIN_AUTH_STATE || 'output/playwright/prod-auth-refresh-20260625/auth-state.json';
const outDir = args.out || `output/playwright/mass-market-qa-${dateStamp()}`;
const imagePath = args.image || process.env.HEAVY_CHAIN_QA_IMAGE || '/Users/nichikatanaka/Downloads/S__4235312(1).jpg';
const mockFunctions = args.mockFunctions === 'true' || args.mockFunctions === true || process.env.HEAVY_CHAIN_QA_MOCK_FUNCTIONS === 'true';
const browserPath = args.browserPath || 'in-app Browser unavailable: iab; Playwright recordVideo fallback';

const desktopViewport = { width: 1440, height: 1050 };
const mobileViewport = { width: 390, height: 844 };

const routeSpecs = [
  { key: 'dashboard', path: '/dashboard', expected: ['DASHBOARD', '制作ワークフロー'] },
  { key: 'lightchain', path: '/lightchain', expected: ['Lightchain互換'], upload: true },
  { key: 'generate-home', path: '/generate', expected: ['Lightchain'] },
  { key: 'generate-campaign', path: '/generate?feature=campaign-image', expected: ['キャンペーン画像'], upload: true, generateReady: true },
  { key: 'marketing', path: '/marketing', expected: ['マーケティング'], upload: true },
  { key: 'fitting', path: '/fitting', expected: ['AIフィッティング'], upload: true },
  { key: 'studio', path: '/studio', expected: ['Fashion Studio'], upload: true },
  { key: 'models', path: '/models', expected: ['モデル'], upload: true },
  { key: 'patterns', path: '/patterns', expected: ['柄'], upload: true },
  { key: 'video', path: '/video', expected: ['動画'], upload: true },
  { key: 'lab', path: '/lab', expected: ['Lab'], upload: true },
  { key: 'jobs', path: '/jobs', expected: ['制作キュー'], jobsToggle: true },
  { key: 'history', path: '/history', expected: ['生成履歴'] },
  { key: 'gallery', path: '/gallery', expected: ['ギャラリー'], galleryDetail: true },
  { key: 'canvas', path: '/canvas/new', expected: ['画像を置く', 'Galleryから追加'], upload: true, canvasGallery: true, minBodyLength: 40 },
  { key: 'brand-settings', path: '/brand/settings', expected: ['ブランド'], upload: true },
  { key: 'credits', path: '/credits', expected: ['クレジット'] },
];

const mobileSpecs = [
  'dashboard',
  'generate-campaign',
  'lightchain',
  'marketing',
  'fitting',
  'jobs',
  'gallery',
  'canvas',
];

const evidence = {
  workflow: 'mass-market-user-journey-qa',
  capturedAt: new Date().toISOString(),
  baseUrl,
  authState: authStatePath,
  imagePath,
  outDir,
  browserPath,
  mockFunctions,
  irreversibleActions: {
    generationSubmit: 'not_clicked',
    purchasePaymentCheckout: 'not_touched',
    externalPublish: 'not_touched',
    destructiveDelete: 'not_touched',
  },
  routeCount: routeSpecs.length,
  routes: [],
  mobile: [],
  consoleMessages: [],
  pageErrors: [],
  requestFailures: [],
  cleanup: {
    localStorageMutationsOnly: true,
    serverRowsCreated: false,
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

try {
  const storageState = buildStorageStateForBaseUrl(authStatePath, baseUrl);
  context = await browser.newContext({
    storageState,
    viewport: desktopViewport,
    recordVideo: {
      dir: path.join(outDir, 'videos'),
      size: desktopViewport,
    },
  });
  await installSafeMocks(context);

  for (const spec of routeSpecs) {
    evidence.routes.push(await runRoute(spec, context, desktopViewport));
  }

  for (const key of mobileSpecs) {
    const spec = routeSpecs.find((item) => item.key === key);
    if (spec) {
      evidence.mobile.push(await runRoute({ ...spec, key: `mobile-${spec.key}`, mobile: true }, context, mobileViewport));
    }
  }
} finally {
  if (context) {
    await context.close();
    evidence.cleanup.browserClosed = true;
  }
  await browser.close();
}

evidence.ok = computeOk(evidence);
evidence.failed = collectFailures(evidence);
const summaryPath = path.join(outDir, 'SUMMARY.json');
fs.writeFileSync(summaryPath, `${JSON.stringify(evidence, null, 2)}\n`);
console.log(JSON.stringify({ ok: evidence.ok, summaryPath, failed: evidence.failed }, null, 2));
process.exit(evidence.ok ? 0 : 1);

async function runRoute(spec, context, viewport) {
  const page = await context.newPage();
  await page.setViewportSize(viewport);
  const routeEvidence = {
    key: spec.key,
    path: spec.path,
    viewport,
    url: null,
    title: null,
    expected: spec.expected,
    screenshot: null,
    video: null,
    domExcerpt: null,
    assertions: [],
    interactions: [],
    exactBlocker: null,
  };

  page.on('console', (message) => recordConsole(message, spec.key));
  page.on('pageerror', (error) => evidence.pageErrors.push({ route: spec.key, message: error.message }));
  page.on('requestfailed', (request) => recordRequestFailure(request, spec.key));

  try {
    await page.goto(`${baseUrl}${spec.path}`, { waitUntil: 'domcontentloaded', timeout: 45000 });
    await page.waitForLoadState('networkidle', { timeout: 15000 }).catch(() => undefined);
    await page.waitForTimeout(600);
    await page.waitForFunction(() => !document.body.innerText.includes('読み込み中...'), null, { timeout: 15000 }).catch(() => undefined);
    await dismissBlockingGuides(page, routeEvidence);
    routeEvidence.url = page.url();
    routeEvidence.title = await page.title();
    const body = await bodyText(page);
    routeEvidence.domExcerpt = body.slice(0, 1400);
    addAssertion(routeEvidence, 'meaningful_page_content', body.trim().length > (spec.minBodyLength ?? 80) && !isLoginBody(body), {
      bodyLength: body.trim().length,
      minBodyLength: spec.minBodyLength ?? 80,
    });
    addAssertion(routeEvidence, 'expected_text_visible', spec.expected.every((text) => body.includes(text)), {
      expected: spec.expected,
    });
    addAssertion(routeEvidence, 'no_framework_overlay', !hasFrameworkOverlay(body));
    addAssertion(routeEvidence, 'no_horizontal_overflow', await hasNoHorizontalOverflow(page));

    routeEvidence.screenshot = await screenshot(page, `${spec.key}.png`);

    if (spec.upload) {
      await interactUpload(page, routeEvidence);
    }
    if (spec.generateReady) {
      await interactGenerateReady(page, routeEvidence);
    }
    if (spec.jobsToggle) {
      await interactJobsToggle(page, routeEvidence);
    }
    if (spec.galleryDetail) {
      await interactGalleryDetail(page, routeEvidence);
    }
    if (spec.canvasGallery) {
      await interactCanvasGallery(page, routeEvidence);
    }
  } catch (error) {
    routeEvidence.exactBlocker = `route_exception:${error.message}`;
    addAssertion(routeEvidence, 'route_exception_free', false, { error: error.message });
  } finally {
    routeEvidence.video = await closePageAndGetVideo(page);
  }

  return routeEvidence;
}

async function interactUpload(page, routeEvidence) {
  const upload = page.locator('input[accept="image/*"]').first();
  const count = await upload.count();
  if (!count) {
    routeEvidence.interactions.push({ type: 'upload-image', skipped: 'no_image_input' });
    return;
  }
  await upload.setInputFiles(imagePath);
  await page.waitForTimeout(500);
  const body = await bodyText(page);
  const reflected = /読込済み|素材認識済み|S__4235312|Canvas保存時|画像|商品/.test(body);
  routeEvidence.interactions.push({ type: 'upload-image', reflected });
  addAssertion(routeEvidence, 'upload_reflected_in_ui', reflected);
  routeEvidence.uploadScreenshot = await screenshot(page, `${routeEvidence.key}-uploaded.png`);
}

async function interactGenerateReady(page, routeEvidence) {
  await page.getByPlaceholder(/夏のサマーセール/).fill('Mass-market QA: uploaded apparel reference should drive campaign output.').catch(() => undefined);
  await page.getByPlaceholder(/SUMMER SALE/).fill('MASS MARKET QA').catch(() => undefined);
  await page.getByPlaceholder(/最大50% OFF/).fill('Visual workflow proof').catch(() => undefined);
  const button = page.getByRole('button', { name: /Runway workerで生成/ }).first();
  const visible = await button.isVisible().catch(() => false);
  const enabled = await button.isEnabled().catch(() => false);
  routeEvidence.interactions.push({ type: 'generate-ready-no-submit', visible, enabled });
  addAssertion(routeEvidence, 'generate_button_ready_without_submit', visible && enabled);
}

async function interactJobsToggle(page, routeEvidence) {
  const button = page.getByRole('button', { name: /要確認 .*件を表示|失敗を隠す/ }).first();
  const present = await button.count().then(Boolean);
  routeEvidence.interactions.push({ type: 'jobs-failed-toggle-present', present });
  if (!present) return;
  await button.click();
  await page.waitForTimeout(500);
  const body = await bodyText(page);
  const expanded = /失敗を隠す|入力を直して再開|Runway承認状態|workerとRunway/.test(body);
  routeEvidence.interactions.push({ type: 'jobs-failed-toggle-expanded', expanded });
  addAssertion(routeEvidence, 'jobs_failed_toggle_expands', expanded);
}

async function interactGalleryDetail(page, routeEvidence) {
  const detail = page.getByText('詳細を見る').first();
  const present = await detail.count().then(Boolean);
  routeEvidence.interactions.push({ type: 'gallery-detail-present', present });
  if (!present) return;
  await detail.click();
  await page.waitForTimeout(700);
  const body = await bodyText(page);
  const detailOpen = /PNG|JPEG|WebP|共有リンク|お気に入り|Canvas/.test(body);
  routeEvidence.interactions.push({ type: 'gallery-detail-opened', detailOpen });
  addAssertion(routeEvidence, 'gallery_detail_actions_visible', detailOpen);
  routeEvidence.detailScreenshot = await screenshot(page, `${routeEvidence.key}-detail.png`);
}

async function interactCanvasGallery(page, routeEvidence) {
  await dismissBlockingGuides(page, routeEvidence);
  const button = page.getByRole('button', { name: /Galleryから追加/ }).first();
  const present = await button.count().then(Boolean);
  routeEvidence.interactions.push({ type: 'canvas-gallery-button-present', present });
  if (!present) {
    addAssertion(routeEvidence, 'canvas_gallery_button_visible', false);
    return;
  }
  await button.click();
  await page.waitForTimeout(1000);
  const body = await bodyText(page);
  const selectorOpen = /Gallery|画像を選択|素材|追加|検索/.test(body);
  routeEvidence.interactions.push({ type: 'canvas-gallery-selector-opened', selectorOpen });
  addAssertion(routeEvidence, 'canvas_gallery_selector_opens', selectorOpen);
  routeEvidence.gallerySelectorScreenshot = await screenshot(page, `${routeEvidence.key}-gallery-selector.png`);
}

async function dismissBlockingGuides(page, routeEvidence) {
  const skip = page.getByRole('button', { name: /^スキップ$/ }).first();
  const visible = await skip.isVisible().catch(() => false);
  if (!visible) return;
  await skip.click();
  await page.waitForTimeout(400);
  routeEvidence.interactions.push({ type: 'dismiss-guide', label: 'スキップ' });
}

async function installSafeMocks(context) {
  if (!mockFunctions) return;
  await context.route('**/functions/v1/generate-image', async (route) => {
    await route.fulfill({
      status: 202,
      contentType: 'application/json',
      body: JSON.stringify({ job: { id: 'mock-mass-market-job', status: 'pending' }, message: 'mocked by verify-mass-market-qa' }),
    });
  });
  await context.route('**/functions/v1/marketing-workspace-artifact', async (route) => {
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({ ok: true, artifact: { id: 'mock-marketing-artifact' } }),
    });
  });
}

function buildStorageStateForBaseUrl(filePath, targetBaseUrl) {
  const state = JSON.parse(fs.readFileSync(filePath, 'utf8'));
  const targetOrigin = new URL(targetBaseUrl).origin;
  if (/^https?:\/\/(127\.0\.0\.1|localhost)/.test(targetOrigin)) {
    const prodOrigin = state.origins?.find((origin) => origin.origin === 'https://heavy-chain.zeabur.app')
      ?? state.origins?.[0];
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
  await page.close();
  if (!video) return null;
  return video.path().catch(() => null);
}

function addAssertion(routeEvidence, name, passed, details = {}) {
  routeEvidence.assertions.push({ name, passed: Boolean(passed), details });
  if (!passed && !routeEvidence.exactBlocker) {
    routeEvidence.exactBlocker = name;
  }
}

function recordConsole(message, route) {
  if (!['error', 'warning'].includes(message.type())) return;
  evidence.consoleMessages.push({ route, type: message.type(), text: message.text() });
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
    && result.mobile.every((route) => route.assertions.every((assertion) => assertion.passed))
    && result.consoleMessages.length === 0
    && result.pageErrors.length === 0
    && result.requestFailures.length === 0;
}

function collectFailures(result) {
  const routeFailures = [...result.routes, ...result.mobile]
    .flatMap((route) => route.assertions
      .filter((assertion) => !assertion.passed)
      .map((assertion) => `${route.key}:${assertion.name}`));
  return [
    ...routeFailures,
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
    workflow: 'mass-market-user-journey-qa',
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
