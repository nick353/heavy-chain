#!/usr/bin/env node

import { createClient } from '@supabase/supabase-js';
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';

const DEFAULT_BRAND_ID = 'e5571b0b-7af7-4265-9d47-7d90ae4767d3';
const GENERATED_IMAGES_BUCKET = 'generated-images';
const args = parseArgs(process.argv.slice(2));
const initialEnvKeys = new Set(Object.keys(process.env));
loadEnvFile('.env.production.local', initialEnvKeys);

const now = new Date();
const windowHours = numberArg(args.windowHours, 24);
const staleMinutes = numberArg(args.staleMinutes, 20);
const maxFailureRate = numberArg(args.maxFailureRate, 0.15);
const maxFailedJobs = numberArg(args.maxFailedJobs, 0);
const maxStaleActiveJobs = numberArg(args.maxStaleActiveJobs, 0);
const maxStorageErrors = numberArg(args.maxStorageErrors, 0);
const maxUiFailures = numberArg(args.maxUiFailures, 0);
const brandId = args.brandId || process.env.HEAVY_CHAIN_MONITOR_BRAND_ID || process.env.RUNWAY_READINESS_BRAND_ID || DEFAULT_BRAND_ID;
const baseUrl = trimTrailingSlash(args.baseUrl || process.env.HEAVY_CHAIN_BASE_URL || 'https://heavy-chain.zeabur.app');
const outDir = args.out || `output/playwright/production-monitor-${dateStamp(now)}`;
const uiOutDir = path.join(outDir, 'ui');
const runUi = args.ui !== false && args.skipUi !== true;
const supabaseUrl = process.env.SUPABASE_URL || process.env.VITE_SUPABASE_URL;
const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.SERVICE_ROLE_KEY;
const since = new Date(now.getTime() - windowHours * 60 * 60 * 1000);
const staleBefore = new Date(now.getTime() - staleMinutes * 60 * 1000);

const report = {
  schema: 'heavy-chain.production-monitor.v1',
  capturedAt: now.toISOString(),
  mode: 'read-only-no-submit-no-payment-no-cleanup',
  baseUrl,
  brandId,
  window: {
    hours: windowHours,
    since: since.toISOString(),
    staleMinutes,
    staleBefore: staleBefore.toISOString(),
  },
  thresholds: {
    maxFailureRate,
    maxFailedJobs,
    maxStaleActiveJobs,
    maxStorageErrors,
    maxUiFailures,
  },
  irreversibleActions: {
    generationSubmit: 'not_clicked',
    purchasePaymentCheckout: 'not_touched',
    externalPublish: 'not_touched',
    destructiveCleanup: 'not_touched',
  },
  checks: [],
  blockers: [],
  warnings: [],
  sections: {},
};

if (!supabaseUrl || !serviceRoleKey) {
  addBlocker('supabase_service_role_env_missing', 'SUPABASE_URL/VITE_SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY/SERVICE_ROLE_KEY are required.', 'Load production Supabase env locally without printing secret values.');
  await finish();
}

const supabase = createClient(supabaseUrl, serviceRoleKey, {
  auth: { persistSession: false, autoRefreshToken: false },
});

await collectGenerationHealth();
await collectEdgeFunctionHealth();
await collectUsageHealth();
await collectStorageHealth();
collectLocalWorkerInboxHealth();
if (runUi) await collectUiHealth();
else addWarning('ui_probe_skipped', 'UI probe was skipped by --skip-ui.', 'Run without --skip-ui for daily production monitoring.');

await finish();

