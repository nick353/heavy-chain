#!/usr/bin/env node

import fs from 'node:fs';
import path from 'node:path';
import http from 'node:http';
import { spawn } from 'node:child_process';
import { chromium } from '@playwright/test';

const root = process.cwd();
const outDir = path.resolve(root, process.argv[2] || 'output/playwright/unified-desktop-layout-current');
const baseUrl = 'http://127.0.0.1:4184';
const SHELL_READY_TIMEOUT_MS = 10_000;
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
const featureIds = readUnifiedFeatureIds();
const routeSpecs = buildRouteSpecs(featureIds);
const evidence = {
  workflow: 'unified-desktop-layout',
  capturedAt: new Date().toISOString(),
  baseUrl,
  viewports,
  catalogFeatureCount: featureIds.length,
  routeCount: routeSpecs.length,
  results: [],
  performance: null,
  diagnostics: {
    consoleErrors: [],
    pageErrors: [],
    requestFailures: [],
  },
  cleanup: { previewStopped: false, browserClosed: false, contextClosed: true },
};

let preview;
let browser;
try {
  preview = spawn('npm', ['run', 'preview', '--', '--host', '127.0.0.1', '--port', '4184'], {
    cwd: root,
    stdio: 'ignore',
  });
  await waitForUrl(`${baseUrl}/lightchain`);
  browser = await chromium.launch({ headless: true });

  for (const viewport of viewports) {
    const context = await browser.newContext({ viewport });
    evidence.cleanup.contextClosed = false;
    await installLocalProofAuth(context);
    const page = await context.newPage();
    page.setDefaultNavigationTimeout(10_000);
    page.setDefaultTimeout(5_000);
    let activeDiagnostics = null;
    page.on('console', (message) => {
      if (message.type() !== 'error') return;
      const entry = { route: activeDiagnostics?.path ?? null, text: message.text() };
      activeDiagnostics?.consoleErrors.push(entry);
      evidence.diagnostics.consoleErrors.push(entry);
    });
    page.on('pageerror', (error) => {
      const entry = { route: activeDiagnostics?.path ?? null, message: error.message };
      activeDiagnostics?.pageErrors.push(entry);
      evidence.diagnostics.pageErrors.push(entry);
    });
    page.on('requestfailed', (request) => {
      const entry = {
        route: activeDiagnostics?.path ?? null,
        url: request.url(),
        method: request.method(),
        failure: request.failure()?.errorText ?? null,
      };
      activeDiagnostics?.requestFailures.push(entry);
      evidence.diagnostics.requestFailures.push(entry);
    });
    for (const route of routeSpecs) {
      const result = {
        viewport,
        routeId: route.id,
        path: route.path,
        ok: false,
        timing: { navigationMs: null, settleMs: null, domContentLoadedMs: null, loadEventMs: null },
        diagnostics: { consoleErrors: [], pageErrors: [], requestFailures: [] },
      };
      const startedAt = Date.now();
      activeDiagnostics = { ...result.diagnostics, path: route.path };
      result.diagnostics = activeDiagnostics;
      try {
        await page.goto(`${baseUrl}${route.path}`, { waitUntil: 'domcontentloaded' });
        result.timing.navigationMs = Date.now() - startedAt;
        await page.locator('[data-testid="heavy-unified-workspace-shell"]').waitFor({ state: 'visible', timeout: SHELL_READY_TIMEOUT_MS });
        result.timing.settleMs = Date.now() - startedAt;
        await page.waitForTimeout(150);
        const readback = await page.evaluate(() => {
          const shell = document.querySelector('[data-testid="heavy-unified-workspace-shell"]');
          const main = shell?.querySelector('main');
          const rail = document.querySelector('[data-testid="heavy-unified-context-rail"]');
          const navigation = performance.getEntriesByType('navigation')[0];
          return {
            innerWidth: window.innerWidth,
            documentScrollWidth: document.documentElement.scrollWidth,
            bodyScrollWidth: document.body.scrollWidth,
            shellScrollWidth: shell?.scrollWidth ?? null,
            mainScrollWidth: main?.scrollWidth ?? null,
            contextRailVisible: Boolean(rail && getComputedStyle(rail).display !== 'none'),
            domContentLoadedMs: navigation ? Math.round(navigation.domContentLoadedEventEnd) : null,
            loadEventMs: navigation ? Math.round(navigation.loadEventEnd) : null,
          };
        });
        result.readback = readback;
        result.timing.domContentLoadedMs = readback.domContentLoadedMs;
        result.timing.loadEventMs = readback.loadEventMs;
        result.ok = readback.documentScrollWidth <= viewport.width + 1
          && readback.bodyScrollWidth <= viewport.width + 1
          && (readback.shellScrollWidth == null || readback.shellScrollWidth <= viewport.width + 1);
      } catch (error) {
        result.exactBlocker = error.message;
      } finally {
        activeDiagnostics = null;
      }
      evidence.results.push(result);
    }
    await page.close().catch(() => {});
    await context.close().then(() => {
      evidence.cleanup.contextClosed = true;
    }).catch((error) => {
      evidence.cleanup.contextCloseBlocker = error.message;
    });
  }
} catch (error) {
  evidence.exactBlocker = error.message;
} finally {
  if (browser) {
    await browser.close().then(() => {
      evidence.cleanup.browserClosed = true;
    }).catch((error) => {
      evidence.cleanup.browserCloseBlocker = error.message;
    });
  }
  if (preview) {
    preview.kill('SIGTERM');
    evidence.cleanup.previewStopped = true;
  }
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
  scope: 'local-preview-chromium-only; not production provider latency',
};

