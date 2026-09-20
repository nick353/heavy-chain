#!/usr/bin/env node

import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { apiOrigin, validID } from './monitor-production-health.mjs';
import { verifyScaleOpsEvidence } from './cloudflare-scale-ops-evidence.mjs';

const args = parseArgs(process.argv.slice(2));
const capturedAt = new Date();
const outDir = args.out || 'output/playwright/10m-product-readiness-g618';
const performanceOutDir = path.join(outDir, 'performance');
const monitorOutDir = path.join(outDir, 'production-monitor-readback');
const summaryPath = path.join(outDir, 'summary.json');
const imageCount = Number(args.imageCount || args['image-count'] || 1200);
const canvasObjectCount = Number(args.canvasObjectCount || args['canvas-object-count'] || 600);
const port = Number(args.port || 4174);
const maxReadyMs = Number(args.maxReadyMs || args['max-ready-ms'] || 5000);
const maxFailureRate = Number(args.maxFailureRate || args['max-failure-rate'] || 0);
const windowHours = Number(args.windowHours || args['window-hours'] || 96);
const minStorageImages = Number(args.minStorageImages || args['min-storage-images'] || 4);
let monitorExpected;
try {
  monitorExpected = { apiOrigin:apiOrigin(args.apiBaseUrl ?? process.env.HEAVY_CHAIN_MONITOR_API_URL),
    brandId:args.brandId ?? process.env.HEAVY_CHAIN_MONITOR_BRAND_ID, windowHours, maxFailureRate, minStorageImages };
  if (!validID(monitorExpected.brandId) || !process.env.HEAVY_CHAIN_MONITOR_TOKEN?.trim() ||
      /[\r\n]/.test(process.env.HEAVY_CHAIN_MONITOR_TOKEN) ||
      verifyScaleOpsEvidence(null,monitorExpected)[0]?.name === 'explicit Cloudflare monitor expectations') throw Error();
} catch {
  console.error('G618 requires explicit Cloudflare API origin, brand, live session and valid baseline limits; no build or browser started.');
  process.exit(1);
}

const report = {
  schema: 'heavy-chain.g618.scale-ops-baseline.v2',
  businessCompletion: 'not_verified',
  unverified: ['production_concurrent_load','worker_cpu','provider_invoice','fleet_wide_slo','browser_business_workflow'],
  monitorExpectations: { ...monitorExpected, source: 'explicit_cli_or_environment' },
  capturedAt: capturedAt.toISOString(),
  mode: 'local-scale-plus-read-only-production-ops-no-submit-no-payment-no-cleanup',
  outDir,
  fixture: {
    imageCount,
    canvasObjectCount,
    note: 'Synthetic local UI fixture; not a substitute for real paid traffic or concurrent production generation.',
  },
  thresholds: {
    maxReadyMs,
    minGalleryInitialTiles: 60,
    minCanvasObjects: canvasObjectCount,
    maxFailureRate,
    maxFailedJobs: 0,
    maxStaleActiveJobs: 0,
    maxStorageErrors: 0,
    minStorageImages,
    productionReadbackWindowHours: windowHours,
  },
  irreversibleActions: {
    generationSubmit: 'not_clicked',
    purchasePaymentCheckout: 'not_touched',
    externalPublish: 'not_touched',
    destructiveCleanup: 'not_touched',
    deploy: 'not_run',
  },
  commands: [],
  checks: [],
  blockers: [],
  warnings: [],
  artifacts: {
    performanceSummary: path.join(performanceOutDir, 'summary.json'),
    productionMonitorSummary: path.join(monitorOutDir, 'summary.json'),
    summary: summaryPath,
  },
};

fs.mkdirSync(outDir, { recursive: true });

runStep({
  name: 'production build',
  command: 'npm',
  args: ['run', 'build', '--silent'],
  required: true,
});