async function collectGenerationHealth() {
  const { data, error } = await supabase
    .from('generation_jobs')
    .select('id, status, feature_type, error_message, input_params, created_at, completed_at')
    .eq('brand_id', brandId)
    .gte('created_at', since.toISOString())
    .order('created_at', { ascending: false })
    .limit(500);

  if (error) {
    addBlocker('generation_jobs_readback_failed', error.message, 'Fix production DB readback, then rerun npm run monitor:production.');
    report.sections.generation = { error: error.message };
    return;
  }

  const rows = Array.isArray(data) ? data : [];
  const counts = countBy(rows, (row) => row.status || 'unknown');
  const terminal = (counts.completed || 0) + (counts.failed || 0);
  const failureRate = terminal > 0 ? (counts.failed || 0) / terminal : 0;
  const activeRows = rows.filter((row) => ['pending', 'processing'].includes(row.status));
  const staleActiveRows = activeRows.filter((row) => Date.parse(row.created_at || '') < staleBefore.getTime());
  const localWorkerRows = rows.filter((row) => asRecord(row.input_params).provider === 'runway_mcp_local_worker');
  const failedRows = rows.filter((row) => row.status === 'failed');
  const runwayImportFailures = failedRows.filter((row) => /runway|mcp|worker|import|storage/i.test(`${row.error_message || ''} ${JSON.stringify(row.input_params || {})}`));

  report.sections.generation = {
    total: rows.length,
    counts,
    terminal,
    failureRate,
    active: activeRows.length,
    staleActive: staleActiveRows.length,
    localWorkerJobs: localWorkerRows.length,
    runwayImportFailures: runwayImportFailures.length,
    recentFailedJobs: failedRows.slice(0, 10).map(projectJob),
    staleActiveJobs: staleActiveRows.slice(0, 10).map(projectJob),
  };
  addCheck('generation jobs readable', true, { total: rows.length, counts });
  addThresholdCheck('generation failure rate', failureRate <= maxFailureRate, {
    failureRate,
    threshold: maxFailureRate,
    terminal,
    failed: counts.failed || 0,
  }, 'generation_failure_rate_high', 'Investigate recent failed generation_jobs and worker logs before scaling traffic.');
  addThresholdCheck('recent failed generation jobs', (counts.failed || 0) <= maxFailedJobs, {
    failed: counts.failed || 0,
    threshold: maxFailedJobs,
    recentFailedJobs: failedRows.slice(0, 5).map(projectJob),
  }, 'recent_generation_jobs_failed', 'Open Jobs/Admin and inspect failed job error_message before the next launch push.');
  addThresholdCheck('stale active local worker jobs', staleActiveRows.length <= maxStaleActiveJobs, {
    staleActive: staleActiveRows.length,
    threshold: maxStaleActiveJobs,
    staleActiveJobs: staleActiveRows.slice(0, 5).map(projectJob),
  }, 'stale_generation_jobs_detected', 'Start or repair npm run worker:local-runway:watch, then rerun monitor after processing.');

  if (runwayImportFailures.length > 0) {
    addWarning('runway_import_failures_seen', `${runwayImportFailures.length} recent Runway/MCP/worker-like failure(s) found.`, 'Inspect the failed generation_jobs rows and worker artifacts.');
  }
}

async function collectEdgeFunctionHealth() {
  const { data, error } = await supabase
    .from('edge_function_runs')
    .select('id, function_name, status, request_id, duration_ms, error_message, started_at, completed_at, created_at')
    .eq('brand_id', brandId)
    .gte('created_at', since.toISOString())
    .order('created_at', { ascending: false })
    .limit(500);

  if (error) {
    addBlocker('edge_function_runs_readback_failed', error.message, 'Fix edge_function_runs readback, then rerun npm run monitor:production.');
    report.sections.edgeFunctions = { error: error.message };
    return;
  }
  const rows = Array.isArray(data) ? data : [];
  const counts = countBy(rows, (row) => row.status || 'unknown');
  const failed = rows.filter((row) => row.status === 'failed');
  const startedStale = rows.filter((row) => row.status === 'started' && Date.parse(row.started_at || row.created_at || '') < staleBefore.getTime());
  report.sections.edgeFunctions = {
    total: rows.length,
    counts,
    failed: failed.length,
    staleStarted: startedStale.length,
    recentFailures: failed.slice(0, 10).map(projectEdgeRun),
  };
  addCheck('edge function runs readable', true, { total: rows.length, counts });
  if (failed.length > 0) addWarning('edge_function_failures_seen', `${failed.length} failed Edge Function run(s) in the window.`, 'Inspect edge_function_runs.error_message and matching request_id.');
  if (startedStale.length > 0) addWarning('edge_function_started_stale', `${startedStale.length} Edge Function run(s) still started past stale threshold.`, 'Check Supabase logs for interrupted function execution.');
}

