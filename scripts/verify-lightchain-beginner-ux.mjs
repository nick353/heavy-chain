#!/usr/bin/env node

import fs from 'node:fs';
import path from 'node:path';
import { spawn } from 'node:child_process';
import { chromium } from '@playwright/test';

const args = parseArgs(process.argv.slice(2));
const baseUrl = trimTrailingSlash(args.baseUrl || process.env.HEAVY_CHAIN_BASE_URL || 'http://127.0.0.1:4173');
const authStatePath = args.authState || process.env.HEAVY_CHAIN_AUTH_STATE || 'output/playwright/prod-auth-refresh-20260625/auth-state.json';
const outDir = args.out || `output/playwright/lightchain-beginner-ux-${dateStamp()}`;
const canvasStoreKey = 'heavy-chain-canvas';
const desktopViewport = { width: 1365, height: 900 };
const mobileViewport = { width: 390, height: 844 };
const fixturePng =
  'iVBORw0KGgoAAAANSUhEUgAAASwAAACWCAIAAADrOSKFAAABfklEQVR4nO3VwQ2DMBQFQYp2/6mOBtYiHhSg2R+TR6VJ4FD3Yh8nAAAAAAAAAAAAAAAAAAAAAACwq3n7vQG8Lr3f93nP8xz7B2z67bLvG7BXn8z3/V6f8yP4nff4+v0G7NVd9j7f6wN4u9QzAAAAAAAAAAAAAAAAAADgT2EDAiwIsCDAggALAiysx8O+vV6vR3e73V6vV6vR6fP5/PL5fL1eL5fL5fL5fL5fK9Xq9Xq9Xq9Xq9Xq9Xq8vLy8vLy8vLy8vLy8vLy8vLy8vLy8vLy8vLy8vLy8vLy8vLw8Pj4+Pj4+Pj4+Pj4+Pj4+Pj4+Pj4+Pj4+Pj4+Pj4+Pj4+Pj4+Pg8PDw8PDw8PDw8PDw8PDw8PDw8PDw8PDw8PDw8PDw8PDw8PDw+Pj4+Pj4+Pj4+Pj4+Pj4+Pj4+Pj4+Pj4+Pj4+Pj4+Pj4+Pj4+Px8fn5+fn5+fn5+fn5+fn5+fn5+fn5+fn5+fn5+fn5+fn5+fn5+fAAAAAAAAAAAAAAAAAAAAAAD4O8EGAiwIsCDAggALAiysQw4oEJQ4AAAAAElFTkSuQmCC';

fs.mkdirSync(outDir, { recursive: true });
const uploadPath = path.join(outDir, 'beginner-upload.png');
fs.writeFileSync(uploadPath, Buffer.from(fixturePng, 'base64'));

