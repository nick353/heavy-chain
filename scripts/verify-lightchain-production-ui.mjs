import { existsSync, mkdirSync, writeFileSync } from 'node:fs';
import path from 'node:path';

const PRODUCTION_ORIGIN = 'https://heavy-chain-web.nichika2000823.workers.dev';
const AUTH_STATE_ENV = 'LIGHTCHAIN_UI_AUTH_STATE';
const mode = 'production';
const cliArgs = parseCliArgs(process.argv.slice(2));
const baseUrl = cliArgs.baseUrl || process.env.LIGHTCHAIN_UI_BASE_URL || PRODUCTION_ORIGIN;
const outDir = cliArgs.out || process.env.LIGHTCHAIN_UI_OUT_DIR || `output/playwright/lightchain-production-ui-${new Date().toISOString().slice(0, 10).replaceAll('-', '')}`;
const runId = cliArgs.runId || process.env.LIGHTCHAIN_UI_RUN_ID || null;
const startedAt = new Date().toISOString();
if (runId !== null && !/^[a-zA-Z0-9][a-zA-Z0-9_-]{0,127}$/.test(runId)) throw new Error('invalid_production_ui_run_id');

const viewports = [
  { name: 'desktop', width: 1440, height: 1100 },
  { name: 'mobile', width: 390, height: 900 },
];

const pages = [
  {
    name: 'dashboard',
    path: '/dashboard',
    expected: ['制作ワークフロー', '必要なもの', '作れるもの'],
  },
  {
    name: 'generate',
    path: '/generate',
    expected: ['制作レーンから始める', '制作ワークフローへ戻る', '運用状態'],
  },
  {
    name: 'model',
    path: '/model',
    expected: ['着用ワークフローを選ぶ', '衣服画像'],
  },
  {
    name: 'marketing',
    path: '/marketing',
    expected: ['マーケティングワークスペース', 'キャンバスへ渡す'],
  },
  {
    name: 'studio',
    path: '/studio',
    expected: ['生成前スタジオ設定', 'Canvas'],
  },
  {
    name: 'models',
    path: '/model-library',
    expected: ['モデルカスタマイズ', 'ラベル', 'カスタム', '権限がありません'],
  },
  {
    name: 'patterns',
    path: '/patterns',
    expected: ['制作ボード', 'Canvas'],
  },
  {
    name: 'video',
    path: '/flow/GenerateShortVideo',
    expected: ['動画ワークステーション', '新規ファイル', '参考事例'],
  },
  {
    name: 'lab',
    path: '/lab',
    expected: ['実験レーンを選ぶ', '評価プレビュー'],
  },
  {
    name: 'gallery',
    path: '/gallery',
    expected: ['成果物を選ぶ', 'Canvasで再編集', '採用候補を見る'],
  },
  {
    name: 'history',
    path: '/history',
    expected: ['続きから再開', '失敗を確認', '保存済みを見る'],
  },
  {
    name: 'jobs',
    path: '/jobs',
    expected: ['制作キュー', '再開できる作業', '止まった作業', '完了した成果物'],
  },
  {
    name: 'canvas',
    path: '/canvas/new',
    expected: ['画像を置く', '生成する', '素材を見る'],
  },
  {
    name: 'brand-settings',
    path: '/brand/settings',
    expected: ['ブランド設定', 'ブランド情報', 'チームメンバー', '月間 quota は通常アカウントの生成条件'],
  },
];

mkdirSync(outDir, { recursive: true });

const redact = (value) => String(value)
  .replaceAll(/eyJ[a-zA-Z0-9_-]+\.[a-zA-Z0-9_-]+\.[a-zA-Z0-9_-]+/g, '[redacted-jwt]')
  .replaceAll(/Bearer\s+[a-zA-Z0-9._-]+/gi, 'Bearer [redacted]')
  .replaceAll(/access_token["=:]\s*["']?[^"',\s}]+/gi, 'access_token=[redacted]')
  .replaceAll(/refresh_token["=:]\s*["']?[^"',\s}]+/gi, 'refresh_token=[redacted]');

