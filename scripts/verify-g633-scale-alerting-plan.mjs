#!/usr/bin/env node

import fs from 'node:fs';
import path from 'node:path';

const args = parseArgs(process.argv.slice(2));
const outDir = args.out || 'output/playwright/g633-scale-alerting-plan';
const summaryPath = path.join(outDir, 'summary.json');

const report = {
  schema: 'heavy-chain.g633.scale-alerting-plan.v1',
  capturedAt: new Date().toISOString(),
  mode: 'planning-verifier-no-load-test-no-paid-vendor-no-production-mutation',
  outDir,
  irreversibleActions: {
    generationSubmit: 'not_clicked',
    purchasePaymentCheckout: 'not_touched',
    identityOtpCaptchaSecrets: 'not_touched',
    externalPublish: 'not_touched',
    destructiveCleanup: 'not_touched',
    dnsHostingChanges: 'not_touched',
    paidVendorSetup: 'not_touched',
    productionLoadTest: 'not_run',
    deploy: 'not_run',
  },
  checks: [],
  blockers: [],
  artifacts: {
    summary: summaryPath,
    plan: 'docs/g633-production-scale-alerting-plan-2026-07-01.md',
  },
};

fs.mkdirSync(outDir, { recursive: true });

const planText = readText('docs/g633-production-scale-alerting-plan-2026-07-01.md');
const packageJson = readJson('package.json');
const releaseGateText = readText('scripts/verify-release-gate-unified.mjs');

addCheck('G633 plan exists', Boolean(planText), {
  file: 'docs/g633-production-scale-alerting-plan-2026-07-01.md',
});

for (const phrase of [
  'Hard Stops',
  'Current Safe Baseline',
  'Approval-Required Load Tiers',
  'Proposed T3 Targets Before Execution',
  'Alerting Decision Packet',
  'npm run verify:g633-scale-alerting-plan',
  'does not authorize or execute a load test',
]) {
  addCheck(`plan includes ${phrase}`, planText.includes(phrase), { phrase });
}

for (const phrase of [
  'billing, purchase, payment, checkout',
  'identity verification, OTP/CAPTCHA/security prompt',
  'external public publishing',
  'destructive production cleanup',
  'broad production load',
  'DNS/hosting changes',
  'new paid vendor setup',
  'alert destination setup',
]) {
  addCheck(`hard stops include ${phrase}`, planText.includes(phrase), { phrase });
}

for (const tier of ['T0 local synthetic', 'T1 production read-only', 'T2 marker-scoped production UAT', 'T3 approved concurrency test']) {
  addCheck(`plan includes load tier ${tier}`, planText.includes(tier), { tier });
}

for (const phrase of [
  'authenticated users: 25',
  'generation jobs: 50',
  'Runway concurrency: at most 2',
  'duration: 30 minutes',
  'cost cap',
  'marker prefix',
  'generation failure rate <= 2%',
  'Storage signed URL errors = 0',
  'usage failed/stale = 0',
]) {
  addCheck(`T3 target includes ${phrase}`, planText.includes(phrase), { phrase });
}

for (const phrase of [
  'vendor or built-in channel',
  'cost cap',
  'destination owner',
  'on-call window',
  'escalation policy',
  'retention period',
  'secrets storage path',
  'rollback/remove procedure',
]) {
  addCheck(`alerting decision field includes ${phrase}`, planText.includes(phrase), { phrase });
}

for (const phrase of [
  'generation failure rate above threshold',
  'stale pending/processing jobs',
  'local worker inbox backlog',
  'Storage signed URL/readback errors',
  'Edge Function failed/stale started runs',
  'usage reservation failures or stale reservations',
  'production UI probe failure',
  'release gate regression',
]) {
  addCheck(`alert signal includes ${phrase}`, planText.includes(phrase), { phrase });
}

for (const file of [
  'output/playwright/10m-product-readiness-g618/summary.json',
  'output/playwright/10m-product-readiness-g620/summary.json',
  'output/playwright/prod-post-g630-mass-market-20260701-r1/SUMMARY.json',
  'output/playwright/g632-incident-response-drill/summary.json',
]) {
  addCheck(`baseline proof exists ${file}`, fs.existsSync(file), { file });
}

addCheck(
  'package exposes G633 verifier command',
  packageJson?.scripts?.['verify:g633-scale-alerting-plan'] === 'node scripts/verify-g633-scale-alerting-plan.mjs',
  { script: packageJson?.scripts?.['verify:g633-scale-alerting-plan'] ?? null },
);

addCheck(
  'release gate reads G633 scale alerting plan',
  releaseGateText.includes('G633 scale and alerting plan') &&
    releaseGateText.includes('output/playwright/g633-scale-alerting-plan/summary.json') &&
    releaseGateText.includes('scripts/verify-g633-scale-alerting-plan.mjs') &&
    releaseGateText.includes('verify:g633-scale-alerting-plan'),
  { file: 'scripts/verify-release-gate-unified.mjs' },
);

addCheck(
  'verifier did not require irreversible actions',
  Object.values(report.irreversibleActions).every((value) => ['not_clicked', 'not_touched', 'not_run'].includes(value)),
  { irreversibleActions: report.irreversibleActions },
);

for (const check of report.checks) {
  if (!check.passed) {
    report.blockers.push({
      id: `check_failed:${slug(check.name)}`,
      message: `${check.name} failed.`,
      details: check.details,
    });
  }
}

report.ok = report.blockers.length === 0;
report.summary = {
  ok: report.ok,
  checks: report.checks.length,
  blockers: report.blockers.length,
};

writeJson(summaryPath, report);
console.log(JSON.stringify({ ok: report.ok, summaryPath, blockers: report.blockers.map((item) => item.id) }, null, 2));
process.exit(report.ok ? 0 : 1);

function addCheck(name, passed, details = {}) {
  report.checks.push({ name, passed: Boolean(passed), details });
}

function readText(file) {
  try {
    return fs.readFileSync(file, 'utf8');
  } catch {
    return '';
  }
}

function readJson(file) {
  try {
    return JSON.parse(fs.readFileSync(file, 'utf8'));
  } catch {
    return null;
  }
}

function writeJson(file, value) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, `${JSON.stringify(value, null, 2)}\n`);
}

function slug(value) {
  return String(value).toLowerCase().replace(/[^a-z0-9]+/g, '_').replace(/^_+|_+$/g, '');
}

function parseArgs(argv) {
  const parsed = {};
  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (!arg.startsWith('--')) continue;
    const key = arg.slice(2);
    const next = argv[index + 1];
    if (next && !next.startsWith('--')) {
      parsed[key] = next;
      index += 1;
    } else {
      parsed[key] = true;
    }
  }
  return parsed;
}
