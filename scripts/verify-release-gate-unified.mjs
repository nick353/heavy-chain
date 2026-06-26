#!/usr/bin/env node

import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';

const args = parseArgs(process.argv.slice(2));
const capturedAt = new Date();
const outPath = args.out || `output/playwright/10m-product-readiness-g607/release-gate-${dateStamp(capturedAt)}.json`;
const allowDirty = Boolean(args.allowDirty || args['allow-dirty']);
const skipCommands = Boolean(args.skipCommands || args['skip-commands']);
const maxArtifactAgeHours = Number(args.maxArtifactAgeHours || args['max-artifact-age-hours'] || 48);

const REQUIRED_G608_REQUIREMENT_IDS = [
  'logged_in_production_ui',
  'local_production_build_full_ui',
  'logged_in_navigation',
  'local_worker_operator_controls',
  'runway_site_approval',
  'unapproved_denial',
  'local_worker_contract_redaction',
  'runway_bridge_tools',
  'approved_live_generation_readback',
  'workspace_readback_expected_task_codes',
  'approved_generation_cleanup',
];

const requiredReadbacks = [
  {
    name: 'production monitor',
    path: 'output/playwright/goal-loop-10m-20260626/production-monitor-after-deploy/summary.json',
    validate: (json) =>
      json.ok === true &&
      arrayFrom(json.blockers).length === 0 &&
      Number(json.summary?.blockers ?? 0) === 0 &&
      json.summary?.uiOk === true &&
      !arrayFrom(json.warnings).some((warning) => warning?.code === 'ui_probe_skipped'),
    expect: 'ok=true, blockers=[], summary.blockers=0, uiOk=true, and UI probe not skipped',
  },
  {
    name: 'launch operations',
    path: 'output/playwright/goal-loop-10m-20260626/launch-ops-after-deploy/summary.json',
    validate: (json) => json.ok === true && arrayFrom(json.failed).length === 0,
    expect: 'ok=true and failed=[]',
  },
  {
    name: 'mass-market recorded QA',
    path: 'output/playwright/mass-market-qa-prod-after-reference-handoff-20260625-rerun/SUMMARY.json',
    validate: (json) =>
      json.ok === true &&
      arrayFrom(json.failed).length === 0 &&
      json.cleanup?.contextClosed === true &&
      json.cleanup?.browserClosed === true,
    expect: 'ok=true, failed=[], contextClosed=true, browserClosed=true',
  },
  {
    name: 'G603 garment Canvas',
    path: 'output/playwright/g603-garment-layer-canvas-20260626T130426Z/SUMMARY.json',
    validate: (json) => json.ok === true && arrayFrom(json.failed).length === 0,
    expect: 'ok=true and failed=[]',
  },
  {
    name: 'G605 onboarding templates',
    path: 'output/playwright/g605-onboarding-templates-20260626T133449Z/SUMMARY.json',
    validate: (json) =>
      json.ok === true &&
      arrayFrom(json.failed).length === 0 &&
      json.cleanup?.previewProcessExit?.exited === true &&
      json.cleanup?.previewProcessExit?.portFree === true,
    expect: 'ok=true, failed=[], preview process exited, port free',
  },
  {
    name: 'G606 performance scale',
    path: 'output/playwright/10m-product-readiness-g606/summary.json',
    validate: (json) =>
      json.ok === true &&
      arrayFrom(json.issues).length === 0 &&
      Number(json.galleryStress?.renderedTilesInitial || 0) >= 60 &&
      Number(json.canvasStress?.persistedObjects || 0) >= 180 &&
      json.cleanup?.previewProcessCleanup?.groupAliveAfter === false,
    expect: 'ok=true with Gallery >=60 initial tiles and Canvas >=180 objects',
  },
  {
    name: 'G608 security audit',
    path: 'output/playwright/10m-product-readiness-g608-security-audit/audit-readiness.json',
    validate: (json) => {
      const requirements = arrayFrom(json.requirements);
      const requirementIds = requirements.map((requirement) => requirement?.id).filter(Boolean);
      const uniqueRequirementIds = new Set(requirementIds);
      const expectedRequirementIds = new Set(REQUIRED_G608_REQUIREMENT_IDS);
      return (
        arrayFrom(json.blockers).length === 0 &&
        requirements.length === REQUIRED_G608_REQUIREMENT_IDS.length &&
        uniqueRequirementIds.size === requirements.length &&
        REQUIRED_G608_REQUIREMENT_IDS.every((id) => uniqueRequirementIds.has(id)) &&
        requirementIds.every((id) => expectedRequirementIds.has(id)) &&
        requirements.every((requirement) => requirement?.status === 'passed') &&
        Number(json.summary?.total || 0) === requirements.length &&
        Number(json.summary?.passed || 0) === requirements.length &&
        Number(json.summary?.failed || 0) === 0 &&
        Number(json.summary?.blocked_external || 0) === 0 &&
        Number(json.summary?.pending_after_blocker || 0) === 0 &&
        (json.complete === true || json.ok === true || json.passed === true)
      );
    },
    expect: 'complete/ok/passed with blockers=[], expected requirement IDs exactly once, all requirements passed, and summary counts matching requirements',
  },
];