function redactObject(value) {
  if (typeof value === 'string') return redact(value);
  if (Array.isArray(value)) return value.map(redactObject);
  if (value && typeof value === 'object') {
    return Object.fromEntries(Object.entries(value).map(([key, inner]) => [key, redactObject(inner)]));
  }
  return value;
}

function buildAuthEvidence(envName) {
  const configuredPath = process.env[envName];
  const statePath = typeof configuredPath === 'string' && configuredPath.trim() ? configuredPath.trim() : null;
  return {
    env: envName,
    source: statePath ? 'explicit_env' : 'missing_explicit_env',
    supplied: Boolean(statePath),
    statePath,
    statePathExists: Boolean(statePath && existsSync(statePath)),
    contentInspected: false,
  };
}

function buildTargetEvidence(configuredBaseUrl) {
  try {
    const parsed = new URL(configuredBaseUrl);
    const reasons = [];
    if (parsed.origin !== PRODUCTION_ORIGIN) reasons.push('base_url_origin_mismatch');
    if (parsed.protocol !== 'https:') reasons.push('base_url_not_https');
    if (parsed.username || parsed.password) reasons.push('base_url_credentials_not_allowed');
    return {
      configuredBaseUrl: redact(configuredBaseUrl),
      origin: parsed.origin,
      expectedOrigin: PRODUCTION_ORIGIN,
      bound: reasons.length === 0,
      reasons,
    };
  } catch {
    return {
      configuredBaseUrl: redact(configuredBaseUrl),
      origin: null,
      expectedOrigin: PRODUCTION_ORIGIN,
      bound: false,
      reasons: ['invalid_base_url'],
    };
  }
}

function buildPreflight(authEvidence, targetEvidence) {
  const reasons = [];
  if (!authEvidence.supplied) reasons.push('explicit_auth_state_required');
  else if (!authEvidence.statePathExists) reasons.push('explicit_auth_state_path_missing');
  if (!targetEvidence.bound) reasons.push(...targetEvidence.reasons);
  return { ok: reasons.length === 0, failClosed: reasons.length > 0, reasons };
}

function parseCliArgs(argv) {
  const parsed = {};
  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    const next = argv[index + 1];
    if (arg.startsWith('--') && next && !next.startsWith('--')) { parsed[arg.slice(2)] = next; index += 1; }
  }
  return parsed;
}

function detectLegacyNetworkViolation(request) {
  let parsed;
  try {
    parsed = new URL(request.url());
  } catch {
    return null;
  }
  if (!['http:', 'https:'].includes(parsed.protocol)) return null;
  const hostname = parsed.hostname.toLowerCase();
  const legacyService = hostname === 'zeabur.app' || hostname.endsWith('.zeabur.app')
    ? 'legacy_zeabur_host'
    : hostname === 'supabase.co' || hostname.endsWith('.supabase.co')
      || hostname === 'supabase.in' || hostname.endsWith('.supabase.in')
      || hostname === 'supabase.com' || hostname.endsWith('.supabase.com')
      ? 'legacy_supabase_host'
      : null;
  if (!legacyService) return null;
  return {
    kind: 'legacy_network_request',
    service: legacyService,
    hostname,
    origin: parsed.origin,
    pathname: parsed.pathname,
    method: typeof request.method === 'function' ? request.method() : null,
    resourceType: typeof request.resourceType === 'function' ? request.resourceType() : null,
  };
}

const authEvidence = buildAuthEvidence(AUTH_STATE_ENV);
const storageState = authEvidence.statePath;
const targetEvidence = buildTargetEvidence(baseUrl);
const preflight = buildPreflight(authEvidence, targetEvidence);

