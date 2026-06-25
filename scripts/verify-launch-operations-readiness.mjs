#!/usr/bin/env node

import fs from 'node:fs';
import path from 'node:path';
import { chromium } from '@playwright/test';

const args = parseArgs(process.argv.slice(2));
const baseUrl = trimTrailingSlash(args.baseUrl || process.env.HEAVY_CHAIN_BASE_URL || 'https://heavy-chain.zeabur.app');
const authState = args.authState || process.env.HEAVY_CHAIN_AUTH_STATE || 'output/playwright/prod-auth-refresh-20260625/auth-state.json';
const outDir = args.out || `output/playwright/launch-operations-readiness-${dateStamp()}`;
const expectedAsset = args.expectedAsset || process.env.HEAVY_CHAIN_EXPECTED_ASSET || 'assets/index.CTWP3Xmm.js';

const evidence = {
  workflow: 'launch-operations-readiness',
  capturedAt: new Date().toISOString(),
  baseUrl,
  expectedAsset,
  authState,
  outDir,
  irreversibleActions: {
    generationSubmit: 'not_clicked',
    purchasePaymentCheckout: 'not_touched',
    externalPublish: 'not_touched',
    destructiveCleanup: 'not_touched',
  },
  checks: [],
  consoleMessages: [],
  pageErrors: [],
  networkFailures: [],
  screenshots: {},
  docs: {
    launchRunbook: 'docs/launch-operations-runbook-2026-06-25.md',
    productizationChecklist: 'docs/productization-final-checklist-2026-06-25.md',
    state: 'STATE.md',
  },
};

fs.mkdirSync(outDir, { recursive: true });

if (!fs.existsSync(authState)) {
  failEarly(`auth_state_missing: ${authState}`);
}

const browser = await chromium.launch({ headless: true });
const context = await browser.newContext({
  storageState: authState,
  viewport: { width: 1440, height: 1000 },
});

try {
  await checkProductionAsset();
  await checkRoute({
    key: 'dashboard',
    path: '/dashboard',
    expected: ['画像生成', 'ギャラリー'],
  });
  await checkGenerateForm();
  await checkGalleryImages();
  await checkCanvas();
  await checkPublicSurface();
  await checkMobileRoutes();
  await checkDocsAndProofFiles();
} finally {
  await context.close();
  await browser.close();
}

pushCheck('No relevant console/page errors', evidence.consoleMessages.length === 0 && evidence.pageErrors.length === 0, {
  consoleMessages: evidence.consoleMessages,
  pageErrors: evidence.pageErrors,
});
pushCheck('No app/Supabase HTTP request failures', evidence.networkFailures.length === 0, {
  networkFailures: evidence.networkFailures,
});

evidence.ok = evidence.checks.every((check) => check.passed);
evidence.failed = evidence.checks.filter((check) => !check.passed).map((check) => check.name);

const summaryPath = path.join(outDir, 'summary.json');
fs.writeFileSync(summaryPath, `${JSON.stringify(evidence, null, 2)}\n`);
console.log(JSON.stringify({ ok: evidence.ok, summaryPath, failed: evidence.failed }, null, 2));
process.exit(evidence.ok ? 0 : 1);

async function checkProductionAsset() {
  const response = await context.request.get(`${baseUrl}/`);
  const body = await response.text();
  pushCheck('Zeabur serves expected current asset', response.ok() && body.includes(expectedAsset), {
    status: response.status(),
    expectedAsset,
    found: body.includes(expectedAsset),
  });
}

async function checkRoute({ key, path: routePath, expected }) {
  const page = await newObservedPage();
  await page.goto(`${baseUrl}${routePath}`, { waitUntil: 'domcontentloaded' });
  await page.waitForLoadState('networkidle', { timeout: 20000 }).catch(() => undefined);
  await page.waitForTimeout(1000);
  const body = await page.locator('body').innerText({ timeout: 15000 }).catch((error) => `__ERROR__ ${error.message}`);
  const screenshot = `${outDir}/${key}.png`;
  await page.screenshot({ path: screenshot, fullPage: false });
  evidence.screenshots[key] = screenshot;
  pushCheck(`${key} route renders`, expected.every((text) => body.includes(text)) && !isLoginBody(body), {
    url: page.url(),
    expected,
    excerpt: body.slice(0, 1000),
    screenshot,
  });
  await page.close();
}