async function collectUsageHealth() {
  const { data, error } = await supabase
    .from('usage_events')
    .select('id, function_name, status, units, request_id, reserved_at, completed_at, created_at')
    .eq('brand_id', brandId)
    .gte('created_at', since.toISOString())
    .order('created_at', { ascending: false })
    .limit(500);

  if (error) {
    addBlocker('usage_events_readback_failed', error.message, 'Fix usage_events readback, then rerun npm run monitor:production.');
    report.sections.usage = { error: error.message };
    return;
  }
  const rows = Array.isArray(data) ? data : [];
  const counts = countBy(rows, (row) => row.status || 'unknown');
  const failed = rows.filter((row) => row.status === 'failed');
  const staleReserved = rows.filter((row) => row.status === 'reserved' && Date.parse(row.reserved_at || row.created_at || '') < staleBefore.getTime());
  report.sections.usage = {
    total: rows.length,
    counts,
    failed: failed.length,
    staleReserved: staleReserved.length,
    recentFailures: failed.slice(0, 10).map(projectUsageEvent),
  };
  addCheck('usage events readable', true, { total: rows.length, counts });
  if (failed.length > 0) addWarning('usage_event_failures_seen', `${failed.length} failed usage event(s) in the window.`, 'Inspect usage_events and matching request_id.');
  if (staleReserved.length > 0) addWarning('usage_event_reserved_stale', `${staleReserved.length} usage reservation(s) are stale.`, 'Check matching Edge Function runs and finalize/release path.');
}

async function collectStorageHealth() {
  const { data, error } = await supabase
    .from('generated_images')
    .select('id, job_id, feature_type, storage_path, created_at')
    .eq('brand_id', brandId)
    .gte('created_at', since.toISOString())
    .not('storage_path', 'is', null)
    .order('created_at', { ascending: false })
    .limit(50);

  if (error) {
    addBlocker('generated_images_readback_failed', error.message, 'Fix generated_images readback, then rerun npm run monitor:production.');
    report.sections.storage = { error: error.message };
    return;
  }

  const rows = Array.isArray(data) ? data : [];
  const signedUrlChecks = [];
  for (const row of rows) {
    const { signed, signedError, attempts } = await createSignedUrlWithRetry(row.storage_path, 120);
    signedUrlChecks.push({
      imageId: row.id,
      jobId: row.job_id,
      feature: row.feature_type,
      storagePath: row.storage_path,
      signedUrlOk: Boolean(signed?.signedUrl && !signedError),
      error: signedError?.message || null,
      attempts,
    });
  }
  const errors = signedUrlChecks.filter((row) => !row.signedUrlOk);
  report.sections.storage = {
    checkedImages: rows.length,
    signedUrlOk: signedUrlChecks.filter((row) => row.signedUrlOk).length,
    errors: errors.length,
    failed: errors.slice(0, 10),
  };
  addCheck('generated image storage readable', errors.length <= maxStorageErrors, {
    checkedImages: rows.length,
    errors: errors.length,
    threshold: maxStorageErrors,
  });
  if (errors.length > maxStorageErrors) {
    addBlocker('generated_image_storage_errors', `${errors.length} generated image storage object(s) failed signed-url readback.`, 'Inspect generated_images.storage_path and Storage object existence before trusting Gallery health.');
  }
}

