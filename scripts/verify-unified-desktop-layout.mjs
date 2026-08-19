#!/usr/bin/env node

import fs from 'node:fs';
import path from 'node:path';
import { spawn } from 'node:child_process';
import { chromium } from '@playwright/test';

const root = process.cwd();
const outDir = path.resolve(root, process.argv[2] || 'output/playwright/unified-desktop-layout-current');
const baseUrl = 'http://127.0.0.1:4184';
const baseOrigin = new URL(baseUrl).origin;
const SHELL_READY_TIMEOUT_MS = 10_000;
const GLOBAL_BUDGET_MS = 300_000;
const CELL_BUDGET_MS = 30_000;
const CLEANUP_BUDGET_MS = 5_000;
const EXPECTED_FEATURE_COUNT = 31;
const EXPECTED_TARGET_COUNT = 57;
const EXPECTED_VIEWPORT_COUNT = 4;
const EXPECTED_CHECK_COUNT = 228;
const LOCAL_HOSTS = new Set(['localhost', '127.0.0.1', '::1']);
const viewports = [
  { width: 1280, height: 900 },
  { width: 1440, height: 1050 },
  { width: 1920, height: 1200 },
  { width: 2560, height: 1400 },
];
const baseRouteSpecs = [
  { id: 'hub', path: '/lightchain' },
  { id: 'ai-fitting', path: '/fitting' },
  { id: 'model', path: '/model' },
  { id: 'fabric-image', path: '/lightchain/fabric-image' },
  { id: 'printing-image', path: '/lightchain/printing-image' },
  { id: 'gallery', path: '/gallery' },
  { id: 'history', path: '/history' },
  { id: 'jobs', path: '/jobs' },
];

const tracker = {
  activeTimers: 0,
  activeListeners: 0,
  activePages: 0,
  activeContexts: 0,
  browserClosed: false,
};

const evidence = {
  workflow: 'unified-desktop-layout',
  capturedAt: new Date().toISOString(),
  contract: {
    featureCount: EXPECTED_FEATURE_COUNT,
    targetCount: EXPECTED_TARGET_COUNT,
    viewportCount: EXPECTED_VIEWPORT_COUNT,
    checkCount: EXPECTED_CHECK_COUNT,
  },
  scheduled: EXPECTED_CHECK_COUNT,
  completed: 0,
  failed: 0,
  globalTimedOut: false,
  results: [],
  performance: null,
  diagnostics: {
    consoleErrors: 0,
    pageErrors: 0,
    requestFailures: 0,
  },
  cleanup: {
    browserClosed: false,
    contextClosed: true,
    previewExited: false,
    cleanupLeftovers: 0,
  },
};

let preview = null;
let browser = null;