async function checkGenerateForm() {
  const page = await newObservedPage();
  await page.goto(`${baseUrl}/generate?feature=campaign-image`, { waitUntil: 'domcontentloaded' });
  await page.waitForLoadState('networkidle', { timeout: 20000 }).catch(() => undefined);
  const prompt = 'Heavy Chain black hoodie premium campaign visual, concrete studio, silver chain detail';
  const textarea = page.locator('textarea[placeholder*="夏のサマーセール"], textarea').first();
  await textarea.fill(prompt, { timeout: 15000 });
  const textareaValue = await textarea.inputValue();
  const button = page.getByRole('button', { name: /生成|Runway|作成/ }).first();
  const buttonVisible = await button.isVisible().catch(() => false);
  const body = await page.locator('body').innerText();
  const screenshot = `${outDir}/generate-form-filled-no-submit.png`;
  await page.screenshot({ path: screenshot, fullPage: false });
  evidence.screenshots.generateForm = screenshot;
  pushCheck('Generate form is editable without submitting', buttonVisible && textareaValue === prompt, {
    url: page.url(),
    prompt,
    textareaValue,
    generationSubmit: 'not_clicked',
    buttonVisible,
    excerpt: body.slice(0, 800),
    screenshot,
  });
  await page.close();
}

async function checkGalleryImages() {
  const page = await newObservedPage();
  await page.goto(`${baseUrl}/gallery`, { waitUntil: 'domcontentloaded' });
  await page.waitForLoadState('networkidle', { timeout: 20000 }).catch(() => undefined);
  await page.waitForFunction(() => {
    const text = document.body.innerText;
    const loadedImages = Array.from(document.images).filter((img) => img.complete && img.naturalWidth > 0);
    return loadedImages.length > 0 || /0枚の画像|画像がありません|まだ画像/.test(text);
  }, { timeout: 30000 }).catch(() => undefined);
  await page.mouse.wheel(0, 900);
  await page.waitForTimeout(1000);
  const images = (await page.locator('img').evaluateAll((nodes) =>
    nodes.map((img) => ({
      src: img.currentSrc || img.src,
      complete: img.complete,
      naturalWidth: img.naturalWidth,
      naturalHeight: img.naturalHeight,
    })).filter((item) => item.src)
  )).map((image) => ({
    ...image,
    src: sanitizeImageSrc(image.src),
  }));
  const screenshot = `${outDir}/gallery-images.png`;
  await page.screenshot({ path: screenshot, fullPage: false });
  evidence.screenshots.galleryImages = screenshot;
  pushCheck('Gallery loads reusable generated images', images.some((img) => img.complete && img.naturalWidth > 0), {
    url: page.url(),
    imageCount: images.length,
    loadedImages: images.filter((img) => img.complete && img.naturalWidth > 0).slice(0, 8),
    screenshot,
  });
  await page.close();
}

async function checkCanvas() {
  const page = await newObservedPage();
  await page.goto(`${baseUrl}/canvas/new`, { waitUntil: 'domcontentloaded' });
  await page.waitForLoadState('networkidle', { timeout: 20000 }).catch(() => undefined);
  await page.waitForFunction(() => {
    const text = document.body.innerText;
    return ['画像を置く', 'Galleryから追加', '保存'].every((item) => text.includes(item));
  }, { timeout: 30000 }).catch(() => undefined);
  const body = await page.locator('body').innerText({ timeout: 15000 });
  const screenshot = `${outDir}/canvas.png`;
  await page.screenshot({ path: screenshot, fullPage: false });
  evidence.screenshots.canvas = screenshot;
  pushCheck('Canvas opens with expected production tools', ['画像を置く', 'Galleryから追加', '保存'].every((text) => body.includes(text)), {
    url: page.url(),
    excerpt: body.slice(0, 1000),
    screenshot,
  });
  await page.close();
}