const commandChecks = [
  {
    name: 'node syntax: release gate',
    command: 'node',
    args: ['--check', 'scripts/verify-release-gate-unified.mjs'],
  },
  {
    name: 'node syntax: release doctor',
    command: 'node',
    args: ['--check', 'scripts/release-doctor.mjs'],
  },
  {
    name: 'node syntax: production monitor',
    command: 'node',
    args: ['--check', 'scripts/monitor-production-health.mjs'],
  },
  {
    name: 'node syntax: launch ops',
    command: 'node',
    args: ['--check', 'scripts/verify-launch-operations-readiness.mjs'],
  },
  {
    name: 'node syntax: mass-market QA',
    command: 'node',
    args: ['--check', 'scripts/verify-mass-market-qa.mjs'],
  },
  {
    name: 'security audit',
    command: 'npm',
    args: ['run', 'security:audit', '--silent'],
  },
  {
    name: 'generation scorecard',
    command: 'npm',
    args: ['run', 'verify:generation-scorecard', '--silent'],
  },
  {
    name: 'typecheck',
    command: 'npm',
    args: ['run', 'typecheck', '--silent'],
  },
  {
    name: 'build',
    command: 'npm',
    args: ['run', 'build', '--silent'],
  },
  {
    name: 'lint',
    command: 'npm',
    args: ['run', 'lint', '--silent', '--', '--max-warnings=0'],
  },
  {
    name: 'git diff check',
    command: 'git',
    args: ['diff', '--check'],
  },
];

const report = {
  schema: 'heavy-chain.release-gate-unified.v1',
  capturedAt: capturedAt.toISOString(),
  mode: skipCommands
    ? 'readback-only-dry-run-no-submit-no-payment-no-cleanup'
    : 'readback-plus-local-static-checks-no-submit-no-payment-no-cleanup',
  outPath,
  allowDirty,
  maxArtifactAgeHours,
  irreversibleActions: {
    generationSubmit: 'not_clicked',
    purchasePaymentCheckout: 'not_touched',
    externalPublish: 'not_touched',
    destructiveCleanup: 'not_touched',
    deploy: 'not_run',
  },
  readbacks: [],
  commands: [],
  blockers: [],
  warnings: [],
  stopConditions: [
    'billing_purchase_payment_checkout',
    'identity_otp_captcha_security_prompt',
    'secret_entry',
    'external_public_publish',
    'destructive_cleanup_outside_marker_scoped_artifacts',
    'new_paid_external_vendor_or_monitoring_service',
  ],
};

if (!allowDirty) {
  checkGitClean();
} else {
  report.warnings.push({ id: 'git_dirty_allowed', message: '--allow-dirty was used; this proof is a development dry-run, not final release approval.' });
  report.blockers.push({
    id: 'allow_dirty_not_release_acceptance',
    message: '--allow-dirty cannot produce an accepted release gate proof.',
    next: 'Commit or park tracked changes, then rerun without --allow-dirty.',
  });
}

for (const item of requiredReadbacks) {
  report.readbacks.push(readbackCheck(item));
}

if (!skipCommands) {
  for (const item of commandChecks) {
    report.commands.push(runCommand(item));
  }
} else {
  report.warnings.push({ id: 'commands_skipped', message: '--skip-commands was used; static command gates were not executed.' });
  report.blockers.push({
    id: 'commands_skipped_not_release_acceptance',
    message: '--skip-commands cannot produce an accepted release gate proof.',
    next: 'Rerun without --skip-commands so security audit, scorecard, typecheck, lint, syntax checks, and git diff check execute.',
  });
}

report.ok =
  report.blockers.length === 0 &&
  report.readbacks.every((item) => item.passed) &&
  report.commands.every((item) => item.passed);
report.failed = [
  ...report.readbacks.filter((item) => !item.passed).map((item) => `readback:${item.name}`),
  ...report.commands.filter((item) => !item.passed).map((item) => `command:${item.name}`),
  ...report.blockers.map((item) => `blocker:${item.id}`),
];

fs.mkdirSync(path.dirname(outPath), { recursive: true });
fs.writeFileSync(outPath, `${JSON.stringify(report, null, 2)}\n`);

console.log(JSON.stringify({ ok: report.ok, outPath, failed: report.failed }, null, 2));
process.exit(report.ok ? 0 : 1);