runStep({
  name: 'local 1200 image / 600 canvas performance fixture',
  command: 'node',
  args: ['scripts/measure-g606-performance.mjs'],
  required: true,
  env: {
    G606_OUT_DIR: performanceOutDir,
    G606_IMAGE_COUNT: String(imageCount),
    G606_CANVAS_OBJECT_COUNT: String(canvasObjectCount),
    G606_PORT: String(port),
    G606_MAX_READY_MS: String(maxReadyMs),
  },
});

runStep({
  name: 'production monitor readback',
  command: 'node',
  args: [
    'scripts/monitor-production-health.mjs',
    '--out',
    monitorOutDir,
    '--skip-ui',
    '--windowHours',
    String(windowHours),
    '--apiBaseUrl', monitorExpected.apiOrigin,
    '--brandId', monitorExpected.brandId,
    '--maxFailureRate', String(maxFailureRate),
    '--sampleSize', String(Math.max(20,minStorageImages)),
  ],
  required: true,
});

const performanceSummary = readJson(report.artifacts.performanceSummary);
const monitorSummary = readJson(report.artifacts.productionMonitorSummary);

addCheck('performance summary readable', Boolean(performanceSummary), {
  path: report.artifacts.performanceSummary,
});
addCheck('production monitor summary readable', Boolean(monitorSummary), {
  path: report.artifacts.productionMonitorSummary,
});
addCheck('production readback window covers G618 baseline', windowHours >= 96, {
  windowHours,
  minWindowHours: 96,
});

if (performanceSummary) {
  const routes = arrayFrom(performanceSummary.routeMetrics);
  const routeMaxReadyMs = routes.length && routes.every(route => Number.isFinite(route.readyMs) && route.readyMs >= 0)
    ? Math.max(...routes.map(route => route.readyMs)) : Infinity;
  addCheck('local scale fixture size', performanceSummary.fixture?.imageCount >= imageCount && performanceSummary.fixture?.canvasObjectCount >= canvasObjectCount, {
    expectedImages: imageCount,
    actualImages: performanceSummary.fixture?.imageCount ?? null,
    expectedCanvasObjects: canvasObjectCount,
    actualCanvasObjects: performanceSummary.fixture?.canvasObjectCount ?? null,
  });
  addCheck('local scale performance passed', performanceSummary.ok === true && arrayFrom(performanceSummary.issues).length === 0, {
    ok: performanceSummary.ok,
    issues: arrayFrom(performanceSummary.issues),
  });
  addCheck('local route SLO', routeMaxReadyMs <= maxReadyMs, {
    routeMaxReadyMs,
    threshold: maxReadyMs,
  });
  addCheck('gallery virtualization guard', Number(performanceSummary.galleryStress?.renderedTilesInitial || 0) >= 60 && Number(performanceSummary.galleryStress?.renderedTilesInitial || 0) <= 60, {
    renderedTilesInitial: performanceSummary.galleryStress?.renderedTilesInitial ?? null,
    totalImages: performanceSummary.galleryStress?.totalImages ?? null,
  });
  addCheck('canvas object readback', Number(performanceSummary.canvasStress?.persistedObjects || 0) >= canvasObjectCount, {
    persistedObjects: performanceSummary.canvasStress?.persistedObjects ?? null,
  });
  addCheck('preview cleanup proof', performanceSummary.cleanup?.previewProcessCleanup?.groupAliveAfter === false, {
    previewProcessCleanup: performanceSummary.cleanup?.previewProcessCleanup ?? null,
  });
}

if (monitorSummary) {
  for (const check of verifyScaleOpsEvidence(monitorSummary, monitorExpected)) addCheck(check.name, check.passed);
}

for (const check of report.checks) {
  if (!check.passed) {
    report.blockers.push({
      id: `check_failed:${check.name.replace(/[^a-z0-9]+/gi, '_').toLowerCase()}`,
      message: `${check.name} failed.`,
      details: check.details,
    });
  }
}

