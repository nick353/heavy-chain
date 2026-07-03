#!/usr/bin/env node

import fs from 'node:fs';
import path from 'node:path';
import { spawn } from 'node:child_process';
import { chromium } from '@playwright/test';

const args = parseArgs(process.argv.slice(2));
const baseUrl = trimTrailingSlash(args.baseUrl || process.env.HEAVY_CHAIN_BASE_URL || 'http://127.0.0.1:4173');
const authStatePath = args.authState || process.env.HEAVY_CHAIN_AUTH_STATE || 'output/playwright/prod-auth-refresh-20260625/auth-state.json';
const outDir = args.out || `output/playwright/g605-onboarding-templates-${dateStamp()}`;
const canvasStoreKey = 'heavy-chain-canvas';
const desktopViewport = { width: 1440, height: 1050 };
const mobileViewport = { width: 390, height: 844 };

fs.mkdirSync(outDir, { recursive: true });

let previewProcess = null;
let browser = null;
let desktopContext = null;
let mobileContext = null;

const evidence = {
  workflow: 'g605-onboarding-templates',
  capturedAt: new Date().toISOString(),
  baseUrl,
  authState: authStatePath,
  outDir,
  screenshots: {},
  videos: {},
  consoleMessages: [],
  pageErrors: [],
  requestFailures: [],
  assertions: [],
  cleanup: {
    desktopContextClosed: false,
    mobileContextClosed: false,
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

  desktopContext = await browser.newContext({
    storageState,
    viewport: desktopViewport,
    acceptDownloads: true,
    recordVideo: {
      dir: path.join(outDir, 'videos-desktop'),
      size: desktopViewport,
    },
  });
  await installFirstRunState(desktopContext);

  const page = await desktopContext.newPage();
  wirePageDiagnostics(page, 'desktop');

  await page.goto(`${baseUrl}/dashboard`, { waitUntil: 'networkidle' });
  await page.getByText('Heavy Chainへようこそ').waitFor({ timeout: 6000 });
  await page.screenshot({ path: path.join(outDir, '01-dashboard-first-run-onboarding.png'), fullPage: true });
  evidence.screenshots.dashboardFirstRun = path.join(outDir, '01-dashboard-first-run-onboarding.png');

  const firstRunBody = await bodyText(page);
  const firstRunNextVisible = await page.getByRole('button', { name: '次へ' }).isVisible();
  addAssertion('first_run_onboarding_visible', firstRunBody.includes('Heavy Chainへようこそ') && firstRunNextVisible, {
    url: page.url(),
    firstRunNextVisible,
  });

  for (let index = 0; index < 4; index += 1) {
    await page.getByRole('button', { name: '次へ' }).click();
    await page.waitForTimeout(200);
  }
  await page.getByRole('button', { name: /始める/ }).click();
  await page.waitForTimeout(700);
  await page.screenshot({ path: path.join(outDir, '02-dashboard-after-onboarding.png'), fullPage: true });
  evidence.screenshots.dashboardAfterOnboarding = path.join(outDir, '02-dashboard-after-onboarding.png');
  const dashboardAfterBody = await bodyText(page);
  fs.writeFileSync(path.join(outDir, '02-dashboard-body.txt'), dashboardAfterBody);
  const firstActionLinks = await page.evaluate(() => Array.from(document.querySelectorAll('a[href]')).map((anchor) => ({
    text: anchor.textContent?.replace(/\s+/g, ' ').trim() || '',
    href: anchor.getAttribute('href') || '',
  })));
  const visibleButtons = await page.evaluate(() => Array.from(document.querySelectorAll('button')).map((button) => (
    button.textContent?.replace(/\s+/g, ' ').trim() || ''
  )).filter(Boolean));
  const canvasEntry = firstActionLinks.find((link) => (
    ['/canvas', '/canvas/new'].includes(link.href) && /Canvas|キャンバス/i.test(link.text)
  ));
  const generateEntry = firstActionLinks.find((link) => (
    link.href === '/generate' && /生成|制作|新しく/.test(link.text)
  ));
  addAssertion('dashboard_first_actions_available', Boolean(canvasEntry && generateEntry), {
    canvasEntry,
    generateEntry,
    matchingLinks: firstActionLinks.filter((link) => ['/canvas/new', '/generate'].includes(link.href)),
  });

  await page.evaluate((key) => window.localStorage.removeItem(key), canvasStoreKey);
  await page.goto(`${baseUrl}/canvas/new`, { waitUntil: 'networkidle' });
  await page.waitForTimeout(1200);
  await page.screenshot({ path: path.join(outDir, '03-canvas-empty-before-template.png'), fullPage: true });
  evidence.screenshots.canvasEmpty = path.join(outDir, '03-canvas-empty-before-template.png');
  const emptyBody = await bodyText(page);
  fs.writeFileSync(path.join(outDir, '03-canvas-empty-body.txt'), emptyBody);
  const templateButtonVisible = await page.locator('button[title="テンプレート"]').isVisible();
  addAssertion('canvas_empty_state_has_template_entry', templateButtonVisible && emptyBody.includes('プロパティ'), {
    url: page.url(),
    templateButtonVisible,
  });

  await page.locator('button[title="テンプレート"]').click();
  await page.locator('button').filter({ hasText: /^EC$/ }).first().click();
  await page.getByRole('button', { name: /サイズテンプレート ECサムネイル/ }).click();
  await page.waitForTimeout(700);
  await page.screenshot({ path: path.join(outDir, '04-canvas-size-template-added.png'), fullPage: true });
  evidence.screenshots.sizeTemplate = path.join(outDir, '04-canvas-size-template-added.png');

  await page.locator('button[title="テンプレート"]').click();
  await page.getByRole('button', { name: 'デザイン' }).click();
  await page.getByRole('button', { name: /デザインテンプレート 商品カード/ }).waitFor({ timeout: 3000 });
  await page.getByRole('button', { name: /デザインテンプレート 商品カード/ }).click();
  await page.waitForTimeout(900);
  await page.screenshot({ path: path.join(outDir, '05-canvas-design-template-expanded.png'), fullPage: true });
  evidence.screenshots.designTemplate = path.join(outDir, '05-canvas-design-template-expanded.png');

  const storage = await page.evaluate((key) => window.localStorage.getItem(key), canvasStoreKey);
  const parsedStorage = storage ? JSON.parse(storage) : null;
  fs.writeFileSync(path.join(outDir, '05-canvas-storage.json'), `${JSON.stringify(parsedStorage, null, 2)}\n`);
  const currentObjects = Array.isArray(parsedStorage?.state?.objects) ? parsedStorage.state.objects : [];
  const sizeTemplate = currentObjects.find((object) => object?.metadata?.feature === 'canvas-size-template' && object?.metadata?.parameters?.templateId === 'ec-square');
  const designObjects = currentObjects.filter((object) => object?.metadata?.feature === 'canvas-design-template' && object?.metadata?.parameters?.templateId === 'product-card');
  const designText = designObjects.filter((object) => object.type === 'text').map((object) => object.text);
  const designFrames = designObjects.filter((object) => object.type === 'frame');

  addAssertion('size_template_persisted', Boolean(sizeTemplate), {
    templateName: sizeTemplate?.metadata?.parameters?.templateName ?? null,
    width: sizeTemplate?.width ?? null,
    height: sizeTemplate?.height ?? null,
  });
  addAssertion('design_template_expanded_to_layers', designObjects.length >= 4 && designFrames.length >= 2 && designText.includes('商品名') && designText.includes('¥0,000'), {
    objectCount: designObjects.length,
    frameCount: designFrames.length,
    texts: designText,
  });
  addAssertion('design_template_metadata_links_children', designObjects.some((object) => object.parentId && object.derivedFrom), {
    linkedObjects: designObjects.filter((object) => object.parentId && object.derivedFrom).length,
  });

  evidence.videos.desktop = await closePageAndGetVideo(page);
  addAssertion('desktop_video_recorded', Boolean(evidence.videos.desktop), { video: evidence.videos.desktop });

  await installFirstRunState(desktopContext);
  const mobilePage = await desktopContext.newPage();
  await mobilePage.setViewportSize(mobileViewport);
  wirePageDiagnostics(mobilePage, 'mobile');
  await mobilePage.goto(`${baseUrl}/dashboard`, { waitUntil: 'networkidle' });
  await mobilePage.screenshot({ path: path.join(outDir, '06-mobile-first-run-onboarding.png'), fullPage: true });
  evidence.screenshots.mobileOnboarding = path.join(outDir, '06-mobile-first-run-onboarding.png');
  const mobileBody = await bodyText(mobilePage);
  addAssertion('mobile_onboarding_visible_without_overflow_blocker', mobileBody.includes('Heavy Chainへようこそ') && await mobilePage.getByRole('button', { name: '次へ' }).isVisible(), {
    viewport: mobileViewport,
  });
  evidence.videos.mobile = await closePageAndGetVideo(mobilePage);
  addAssertion('mobile_video_recorded', Boolean(evidence.videos.mobile), { video: evidence.videos.mobile });
} catch (error) {
  evidence.exactBlocker = error.message;
  addAssertion('route_exception_free', false, { error: error.message });
} finally {
  if (desktopContext) {
    await withTimeout(desktopContext.close(), 10000, 'desktop_context_close_timeout')
      .then(() => {
        evidence.cleanup.desktopContextClosed = true;
      })
      .catch((error) => {
        evidence.cleanup.desktopContextCloseBlocker = error.message;
      });
  } else {
    evidence.cleanup.desktopContextClosed = true;
  }
  if (mobileContext) {
    await withTimeout(mobileContext.close(), 10000, 'mobile_context_close_timeout')
      .then(() => {
        evidence.cleanup.mobileContextClosed = true;
      })
      .catch((error) => {
        evidence.cleanup.mobileContextCloseBlocker = error.message;
      });
  } else {
    evidence.cleanup.mobileContextClosed = true;
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
    const previewExit = await stopPreviewServer(previewProcess, baseUrl);
    evidence.cleanup.previewProcessExit = previewExit;
    evidence.cleanup.previewStopped = previewExit.exited === true && previewExit.portFree === true;
  } else {
    evidence.cleanup.previewStopped = true;
  }
}

evidence.ok = evidence.assertions.every((assertion) => assertion.passed)
  && evidence.cleanup.desktopContextClosed
  && evidence.cleanup.mobileContextClosed
  && evidence.cleanup.browserClosed
  && evidence.cleanup.previewStopped
  && evidence.consoleMessages.length === 0
  && evidence.pageErrors.length === 0
  && evidence.requestFailures.length === 0;
evidence.failed = evidence.assertions.filter((assertion) => !assertion.passed).map((assertion) => assertion.name);
fs.writeFileSync(path.join(outDir, 'SUMMARY.json'), `${JSON.stringify(evidence, null, 2)}\n`);
console.log(JSON.stringify({ ok: evidence.ok, summaryPath: path.join(outDir, 'SUMMARY.json'), failed: evidence.failed }, null, 2));
process.exit(evidence.ok ? 0 : 1);

function addAssertion(name, passed, details = {}) {
  evidence.assertions.push({ name, passed: Boolean(passed), details });
  if (!passed && !evidence.exactBlocker) {
    evidence.exactBlocker = name;
  }
}

async function installFirstRunState(context) {
  await context.addInitScript((canvasKey) => {
    for (const key of Object.keys(window.localStorage)) {
      if (key === 'onboarding_completed' || key.startsWith('heavy_chain_onboarding_completed')) {
        window.localStorage.removeItem(key);
      }
    }
    window.localStorage.removeItem(canvasKey);
  }, canvasStoreKey);
}

function buildStorageStateForBaseUrl(filePath, targetBaseUrl) {
  const state = JSON.parse(fs.readFileSync(filePath, 'utf8'));
  const targetOrigin = new URL(targetBaseUrl).origin;
  for (const origin of state.origins ?? []) {
    origin.localStorage = (origin.localStorage ?? []).filter((item) => (
      item.name !== 'onboarding_completed' && !item.name.startsWith('heavy_chain_onboarding_completed')
    ));
  }
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
  if (await serverAlreadyResponds(targetBaseUrl)) {
    throw new Error(`preview_port_already_in_use:${targetBaseUrl}`);
  }
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

async function stopPreviewServer(child, targetBaseUrl) {
  const proof = {
    pid: child.pid ?? null,
    exited: false,
    exit: null,
    portFree: false,
  };

  if (child.exitCode === null && child.signalCode === null) {
    child.kill('SIGTERM');
  }

  proof.exit = await waitForProcessExit(child, 5000).catch(async (error) => {
    child.kill('SIGKILL');
    const sigkillExit = await waitForProcessExit(child, 5000).catch((killError) => ({
      code: child.exitCode,
      signal: child.signalCode,
      error: killError.message,
    }));
    return {
      code: child.exitCode,
      signal: child.signalCode,
      error: error.message,
      sigkillExit,
    };
  });

  proof.exited = child.exitCode !== null || child.signalCode !== null;
  proof.portFree = !(await serverAlreadyResponds(targetBaseUrl));
  return proof;
}

function waitForProcessExit(child, timeoutMs) {
  if (child.exitCode !== null || child.signalCode !== null) {
    return Promise.resolve({ code: child.exitCode, signal: child.signalCode });
  }

  return new Promise((resolve, reject) => {
    const timeout = setTimeout(() => {
      cleanup();
      reject(new Error('preview_process_exit_timeout'));
    }, timeoutMs);
    const onClose = (code, signal) => {
      cleanup();
      resolve({ code, signal });
    };
    const cleanup = () => {
      clearTimeout(timeout);
      child.off('close', onClose);
    };
    child.once('close', onClose);
  });
}

async function serverAlreadyResponds(targetBaseUrl) {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 500);
  try {
    const response = await fetch(targetBaseUrl, { signal: controller.signal });
    return response.ok || response.status < 500;
  } catch {
    return false;
  } finally {
    clearTimeout(timeout);
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
