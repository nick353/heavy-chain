#!/usr/bin/env node

import fs from 'node:fs';
import path from 'node:path';
import { spawn } from 'node:child_process';
import { chromium } from '@playwright/test';

const args = parseArgs(process.argv.slice(2));
const baseUrl = trimTrailingSlash(args.baseUrl || process.env.HEAVY_CHAIN_BASE_URL || 'http://127.0.0.1:4173');
const authStatePath = args.authState || process.env.HEAVY_CHAIN_AUTH_STATE || 'output/playwright/prod-auth-refresh-20260625/auth-state.json';
const outDir = args.out || `output/playwright/g610-retention-project-search-${dateStamp()}`;
const canvasStoreKey = 'heavy-chain-canvas';
const viewport = { width: 1440, height: 1050 };

fs.mkdirSync(outDir, { recursive: true });

let previewProcess = null;
let browser = null;
let context = null;

const evidence = {
  workflow: 'g610-retention-project-search',
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
  const authUserId = extractAuthUserId(storageState);

  browser = await chromium.launch({ headless: true });
  context = await browser.newContext({
    storageState,
    viewport,
    recordVideo: {
      dir: path.join(outDir, 'videos'),
      size: viewport,
    },
  });
  await installProjectFixture(context, baseUrl, authUserId);

  const page = await context.newPage();
  wirePageDiagnostics(page);

  await page.goto(`${baseUrl}/dashboard`, { waitUntil: 'networkidle' });
  await page.getByRole('heading', { name: 'プロジェクト' }).waitFor({ timeout: 8000 });
  await page.screenshot({ path: path.join(outDir, '01-dashboard-projects.png'), fullPage: true });
  evidence.screenshots.dashboardProjects = path.join(outDir, '01-dashboard-projects.png');

  const searchInput = page.getByLabel('プロジェクトを検索');
  await searchInput.waitFor({ timeout: 5000 });
  const initialBody = await bodyText(page);
  addAssertion('dashboard_project_search_visible', await searchInput.isVisible(), {
    bodyExcerpt: initialBody.slice(0, 700),
  });
  addAssertion('dashboard_shows_recent_count', /最近の6件 \/ 全8件/.test(initialBody), {
    countTextFound: initialBody.includes('最近の6件 / 全8件'),
  });

  await searchInput.fill('hoodie');
  await page.waitForTimeout(300);
  await page.screenshot({ path: path.join(outDir, '02-search-hoodie.png'), fullPage: true });
  evidence.screenshots.searchHoodie = path.join(outDir, '02-search-hoodie.png');
  const hoodieBody = await bodyText(page);
  addAssertion('search_filters_by_project_name', hoodieBody.includes('Hoodie Campaign Workspace') && !hoodieBody.includes('Lookbook Moodboard'), {
    countText: textMatch(hoodieBody, /\d+件 \/ 全8件/),
  });

  await searchInput.fill('image');
  await page.waitForTimeout(300);
  const imageBody = await bodyText(page);
  addAssertion('search_filters_by_object_type', imageBody.includes('Hoodie Campaign Workspace') && imageBody.includes('Product Detail Retouch'), {
    countText: textMatch(imageBody, /\d+件 \/ 全8件/),
  });

  await searchInput.fill('画像');
  await page.waitForTimeout(300);
  const japaneseImageBody = await bodyText(page);
  addAssertion('search_filters_by_japanese_object_type', japaneseImageBody.includes('Hoodie Campaign Workspace') && japaneseImageBody.includes('Product Detail Retouch'), {
    countText: textMatch(japaneseImageBody, /\d+件 \/ 全8件/),
  });

  await searchInput.fill('no-match-retention-proof');
  await page.waitForTimeout(300);
  await page.screenshot({ path: path.join(outDir, '03-search-empty.png'), fullPage: true });
  evidence.screenshots.searchEmpty = path.join(outDir, '03-search-empty.png');
  const emptyBody = await bodyText(page);
  addAssertion('search_empty_state_visible', emptyBody.includes('一致するプロジェクトがありません') && emptyBody.includes('検索をクリア'), {
    bodyExcerpt: emptyBody.slice(0, 700),
  });

  await page.getByRole('button', { name: '検索をクリア', exact: true }).click();
  await page.waitForTimeout(300);
  const clearedBody = await bodyText(page);
  addAssertion('search_clear_restores_recent_projects', clearedBody.includes('最近の6件 / 全8件') && clearedBody.includes('Hoodie Campaign Workspace'), {
    countText: textMatch(clearedBody, /最近の\d+件 \/ 全8件/),
  });

  await searchInput.fill('season');
  await page.getByRole('button', { name: 'Season Palette Boardのメニューを開く' }).click();
  await page.getByRole('button', { name: 'Season Palette Boardを削除' }).click();
  await page.waitForTimeout(400);
  const afterDeleteBody = await bodyText(page);
  addAssertion('project_delete_still_works_from_filtered_results', !afterDeleteBody.includes('Season Palette Board') && afterDeleteBody.includes('一致するプロジェクトがありません'), {
    bodyExcerpt: afterDeleteBody.slice(0, 700),
  });

  await page.getByRole('button', { name: '検索をクリア', exact: true }).click();
  await page.getByText('Hoodie Campaign Workspace').click();
  await page.waitForURL(/\/canvas\/g610-project-hoodie/, { timeout: 8000 });
  await page.screenshot({ path: path.join(outDir, '04-open-project.png'), fullPage: true });
  evidence.screenshots.openProject = path.join(outDir, '04-open-project.png');
  const canvasReadback = await readCanvasStorage(page);
  addAssertion('open_project_navigates_to_canvas', page.url().includes('/canvas/g610-project-hoodie'), {
    url: page.url(),
  });
  addAssertion('opened_project_storage_readback_matches_canvas_project', canvasReadback.currentProjectId === 'g610-project-hoodie' && canvasReadback.objectCount === 1, {
    currentProjectId: canvasReadback.currentProjectId,
    currentProjectName: canvasReadback.currentProjectName,
    objectCount: canvasReadback.objectCount,
  });

  evidence.videos.desktop = await closePageAndGetVideo(page);
  addAssertion('video_recorded', Boolean(evidence.videos.desktop), { video: evidence.videos.desktop });
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
  } else {
    evidence.cleanup.contextClosed = true;
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
    const previewExit = await stopPreviewServer(previewProcess, baseUrl);
    evidence.cleanup.previewProcessExit = previewExit;
    evidence.cleanup.previewStopped = previewExit.exited === true && previewExit.portFree === true;
  } else {
    evidence.cleanup.previewStopped = true;
  }
}