function writeFailClosedSummary() {
  const result = {
    viewport: null,
    page: 'runner',
    requestedUrl: null,
    finalUrl: null,
    screenshotPath: null,
    textPath: null,
    consolePath: null,
    expected: [],
    missingText: [],
    redirectedToLogin: false,
    consoleErrorCount: 0,
    pageErrorCount: 0,
    legacyViolations: [],
    failClosed: true,
    failClosedReasons: preflight.reasons,
    passed: false,
  };
  const summary = {
    schema: 'heavy-chain.lightchain-production-ui.v2',
    startedAt,
    finishedAt: new Date().toISOString(),
    runId,
    mode,
    baseUrl,
    targetOrigin: targetEvidence,
    storageState,
    authEvidence,
    outDir,
    pages: pages.map(({ name, path: pagePath, expected }) => ({ name, path: pagePath, expected })),
    viewports,
    observedAssets: [],
    consoleMessages: [],
    pageErrors: [],
    requestFailures: [],
    legacyViolations: [],
    preflight,
    completion: {
      evidenceScope: 'production-ui-read-only',
      status: 'not_verified',
      localCompletion: 'not_claimed',
      productionParity: 'not_verified',
      externalActionsStarted: false,
    },
    cleanup: { contextClosed: true, browserClosed: true },
    resultCount: 1,
    failureCount: 1,
    fatalRunnerError: null,
    results: [result],
  };
  mkdirSync(outDir, { recursive: true });
  writeFileSync(path.join(outDir, 'summary.json'), JSON.stringify(summary, null, 2));
  console.error(JSON.stringify(summary, null, 2));
  process.exit(1);
}

if (!preflight.ok) writeFailClosedSummary();

async function dismissBlockingOverlays(page) {
  const buttonTexts = [
    'スキップ',
    '閉じる',
    'あとで',
    'はじめる',
    '完了',
  ];

  for (const text of buttonTexts) {
    const button = page.getByRole('button', { name: text }).first();
    if (await button.isVisible({ timeout: 750 }).catch(() => false)) {
      await button.click().catch(() => {});
      await page.waitForTimeout(500);
    }
  }
}

async function waitForExpectedText(page, expected) {
  await Promise.race([
    ...expected.map((text) => page.getByText(text, { exact: false }).first().waitFor({ state: 'visible', timeout: 30_000 })),
    page.waitForTimeout(30_000),
  ]).catch(() => {});
}

