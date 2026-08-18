#!/usr/bin/env node

import fs from 'node:fs';
import path from 'node:path';

const args = parseArgs(process.argv.slice(2));
const outDir = args.out || 'output/playwright/g632-incident-response-drill';
const summaryPath = path.join(outDir, 'summary.json');
const report = {
  schema: 'heavy-chain.g632.incident-response-drill.v1',
  capturedAt: new Date().toISOString(),
  mode: 'non-destructive-provider-neutral-read-only-drill',
  outDir,
  scenarios: [],
  checks: [],
  blockers: [],
  irreversibleActions: {
    generationSubmit: 'not_clicked',
    retry: 'not_run',
    purchasePaymentCheckout: 'not_touched',
    identityOtpCaptchaSecrets: 'not_touched',
    externalPublish: 'not_touched',
    destructiveCleanup: 'not_touched',
    deploy: 'not_run',
  },
  artifacts: {
    summary: summaryPath,
    drill: 'docs/g632-incident-response-drill-2026-07-01.md',
  },
};
fs.mkdirSync(outDir, { recursive: true });

const doc = readText(report.artifacts.drill);
const packageJson = readJson('package.json');
const releaseGate = readText('scripts/verify-release-gate-unified.mjs');
const scenarios = [
  ['provider-adapter-failure', 'provider adapter error', 'do not retry automatically', 'verify:g620-security-ops'],
  ['job-readback-stall', 'pending', 'Jobs, History, and usage readback', 'monitor:production'],
  ['storage-readback-failure', 'signed URL', 'do not trust the Gallery card', 'workspace readback JSON'],
  ['rls-permission-anomaly', 'permission error', 'do not bypass RLS', 'security-audit.mjs'],
  ['generation-quality-regression', 'needs-polish', 'do not generate a replacement', 'generation-quality-rubric-2026-06-26.md'],
];
const evidenceFiles = [
  'output/playwright/g672-api-less-generation-readiness/summary.json',
  'output/playwright/g764-g620-security-ops-r1/summary.json',
  'output/playwright/prod-db-readback-current-20260818-r11/workspace-db-readback.json',
  'docs/generation-quality-rubric-2026-06-26.md',
  'scripts/security-audit.mjs',
  'scripts/supabase-prod-verify.sh',
];

addCheck('G632 document exists', Boolean(doc), { file: report.artifacts.drill });
for (const phrase of ['Hard Stops', 'Drill Matrix', 'Rehearsal Commands', 'no irreversible action requirement']) {
  addCheck(`drill document includes ${phrase}`, doc.includes(phrase), { phrase });
}
addCheck('drill document declares safe command boundary', /do not authorize generation, retry, billing, or\s*deployment/i.test(doc), {});
addCheck('drill document has no retired provider reference', !/\b(?:runway|runway_mcp|local-runway)\b/i.test(doc), {});
addCheck('package exposes G632 verifier command', packageJson?.scripts?.['verify:g632-incident-response'] === 'node scripts/verify-g632-incident-response-drill.mjs', {
  script: packageJson?.scripts?.['verify:g632-incident-response'] ?? null,
});
addCheck('release gate references G632 verifier', releaseGate.includes('scripts/verify-g632-incident-response-drill.mjs') && releaseGate.includes('verify:g632-incident-response'), {});

for (const file of evidenceFiles) {
  addCheck(`required drill evidence exists: ${file}`, fs.existsSync(file), { file });
}
const apiLess = readJson(evidenceFiles[0]);
const security = readJson(evidenceFiles[1]);
addCheck('API-less readiness evidence is passed', apiLess?.ok === true, { ok: apiLess?.ok ?? null });
addCheck('security operations evidence is passed', security?.ok === true && security?.schema === 'heavy-chain.g620.security-operations.v2', { ok: security?.ok ?? null, schema: security?.schema ?? null });

for (const [id, detection, firstAction, proof] of scenarios) {
  const checks = [
    doc.includes(`\`${id}\``),
    doc.toLowerCase().includes(detection.toLowerCase()),
    doc.toLowerCase().includes(firstAction.toLowerCase()),
    doc.toLowerCase().includes(proof.toLowerCase()),
    doc.includes('Stop'),
  ];
  const passed = checks.every(Boolean);
  report.scenarios.push({ id, passed, checks: { detection: checks[0] && checks[1], firstAction: checks[2], proof: checks[3], stopCondition: checks[4] } });
  addCheck(`scenario is rehearsal-ready: ${id}`, passed, { detection, firstAction, proof });
}

for (const check of report.checks) {
  if (!check.passed) report.blockers.push({ id: `check_failed:${slug(check.name)}`, message: check.name, details: check.details });
}
report.ok = report.blockers.length === 0 && report.scenarios.every((scenario) => scenario.passed);
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

function addCheck(name, passed, details) { report.checks.push({ name, passed: Boolean(passed), details }); }
function readText(file) { try { return fs.readFileSync(file, 'utf8'); } catch { return ''; } }
function readJson(file) { try { return JSON.parse(fs.readFileSync(file, 'utf8')); } catch { return null; } }
function writeJson(file, value) { fs.mkdirSync(path.dirname(file), { recursive: true }); fs.writeFileSync(file, `${JSON.stringify(value, null, 2)}\n`); }
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