evidence.ok = evidence.assertions.every((assertion) => assertion.passed) &&
  evidence.cleanup.contextClosed === true &&
  evidence.cleanup.browserClosed === true &&
  evidence.cleanup.previewStopped === true;
evidence.failed = evidence.assertions.filter((assertion) => !assertion.passed).map((assertion) => assertion.name);
fs.writeFileSync(path.join(outDir, 'SUMMARY.json'), `${JSON.stringify(evidence, null, 2)}\n`);
console.log(JSON.stringify({ ok: evidence.ok, outDir, failed: evidence.failed }, null, 2));
process.exit(evidence.ok ? 0 : 1);

async function installProjectFixture(context, targetBaseUrl, userId) {
  const fixture = buildProjectStorageFixture();
  await context.addInitScript(({ key, value, completedKey }) => {
    window.localStorage.setItem(key, JSON.stringify(value));
    window.localStorage.setItem(completedKey, 'true');
    window.localStorage.removeItem('onboarding_completed');
  }, { key: canvasStoreKey, value: fixture, completedKey: onboardingCompletedKey(userId) });

  const page = await context.newPage();
  await page.goto(`${targetBaseUrl}/dashboard`, { waitUntil: 'domcontentloaded' });
  await page.evaluate(({ key, value, completedKey }) => {
    window.localStorage.setItem(key, JSON.stringify(value));
    window.localStorage.setItem(completedKey, 'true');
    window.localStorage.removeItem('onboarding_completed');
  }, { key: canvasStoreKey, value: fixture, completedKey: onboardingCompletedKey(userId) });
  await page.close();
}