async function verifyPage(page, viewport, pageSpec, errorsByPage, legacyViolationsByPage, observedAssets) {
  const consoleErrors = [];
  const pageErrors = [];
  const requestFailures = [];

  const requestedUrl = new URL(pageSpec.path, baseUrl).toString();
  await page.goto(requestedUrl, { waitUntil: 'domcontentloaded', timeout: 60_000 });
  await dismissBlockingOverlays(page);
  await waitForExpectedText(page, pageSpec.expected);
  await dismissBlockingOverlays(page);
  await page.waitForTimeout(1000);

  const bodyText = await page.locator('body').innerText({ timeout: 15_000 }).catch(() => '');
  const rawFinalUrl = page.url();
  const finalUrl = redact(rawFinalUrl);
  const missingText = pageSpec.expected.filter((expectedText) => !bodyText.includes(expectedText));
  const redirectedToLogin = /\/login(?:$|[?#])/.test(new URL(rawFinalUrl).pathname);
  const legacyViolations = legacyViolationsByPage.get(pageSpec.name) || [];
  const scripts = await page.locator('script[src]').evaluateAll((nodes) => nodes
    .map((node) => node.getAttribute('src'))
    .filter(Boolean))
    .catch(() => []);
  const stylesheetLinks = await page.locator('link[rel="stylesheet"][href]').evaluateAll((nodes) => nodes
    .map((node) => node.getAttribute('href'))
    .filter(Boolean))
    .catch(() => []);
  for (const asset of [...scripts, ...stylesheetLinks]) {
    const assetUrl = new URL(asset, rawFinalUrl);
    observedAssets.add(assetUrl.pathname.replace(/^\//, ''));
  }
  const screenshotPath = path.join(outDir, `${viewport.name}-${pageSpec.name}.png`);
  const textPath = path.join(outDir, `${viewport.name}-${pageSpec.name}.txt`);
  const consolePath = path.join(outDir, `${viewport.name}-${pageSpec.name}.console.json`);

  for (const entry of errorsByPage.get(pageSpec.name) || []) {
    if (entry.kind === 'console') consoleErrors.push(entry.payload);
    if (entry.kind === 'pageerror') pageErrors.push(entry.payload);
    if (entry.kind === 'requestfailure') requestFailures.push(entry.payload);
  }
  await page.screenshot({ path: screenshotPath, fullPage: true });
  writeFileSync(textPath, redact(bodyText));
  writeFileSync(consolePath, JSON.stringify({ consoleErrors, pageErrors }, null, 2));

  return {
    viewport: viewport.name,
    page: pageSpec.name,
    requestedUrl,
    finalUrl,
    screenshotPath,
    textPath,
    consolePath,
    expected: pageSpec.expected,
    missingText,
    redirectedToLogin,
    consoleErrorCount: consoleErrors.length,
    pageErrorCount: pageErrors.length,
    requestFailureCount: requestFailures.length,
    legacyViolations,
    scripts: scripts.map((script) => redact(new URL(script, rawFinalUrl).pathname.replace(/^\//, ''))),
    stylesheets: stylesheetLinks.map((stylesheet) => redact(new URL(stylesheet, rawFinalUrl).pathname.replace(/^\//, ''))),
    passed: !redirectedToLogin && missingText.length === 0 && consoleErrors.length === 0
      && pageErrors.length === 0 && requestFailures.length === 0 && legacyViolations.length === 0,
  };
}

const { chromium } = await import('@playwright/test');
let browser = null;
const results = [];
const observedAssets = new Set();
const legacyViolations = [];
let fatalRunnerError = null;
const cleanup = { contextClosed: false, browserClosed: false };
const consoleMessages = [];
const pageErrors = [];
const requestFailures = [];

try {
  browser = await chromium.launch({ headless: true });
  outer:
  for (const viewport of viewports) {
    const context = await browser.newContext({
      storageState,
      baseURL: PRODUCTION_ORIGIN,
      viewport: { width: viewport.width, height: viewport.height },
    });
    const page = await context.newPage();
    let activePageName = 'bootstrap';
    const errorsByPage = new Map();
    const legacyViolationsByPage = new Map();

    const addError = (pageName, entry) => {
      const list = errorsByPage.get(pageName) || [];
      list.push(entry);
      errorsByPage.set(pageName, list);
    };

    const addLegacyViolation = (pageName, entry) => {
      const list = legacyViolationsByPage.get(pageName) || [];
      list.push(entry);
      legacyViolationsByPage.set(pageName, list);
      legacyViolations.push({ viewport: viewport.name, page: pageName, ...entry });
    };

    page.on('request', (request) => {
      const violation = detectLegacyNetworkViolation(request);
      if (violation) addLegacyViolation(activePageName, violation);
    });

    page.on('console', (message) => {
      if (message.type() === 'error') {
        consoleMessages.push({ viewport: viewport.name, page: activePageName, text: redact(message.text()).slice(0, 1000) });
        addError(activePageName, {
          kind: 'console',
          payload: {
            text: redact(message.text()).slice(0, 1000),
            location: redactObject(message.location()),
          },
        });
      }
    });
    page.on('pageerror', (error) => {
      pageErrors.push({ viewport: viewport.name, page: activePageName, message: redact(error.message) });
      addError(activePageName, {
        kind: 'pageerror',
        payload: {
          message: redact(error.message),
          stack: redact(error.stack || ''),
        },
      });
    });
    page.on('requestfailed', (request) => {
      const failure = { url: redact(request.url()), failure: redact(request.failure()?.errorText || 'request_failed') };
      addError(activePageName, { kind: 'requestfailure', payload: failure });
      requestFailures.push({ viewport: viewport.name, page: activePageName, ...failure });
    });

    for (const pageSpec of pages) {
      activePageName = pageSpec.name;
      try {
        results.push(await verifyPage(page, viewport, pageSpec, errorsByPage, legacyViolationsByPage, observedAssets));
      } catch (error) {
        const message = redact(error?.stack || error?.message || String(error || 'verification_failed'));
        const requestedUrl = new URL(pageSpec.path, baseUrl).toString();
        results.push({
          viewport: viewport.name,
          page: pageSpec.name,
          requestedUrl,
          finalUrl: page.isClosed() ? null : redact(page.url()),
          screenshotPath: null,
          textPath: null,
          consolePath: null,
          expected: pageSpec.expected,
          missingText: pageSpec.expected,
          redirectedToLogin: false,
          consoleErrorCount: (errorsByPage.get(pageSpec.name) || []).filter((entry) => entry.kind === 'console').length,
          pageErrorCount: (errorsByPage.get(pageSpec.name) || []).filter((entry) => entry.kind === 'pageerror').length,
          requestFailureCount: (errorsByPage.get(pageSpec.name) || []).filter((entry) => entry.kind === 'requestfailure').length,
          legacyViolations: legacyViolationsByPage.get(pageSpec.name) || [],
          runnerError: message,
          passed: false,
        });

        if (/Target page, context or browser has been closed|Target page\/context\/browser has been closed/i.test(message)) {
          fatalRunnerError = message;
          break outer;
        }
      }
    }

    const pageCloseError = await page.close().catch((error) => error);
    const contextCloseError = await context.close().catch((error) => error);
    if (pageCloseError || contextCloseError) {
      cleanup.contextClosed = false;
      fatalRunnerError ||= redact(pageCloseError?.stack || contextCloseError?.stack || 'context_close_failed');
    } else cleanup.contextClosed = true;
  }
} catch (error) {
  fatalRunnerError = redact(error?.stack || error?.message || String(error || 'verification_failed'));
} finally {
  const browserCloseError = await browser?.close().catch((error) => error);
  if (browserCloseError) {
    cleanup.browserClosed = false;
    fatalRunnerError ||= redact(browserCloseError?.stack || 'browser_close_failed');
  } else cleanup.browserClosed = true;
}

if (fatalRunnerError && results.length === 0) {
  results.push({
    viewport: null,
    page: 'runner',
    requestedUrl: null,
    finalUrl: null,
    screenshotPath: null,
    textPath: null,
    consolePath: null,
    expected: [],
    missingText: [],
    redirectedToLogin: false,
    consoleErrorCount: 0,
    pageErrorCount: 0,
    legacyViolations,
    runnerError: fatalRunnerError,
    passed: false,
  });
}

const failures = results.filter((result) => !result.passed);
const failureCount = failures.length + consoleMessages.length + pageErrors.length + requestFailures.length + legacyViolations.length + (fatalRunnerError ? 1 : 0);
const hasFailures = failureCount > 0 || fatalRunnerError !== null
  || cleanup.contextClosed !== true || cleanup.browserClosed !== true;
const summary = {
  schema: 'heavy-chain.lightchain-production-ui.v2',
  startedAt,
  finishedAt: new Date().toISOString(),
  runId,
  mode,
  baseUrl,
  targetOrigin: targetEvidence,
  storageState,
  authEvidence,
  outDir,
  pages: pages.map(({ name, path, expected }) => ({ name, path, expected })),
  viewports,
  observedAssets: [...observedAssets].sort(),
  consoleMessages,
  pageErrors,
  requestFailures,
  legacyViolations,
  preflight,
  completion: {
    evidenceScope: 'production-ui-read-only',
    status: hasFailures ? 'not_verified' : 'verified_read_only',
    localCompletion: 'not_claimed',
    productionParity: 'not_verified',
    externalActionsStarted: false,
  },
  cleanup,
  resultCount: results.length,
  failureCount,
  fatalRunnerError,
  results,
};

writeFileSync(path.join(outDir, 'summary.json'), JSON.stringify(summary, null, 2));

if (hasFailures) {
  console.error('Heavy Chain production UI verification failed. Secret values were not printed.');
  for (const failure of failures) {
    console.error(`- ${failure.viewport}/${failure.page}: missing=${failure.missingText.join('|') || 'none'} login=${failure.redirectedToLogin} consoleErrors=${failure.consoleErrorCount} pageErrors=${failure.pageErrorCount} legacyViolations=${failure.legacyViolations?.length || 0}`);
  }
  if (failures.length === 0) console.error(`- aggregated_failure: failureCount=${failureCount} fatalRunnerError=${Boolean(fatalRunnerError)} contextClosed=${cleanup.contextClosed} browserClosed=${cleanup.browserClosed}`);
  process.exit(1);
}

console.log(`Heavy Chain production UI verification passed. Proof: ${path.join(outDir, 'summary.json')}`);