async function main() {
  const runBudget = new MonotonicBudget(monotonicNow() + GLOBAL_BUDGET_MS, tracker);
  let featureIds = [];
  let routeSpecs = [];

  try {
    assertAllowedLocalUrl(baseUrl, baseOrigin);
    featureIds = readUnifiedFeatureIds();
    routeSpecs = buildRouteSpecs(featureIds);
    validatePlan(featureIds, routeSpecs);
    emitProgress({ event: 'plan_verified', scheduled: EXPECTED_CHECK_COUNT });

    preview = spawn('npm', ['run', 'preview', '--', '--host', '127.0.0.1', '--port', '4184'], {
      cwd: root,
      stdio: 'ignore',
    });
    const previewBudget = runBudget.child(SHELL_READY_TIMEOUT_MS);
    await previewBudget.run('preview_ready', () => waitForUrl(`${baseUrl}/lightchain`, previewBudget));
    emitProgress({ event: 'preview_ready', scheduled: EXPECTED_CHECK_COUNT });

    browser = await runBudget.run('browser_launch', () => chromium.launch({ headless: true }));
    await Promise.all(viewports.map((viewport) => runViewport(viewport, routeSpecs, runBudget)));
  } catch (error) {
    if (isGlobalTimeout(error) || runBudget.expired()) {
      evidence.globalTimedOut = true;
      evidence.exactBlocker = 'global_timeout';
      emitProgress({ event: 'global_timeout', completed: evidence.completed });
    } else {
      evidence.exactBlocker = classifyError(error);
      evidence.blockerDetail = safeErrorDetail(error);
      emitProgress({ event: 'run_blocked', reason: evidence.exactBlocker, detail: evidence.blockerDetail });
    }
  } finally {
    const cleanupBudget = new MonotonicBudget(monotonicNow() + CLEANUP_BUDGET_MS, tracker);
    if (browser) {
      try {
        await cleanupBudget.run('browser_close', () => browser.close());
        tracker.browserClosed = true;
      } catch (error) {
        evidence.cleanup.browserCloseBlocker = classifyError(error);
      }
    }
    if (preview) {
      try {
        evidence.cleanup.previewExited = await stopPreview(preview, cleanupBudget);
      } catch (error) {
        evidence.cleanup.previewCloseBlocker = classifyError(error);
      }
    }
    evidence.cleanup.browserClosed = tracker.browserClosed;
    evidence.cleanup.contextClosed = tracker.activeContexts === 0;
    evidence.cleanup.previewExited = evidence.cleanup.previewExited || isChildExited(preview);
    evidence.cleanup.cleanupLeftovers = countCleanupLeftovers(preview);
  }

  const settledTimings = evidence.results
    .map((result) => result.timing?.settleMs)
    .filter((value) => Number.isFinite(value));
  const navigationTimings = evidence.results
    .map((result) => result.timing?.navigationMs)
    .filter((value) => Number.isFinite(value));
  evidence.performance = {
    measuredResultCount: settledTimings.length,
    settleMs: summarizeTimings(settledTimings),
    navigationMs: summarizeTimings(navigationTimings),
    scope: 'local-preview-chromium-only',
  };
  evidence.failed = evidence.results.filter((result) => !result.ok).length;
  evidence.resultCount = evidence.results.length;
  evidence.ok = evidence.scheduled === EXPECTED_CHECK_COUNT
    && evidence.completed === EXPECTED_CHECK_COUNT
    && evidence.failed === 0
    && !evidence.globalTimedOut
    && evidence.cleanup.contextClosed
    && evidence.cleanup.previewExited
    && evidence.cleanup.cleanupLeftovers === 0;

  try {
    fs.mkdirSync(outDir, { recursive: true });
    fs.writeFileSync(path.join(outDir, 'SUMMARY.json'), `${JSON.stringify(evidence, null, 2)}\n`);
  } catch (error) {
    evidence.ok = false;
    evidence.summaryWriteBlocker = classifyError(error);
  }

  emitProgress({
    event: 'summary_written',
    completed: evidence.completed,
    failed: evidence.failed,
  });
  console.log(JSON.stringify({
    ok: evidence.ok,
    scheduled: evidence.scheduled,
    completed: evidence.completed,
    failed: evidence.failed,
    globalTimedOut: evidence.globalTimedOut,
    contextClosed: evidence.cleanup.contextClosed,
    previewExited: evidence.cleanup.previewExited,
    cleanupLeftovers: evidence.cleanup.cleanupLeftovers,
  }));
  process.exitCode = evidence.globalTimedOut ? 2 : evidence.ok ? 0 : 1;
}

