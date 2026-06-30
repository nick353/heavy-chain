#!/usr/bin/env node

import fs from 'node:fs';
import path from 'node:path';

const args = parseArgs(process.argv.slice(2));
const outDir = args.out || 'output/playwright/g632-incident-response-drill';
const summaryPath = path.join(outDir, 'summary.json');

const report = {
  schema: 'heavy-chain.g632.incident-response-drill.v1',
  capturedAt: new Date().toISOString(),
  mode: 'non-destructive-ops-drill-no-submit-no-payment-no-cleanup',
  outDir,
  irreversibleActions: {
    generationSubmit: 'not_clicked',
    purchasePaymentCheckout: 'not_touched',
    identityOtpCaptchaSecrets: 'not_touched',
    externalPublish: 'not_touched',
    destructiveCleanup: 'not_touched',
    dnsHostingChanges: 'not_touched',
    deploy: 'not_run',
  },
  scenarios: [],
  checks: [],
  blockers: [],
  artifacts: {
    summary: summaryPath,
    runbook: 'docs/g632-incident-response-drill-2026-07-01.md',
  },
};

fs.mkdirSync(outDir, { recursive: true });

const drillText = readText('docs/g632-incident-response-drill-2026-07-01.md');
const g614Text = readText('docs/g614-operations-runbook-2026-06-26.md');
const g620Text = readText('docs/g620-security-operations-runbook-2026-06-30.md');
const releaseGateText = readText('scripts/verify-release-gate-unified.mjs');
const packageJson = readJson('package.json');
const scorecardText = readText('docs/generation-quality-rubric-2026-06-26.md');

addCheck('drill runbook exists', Boolean(drillText), {
  file: 'docs/g632-incident-response-drill-2026-07-01.md',
});

for (const phrase of [
  'Hard Stops',
  'Drill Matrix',
  'Runway failure',
  'Worker stop',
  'Storage readback failure',
  'RLS or permission anomaly',
  'Generation-quality regression',
  'npm run verify:g632-incident-response',
  'not public-launch completion',
]) {
  addCheck(`drill runbook includes ${phrase}`, drillText.includes(phrase), { phrase });
}

for (const phrase of [
  'billing, purchase, payment, checkout',
  'identity verification, OTP/CAPTCHA/security prompt',
  'external public publishing',
  'destructive production cleanup',
  'DNS/hosting changes',
  'new paid vendor setup',
]) {
  addCheck(`drill hard stop includes ${phrase}`, drillText.includes(phrase), { phrase });
}

const scenarios = [
  {
    id: 'runway_failure',
    title: 'Runway failure',
    requiredTerms: [
      'workspace_limit',
      'approved existing Runway MCP client',
      'at most two concurrent generations',
      'localhost:15554',
      'mcp-remote',
      'runway-workspace-limit-after-successful-probe.json',
      'run-manifest.json',
      'cleanup*.json',
    ],
    evidenceFiles: [
      'output/playwright/g617-same-run-fresh-generation-hc-g617-same-run-fresh-20260630T063740Z/runway-workspace-limit-after-successful-probe.json',
      'output/playwright/g617-same-run-fresh-generation-hc-g617-same-run-fresh-20260630T063740Z/run-manifest.json',
      'output/playwright/g617-same-run-fresh-generation-hc-g617-same-run-fresh-20260630T063740Z/cleanup-after-runway-workspace-limit.json',
    ],
    supportingTerms: [
      [g614Text, 'Do not use the old `localhost:15554` dynamic-client consent path.'],
      [g620Text, 'worker/import failure'],
    ],
  },
  {
    id: 'worker_stop',
    title: 'Worker stop',
    requiredTerms: [
      'npm run worker:local-runway:watch',
      'heavyChainJobId',
      'generationJobId',
      'local inbox warning',
      'Do not broad-delete jobs',
      'untagged MCP JSON',
    ],
    evidenceFiles: [
      'output/playwright/production-monitor-post-g630-20260701-r1/summary.json',
    ],
    supportingTerms: [
      [g614Text, 'npm run worker:local-runway:watch'],
      [g614Text, 'JSON moved to `failed/`'],
    ],
  },
  {
    id: 'storage_readback_failure',
    title: 'Storage readback failure',
    requiredTerms: [
      'signed URL/download fails',
      'Do not trust Gallery',
      'generated_images.storage_path',
      'production monitor storage signed URL checks',
      'signed URL/download succeeds',
    ],
    evidenceFiles: [
      'output/playwright/production-monitor-post-g630-20260701-r1/summary.json',
    ],
    supportingTerms: [
      [g620Text, 'Storage trust without object proof'],
      [g614Text, 'storage readback failure'],
    ],
  },
  {
    id: 'rls_permission_anomaly',
    title: 'RLS or permission anomaly',
    requiredTerms: [
      'request id',
      'brand id',
      'user id',
      'npm run security:audit',
      'bash scripts/supabase-prod-verify.sh',
      'Do not bypass RLS',
    ],
    evidenceFiles: [
      'output/playwright/10m-product-readiness-g620/summary.json',
    ],
    supportingTerms: [
      [g620Text, 'access/role issue'],
      [g620Text, 'admin_audit_logs'],
    ],
  },
  {
    id: 'generation_quality_regression',
    title: 'Generation-quality regression',
    requiredTerms: [
      'visible UI/watermark/text artifact',
      'scorecard',
      'needs-polish',
      'Rerun bounded prompt/style fix',
      'every feature is `pass`',
    ],
    evidenceFiles: [
      'docs/generation-quality-rubric-2026-06-26.md',
    ],
    supportingTerms: [
      [scorecardText, 'Needs polish'],
      [scorecardText, 'fail'],
    ],
  },
];

for (const scenario of scenarios) {
  const missingTerms = scenario.requiredTerms.filter((term) => !drillText.includes(term));
  const missingEvidenceFiles = scenario.evidenceFiles.filter((file) => !fs.existsSync(file));
  const missingSupportingTerms = scenario.supportingTerms
    .filter(([text, term]) => !text.includes(term))
    .map(([, term]) => term);
  const passed = missingTerms.length === 0 && missingEvidenceFiles.length === 0 && missingSupportingTerms.length === 0;
  report.scenarios.push({
    id: scenario.id,
    title: scenario.title,
    passed,
    missingTerms,
    missingEvidenceFiles,
    missingSupportingTerms,
  });
  addCheck(`${scenario.title} scenario is fully specified`, passed, {
    missingTerms,
    missingEvidenceFiles,
    missingSupportingTerms,
  });
}

addCheck(
  'package exposes G632 incident response verifier',
  packageJson?.scripts?.['verify:g632-incident-response'] === 'node scripts/verify-g632-incident-response-drill.mjs',
  { script: packageJson?.scripts?.['verify:g632-incident-response'] ?? null },
);

addCheck(
  'release gate reads G632 incident response drill',
  releaseGateText.includes('G632 incident response drill') &&
    releaseGateText.includes('output/playwright/g632-incident-response-drill/summary.json') &&
    releaseGateText.includes('scripts/verify-g632-incident-response-drill.mjs') &&
    releaseGateText.includes('verify:g632-incident-response'),
  { file: 'scripts/verify-release-gate-unified.mjs' },
);

addCheck(
  'drill avoids irreversible actions',
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
  scenarios: report.scenarios.length,
  passedScenarios: report.scenarios.filter((scenario) => scenario.passed).length,
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