function buildProjectStorageFixture() {
  const now = Date.now();
  const projects = [
    project('g610-project-hoodie', 'Hoodie Campaign Workspace', now - 1_000, 'image'),
    project('g610-project-detail', 'Product Detail Retouch', now - 2_000, 'image'),
    project('g610-project-type', 'Typography Launch Banner', now - 3_000, 'text'),
    project('g610-project-lookbook', 'Lookbook Moodboard', now - 4_000, 'frame'),
    project('g610-project-template', 'EC Template Reuse', now - 5_000, 'shape'),
    project('g610-project-team', 'Team Review Canvas', now - 6_000, 'text'),
    project('g610-project-season', 'Season Palette Board', now - 7_000, 'shape'),
    project('g610-project-archive', 'Archive Chain Assets', now - 8_000, 'frame'),
  ];
  return {
    state: {
      currentProjectId: null,
      currentProjectName: 'プロジェクト名',
      projects,
      zoom: 1,
      panX: 0,
      panY: 0,
      gridVisible: true,
      snapToGrid: true,
      gridSize: 20,
      objects: [],
      selectedIds: [],
      history: [[]],
      historyIndex: 0,
    },
    version: 0,
  };
}

function project(id, name, updatedMs, objectType) {
  const updatedAt = new Date(updatedMs).toISOString();
  return {
    id,
    name,
    createdAt: new Date(updatedMs - 60_000).toISOString(),
    updatedAt,
    brandId: 'g610-brand',
    objects: [
      {
        id: `${id}-object`,
        type: objectType,
        x: 120,
        y: 120,
        width: 220,
        height: 140,
        rotation: 0,
        scaleX: 1,
        scaleY: 1,
        opacity: 1,
        locked: false,
        visible: true,
        zIndex: 1,
        ...(objectType === 'text' ? { text: name, fontSize: 24, fontFamily: 'Noto Sans JP', fill: '#111827' } : {}),
        ...(objectType === 'image' ? { src: tinyPngDataUri() } : {}),
        ...(objectType === 'shape' ? { shapeType: 'rect', fill: '#f5f5f4', stroke: '#a3a3a3', strokeWidth: 2 } : {}),
        ...(objectType === 'frame' ? { stroke: '#806a54', strokeWidth: 2 } : {}),
      },
    ],
  };
}

function tinyPngDataUri() {
  return 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+/p9sAAAAASUVORK5CYII=';
}

function addAssertion(name, passed, details = {}) {
  evidence.assertions.push({ name, passed: Boolean(passed), details });
}

function textMatch(text, pattern) {
  return text.match(pattern)?.[0] || null;
}

async function bodyText(page) {
  return page.locator('body').innerText({ timeout: 5000 });
}

async function readCanvasStorage(page) {
  return page.evaluate((key) => {
    const parsed = JSON.parse(window.localStorage.getItem(key) || '{}');
    const state = parsed.state || {};
    return {
      currentProjectId: state.currentProjectId || null,
      currentProjectName: state.currentProjectName || null,
      objectCount: Array.isArray(state.objects) ? state.objects.length : 0,
    };
  }, canvasStoreKey);
}

function wirePageDiagnostics(page) {
  page.on('console', (message) => {
    if (['error', 'warning'].includes(message.type())) {
      evidence.consoleMessages.push({ type: message.type(), text: message.text() });
    }
  });
  page.on('pageerror', (error) => {
    evidence.pageErrors.push(error.message);
  });
  page.on('requestfailed', (request) => {
    const url = request.url();
    if (!/\.(png|jpg|jpeg|webp|svg|ico|woff2?)($|\?)/i.test(url)) {
      evidence.requestFailures.push({ url, failure: request.failure()?.errorText || null });
    }
  });
}