async function runViewport(viewport, routeSpecs, runBudget) {
  let context = null;
  let page = null;
  let activeDiagnostics = null;
  const listeners = [];
  const viewportBudget = runBudget.child(CELL_BUDGET_MS);

  try {
    context = await viewportBudget.run('context_create', () => browser.newContext({ viewport }));
    tracker.activeContexts += 1;
    evidence.cleanup.contextClosed = false;
    await viewportBudget.run('local_network_boundary', () => installLocalPreviewNetworkBoundary(context));
    await viewportBudget.run('local_proof_auth', () => installLocalProofAuth(context));
    page = await viewportBudget.run('page_create', () => context.newPage());
    tracker.activePages += 1;
    page.setDefaultNavigationTimeout(CELL_BUDGET_MS);
    page.setDefaultTimeout(CELL_BUDGET_MS);

    const onConsole = (message) => {
      if (message.type() !== 'error') return;
      evidence.diagnostics.consoleErrors += 1;
      if (activeDiagnostics) activeDiagnostics.consoleErrors += 1;
    };
    const onPageError = () => {
      evidence.diagnostics.pageErrors += 1;
      if (activeDiagnostics) activeDiagnostics.pageErrors += 1;
    };
    const onRequestFailed = () => {
      evidence.diagnostics.requestFailures += 1;
      if (activeDiagnostics) activeDiagnostics.requestFailures += 1;
    };
    for (const [event, listener] of [['console', onConsole], ['pageerror', onPageError], ['requestfailed', onRequestFailed]]) {
      page.on(event, listener);
      listeners.push([event, listener]);
      tracker.activeListeners += 1;
    }

    for (const route of routeSpecs) {
      if (runBudget.expired()) {
        evidence.globalTimedOut = true;
        emitProgress({ event: 'global_timeout', completed: evidence.completed });
        break;
      }
      const result = {
        viewport,
        routeId: route.id,
        ok: false,
        timing: { navigationMs: null, settleMs: null, domContentLoadedMs: null, loadEventMs: null },
        diagnostics: { consoleErrors: 0, pageErrors: 0, requestFailures: 0 },
      };
      const cellBudget = runBudget.beginCell();
      activeDiagnostics = result.diagnostics;
      emitProgress({ event: 'cell_start', viewport: viewport.width, routeId: route.id });
      const startedAt = monotonicNow();
      try {
        await cellBudget.run('navigation', () => page.goto(`${baseUrl}${route.path}`, {
          waitUntil: 'domcontentloaded',
          timeout: Math.min(SHELL_READY_TIMEOUT_MS, cellBudget.remaining()),
        }));
        result.timing.navigationMs = elapsedMs(startedAt);
        const finalUrl = page.url();
        assertAllowedLocalUrl(finalUrl, baseOrigin);
        if (new URL(finalUrl).origin !== baseOrigin) throw new Error('final_origin_mismatch');
        await cellBudget.run('shell_ready', () => page.locator('[data-testid="lightchain-parity-shell"]').waitFor({
          state: 'visible',
          timeout: Math.min(SHELL_READY_TIMEOUT_MS, cellBudget.remaining()),
        }));
        result.timing.settleMs = elapsedMs(startedAt);
        await cellBudget.run('settle', () => page.waitForTimeout(Math.min(150, cellBudget.remaining())));
        const readback = await cellBudget.run('layout_readback', () => page.evaluate(() => {
          const shell = document.querySelector('[data-testid="lightchain-parity-shell"]');
          const main = shell?.querySelector('main');
          const heavyChrome = document.querySelectorAll(
            '[data-testid="heavy-unified-feature-library"], [data-testid="heavy-unified-context-rail"], [data-testid="heavy-unified-flow-state"], [aria-label="制作コンテキスト"]',
          ).length;
          const navigation = performance.getEntriesByType('navigation')[0];
          return {
            innerWidth: window.innerWidth,
            documentScrollWidth: document.documentElement.scrollWidth,
            bodyScrollWidth: document.body.scrollWidth,
            shellScrollWidth: shell?.scrollWidth ?? null,
            mainScrollWidth: main?.scrollWidth ?? null,
            heavyChrome,
            domContentLoadedMs: navigation ? Math.round(navigation.domContentLoadedEventEnd) : null,
            loadEventMs: navigation ? Math.round(navigation.loadEventEnd) : null,
          };
        }));
        result.readback = readback;
        result.timing.domContentLoadedMs = readback.domContentLoadedMs;
        result.timing.loadEventMs = readback.loadEventMs;
        result.ok = readback.documentScrollWidth <= viewport.width + 1
          && readback.bodyScrollWidth <= viewport.width + 1
          && (readback.shellScrollWidth == null || readback.shellScrollWidth <= viewport.width + 1)
          && readback.heavyChrome === 0;
        if (!result.ok) result.exactBlocker = readback.heavyChrome > 0 ? 'heavy_chrome_present' : 'layout_overflow';
      } catch (error) {
        result.exactBlocker = classifyError(error);
        if (isGlobalTimeout(error) || runBudget.expired()) evidence.globalTimedOut = true;
      } finally {
        activeDiagnostics = null;
        evidence.results.push(result);
        evidence.completed += 1;
        emitProgress({
          event: 'cell_complete',
          viewport: viewport.width,
          routeId: route.id,
          ok: result.ok,
          completed: evidence.completed,
        });
      }
      if (evidence.globalTimedOut) break;
    }
  } catch (error) {
    if (isGlobalTimeout(error) || runBudget.expired()) {
      evidence.globalTimedOut = true;
      evidence.exactBlocker = 'global_timeout';
    } else {
      evidence.exactBlocker = classifyError(error);
    }
  } finally {
    activeDiagnostics = null;
    for (const [event, listener] of listeners) {
      try {
        page?.off(event, listener);
      } finally {
        tracker.activeListeners = Math.max(0, tracker.activeListeners - 1);
      }
    }
    const cleanupBudget = new MonotonicBudget(monotonicNow() + CLEANUP_BUDGET_MS, tracker);
    if (page) {
      try {
        await cleanupBudget.run('page_close', () => page.close());
        tracker.activePages = Math.max(0, tracker.activePages - 1);
      } catch {
        // Keep the active count so cleanupLeftovers reports the failed readback.
      }
    }
    if (context) {
      try {
        await cleanupBudget.run('context_close', () => context.close());
        tracker.activeContexts = Math.max(0, tracker.activeContexts - 1);
      } catch {
        evidence.cleanup.contextCloseBlocker = 'context_close_failed';
      }
    }
    evidence.cleanup.contextClosed = tracker.activeContexts === 0;
  }
}