function checkGitClean() {
  const result = spawnSync('git', ['status', '--short'], {
    cwd: process.cwd(),
    encoding: 'utf8',
    shell: false,
  });
  if (result.status !== 0) {
    report.blockers.push({
      id: 'git_status_failed',
      message: safeTail(`${result.stdout || ''}${result.stderr || ''}`).join('\n'),
      next: 'Fix git status execution before release gate.',
    });
    return;
  }
  if (result.stdout.trim()) {
    report.blockers.push({
      id: 'git_dirty',
      message: 'Working tree has uncommitted changes.',
      details: result.stdout.trim().split(/\r?\n/).slice(0, 20),
      next: 'Commit or intentionally park changes, then rerun without --allow-dirty.',
    });
  }
}

function readbackCheck(item) {
  const entry = {
    name: item.name,
    path: item.path,
    expected: item.expect,
    passed: false,
  };

  try {
    const raw = fs.readFileSync(item.path, 'utf8');
    const stat = fs.statSync(item.path);
    const json = JSON.parse(raw);
    entry.safeSummary = summarizeJson(json);
    entry.freshness = artifactFreshness(item.path, json, stat);
    entry.passed = item.validate(json) && entry.freshness.passed;
    if (!entry.passed) {
      entry.next = entry.freshness.passed
        ? `Refresh or repair ${item.path}; expected ${item.expect}.`
        : `Refresh ${item.path}; artifact is older than ${maxArtifactAgeHours}h or lacks a usable timestamp/mtime.`;
    }
  } catch (error) {
    entry.error = error.message;
    entry.next = `Create or restore ${item.path}; expected ${item.expect}.`;
  }

  return entry;
}

function artifactFreshness(filePath, json, stat) {
  const timestamp =
    json.capturedAt ||
    json.measuredAt ||
    json.captured_at ||
    json.verifiedAt ||
    json.completedAt ||
    json.finishedAt ||
    json.generatedAt ||
    null;
  const timestampMs = timestamp ? Date.parse(timestamp) : Number.NaN;
  const source = 'artifact_timestamp';
  const observedMs = timestampMs;
  const ageHours = (capturedAt.getTime() - observedMs) / (60 * 60 * 1000);
  return {
    source,
    timestamp: Number.isFinite(timestampMs) ? new Date(timestampMs).toISOString() : null,
    mtime: stat.mtime.toISOString(),
    ageHours: Number(ageHours.toFixed(2)),
    maxArtifactAgeHours,
    passed: Number.isFinite(ageHours) && ageHours >= 0 && ageHours <= maxArtifactAgeHours,
  };
}

function runCommand(item) {
  const startedAt = new Date();
  const result = spawnSync(item.command, item.args, {
    cwd: process.cwd(),
    encoding: 'utf8',
    env: process.env,
    shell: false,
    maxBuffer: 10 * 1024 * 1024,
  });
  const output = `${result.stdout || ''}${result.stderr || ''}`;
  return {
    name: item.name,
    command: [item.command, ...item.args].join(' '),
    startedAt: startedAt.toISOString(),
    durationMs: Date.now() - startedAt.getTime(),
    status: result.status,
    passed: result.error === undefined && result.status === 0,
    outputTail: safeTail(output),
    error: result.error?.message,
  };
}

function summarizeJson(json) {
  return {
    ok: json.ok,
    passed: json.passed,
    failed: arrayFrom(json.failed).slice(0, 10),
    blockers: arrayFrom(json.blockers).length,
    warnings: arrayFrom(json.warnings).length,
    capturedAt: json.capturedAt || json.verifiedAt || json.completedAt || null,
    workflow: json.workflow || json.schema || null,
  };
}

function safeTail(text) {
  return redact(String(text || ''))
    .split(/\r?\n/)
    .map((line) => line.trimEnd())
    .filter(Boolean)
    .slice(-12);
}

function redact(text) {
  return text
    .replace(/eyJ[A-Za-z0-9_-]{20,}\.[A-Za-z0-9_-]{20,}\.[A-Za-z0-9_-]{20,}/g, '[redacted]')
    .replace(/sk-[A-Za-z0-9_-]{12,}/g, '[redacted]')
    .replace(/AIza[0-9A-Za-z_-]{12,}/g, '[redacted]')
    .replace(/((?:SUPABASE|OPENAI|GEMINI|RUNWAY|VITE)_[A-Z0-9_]*(?:KEY|TOKEN|SECRET|URL)?\s*[=:]\s*)\S+/gi, '$1[redacted]');
}

function arrayFrom(value) {
  return Array.isArray(value) ? value : [];
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

function dateStamp(date) {
  return date.toISOString().replace(/[-:]/g, '').replace(/\.\d{3}Z$/, 'Z');
}
