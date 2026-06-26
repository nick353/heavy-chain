#!/usr/bin/env node

import fs from 'node:fs';

const requiredFiles = [
  'docs/g614-operations-runbook-2026-06-26.md',
  'docs/launch-operations-runbook-2026-06-25.md',
  'docs/production-monitoring-runbook-2026-06-26.md',
  'docs/release-gate-runbook-2026-06-26.md',
  'docs/rollback.md',
  'goals/HUMAN_NEEDED.md',
  'package.json',
];

const requiredPhrases = [
  'npm run worker:local-runway:watch',
  'npm run build:local-runway-handoff',
  'npm run worker:local-runway -- --job-id',
  'npm run monitor:production',
  'npm run verify:release-gate',
  'localhost:15554',
  'heavyChainJobId',
  'generationJobId',
  'referenceImageHandoff',
  'Supabase signed URLs',
  'Runway-hosted reference URL',
  'Stop before billing, purchase, payment, checkout',
  'Rollback is human-approved only',
  'docs/launch-operations-runbook-2026-06-25.md',
  'docs/production-monitoring-runbook-2026-06-26.md',
  'docs/release-gate-runbook-2026-06-26.md',
  'docs/rollback.md',
  'goals/HUMAN_NEEDED.md',
];

const requiredPackageScripts = [
  'build',
  'typecheck',
  'lint',
  'worker:local-runway:watch',
  'build:local-runway-handoff',
  'worker:local-runway',
  'monitor:production',
  'verify:release-gate',
  'verify:launch-ops',
  'security:audit',
  'supabase:verify',
];

const expectedPackageScriptSubstrings = {
  build: ['tsc -b', 'vite build'],
  typecheck: ['tsc --noEmit'],
  lint: ['eslint .'],
  'worker:local-runway:watch': [
    'scripts/local-runway-mcp-worker.mjs',
    '--loop',
    '--watch-mcp-results output/runway-mcp-results/inbox',
  ],
  'build:local-runway-handoff': ['scripts/build-local-runway-mcp-handoff.mjs'],
  'worker:local-runway': ['scripts/local-runway-mcp-worker.mjs'],
  'monitor:production': ['scripts/monitor-production-health.mjs'],
  'verify:release-gate': ['scripts/verify-release-gate-unified.mjs'],
  'verify:launch-ops': ['scripts/verify-launch-operations-readiness.mjs'],
  'security:audit': ['scripts/security-audit.mjs'],
  'supabase:verify': ['scripts/supabase-prod-verify.sh'],
  'verify:g614-ops': ['scripts/verify-g614-operations-docs.mjs'],
};

const failures = [];

for (const file of requiredFiles) {
  if (!fs.existsSync(file)) failures.push(`missing_file:${file}`);
}

const opsText = read('docs/g614-operations-runbook-2026-06-26.md');
for (const phrase of requiredPhrases) {
  if (!opsText.includes(phrase)) failures.push(`missing_ops_phrase:${phrase}`);
}

const rollbackText = read('docs/rollback.md');
if (/not release-ready.*2026-06-18/i.test(rollbackText)) {
  failures.push('stale_rollback_release_ready_status');
}
if (!rollbackText.includes('npm run verify:release-gate')) {
  failures.push('rollback_missing_release_gate_pointer');
}
for (const phrase of [
  'verified last-known-good commit',
  'git rev-parse HEAD',
  'git status --short',
  'git diff --stat -- supabase/functions/generate-image',
  'supabase functions deploy generate-image --project-ref <confirmed-project-ref>',
]) {
  if (!rollbackText.includes(phrase)) failures.push(`rollback_missing_safe_edge_function_boundary:${phrase}`);
}

const launchText = read('docs/launch-operations-runbook-2026-06-25.md');
if (!launchText.includes('Do not pass Supabase signed URLs')) {
  failures.push('launch_runbook_missing_reference_image_boundary');
}
if (!launchText.includes('Consent session missing or expired')) {
  failures.push('launch_runbook_missing_localhost_consent_triage');
}

const monitorText = read('docs/production-monitoring-runbook-2026-06-26.md');
if (!monitorText.includes('read-only')) failures.push('monitor_runbook_missing_read_only_boundary');

const releaseGateText = read('docs/release-gate-runbook-2026-06-26.md');
if (!/`?--allow-dirty`? is not release approval/.test(releaseGateText)) {
  failures.push('release_gate_missing_allow_dirty_boundary');
}
if (!releaseGateText.includes('command gates passing')) {
  failures.push('release_gate_missing_command_gate_contract');
}

const packageJson = JSON.parse(read('package.json'));
for (const script of requiredPackageScripts) {
  if (!packageJson.scripts?.[script]) failures.push(`missing_package_script:${script}`);
}
for (const [script, substrings] of Object.entries(expectedPackageScriptSubstrings)) {
  const command = packageJson.scripts?.[script] || '';
  for (const substring of substrings) {
    if (!command.includes(substring)) {
      failures.push(`package_script_mismatch:${script}:${substring}`);
    }
  }
}

const summary = {
  ok: failures.length === 0,
  checkedAt: new Date().toISOString(),
  files: requiredFiles,
  requiredPackageScripts: [...requiredPackageScripts, 'verify:g614-ops'],
  failures,
};

console.log(JSON.stringify(summary, null, 2));
process.exit(summary.ok ? 0 : 1);

function read(file) {
  return fs.existsSync(file) ? fs.readFileSync(file, 'utf8') : '';
}
