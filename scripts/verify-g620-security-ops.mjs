#!/usr/bin/env node

import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';

const args = parseArgs(process.argv.slice(2));
const outDir = args.out || 'output/playwright/10m-product-readiness-g620';
const summaryPath = path.join(outDir, 'summary.json');
const monitorOutDir = path.join(outDir, 'production-monitor-readback');
const runMonitor = args.monitor !== false && args['skip-monitor'] !== true;
const monitorWindowHours = Number(args.windowHours || args['window-hours'] || 96);
const allowedMonitorWarnings = new Set(['local_worker_inbox_stale_files', 'ui_probe_skipped']);

const runwayGenerationFunctions = [
  'generate-image',
  'remove-background',
  'upscale',
  'colorize',
  'generate-variations',
  'design-gacha',
  'product-shots',
  'multilingual-banner',
];
const openAiGenerationFunctions = ['model-matrix'];
const edgeObservedFunctions = discoverFunctionsUsing('recordEdgeFunctionRun');
const meteredFunctions = discoverFunctionsUsing('reserveBrandUsage');

const report = {
  schema: 'heavy-chain.g620.security-operations.v1',
  capturedAt: new Date().toISOString(),
  mode: 'read-only-security-ops-no-submit-no-payment-no-cleanup',
  outDir,
  irreversibleActions: {
    generationSubmit: 'not_clicked',
    purchasePaymentCheckout: 'not_touched',
    identityOtpCaptchaSecrets: 'not_touched',
    externalPublish: 'not_touched',
    destructiveCleanup: 'not_touched',
    deploy: 'not_run',
  },
  thresholds: {
    monitorWindowHours,
    maxGenerationFailureRate: 0,
    maxFailedGenerationJobs: 0,
    maxStaleActiveJobs: 0,
    maxStorageErrors: 0,
    maxUsageFailures: 0,
    maxStaleUsageReservations: 0,
    maxEdgeFunctionFailures: 0,
    maxStaleStartedEdgeRuns: 0,
  },
  commands: [],
  checks: [],
  blockers: [],
  warnings: [],
  artifacts: {
    summary: summaryPath,
    productionMonitorSummary: path.join(monitorOutDir, 'summary.json'),
    runbook: 'docs/g620-security-operations-runbook-2026-06-30.md',
  },
};

fs.mkdirSync(outDir, { recursive: true });

if (runMonitor) {
  runStep({
    name: 'production monitor readback',
    command: 'node',
    args: [
      'scripts/monitor-production-health.mjs',
      '--skip-ui',
      '--windowHours',
      String(monitorWindowHours),
      '--maxFailureRate',
      '0',
      '--maxFailedJobs',
      '0',
      '--maxStaleActiveJobs',
      '0',
      '--maxStorageErrors',
      '0',
      '--out',
      monitorOutDir,
    ],
    required: true,
  });
}

checkRunbook();
checkDatabaseControls();
checkGenerationFunctionControls();
checkMonitorReadback();
checkReleaseGateWiring();