report.ok = report.commands.every((command) => command.passed) && report.blockers.length === 0;
report.summary = {
  ok: report.ok,
  commands: report.commands.length,
  checks: report.checks.length,
  blockers: report.blockers.length,
  warnings: report.warnings.length,
  performanceOk: performanceSummary?.ok ?? null,
  monitorOk: monitorSummary?.ok ?? null,
  imageCount,
  canvasObjectCount,
};

fs.writeFileSync(summaryPath, `${JSON.stringify(redactObject(report), null, 2)}\n`);
console.log(JSON.stringify({ ok: report.ok, summaryPath, blockers: report.blockers.map((item) => item.id) }, null, 2));
process.exit(report.ok ? 0 : 1);

function runStep({ name, command, args: commandArgs, required, env = {} }) {
  const startedAt = new Date();
  const result = spawnSync(command, commandArgs, {
    cwd: process.cwd(),
    encoding: 'utf8',
    env: { ...process.env, ...env },
    shell: false,
    maxBuffer: 12 * 1024 * 1024,
  });
  const entry = {
    name,
    command: [command, ...commandArgs].join(' '),
    startedAt: startedAt.toISOString(),
    durationMs: Date.now() - startedAt.getTime(),
    status: result.status,
    passed: result.error === undefined && result.status === 0,
    outputTail: safeTail(`${result.stdout || ''}${result.stderr || ''}`),
    error: result.error?.message || null,
  };
  report.commands.push(entry);
  if (required && !entry.passed) {
    report.blockers.push({
      id: `command_failed:${name.replace(/[^a-z0-9]+/gi, '_').toLowerCase()}`,
      message: `${name} failed.`,
      outputTail: entry.outputTail,
      error: entry.error,
    });
    fs.writeFileSync(summaryPath, `${JSON.stringify(redactObject({ ...report, ok: false }), null, 2)}\n`);
    console.log(JSON.stringify({ ok: false, summaryPath, failedCommand: name }, null, 2));
    process.exit(1);
  }
}

function addCheck(name, passed, details = {}) {
  report.checks.push({ name, passed: Boolean(passed), details: redactObject(details) });
}

function readJson(filePath) {
  try {
    return JSON.parse(fs.readFileSync(filePath, 'utf8'));
  } catch {
    return null;
  }
}

function parseArgs(argv) {
  const parsed = {};
  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    const next = argv[index + 1];
    if (!arg.startsWith('--')) continue;
    const key = arg.slice(2);
    if (!next || next.startsWith('--')) {
      parsed[key] = true;
    } else {
      parsed[key] = next;
      index += 1;
    }
  }
  return parsed;
}

function arrayFrom(value) {
  return Array.isArray(value) ? value : [];
}

function safeTail(text) {
  return redact(String(text || ''))
    .split(/\r?\n/)
    .map((line) => line.trimEnd())
    .filter(Boolean)
    .slice(-20);
}

function redact(text) {
  return text
    .replace(/eyJ[A-Za-z0-9_-]{20,}\.[A-Za-z0-9_-]{20,}\.[A-Za-z0-9_-]{20,}/g, '[redacted]')
    .replace(/sk-[A-Za-z0-9_-]{12,}/g, '[redacted]')
    .replace(/AIza[0-9A-Za-z_-]{12,}/g, '[redacted]')
    .replace(/((?:SUPABASE|OPENAI|GEMINI|VITE)_[A-Z0-9_]*(?:KEY|TOKEN|SECRET|URL)?\s*[=:]\s*)\S+/gi, '$1[redacted]');
}

function redactObject(value) {
  if (Array.isArray(value)) return value.map(redactObject);
  if (!value || typeof value !== 'object') {
    if (typeof value === 'string') return redact(value);
    return value;
  }
  return Object.fromEntries(Object.entries(value).map(([key, item]) => {
    if (/token|secret|authorization|apikey|api_key|jwt|signedurl/i.test(key)) return [key, '[redacted]'];
    return [key, redactObject(item)];
  }));
}