function readUnifiedFeatureIds() {
  const source = fs.readFileSync(path.join(root, 'src/features/lightchain/parityContract.ts'), 'utf8');
  const rowsBlock = source.match(/GOAL_CANDIDATE_ROW_IDS\s*=\s*Object\.freeze\(\[([\s\S]+?)\]\s*as const\)/);
  if (!rowsBlock) throw new Error('lightchain_goal_candidate_catalog_missing');
  const ids = [...rowsBlock[1].matchAll(/'([^']+)'/g)]
    .map((match) => match[1])
    .filter((id) => !id.startsWith('video-'));
  if (ids.length !== EXPECTED_FEATURE_COUNT || new Set(ids).size !== EXPECTED_FEATURE_COUNT) {
    throw new Error('unified_feature_catalog_count_invalid');
  }
  return ids;
}

function readUnifiedRouteAliases() {
  const source = fs.readFileSync(path.join(root, 'src/lib/lightchainUnifiedFeatureCatalog.ts'), 'utf8');
  const aliasesBlock = source.match(/const routeAliases:[^=]+?=\s*\{([\s\S]+?)\n\};/);
  if (!aliasesBlock) throw new Error('unified_route_alias_catalog_missing');
  const aliases = new Map();
  for (const match of aliasesBlock[1].matchAll(/(?:'([^']+)'|([a-z-]+)):\s*\[([^\]]*)\]/g)) {
    const featureId = match[1] ?? match[2];
    const routes = [...match[3].matchAll(/'([^']+)'/g)].map((route) => route[1]);
    aliases.set(featureId, routes);
  }
  return aliases;
}

function buildRouteSpecs(featureIds) {
  const aliases = readUnifiedRouteAliases();
  const specs = [...baseRouteSpecs];
  const seen = new Set(specs.map((route) => route.path));
  for (const featureId of featureIds) {
    const featurePath = `/lightchain/${featureId}`;
    if (!seen.has(featurePath)) {
      specs.push({ id: `canonical-${featureId}`, path: featurePath });
      seen.add(featurePath);
    }
    for (const alias of aliases.get(featureId) ?? []) {
      if (!seen.has(alias)) {
        const aliasId = alias.replace(/[^a-z0-9]+/gi, '-').replace(/^-|-$/g, '');
        specs.push({ id: `alias-${featureId}-${aliasId}`, path: alias });
        seen.add(alias);
      }
    }
  }
  return specs;
}