for (const check of report.checks) {
  if (!check.passed) {
    report.blockers.push({
      id: `check_failed:${slug(check.name)}`,
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
  monitorWindowHours,
};

writeSummary();
console.log(JSON.stringify({ ok: report.ok, summaryPath, blockers: report.blockers.map((item) => item.id) }, null, 2));
process.exit(report.ok ? 0 : 1);

function checkRunbook() {
  const file = 'docs/g620-security-operations-runbook-2026-06-30.md';
  const text = readText(file);
  addCheck('G620 runbook exists', Boolean(text), { file });
  const requiredTerms = [
    'Hard Stops',
    'Abuse-Case Matrix',
    'Audit Sources',
    'Incident Response',
    'Monitoring SLOs',
    'npm run verify:g620-security-ops',
    'billing, purchase, payment, checkout',
    'identity verification, OTP/CAPTCHA/security prompt',
    'external public publishing',
    'destructive production cleanup',
  ];
  for (const term of requiredTerms) {
    addCheck(`G620 runbook includes ${term}`, text.includes(term), { file, term });
  }
}

function checkDatabaseControls() {
  const billing = readText('supabase/migrations/20260617044009_billing_usage_limits.sql');
  const usageHardening = readText('supabase/migrations/20260617080031_harden_usage_quota_guards.sql');
  const quotaBypass = readText('supabase/migrations/20260625092000_disable_generation_quota_while_billing_inactive.sql');
  const runwayApprovals = readText('supabase/migrations/20260623090000_runway_mcp_connection_approvals.sql');
  const auth = readText('supabase/functions/_shared/auth.ts');
  const observability = readText('supabase/functions/_shared/observability.ts');
  const usage = readText('supabase/functions/_shared/usage.ts');
  const approval = readText('supabase/functions/_shared/runwayApproval.ts');

  addCheck('admin audit logs table and admin-only RLS exist', allIncludes(billing, [
    'CREATE TABLE IF NOT EXISTS public.admin_audit_logs',
    'ALTER TABLE public.admin_audit_logs ENABLE ROW LEVEL SECURITY',
    'CREATE POLICY "Admins can view audit logs"',
    'private.is_current_user_admin()',
  ]), { file: 'supabase/migrations/20260617044009_billing_usage_limits.sql' });

  addCheck('edge function run observability table and RLS exist', allIncludes(billing, [
    'CREATE TABLE IF NOT EXISTS public.edge_function_runs',
    'ALTER TABLE public.edge_function_runs ENABLE ROW LEVEL SECURITY',
    'CREATE POLICY "Brand admins can view edge runs"',
    'CREATE POLICY "Admins can view edge runs"',
  ]), { file: 'supabase/migrations/20260617044009_billing_usage_limits.sql' });

  addCheck('usage events RLS and idempotency index exist', allIncludes(billing, [
    'ALTER TABLE public.usage_events ENABLE ROW LEVEL SECURITY',
    'CREATE POLICY "Brand viewers can view usage events"',
    'idx_usage_events_brand_function_idempotency',
    'WHERE idempotency_key IS NOT NULL',
  ]), { file: 'supabase/migrations/20260617044009_billing_usage_limits.sql' });

  addCheck('usage reservation stale release and short-window rate limits exist', allIncludes(usageHardening, [
    "reservation_stale",
    "INTERVAL '15 minutes'",
    "status = 'released'",
    'v_brand_recent_units + p_units > 5',
    'v_user_recent_units + p_units > 3',
    'Brand usage rate limit exceeded',
    'User usage rate limit exceeded',
  ]), { file: 'supabase/migrations/20260617080031_harden_usage_quota_guards.sql' });

  addCheck('billing inactive quota bypass preserves rate limits and usage events', allIncludes(quotaBypass, [
    'Heavy Chain billing is not active yet',
    'billing_inactive_quota_bypass',
    "'generation_quota_enforced',",
    'false',
    'v_brand_recent_units + p_units > 5',
    'v_user_recent_units + p_units > 3',
    'reservation_stale',
  ]), { file: 'supabase/migrations/20260625092000_disable_generation_quota_while_billing_inactive.sql' });

  addCheck('Runway approval lifecycle requires platform admin for approval changes', allIncludes(runwayApprovals, [
    'public.runway_mcp_connection_approvals',
    'ENABLE ROW LEVEL SECURITY',
    'Brand viewers can view Runway MCP connection approvals',
    'public.request_runway_mcp_connection',
    'public.admin_update_runway_mcp_connection',
    'private.has_brand_role(p_brand_id, \'admin\')',
    'private.is_current_user_admin()',
    'Platform admin permissions required',
    'revoked',
  ]), { file: 'supabase/migrations/20260623090000_runway_mcp_connection_approvals.sql' });

  addCheck('service role key is only read from environment in shared auth helper', allIncludes(auth, [
    "Deno.env.get('SERVICE_ROLE_KEY')",
    "Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')",
    'Service role key not configured',
    'persistSession: false',
  ]), { file: 'supabase/functions/_shared/auth.ts' });

  addCheck('Edge observability RPC wrapper is shared and non-fatal on logging failure', allIncludes(observability, [
    'recordEdgeFunctionRun',
    'service_record_edge_function_run',
    'Edge run observability warning',
    'sanitizeError',
  ]), { file: 'supabase/functions/_shared/observability.ts' });

  addCheck('usage reservation and completion RPC wrappers exist', allIncludes(usage, [
    'service_reserve_brand_usage',
    'service_complete_usage_event',
    'Usage quota reservation failed',
    'Usage completion warning',
  ]), { file: 'supabase/functions/_shared/usage.ts' });

  addCheck('Runway approval helper denies missing or unapproved status', allIncludes(approval, [
    'runway_mcp_connection_approvals',
    'runway_mcp_connection_status_unavailable',
    'runway_mcp_connection_not_approved',
    "data?.status !== 'approved'",
    '!data.approved_at',
  ]), { file: 'supabase/functions/_shared/runwayApproval.ts' });
}

function checkGenerationFunctionControls() {
  const meteredWithoutEdgeObservability = meteredFunctions.filter((functionName) => !edgeObservedFunctions.includes(functionName));
  addCheck('edge-observed function discovery includes expected non-Runway functions', edgeObservedFunctions.includes('optimize-prompt') &&
    edgeObservedFunctions.includes('bulk-download') &&
    edgeObservedFunctions.includes('share-link') &&
    edgeObservedFunctions.length >= runwayGenerationFunctions.length + 3, {
    discovered: edgeObservedFunctions,
    expectedAtLeast: runwayGenerationFunctions.length + 3,
  });
  addCheck('metered function discovery includes expected non-Runway functions', meteredFunctions.includes('optimize-prompt') &&
    meteredFunctions.includes('bulk-download') &&
    meteredFunctions.length >= runwayGenerationFunctions.length + 2, {
    discovered: meteredFunctions,
    expectedAtLeast: runwayGenerationFunctions.length + 2,
  });
  addCheck('all metered functions are edge-observed', meteredWithoutEdgeObservability.length === 0, {
    meteredWithoutEdgeObservability,
    edgeObservedFunctions,
    meteredFunctions,
  });

  for (const functionName of edgeObservedFunctions) {
    const file = `supabase/functions/${functionName}/index.ts`;
    const text = readText(file);
    addCheck(`${functionName} source exists`, Boolean(text), { file });
    addCheck(`${functionName} has an auth, role, image, or token access gate`, hasAccessGate(functionName, text), { file });
    if (runwayGenerationFunctions.includes(functionName)) {
      addCheck(`${functionName} requires brand editor before Runway generation`, allIncludes(text, [
        'requireBrandRole',
        "'editor'",
      ]), { file });
      addCheck(`${functionName} requires Runway approval before usage reserve`, ordered(text, [
        'requireRunwayMcpConnectionApproval',
        'reserveBrandUsage',
      ]), { file });
    }
    if (openAiGenerationFunctions.includes(functionName)) {
      addCheck(`${functionName} requires brand editor and usage reserve before OpenAI generation`, ordered(text, [
        'requireBrandRole',
        "'editor'",
        'reserveBrandUsage',
        'recordEdgeFunctionRun',
        'generatedImage = await generateWithReference',
      ]) || ordered(text, [
        'requireBrandRole',
        "'editor'",
        'reserveBrandUsage',
        'recordEdgeFunctionRun',
        'generatedImage = await generateFromText',
      ]), { file });
      addCheck(`${functionName} records OpenAI provider metadata without Runway approval gate`, allIncludes(text, [
        'editOpenAiImage',
        'generateOpenAiImage',
        "metadata: { provider: 'openai'",
        'generation_params',
        "provider: 'openai'",
        "metadata: {",
      ]) && !text.includes('requireRunwayMcpConnectionApproval'), { file });
    }
    addCheck(`${functionName} records started/succeeded/failed Edge runs`, countOccurrences(text, 'recordEdgeFunctionRun') >= 3, {
      file,
      occurrences: countOccurrences(text, 'recordEdgeFunctionRun'),
    });
  }

  for (const functionName of meteredFunctions) {
    const file = `supabase/functions/${functionName}/index.ts`;
    const text = readText(file);
    addCheck(`${functionName} reserves usage before metered work`, text.includes('reserveBrandUsage'), { file });
    addCheck(`${functionName} completes usage on success and failure`, allIncludes(text, [
      'completeBrandUsage(',
      "'succeeded'",
      "'failed'",
    ]), { file });
    addCheck(`${functionName} uses sanitized client error response`, allIncludes(text, [
      'clientError',
      'sanitizeError',
    ]), { file });
  }
}

function checkMonitorReadback() {
  const monitorPath = path.join(monitorOutDir, 'summary.json');
  const monitor = readJson(monitorPath);
  addCheck('G620 production monitor summary readable', Boolean(monitor), { path: monitorPath });
  if (!monitor) return;

  const generation = monitor.sections?.generation || {};
  const storage = monitor.sections?.storage || {};
  const usage = monitor.sections?.usage || {};
  const edgeFunctions = monitor.sections?.edgeFunctions || {};
  const warnings = arrayFrom(monitor.warnings).map((warning) => warning?.code).filter(Boolean);
  const disallowedWarnings = warnings.filter((warning) => !allowedMonitorWarnings.has(warning));

  addCheck('production monitor is read-only and safe', monitor.mode === 'read-only-no-submit-no-payment-no-cleanup' &&
    monitor.irreversibleActions?.generationSubmit === 'not_clicked' &&
    monitor.irreversibleActions?.purchasePaymentCheckout === 'not_touched' &&
    monitor.irreversibleActions?.externalPublish === 'not_touched' &&
    monitor.irreversibleActions?.destructiveCleanup === 'not_touched', {
    mode: monitor.mode,
    irreversibleActions: monitor.irreversibleActions,
  });
  addCheck('production monitor window covers G620 baseline', Number(monitor.window?.hours ?? 0) >= monitorWindowHours, {
    monitorWindowHours: monitor.window?.hours ?? null,
    minWindowHours: monitorWindowHours,
  });
  addCheck('production monitor has no blockers', monitor.ok === true && arrayFrom(monitor.blockers).length === 0, {
    ok: monitor.ok,
    blockers: arrayFrom(monitor.blockers).length,
  });
  addCheck('production monitor warnings are allowlisted', disallowedWarnings.length === 0, {
    warnings,
    allowed: [...allowedMonitorWarnings],
  });
  addCheck('generation SLO is zero-failure and no stale active jobs', Number(generation.failureRate ?? 0) === 0 &&
    Number(generation.counts?.failed ?? 0) === 0 &&
    Number(generation.staleActive ?? 0) === 0, {
    failureRate: generation.failureRate ?? null,
    failed: generation.counts?.failed ?? null,
    staleActive: generation.staleActive ?? null,
  });
  addCheck('storage signed URL readback has no errors', Number(storage.errors ?? 0) === 0 &&
    Number(storage.signedUrlOk ?? 0) === Number(storage.checkedImages ?? 0), {
    checkedImages: storage.checkedImages ?? null,
    signedUrlOk: storage.signedUrlOk ?? null,
    errors: storage.errors ?? null,
  });
  addCheck('usage events have no failed or stale reserved rows', Number(usage.failed ?? 0) === 0 &&
    Number(usage.staleReserved ?? 0) === 0, {
    failed: usage.failed ?? null,
    staleReserved: usage.staleReserved ?? null,
    total: usage.total ?? null,
  });
  addCheck('usage readback sample state is explicit', Number(usage.total ?? 0) >= 0, {
    total: usage.total ?? null,
    samplePresent: Number(usage.total ?? 0) > 0,
  });
  if (Number(usage.total ?? 0) === 0) {
    addWarning('production_usage_sample_absent', 'No usage_events rows were present in the G620 production monitor window.', 'The verifier still checks source/RPC completion paths; rerun after safe production usage exists for live-row proof.');
  }
  addCheck('edge function runs have no failed or stale started rows', Number(edgeFunctions.failed ?? 0) === 0 &&
    Number(edgeFunctions.staleStarted ?? 0) === 0, {
    failed: edgeFunctions.failed ?? null,
    staleStarted: edgeFunctions.staleStarted ?? null,
    total: edgeFunctions.total ?? null,
  });
  addCheck('edge function run sample state is explicit', Number(edgeFunctions.total ?? 0) >= 0, {
    total: edgeFunctions.total ?? null,
    samplePresent: Number(edgeFunctions.total ?? 0) > 0,
  });
  if (Number(edgeFunctions.total ?? 0) === 0) {
    addWarning('production_edge_function_sample_absent', 'No edge_function_runs rows were present in the G620 production monitor window.', 'The verifier still checks source/RPC observability paths; rerun after safe production Edge runs exist for live-row proof.');
  }
}

function checkReleaseGateWiring() {
  const packageJson = readJson('package.json');
  const releaseGate = readText('scripts/verify-release-gate-unified.mjs');
  addCheck('package exposes G620 verifier command', packageJson?.scripts?.['verify:g620-security-ops'] === 'node scripts/verify-g620-security-ops.mjs', {
    script: packageJson?.scripts?.['verify:g620-security-ops'] ?? null,
  });
  addCheck('release gate reads G620 security ops baseline', allIncludes(releaseGate, [
    'G620 security operations',
    'heavy-chain.g620.security-operations.v1',
    'validateG620SecurityOps',
    'scripts/verify-g620-security-ops.mjs',
  ]), { file: 'scripts/verify-release-gate-unified.mjs' });
}

function runStep({ name, command, args: commandArgs, required }) {
  const startedAt = new Date();
  const result = spawnSync(command, commandArgs, {
    cwd: process.cwd(),
    encoding: 'utf8',
    env: process.env,
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
      id: `command_failed:${slug(name)}`,
      message: `${name} failed.`,
      outputTail: entry.outputTail,
      error: entry.error,
    });
    report.ok = false;
    report.summary = {
      ok: false,
      commands: report.commands.length,
      checks: report.checks.length,
      blockers: report.blockers.length,
      warnings: report.warnings.length,
      monitorWindowHours,
    };
    writeSummary();
    console.log(JSON.stringify({ ok: false, summaryPath, failedCommand: name }, null, 2));
    process.exit(1);
  }
}

function addCheck(name, passed, details = {}) {
  report.checks.push({ name, passed: Boolean(passed), details: redact(details) });
}

function addWarning(id, message, nextAction) {
  report.warnings.push({ id, message, nextAction });
}

function discoverFunctionsUsing(token) {
  const functionsDir = 'supabase/functions';
  return fs.readdirSync(functionsDir, { withFileTypes: true })
    .filter((entry) => entry.isDirectory() && !entry.name.startsWith('_'))
    .map((entry) => entry.name)
    .filter((functionName) => {
      const text = readText(path.join(functionsDir, functionName, 'index.ts'));
      return text.includes(token);
    })
    .sort();
}

function hasAccessGate(functionName, text) {
  if (text.includes('requireBrandRole') || text.includes('requireImageRole') || text.includes('requireFolderRole')) return true;
  if (functionName === 'share-link') {
    return text.includes('readToken') &&
      text.includes('expires_at') &&
      text.includes('Share link not found') &&
      text.includes('Share link expired');
  }
  return false;
}

function readText(filePath) {
  try {
    return fs.readFileSync(filePath, 'utf8');
  } catch {
    return '';
  }
}

function readJson(filePath) {
  try {
    return JSON.parse(fs.readFileSync(filePath, 'utf8'));
  } catch {
    return null;
  }
}

function allIncludes(text, required) {
  return required.every((item) => text.includes(item));
}

function ordered(text, required) {
  let cursor = -1;
  for (const item of required) {
    const index = text.indexOf(item, cursor + 1);
    if (index < 0) return false;
    cursor = index;
  }
  return true;
}

function countOccurrences(text, needle) {
  if (!needle) return 0;
  return text.split(needle).length - 1;
}

function arrayFrom(value) {
  return Array.isArray(value) ? value : [];
}

function parseArgs(argv) {
  const parsed = {};
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    if (!arg.startsWith('--')) continue;
    const key = arg.slice(2);
    const next = argv[i + 1];
    if (!next || next.startsWith('--')) {
      parsed[key] = true;
      continue;
    }
    parsed[key] = next;
    i += 1;
  }
  return parsed;
}

function slug(value) {
  return String(value).replace(/[^a-z0-9]+/gi, '_').replace(/^_+|_+$/g, '').toLowerCase();
}

function safeTail(text, max = 5000) {
  return text.length > max ? text.slice(-max) : text;
}

function redact(value) {
  if (Array.isArray(value)) return value.map(redact);
  if (!value || typeof value !== 'object') return value;
  return Object.fromEntries(Object.entries(value).map(([key, inner]) => [
    key,
    key === 'identityOtpCaptchaSecrets'
      ? redact(inner)
      : /token|secret|key|authorization|signedurl/i.test(key) ? '[redacted]' : redact(inner),
  ]));
}

function writeSummary() {
  fs.mkdirSync(path.dirname(summaryPath), { recursive: true });
  fs.writeFileSync(summaryPath, `${JSON.stringify(redact(report), null, 2)}\n`);
}