evidence.failed = evidence.results.filter((result) => !result.ok).map((result) => ({
  viewport: result.viewport,
  routeId: result.routeId,
  path: result.path,
  exactBlocker: result.exactBlocker ?? result.readback,
}));
evidence.resultCount = evidence.results.length;
evidence.ok = !evidence.exactBlocker && evidence.results.length === viewports.length * routeSpecs.length && evidence.failed.length === 0 && evidence.cleanup.browserClosed && evidence.cleanup.previewStopped;
fs.mkdirSync(outDir, { recursive: true });
fs.writeFileSync(path.join(outDir, 'SUMMARY.json'), `${JSON.stringify(evidence, null, 2)}\n`);
console.log(JSON.stringify({
  ok: evidence.ok,
  catalogFeatureCount: featureIds.length,
  routeCount: routeSpecs.length,
  resultCount: evidence.results.length,
  failed: evidence.failed,
  summaryPath: path.join(outDir, 'SUMMARY.json'),
}, null, 2));
process.exit(evidence.ok ? 0 : 1);

function readUnifiedFeatureIds() {
  const source = fs.readFileSync(path.join(root, 'src/features/lightchain/parityContract.ts'), 'utf8');
  const rowsBlock = source.match(/GOAL_CANDIDATE_ROW_IDS\s*=\s*Object\.freeze\(\[([\s\S]+?)\]\s*as const\)/);
  if (!rowsBlock) throw new Error('lightchain_goal_candidate_catalog_missing');
  const ids = [...rowsBlock[1].matchAll(/'([^']+)'/g)]
    .map((match) => match[1])
    .filter((id) => !id.startsWith('video-'));
  if (ids.length !== 31) throw new Error(`unified_feature_catalog_count_invalid:${ids.length}`);
  return [...new Set(ids)];
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
    const path = `/lightchain/${featureId}`;
    if (!seen.has(path)) {
      specs.push({ id: `canonical-${featureId}`, path });
      seen.add(path);
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

async function installLocalProofAuth(context) {
  const supabaseUrl = readEnvValue('VITE_SUPABASE_URL');
  if (!supabaseUrl) throw new Error('local_proof_supabase_url_missing');
  const projectRef = new URL(supabaseUrl).host.split('.')[0];
  const userId = '00000000-0000-4000-8000-000000000033';
  const email = 'unified-desktop-layout-local-proof@example.test';
  const token = makeLocalJwt(userId, email);
  await context.addInitScript(({ userId, email, projectRef, token }) => {
    const key = `sb-${projectRef}-auth-token`;
    window.localStorage.setItem(key, JSON.stringify({
      access_token: token,
      token_type: 'bearer',
      expires_at: Math.floor(Date.now() / 1000) + 60 * 60,
      expires_in: 60 * 60,
      refresh_token: 'local-proof-refresh',
      user: { id: userId, aud: 'authenticated', role: 'authenticated', email, user_metadata: {}, app_metadata: {} },
    }));
  }, { userId, email, projectRef, token });
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

async function waitForUrl(url) {
  const started = Date.now();
  while (Date.now() - started < 15_000) {
    try {
      const response = await fetch(url);
      if (response.status < 500) return;
    } catch {
      await new Promise((resolve) => setTimeout(resolve, 250));
    }
  }
  throw new Error(`preview_server_unavailable:${url}`);
}