function validatePlan(featureIds, routeSpecs) {
  if (viewports.length !== EXPECTED_VIEWPORT_COUNT) throw new Error('viewport_count_invalid');
  if (featureIds.length !== EXPECTED_FEATURE_COUNT) throw new Error('feature_count_invalid');
  if (routeSpecs.length !== EXPECTED_TARGET_COUNT) throw new Error('target_count_invalid');
  if (routeSpecs.length * viewports.length !== EXPECTED_CHECK_COUNT) throw new Error('check_count_invalid');
  if (new Set(routeSpecs.map((route) => route.path)).size !== EXPECTED_TARGET_COUNT) throw new Error('target_identity_invalid');
}

async function installLocalProofAuth(context) {
  const supabaseUrl = readEnvValue('VITE_SUPABASE_URL');
  if (!supabaseUrl) throw new Error('local_proof_supabase_url_missing');
  const projectRef = new URL(supabaseUrl).host.split('.')[0];
  const userId = '00000000-0000-4000-8000-000000000033';
  const email = 'unified-desktop-layout-local-proof@example.test';
  const token = makeLocalJwt(userId, email);
  await context.addInitScript(({ userId: initUserId, email: initEmail, projectRef: initProjectRef, token: initToken }) => {
    const key = `sb-${initProjectRef}-auth-token`;
    window.localStorage.setItem(key, JSON.stringify({
      access_token: initToken,
      token_type: 'bearer',
      expires_at: Math.floor(Date.now() / 1000) + 60 * 60,
      expires_in: 60 * 60,
      refresh_token: 'local-proof-refresh',
      user: { id: initUserId, aud: 'authenticated', role: 'authenticated', email: initEmail, user_metadata: {}, app_metadata: {} },
    }));
  }, { userId, email, projectRef, token });
}

async function installLocalPreviewNetworkBoundary(context) {
  await context.route('**/*', async (route) => {
    let requestUrl;
    try {
      requestUrl = new URL(route.request().url());
    } catch {
      await route.abort('blockedbyclient');
      return;
    }

    if (
      requestUrl.origin === baseOrigin
      || requestUrl.protocol === 'data:'
      || requestUrl.protocol === 'blob:'
    ) {
      await route.continue();
      return;
    }

    await route.abort('blockedbyclient');
  });
}