const evidence = {
  workflow: 'lightchain-beginner-ux',
  capturedAt: new Date().toISOString(),
  baseUrl,
  outDir,
  authState: authStatePath,
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
    viewport: desktopViewport,
    recordVideo: { dir: path.join(outDir, 'videos'), size: desktopViewport },
  });
  const page = await context.newPage();
  wirePageDiagnostics(page, 'desktop');

  await page.goto(`${baseUrl}/lightchain/fitting-clothing-reference`, { waitUntil: 'networkidle' });
  await dismissBlockingOverlays(page);
  await page.evaluate((key) => window.localStorage.removeItem(key), canvasStoreKey);
  await screenshot(page, '01-desktop-empty');

  const emptyBody = await bodyText(page);
  const visibleButtonsBeforeUpload = await page.getByRole('button').evaluateAll((buttons) =>
    buttons.filter((button) => {
      const rect = button.getBoundingClientRect();
      return rect.width > 0 && rect.height > 0 && getComputedStyle(button).visibility !== 'hidden';
    }).map((button) => button.textContent?.trim()).filter(Boolean),
  );
  fs.writeFileSync(path.join(outDir, '01-empty-body.txt'), emptyBody);
  addAssertion('beginner_upload_only_before_upload', (
    emptyBody.includes('素材入力')
    && emptyBody.includes('衣服画像をアップロード')
    && !emptyBody.includes('AIマスク認識')
    && !emptyBody.includes('Canvasに注文票を保存')
  ), {
    bodyExcerpt: emptyBody.slice(0, 1200),
  });
  addAssertion('advanced_controls_hidden_before_upload', (
    !emptyBody.includes('詳細設定')
    && !emptyBody.includes('レイヤー詳細')
    && !emptyBody.includes('参考条件')
  ), {
    bodyExcerpt: emptyBody.slice(0, 1200),
  });
  addAssertion('visible_button_count_reduced_before_upload', visibleButtonsBeforeUpload.length <= 8, {
    count: visibleButtonsBeforeUpload.length,
    visibleButtonsBeforeUpload,
  });

  await page.locator('input[type="file"]').first().setInputFiles(uploadPath);
  await page.getByRole('button', { name: 'AIマスク認識' }).waitFor({ state: 'visible', timeout: 5000 });
  await page.getByRole('button', { name: /Canvasに注文票を保存/ }).waitFor({ state: 'visible', timeout: 5000 });
  await page.getByRole('button', { name: 'AIマスク認識' }).click();
  await page.getByRole('button', { name: '柄' }).click();
  await screenshot(page, '02-after-mask-candidates');
  await page.getByRole('button', { name: '抽出して次へ' }).click();
  await screenshot(page, '03-after-one-button-next');
  const nextBody = await bodyText(page);
  addAssertion('one_button_extract_next_completes_ready_state', nextBody.includes('次ステップ可') && nextBody.includes('OK'), {
    bodyExcerpt: nextBody.slice(0, 1200),
  });

  await page.getByRole('button', { name: /Canvasに注文票を保存/ }).click();
  await page.waitForURL(/\/canvas\//, { timeout: 20_000 });
  await page.waitForTimeout(800);
  await screenshot(page, '04-canvas-after-save');
  const storage = await page.evaluate((key) => window.localStorage.getItem(key), canvasStoreKey);
  const parsedStorage = storage ? JSON.parse(storage) : null;
  fs.writeFileSync(path.join(outDir, '04-canvas-storage.json'), `${JSON.stringify(parsedStorage, null, 2)}\n`);
  const project = Array.isArray(parsedStorage?.state?.projects)
    ? parsedStorage.state.projects.find((item) => item?.id === parsedStorage?.state?.currentProjectId)
    : null;
  const objects = Array.isArray(project?.objects) ? project.objects : [];
  const materialObject = objects.find((object) => object?.metadata?.feature === 'lightchain-fitting-clothing-reference-material-reference');
  addAssertion('canvas_save_readback_has_beginner_flow_metadata', materialObject?.metadata?.parameters?.compositionPreview?.flow === 'next-step-ready', {
    currentProjectId: parsedStorage?.state?.currentProjectId ?? null,
    compositionPreview: materialObject?.metadata?.parameters?.compositionPreview ?? null,
  });

  await page.setViewportSize(mobileViewport);
  await page.goto(`${baseUrl}/lightchain/fitting-clothing-reference`, { waitUntil: 'networkidle' });
  await dismissBlockingOverlays(page);
  await screenshot(page, '05-mobile-empty');
  const mobileBody = await bodyText(page);
  addAssertion('mobile_beginner_upload_only', (
    mobileBody.includes('素材入力')
    && mobileBody.includes('衣服画像をアップロード')
    && !mobileBody.includes('AIマスク認識')
    && !mobileBody.includes('Canvasに注文票を保存')
  ), {
    bodyExcerpt: mobileBody.slice(0, 1200),
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
  ...evidence.pageErrors.map((message) => `page_error:${message.message ?? message}`),
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
  summaryPath: path.join(outDir, 'SUMMARY.json'),
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

function wirePageDiagnostics(page, route) {
  page.on('console', (message) => {
    if (['error', 'warning'].includes(message.type())) {
      evidence.consoleMessages.push({ route, type: message.type(), text: message.text() });
    }
  });
  page.on('pageerror', (error) => evidence.pageErrors.push({ route, message: error.message }));
  page.on('requestfailed', (request) => {
    const failure = request.failure()?.errorText ?? 'unknown';
    if (failure === 'net::ERR_ABORTED') return;
    evidence.requestFailures.push({ route, url: request.url(), failure });
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

async function closePageAndGetVideo(page) {
  const video = page.video();
  await page.close();
  if (!video) return null;
  return video.path().catch(() => null);
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

function withTimeout(promise, timeoutMs) {
  return Promise.race([
    promise,
    new Promise((_, reject) => setTimeout(() => reject(new Error(`timeout:${timeoutMs}`)), timeoutMs)),
  ]);
}

function parseArgs(argv) {
  const result = {};
  for (let index = 0; index < argv.length; index += 1) {
    const current = argv[index];
    if (!current.startsWith('--')) continue;
    const key = current.slice(2);
    const next = argv[index + 1];
    if (next && !next.startsWith('--')) {
      result[key] = next;
      index += 1;
    } else {
      result[key] = true;
    }
  }
  return result;
}

function trimTrailingSlash(value) {
  return value.replace(/\/$/, '');
}

function dateStamp() {
  return new Date().toISOString().replace(/[-:]/g, '').replace(/\..+$/, 'Z');
}