async function createSignedUrlWithRetry(storagePath, expiresIn) {
  let signed = null;
  let signedError = null;
  const maxAttempts = 3;
  for (let attempt = 1; attempt <= maxAttempts; attempt += 1) {
    const { data, error } = await supabase.storage
      .from(GENERATED_IMAGES_BUCKET)
      .createSignedUrl(storagePath, expiresIn);
    signed = data;
    signedError = error;
    if (signed?.signedUrl && !signedError) {
      return { signed, signedError: null, attempts: attempt };
    }
    if (attempt < maxAttempts) {
      await new Promise((resolve) => setTimeout(resolve, 250 * attempt));
    }
  }
  return { signed, signedError, attempts: maxAttempts };
}

function collectLocalWorkerInboxHealth() {
  const inboxDir = 'output/runway-mcp-results/inbox';
  const files = fs.existsSync(inboxDir)
    ? fs.readdirSync(inboxDir, { withFileTypes: true }).filter((entry) => entry.isFile() && entry.name.endsWith('.json'))
    : [];
  const unprocessed = files.map((entry) => {
    const filePath = path.join(inboxDir, entry.name);
    const stat = fs.statSync(filePath);
    return {
      file: filePath,
      ageMinutes: Math.round((now.getTime() - stat.mtimeMs) / 60000),
      mtime: new Date(stat.mtimeMs).toISOString(),
    };
  }).sort((a, b) => b.ageMinutes - a.ageMinutes);
  const stale = unprocessed.filter((file) => file.ageMinutes >= staleMinutes);
  report.sections.localWorkerInbox = {
    inboxDir,
    unprocessed: unprocessed.length,
    stale: stale.length,
    staleFiles: stale.slice(0, 10),
    note: 'Local inbox files are warnings unless matching DB jobs are stale; old audit files may intentionally remain.',
  };
  addCheck('local worker inbox readable', true, { unprocessed: unprocessed.length, stale: stale.length });
  if (stale.length > 0) addWarning('local_worker_inbox_stale_files', `${stale.length} local Runway MCP result JSON file(s) remain in inbox.`, 'If these are not intentional audit files, run npm run worker:local-runway:watch or move/archive them.');
}

async function collectUiHealth() {
  const expectedAsset = args.expectedAsset || process.env.HEAVY_CHAIN_EXPECTED_ASSET || readCurrentBuildAsset();
  const launchArgs = ['scripts/verify-launch-operations-readiness.mjs', '--baseUrl', baseUrl, '--out', uiOutDir];
  if (expectedAsset) launchArgs.push('--expectedAsset', expectedAsset);
  const result = spawnSync('node', launchArgs, {
    encoding: 'utf8',
    shell: false,
    env: { ...process.env, HEAVY_CHAIN_EXPECTED_ASSET: expectedAsset || process.env.HEAVY_CHAIN_EXPECTED_ASSET || '' },
  });
  const summaryPath = path.join(uiOutDir, 'summary.json');
  const summary = readJsonIfExists(summaryPath);
  const consoleFailures = (summary?.consoleMessages || []).length + (summary?.pageErrors || []).length;
  const networkFailures = (summary?.networkFailures || []).length;
  const failureCount = (summary?.failed || []).length + consoleFailures + networkFailures;
  report.sections.ui = {
    command: `node ${launchArgs.join(' ')}`,
    exitStatus: result.status,
    summaryPath,
    ok: summary?.ok === true,
    failed: summary?.failed || [],
    consoleMessages: summary?.consoleMessages || [],
    pageErrors: summary?.pageErrors || [],
    networkFailures: summary?.networkFailures || [],
    stdout: truncate(result.stdout),
    stderr: truncate(result.stderr),
  };
  addThresholdCheck('production UI launch-ops probe', failureCount <= maxUiFailures && summary?.ok === true, {
    failureCount,
    threshold: maxUiFailures,
    summaryPath,
    failed: summary?.failed || [],
  }, 'production_ui_probe_failed', 'Open the UI proof summary, inspect screenshots/console/network failures, then rerun npm run monitor:production.');
}

