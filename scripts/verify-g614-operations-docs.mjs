#!/usr/bin/env node

import fs from 'node:fs';
import path from 'node:path';

const args = parseArgs(process.argv.slice(2));
const out = args.out || 'output/playwright/g614-operations-docs/summary.json';
const report = {
  schema: 'heavy-chain.g614.operations-docs.v1',
  capturedAt: new Date().toISOString(),
  mode: 'static-provider-neutral-read-only-no-generation-no-deploy',
  checks: [],
  blockers: [],
  irreversibleActions: {
    generationSubmit: 'not_clicked',
    retry: 'not_run',
    purchasePaymentCheckout: 'not_touched',
    externalPublish: 'not_touched',
    deploy: 'not_run',
  },
  artifacts: { summary: out },
};

const requiredDocs = [
  'docs/g614-operations-runbook-2026-06-26.md',
  'docs/launch-operations-runbook-2026-06-25.md',
  'docs/production-monitoring-runbook-2026-06-26.md',
  'docs/release-gate-runbook-2026-06-26.md',
];
const activeRuntimeFiles = [
  'src/pages/GeneratePage.tsx',
  'src/pages/AdminDashboard.tsx',
  'src/lib/errorMessages.ts',
  'src/lib/imageApi.ts',
  'supabase/functions/_shared/imageProvider.ts',
  ...walk('supabase/functions').filter((file) => file.endsWith('index.ts')),
];
const retiredProviderPattern = /\b(?:runway|runway_mcp|local-runway)\b/i;

for (const file of requiredDocs) {
  addCheck(`required operations document exists: ${file}`, fs.existsSync(file), { file });
}

const g614Text = readText('docs/g614-operations-runbook-2026-06-26.md');
for (const phrase of [
  'OpenAI image adapter',
  'retired third-party worker and OAuth bridge',
  'OPENAI_API_KEY',
  'Signed URLs',
  'npm run verify:release-gate',
  'Stop on billing',
]) {
  addCheck(`G614 runbook includes ${phrase}`, g614Text.includes(phrase), { phrase });
}

const launchText = readText('docs/launch-operations-runbook-2026-06-25.md');
addCheck('launch runbook states the server-side OpenAI boundary', /server-side OpenAI adapter/i.test(launchText), {});
addCheck('monitor runbook states the OpenAI provider readback', /OpenAI provider readback/i.test(readText('docs/production-monitoring-runbook-2026-06-26.md')), {});
const releaseRunbook = readText('docs/release-gate-runbook-2026-06-26.md');
addCheck('release runbook documents non-acceptance debug modes', /--allow-dirty/.test(releaseRunbook) && /--skip-commands/.test(releaseRunbook), {});

const packageJson = readJson('package.json');
addCheck('package exposes G614 verifier command', packageJson?.scripts?.['verify:g614-ops'] === 'node scripts/verify-g614-operations-docs.mjs', {
  script: packageJson?.scripts?.['verify:g614-ops'] ?? null,
});
addCheck('package exposes G632 verifier command', packageJson?.scripts?.['verify:g632-incident-response'] === 'node scripts/verify-g632-incident-response-drill.mjs', {
  script: packageJson?.scripts?.['verify:g632-incident-response'] ?? null,
});

const releaseGateText = readText('scripts/verify-release-gate-unified.mjs');
addCheck('release gate references current operations verifiers', releaseGateText.includes('scripts/verify-g614-operations-docs.mjs') && releaseGateText.includes('scripts/verify-g632-incident-response-drill.mjs') && releaseGateText.includes('verify:g614-ops') && releaseGateText.includes('verify:g632-incident-response'), {});

for (const file of activeRuntimeFiles) {
  const text = readText(file);
  addCheck(`active runtime path has no retired provider reference: ${file}`, Boolean(text) && !retiredProviderPattern.test(text), {
    file,
    exists: Boolean(text),
  });
}

for (const check of report.checks) {
  if (!check.passed) report.blockers.push({ id: `check_failed:${slug(check.name)}`, message: check.name, details: check.details });
}
report.ok = report.blockers.length === 0;
report.summary = { ok: report.ok, checks: report.checks.length, blockers: report.blockers.length };
writeJson(out, report);
console.log(JSON.stringify({ ok: report.ok, summaryPath: out, blockers: report.blockers.map((item) => item.id) }, null, 2));
process.exit(report.ok ? 0 : 1);

function addCheck(name, passed, details) { report.checks.push({ name, passed: Boolean(passed), details }); }
function readText(file) { try { return fs.readFileSync(file, 'utf8'); } catch { return ''; } }
function readJson(file) { try { return JSON.parse(fs.readFileSync(file, 'utf8')); } catch { return null; } }
function writeJson(file, value) { fs.mkdirSync(path.dirname(file), { recursive: true }); fs.writeFileSync(file, `${JSON.stringify(value, null, 2)}\n`); }
function walk(root) {
  if (!fs.existsSync(root)) return [];
  const result = [];
  for (const entry of fs.readdirSync(root, { withFileTypes: true })) {
    const full = path.join(root, entry.name);
    if (entry.isDirectory()) result.push(...walk(full));
    else result.push(full);
  }
  return result;
}
function slug(value) { return String(value).toLowerCase().replace(/[^a-z0-9]+/g, '_').replace(/^_+|_+$/g, ''); }
function parseArgs(argv) {
  const parsed = {};
  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (!arg.startsWith('--')) continue;
    const key = arg.slice(2);
    const next = argv[index + 1];
    parsed[key] = next && !next.startsWith('--') ? (index += 1, next) : true;
  }
  return parsed;
}