function readEnvValue(name) {
  if (process.env[name]) return process.env[name];
  for (const file of ['.env.local', '.env.production.local', '.env']) {
    try {
      const line = fs.readFileSync(path.join(root, file), 'utf8').split(/\r?\n/).find((entry) => entry.startsWith(`${name}=`));
      if (line) return line.slice(name.length + 1).trim().replace(/^['"]|['"]$/g, '');
    } catch {
      // Continue through the conventional Vite env files.
    }
  }
  return null;
}

function base64url(value) {
  return Buffer.from(JSON.stringify(value)).toString('base64url');
}

function makeLocalJwt(userId, email) {
  const now = Math.floor(Date.now() / 1000);
  return [
    base64url({ alg: 'none', typ: 'JWT' }),
    base64url({ aud: 'authenticated', exp: now + 3600, iat: now, role: 'authenticated', sub: userId, email }),
    'local-proof',
  ].join('.');
}

async function waitForUrl(url, budget) {
  assertAllowedLocalUrl(url, baseOrigin);
  const startedAt = monotonicNow();
  while (budget.remaining() > 0 && monotonicNow() - startedAt < SHELL_READY_TIMEOUT_MS) {
    try {
      const response = await budget.run('preview_probe', () => fetchLocalWithRedirectGuard(url));
      if (response.status < 500) return;
    } catch (error) {
      if (isGlobalTimeout(error)) throw error;
    }
    const delay = createTrackedDelay(Math.min(250, Math.max(0, budget.remaining() - 1)));
    await budget.run('preview_probe_delay', () => delay.promise, delay.cancel);
  }
  throw new Error('preview_server_unavailable');
}

async function fetchLocalWithRedirectGuard(startUrl) {
  let currentUrl = assertAllowedLocalUrl(startUrl, baseOrigin).href;
  for (let redirects = 0; redirects <= 5; redirects += 1) {
    const response = await fetch(currentUrl, { redirect: 'manual' });
    const location = response.headers.get('location');
    if (response.status >= 300 && response.status < 400 && location) {
      if (redirects === 5) throw new Error('local_redirect_limit');
      currentUrl = assertAllowedLocalUrl(new URL(location, currentUrl).href, baseOrigin).href;
      continue;
    }
    assertAllowedLocalUrl(response.url || currentUrl, baseOrigin);
    return response;
  }
  throw new Error('local_redirect_invalid');
}

function assertAllowedLocalUrl(value, expectedOrigin) {
  let parsed;
  try {
    parsed = new URL(value);
  } catch {
    throw new Error('local_url_invalid');
  }
  const hostname = parsed.hostname.replace(/^\[|\]$/g, '').toLowerCase();
  if (!['http:', 'https:'].includes(parsed.protocol) || parsed.username || parsed.password || !LOCAL_HOSTS.has(hostname)) {
    throw new Error('local_origin_not_allowed');
  }
  if (expectedOrigin && parsed.origin !== expectedOrigin) throw new Error('local_origin_mismatch');
  return parsed;
}

async function stopPreview(child, budget) {
  if (!child || isChildExited(child)) return true;
  const firstWait = await waitForChildExit(child, budget, 'SIGTERM', 4_000);
  if (firstWait || isChildExited(child)) return true;
  if (!isChildExited(child)) child.kill('SIGKILL');
  const secondWait = await waitForChildExit(child, budget, null, 1_000);
  return secondWait || isChildExited(child);
}

async function waitForChildExit(child, budget, signal, timeoutMs) {
  let cancel = () => {};
  const operation = new Promise((resolve) => {
    if (isChildExited(child)) {
      resolve(true);
      return;
    }
    let settled = false;
    let timer = null;
    const cleanup = () => {
      if (timer) clearTrackedTimeout(timer);
      child.off('exit', onExit);
      child.off('close', onExit);
      tracker.activeListeners = Math.max(0, tracker.activeListeners - 2);
    };
    const finish = (value) => {
      if (settled) return;
      settled = true;
      cleanup();
      resolve(value);
    };
    const onExit = () => finish(true);
    cancel = () => finish(false);
    child.on('exit', onExit);
    child.on('close', onExit);
    tracker.activeListeners += 2;
    timer = trackedSetTimeout(() => finish(false), timeoutMs);
    if (signal && !isChildExited(child)) child.kill(signal);
  });
  try {
    return await budget.child(timeoutMs + 100).run('preview_exit', () => operation);
  } catch {
    return false;
  } finally {
    cancel();
  }
}

function isChildExited(child) {
  return Boolean(child && (child.exitCode !== null || child.signalCode !== null));
}

function countCleanupLeftovers(child) {
  return tracker.activePages
    + tracker.activeContexts
    + tracker.activeTimers
    + tracker.activeListeners
    + (tracker.browserClosed ? 0 : browser ? 1 : 0)
    + (isChildExited(child) ? 0 : child ? 1 : 0);
}

class MonotonicBudget {
  constructor(deadline, state, globalDeadline = deadline) {
    this.deadline = deadline;
    this.state = state;
    this.globalDeadline = globalDeadline;
  }

  child(limitMs) {
    return new MonotonicBudget(Math.min(this.deadline, monotonicNow() + limitMs), this.state, this.globalDeadline);
  }

  beginCell() {
    return this.child(CELL_BUDGET_MS);
  }

  remaining() {
    return Math.max(0, this.deadline - monotonicNow());
  }

  expired() {
    return this.remaining() <= 0;
  }

  async run(label, operation, onTimeout = null) {
    const remaining = this.remaining();
    if (remaining <= 0) {
      throw new BudgetExceeded(label, monotonicNow() >= this.globalDeadline ? 'global_timeout' : 'budget_timeout');
    }
    let timer = null;
    let timedOut = false;
    const timeout = new Promise((_, reject) => {
      timer = trackedSetTimeout(() => {
        timedOut = true;
        reject(new BudgetExceeded(label, 'budget_timeout'));
      }, remaining);
    });
    try {
      return await Promise.race([Promise.resolve().then(operation), timeout]);
    } finally {
      if (timer) clearTrackedTimeout(timer);
      if (timedOut && onTimeout) onTimeout();
    }
  }
}

function createTrackedDelay(delayMs) {
  let settled = false;
  let timer = null;
  let resolveDelay;
  const promise = new Promise((resolve) => {
    resolveDelay = () => {
      if (settled) return;
      settled = true;
      timer = null;
      resolve();
    };
    timer = trackedSetTimeout(resolveDelay, delayMs);
  });
  return {
    promise,
    cancel: () => {
      if (settled) return;
      settled = true;
      if (timer) clearTrackedTimeout(timer);
      timer = null;
      resolveDelay();
    },
  };
}

class BudgetExceeded extends Error {
  constructor(label, kind) {
    super(kind);
    this.name = 'BudgetExceeded';
    this.label = label;
    this.kind = kind;
  }
}

function trackedSetTimeout(callback, delayMs) {
  tracker.activeTimers += 1;
  const timer = { handle: null, cleared: false };
  timer.handle = setTimeout(() => {
    if (timer.cleared) return;
    timer.cleared = true;
    try {
      callback();
    } finally {
      tracker.activeTimers = Math.max(0, tracker.activeTimers - 1);
    }
  }, Math.max(0, delayMs));
  return timer;
}

function clearTrackedTimeout(timer) {
  if (!timer || timer.cleared) return;
  timer.cleared = true;
  clearTimeout(timer.handle);
  tracker.activeTimers = Math.max(0, tracker.activeTimers - 1);
}

function monotonicNow() {
  return performance.now();
}

function elapsedMs(startedAt) {
  return Math.round(monotonicNow() - startedAt);
}

function isGlobalTimeout(error) {
  return error instanceof BudgetExceeded && error.kind === 'global_timeout';
}

function classifyError(error) {
  if (isGlobalTimeout(error)) return 'global_timeout';
  if (error instanceof BudgetExceeded) return 'budget_timeout';
  if (error?.name === 'TimeoutError') return 'operation_timeout';
  const message = String(error?.message || '');
  if (message.includes('local_origin')) return message.split(':')[0];
  if (message.includes('layout_overflow')) return 'layout_overflow';
  if (message.includes('supabase')) return 'local_proof_auth_failed';
  if (message.includes('preview_')) return message.split(':')[0];
  if (message.includes('Executable doesn\'t exist')) return 'browser_executable_missing';
  if (message.includes('browserType.launch')) return 'browser_launch_failed';
  return 'operation_failed';
}

function safeErrorDetail(error) {
  const raw = String(error?.message || error?.code || error?.name || 'unknown');
  return raw
    .replace(/https?:\/\/\S+/g, '[url]')
    .replace(/(?:^|\s)(?:\/[A-Za-z0-9._-]+)+(?:\S*)/g, ' [path]')
    .replace(/\b[\w.+-]+@[\w.-]+\.\w+\b/g, '[email]')
    .replace(/\s+/g, ' ')
    .slice(0, 120);
}

function emitProgress(event) {
  const safeEvent = Object.fromEntries(Object.entries(event).filter(([key]) => key !== 'path' && key !== 'url' && key !== 'text' && key !== 'stack'));
  let line = JSON.stringify({
    event: String(safeEvent.event || 'progress').slice(0, 48),
    ...safeEvent,
  });
  if (Buffer.byteLength(line, 'utf8') > 240) line = JSON.stringify({ event: 'progress_truncated' });
  process.stderr.write(`${line}\n`);
}

function summarizeTimings(values) {
  if (!values.length) return { count: 0, min: null, p50: null, p95: null, max: null };
  const sorted = [...values].sort((left, right) => left - right);
  const pick = (quantile) => sorted[Math.min(sorted.length - 1, Math.ceil(sorted.length * quantile) - 1)];
  return {
    count: sorted.length,
    min: sorted[0],
    p50: pick(0.5),
    p95: pick(0.95),
    max: sorted[sorted.length - 1],
  };
}

await main();