async function finish() {
  report.ok = report.blockers.length === 0;
  report.summary = {
    ok: report.ok,
    blockers: report.blockers.length,
    warnings: report.warnings.length,
    generationFailureRate: report.sections.generation?.failureRate ?? null,
    staleActiveJobs: report.sections.generation?.staleActive ?? null,
    localInboxStaleFiles: report.sections.localWorkerInbox?.stale ?? null,
    storageErrors: report.sections.storage?.errors ?? null,
    uiOk: report.sections.ui?.ok ?? null,
  };
  fs.mkdirSync(outDir, { recursive: true });
  const jsonPath = path.join(outDir, 'summary.json');
  const markdownPath = path.join(outDir, 'SUMMARY.md');
  fs.writeFileSync(jsonPath, `${JSON.stringify(redactObject(report), null, 2)}\n`);
  fs.writeFileSync(markdownPath, renderMarkdown(redactObject(report), jsonPath));
  console.log(JSON.stringify({ ok: report.ok, jsonPath, markdownPath, summary: report.summary }, null, 2));
  process.exit(report.ok ? 0 : 1);
}

function renderMarkdown(proof, jsonPath) {
  const lines = [
    '# Heavy Chain Production Monitor',
    '',
    `Captured: ${proof.capturedAt}`,
    `Mode: ${proof.mode}`,
    `Window: last ${proof.window.hours}h`,
    `JSON: ${jsonPath}`,
    '',
    `Status: ${proof.ok ? 'OK' : 'BLOCKED'}`,
    '',
    '## Summary',
    '',
    `- Generation failure rate: ${formatRate(proof.summary.generationFailureRate)}`,
    `- Stale active jobs: ${proof.summary.staleActiveJobs ?? 'n/a'}`,
    `- Local inbox stale files: ${proof.summary.localInboxStaleFiles ?? 'n/a'}`,
    `- Storage errors: ${proof.summary.storageErrors ?? 'n/a'}`,
    `- UI probe: ${proof.summary.uiOk === null ? 'skipped' : proof.summary.uiOk ? 'OK' : 'failed'}`,
    `- Blockers: ${proof.blockers.length}`,
    `- Warnings: ${proof.warnings.length}`,
    '',
    '## Blockers',
    '',
    ...(proof.blockers.length ? proof.blockers.map((item) => `- ${item.code}: ${item.message}`) : ['- none']),
    '',
    '## Warnings',
    '',
    ...(proof.warnings.length ? proof.warnings.map((item) => `- ${item.code}: ${item.message}`) : ['- none']),
    '',
    '## Daily Command',
    '',
    '```bash',
    'npm run monitor:production',
    '```',
    '',
  ];
  return `${lines.join('\n')}\n`;
}

function addCheck(name, passed, details = {}) {
  report.checks.push({ name, passed: Boolean(passed), details: redactObject(details) });
}

function addThresholdCheck(name, passed, details, code, nextAction) {
  addCheck(name, passed, details);
  if (!passed) addBlocker(code, `${name} exceeded threshold.`, nextAction);
}

function addBlocker(code, message, nextAction) {
  report.blockers.push({ code, message, next_action: nextAction });
}

function addWarning(code, message, nextAction) {
  report.warnings.push({ code, message, next_action: nextAction });
}

function projectJob(row) {
  const input = asRecord(row.input_params);
  return {
    id: row.id,
    status: row.status,
    feature: row.feature_type,
    provider: input.provider || null,
    errorMessage: row.error_message || null,
    createdAt: row.created_at,
    completedAt: row.completed_at,
  };
}

function projectEdgeRun(row) {
  return {
    id: row.id,
    functionName: row.function_name,
    status: row.status,
    requestId: row.request_id,
    durationMs: row.duration_ms,
    errorMessage: row.error_message,
    createdAt: row.created_at,
  };
}