async function checkPublicSurface() {
  const page = await newObservedPage();
  await page.goto(`${baseUrl}/contact`, { waitUntil: 'domcontentloaded' });
  await page.waitForLoadState('networkidle', { timeout: 20000 }).catch(() => undefined);
  const body = await page.locator('body').innerText({ timeout: 15000 });
  const og = await context.request.get(`${baseUrl}/og-image.png`);
  const screenshot = `${outDir}/public-contact.png`;
  await page.screenshot({ path: screenshot, fullPage: false });
  evidence.screenshots.publicContact = screenshot;
  pushCheck('Public contact and OGP image are live', body.includes('お問い合わせ') && og.ok() && (og.headers()['content-type'] || '').includes('image/png'), {
    contactUrl: page.url(),
    ogStatus: og.status(),
    ogContentType: og.headers()['content-type'],
    screenshot,
  });
  await page.close();
}

async function checkMobileRoutes() {
  const mobile = await browser.newContext({
    storageState: authState,
    viewport: { width: 390, height: 844 },
    isMobile: true,
  });
  const mobileChecks = [
    { key: 'mobile-generate', path: '/generate?feature=campaign-image', expected: ['画像生成'] },
    { key: 'mobile-gallery', path: '/gallery', expected: ['ギャラリー'] },
    { key: 'mobile-canvas', path: '/canvas/new', expected: ['キャンバス'] },
  ];

  try {
    for (const item of mobileChecks) {
      const page = await mobile.newPage();
      page.on('console', (message) => recordConsole(message));
      page.on('pageerror', (error) => evidence.pageErrors.push(error.message));
      page.on('requestfailed', (request) => recordRequestFailure(request));
      await page.goto(`${baseUrl}${item.path}`, { waitUntil: 'domcontentloaded' });
      await page.waitForLoadState('networkidle', { timeout: 20000 }).catch(() => undefined);
      await page.waitForTimeout(1000);
      const body = await page.locator('body').innerText({ timeout: 15000 });
      const screenshot = `${outDir}/${item.key}.png`;
      await page.screenshot({ path: screenshot, fullPage: false });
      evidence.screenshots[item.key] = screenshot;
      pushCheck(`${item.key} route renders`, item.expected.every((text) => body.includes(text)) && !isLoginBody(body), {
        url: page.url(),
        expected: item.expected,
        excerpt: body.slice(0, 800),
        screenshot,
      });
      await page.close();
    }
  } finally {
    await mobile.close();
  }
}

async function checkDocsAndProofFiles() {
  const requiredFiles = [
    'STATE.md',
    'docs/productization-final-checklist-2026-06-25.md',
    'docs/launch-operations-runbook-2026-06-25.md',
    'output/playwright/heavy-chain-final-auth-uat-20260625/final-combined-summary.json',
    'output/playwright/heavy-chain-final-auth-uat-20260625-targeted/summary.json',
    'output/playwright/prod-auth-refresh-20260625/summary.json',
    'output/final-uat-20260625/runway-heavy-chain-hoodie.png',
  ];
  const missing = requiredFiles.filter((file) => !fs.existsSync(file));
  const finalSummary = readJson('output/playwright/heavy-chain-final-auth-uat-20260625/final-combined-summary.json');
  const targetedSummary = readJson('output/playwright/heavy-chain-final-auth-uat-20260625-targeted/summary.json');
  const authSummary = readJson('output/playwright/prod-auth-refresh-20260625/summary.json');
  const runwayImage = pngDimensions('output/final-uat-20260625/runway-heavy-chain-hoodie.png');
  const stateText = readText('STATE.md');
  const checklistText = readText('docs/productization-final-checklist-2026-06-25.md');
  const runbookText = readText('docs/launch-operations-runbook-2026-06-25.md');
  const docsStateExpectedText = [
    'verify:launch-ops',
    expectedAsset,
    outDir,
    'read-only',
    'without submit',
    'not_clicked',
    'output/playwright/prod-auth-refresh-20260625/auth-state.json',
  ];
  const docsStateCombined = `${stateText}\n${checklistText}\n${runbookText}\n${JSON.stringify(evidence.irreversibleActions)}`;
  const missingDocsStateText = docsStateExpectedText.filter((text) => !docsStateCombined.includes(text));
  pushCheck('Launch proof bundle is present and internally passing', missing.length === 0 && finalSummary?.ok === true && targetedSummary?.ok === true && authSummary?.ok === true && runwayImage.width === 1536 && runwayImage.height === 1920 && missingDocsStateText.length === 0, {
    missing,
    missingDocsStateText,
    finalSummaryOk: finalSummary?.ok,
    targetedSummaryOk: targetedSummary?.ok,
    authSummaryOk: authSummary?.ok,
    runwayImage,
  });
}

