#!/usr/bin/env node

import fs from 'node:fs';
import path from 'node:path';

const args = parseArgs(process.argv.slice(2));
const out = args.out || 'output/playwright/g614-operations-docs/summary.json';
const report = {
  schema: 'heavy-chain.g614.operations-docs.v2', capturedAt: new Date().toISOString(),
  mode: 'static-cloudflare-provider-neutral-read-only-no-generation-no-deploy', checks: [], blockers: [],
  irreversibleActions: { generationSubmit: 'not_clicked', retry: 'not_run', purchasePaymentCheckout: 'not_touched', externalPublish: 'not_touched', deploy: 'not_run' },
  artifacts: { summary: out },
};
const requiredDocs = [
  'cloudflare/heavy-api/IMAGE_AI.md', 'cloudflare/heavy-api/MONITORING.md',
  'cloudflare/heavy-api/FEEDBACK_ADMIN.md', 'cloudflare/heavy-api/CANVAS_SAVE_RECOVERY.md',
];
const activeRuntimeFiles = [
  'src/pages/GeneratePage.tsx', 'src/pages/AdminDashboard.tsx', 'src/lib/errorMessages.ts',
  'src/lib/imageApi.ts', 'src/lib/cloudflareApi.ts', 'src/lib/cloudflareImageAI.ts',
  'src/lib/cloudflareProtectedImageEdit.ts', 'cloudflare/heavy-api/src/image-ai.ts',
  'cloudflare/heavy-api/src/image-ai-contracts.ts',
];
const retiredRuntimePattern = /(?:supabase\.co|@supabase\/|\/rest\/v1\/|\/auth\/v1\/|\/functions\/v1\/|SUPABASE_(?:URL|ANON_KEY)|OPENAI_API_KEY)/i;

for (const file of requiredDocs) addCheck(`current Cloudflare operations document exists: ${file}`, fs.existsSync(file), { file });
const imageAiText = readText('cloudflare/heavy-api/IMAGE_AI.md');
for (const phrase of ['Cloudflare', 'provider-actions', 'durable', 'no mock image', 'No paid plan']) {
  addCheck(`image AI runbook includes ${phrase}`, imageAiText.toLowerCase().includes(phrase.toLowerCase()), { phrase });
}
const monitoringText = readText('cloudflare/heavy-api/MONITORING.md');
addCheck('monitoring runbook requires authenticated readback', /authenticated read-only|HEAVY_CHAIN_MONITOR_TOKEN/i.test(monitoringText), {});
addCheck('monitoring runbook separates receipt from completion', /not completion proof|quality.*unverified/i.test(monitoringText), {});
const recoveryText = readText('cloudflare/heavy-api/CANVAS_SAVE_RECOVERY.md');
addCheck('Canvas recovery runbook keeps unauthenticated probes non-destructive', /401|No test user|no.*data/i.test(recoveryText), {});
const packageJson = readJson('package.json');
addCheck('package exposes G614 verifier command', packageJson?.scripts?.['verify:g614-ops'] === 'node scripts/verify-g614-operations-docs.mjs', { script: packageJson?.scripts?.['verify:g614-ops'] ?? null });
addCheck('package exposes G632 verifier command', packageJson?.scripts?.['verify:g632-incident-response'] === 'node scripts/verify-g632-incident-response-drill.mjs', { script: packageJson?.scripts?.['verify:g632-incident-response'] ?? null });
const releaseGateText = readText('scripts/verify-release-gate-unified.mjs');
addCheck('release gate references current operations verifiers', releaseGateText.includes('scripts/verify-g614-operations-docs.mjs') && releaseGateText.includes('scripts/verify-g632-incident-response-drill.mjs') && releaseGateText.includes('verify:g614-ops') && releaseGateText.includes('verify:g632-incident-response'), {});
for (const file of activeRuntimeFiles) {
  const text = readText(file);
  addCheck(`active Cloudflare runtime path has no retired provider reference: ${file}`, Boolean(text) && !retiredRuntimePattern.test(text), { file, exists: Boolean(text) });
}
for (const check of report.checks) if (!check.passed) report.blockers.push({ id: `check_failed:${slug(check.name)}`, message: check.name, details: check.details });
report.ok = report.blockers.length === 0;
report.summary = { ok: report.ok, checks: report.checks.length, blockers: report.blockers.length };
writeJson(out, report);
console.log(JSON.stringify({ ok: report.ok, summaryPath: out, blockers: report.blockers.map((item) => item.id) }, null, 2));
process.exit(report.ok ? 0 : 1);

function addCheck(name, passed, details) { report.checks.push({ name, passed: Boolean(passed), details }); }
function readText(file) { try { return fs.readFileSync(file, 'utf8'); } catch { return ''; } }
function readJson(file) { try { return JSON.parse(fs.readFileSync(file, 'utf8')); } catch { return null; } }
function writeJson(file, value) { fs.mkdirSync(path.dirname(file), { recursive: true }); fs.writeFileSync(file, `${JSON.stringify(value, null, 2)}\n`); }
function slug(value) { return String(value).toLowerCase().replace(/[^a-z0-9]+/g, '_').replace(/^_+|_+$/g, ''); }
function parseArgs(argv) { const parsed = {}; for (let index = 0; index < argv.length; index += 1) { const arg = argv[index]; if (!arg.startsWith('--')) continue; const key = arg.slice(2); const next = argv[index + 1]; parsed[key] = next && !next.startsWith('--') ? (index += 1, next) : true; } return parsed; }