function projectUsageEvent(row) {
  return {
    id: row.id,
    functionName: row.function_name,
    status: row.status,
    units: row.units,
    requestId: row.request_id,
    reservedAt: row.reserved_at,
    completedAt: row.completed_at,
    createdAt: row.created_at,
  };
}

function countBy(rows, getKey) {
  return rows.reduce((acc, row) => {
    const key = getKey(row);
    acc[key] = (acc[key] || 0) + 1;
    return acc;
  }, {});
}

function asRecord(value) {
  return value && typeof value === 'object' && !Array.isArray(value) ? value : {};
}

function parseArgs(argv) {
  const parsed = {};
  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    const next = argv[index + 1];
    if (!arg.startsWith('--')) continue;
    const key = arg.slice(2);
    if (key === 'skip-ui') {
      parsed.skipUi = true;
      parsed.ui = false;
    } else if (!next || next.startsWith('--')) {
      parsed[key] = true;
    } else {
      parsed[key] = next;
      index += 1;
    }
  }
  return parsed;
}

function numberArg(value, fallback) {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : fallback;
}

function loadEnvFile(filePath, initialKeys) {
  if (!fs.existsSync(filePath)) return;
  const content = fs.readFileSync(filePath, 'utf8');
  for (const line of content.split(/\r?\n/)) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith('#')) continue;
    const match = /^([A-Za-z_][A-Za-z0-9_]*)=(.*)$/.exec(trimmed);
    if (!match) continue;
    const [, key, rawValue] = match;
    if (key === 'SUPABASE_ACCESS_TOKEN') continue;
    const value = unquote(rawValue.trim());
    if (isPlaceholder(value)) continue;
    if (initialKeys.has(key) && !isPlaceholder(process.env[key])) continue;
    process.env[key] = value;
  }
}

function unquote(value) {
  if ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'"))) return value.slice(1, -1);
  return value;
}

function isPlaceholder(value) {
  return !value || /\b(PROJECT_REF|YOUR_|REPLACE_ME|example\.com)\b/i.test(String(value));
}

function readJsonIfExists(filePath) {
  if (!fs.existsSync(filePath)) return null;
  try {
    return JSON.parse(fs.readFileSync(filePath, 'utf8'));
  } catch {
    return null;
  }
}

function readCurrentBuildAsset() {
  const htmlPath = 'dist/index.html';
  if (!fs.existsSync(htmlPath)) return '';
  const match = fs.readFileSync(htmlPath, 'utf8').match(/assets\/index\.[^"']+\.js/);
  return match?.[0] || '';
}

function trimTrailingSlash(value) {
  return String(value || '').replace(/\/+$/, '');
}

function dateStamp(date = new Date()) {
  return date.toISOString().replace(/[:.]/g, '-');
}

function truncate(value) {
  const text = String(value || '').trim();
  return text.length > 2000 ? `${text.slice(0, 2000)}...[truncated]` : text;
}

function formatRate(value) {
  if (value === null || value === undefined) return 'n/a';
  return `${(Number(value) * 100).toFixed(1)}%`;
}

function redactObject(value) {
  if (Array.isArray(value)) return value.map(redactObject);
  if (!value || typeof value !== 'object') {
    if (typeof value === 'string') return redactString(value);
    return value;
  }
  return Object.fromEntries(Object.entries(value).map(([key, item]) => {
    if (/token|secret|authorization|apikey|api_key|jwt/i.test(key) || key === 'signedUrl') return [key, '[redacted]'];
    return [key, redactObject(item)];
  }));
}

function redactString(value) {
  return value
    .replace(/(apikey|token|authorization|jwt)=([^&\s]+)/gi, '$1=[redacted]')
    .replace(/Bearer\s+[A-Za-z0-9._-]+/gi, 'Bearer [redacted]');
}