async function newObservedPage() {
  const page = await context.newPage();
  attachPageObservers(page);
  return page;
}

function attachPageObservers(page) {
  page.on('console', (message) => recordConsole(message));
  page.on('pageerror', (error) => evidence.pageErrors.push(error.message));
  page.on('requestfailed', (request) => recordRequestFailure(request));
}

function recordConsole(message) {
  if (!['error', 'warning'].includes(message.type())) return;
  const text = message.text();
  if (/Failed to load resource: the server responded with a status of 404.*favicon/i.test(text)) return;
  evidence.consoleMessages.push({ type: message.type(), text });
}

function recordRequestFailure(request) {
  const url = request.url();
  if (!/heavy-chain\.zeabur\.app|supabase\.co/.test(url)) return;
  evidence.networkFailures.push({
    url: sanitizeImageSrc(url),
    method: request.method(),
    failure: request.failure()?.errorText || 'unknown',
  });
}

function sanitizeImageSrc(src) {
  try {
    const url = new URL(src);
    if (url.pathname.includes('/storage/v1/object/sign/')) {
      return `${url.origin}/storage/v1/object/sign/[redacted]`;
    }
    url.search = '';
    url.hash = '';
    return url.toString();
  } catch {
    return src.split('?')[0].split('#')[0];
  }
}

function readText(filePath) {
  try {
    return fs.readFileSync(filePath, 'utf8');
  } catch {
    return '';
  }
}

function pushCheck(name, passed, details) {
  evidence.checks.push({ name, passed: Boolean(passed), details });
}

function failEarly(exactBlocker) {
  evidence.ok = false;
  evidence.exactBlocker = exactBlocker;
  const summaryPath = path.join(outDir, 'summary.json');
  fs.writeFileSync(summaryPath, `${JSON.stringify(evidence, null, 2)}\n`);
  console.error(JSON.stringify({ ok: false, summaryPath, exactBlocker }, null, 2));
  process.exit(1);
}

function isLoginBody(body) {
  return /ログイン|メールアドレス|パスワード/.test(body) && !/画像生成|ギャラリー|キャンバス/.test(body);
}

function readJson(filePath) {
  try {
    return JSON.parse(fs.readFileSync(filePath, 'utf8'));
  } catch {
    return null;
  }
}

function pngDimensions(filePath) {
  try {
    const buffer = fs.readFileSync(filePath);
    if (buffer.toString('ascii', 1, 4) !== 'PNG') return { width: null, height: null };
    return { width: buffer.readUInt32BE(16), height: buffer.readUInt32BE(20) };
  } catch {
    return { width: null, height: null };
  }
}

function parseArgs(argv) {
  const parsed = {};
  for (let index = 0; index < argv.length; index += 1) {
    const item = argv[index];
    if (!item.startsWith('--')) continue;
    const key = item.slice(2);
    const next = argv[index + 1];
    parsed[key] = next && !next.startsWith('--') ? next : true;
    if (parsed[key] === next) index += 1;
  }
  return parsed;
}

function trimTrailingSlash(value) {
  return value.replace(/\/+$/, '');
}

function dateStamp() {
  return new Date().toISOString().slice(0, 10).replaceAll('-', '');
}