async function closePageAndGetVideo(page) {
  const video = page.video();
  await page.close();
  if (!video) return null;
  return video.path().catch(() => null);
}

function buildStorageStateForBaseUrl(storagePath, targetBaseUrl) {
  const storage = JSON.parse(fs.readFileSync(storagePath, 'utf8'));
  const origin = new URL(targetBaseUrl).origin;
  const matchingOrigin = storage.origins?.find((entry) => entry.origin === origin);
  if (!matchingOrigin && storage.origins?.[0]) {
    storage.origins = [{ ...storage.origins[0], origin }];
  }
  return storage;
}

function extractAuthUserId(storageState) {
  for (const origin of storageState.origins || []) {
    for (const item of origin.localStorage || []) {
      if (!item.name.startsWith('sb-') || !item.name.endsWith('-auth-token')) continue;
      try {
        const token = JSON.parse(item.value);
        if (token?.user?.id) return token.user.id;
      } catch {
        // Ignore unrelated localStorage values.
      }
    }
  }
  return null;
}

function onboardingCompletedKey(userId) {
  return userId ? `heavy_chain_onboarding_completed:${userId}` : 'heavy_chain_onboarding_completed';
}

async function startPreviewServer(targetBaseUrl) {
  const url = new URL(targetBaseUrl);
  const port = Number(url.port || 4173);
  const host = url.hostname || '127.0.0.1';
  const child = spawn('npm', ['run', 'preview', '--', '--host', host, '--port', String(port)], {
    cwd: process.cwd(),
    stdio: ['ignore', 'pipe', 'pipe'],
    detached: true,
  });
  child.stdout.on('data', (chunk) => {
    evidence.previewStdout = `${evidence.previewStdout || ''}${chunk}`.slice(-4000);
  });
  child.stderr.on('data', (chunk) => {
    evidence.previewStderr = `${evidence.previewStderr || ''}${chunk}`.slice(-4000);
  });
  await waitForUrl(targetBaseUrl, 30_000);
  return child;
}

async function stopPreviewServer(child, targetBaseUrl) {
  const result = { pid: child.pid, exited: false, portFree: false };
  try {
    process.kill(-child.pid, 'SIGTERM');
  } catch (error) {
    result.sigtermError = error.message;
  }
  await new Promise((resolve) => setTimeout(resolve, 1000));
  result.exited = !isProcessGroupAlive(child.pid);
  result.portFree = !(await canFetch(targetBaseUrl));
  return result;
}

function isProcessGroupAlive(pid) {
  try {
    process.kill(-pid, 0);
    return true;
  } catch {
    return false;
  }
}

async function waitForUrl(url, timeoutMs) {
  const started = Date.now();
  while (Date.now() - started < timeoutMs) {
    if (await canFetch(url)) return;
    await new Promise((resolve) => setTimeout(resolve, 500));
  }
  throw new Error(`preview_timeout:${url}`);
}

async function canFetch(url) {
  try {
    const response = await fetch(url);
    return response.ok || response.status < 500;
  } catch {
    return false;
  }
}

function isLocalPreview(value) {
  try {
    const url = new URL(value);
    return ['127.0.0.1', 'localhost'].includes(url.hostname);
  } catch {
    return false;
  }
}

function withTimeout(promise, timeoutMs, label) {
  return Promise.race([
    promise,
    new Promise((_, reject) => setTimeout(() => reject(new Error(label)), timeoutMs)),
  ]);
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

function trimTrailingSlash(value) {
  return String(value).replace(/\/$/, '');
}

function dateStamp() {
  return new Date().toISOString().replace(/[-:]/g, '').replace(/\.\d{3}Z$/, 'Z');
}
