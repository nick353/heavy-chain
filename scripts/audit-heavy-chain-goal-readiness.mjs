#!/usr/bin/env node

import fs from 'node:fs';
import path from 'node:path';

const args = parseArgs(process.argv.slice(2));
const allowIncomplete = Boolean(args['allow-incomplete'] || args.allowIncomplete);
const outPath = args.out || args.output;

const activeRoots = ['src', 'cloudflare/heavy-api/src', 'cloudflare/heavy-web/src'];
const requiredFiles = [
  'src/lib/cloudflareApi.ts',
  'src/lib/cloudflareBrowserAuth.ts',
  'src/lib/mediaGateway.ts',
  'cloudflare/heavy-api/src/index.ts',
  'cloudflare/heavy-web/src/index.mjs',
];
const forbiddenRuntimePatterns = [
  /@supabase\//i,
  /https?:\/\/[^\s"'`]+\.supabase\.co/i,
  /\bVITE_SUPABASE_[A-Z0-9_]+\b/i,
  /\/auth\/v1\//i,
  /\/rest\/v1\//i,
  /\/functions\/v1\//i,
];

function read(file) {
  return fs.existsSync(file) && fs.statSync(file).isFile() ? fs.readFileSync(file, 'utf8') : '';
}

function sourceFiles(root) {
  if (!fs.existsSync(root)) return [];
  const files = [];
  for (const entry of fs.readdirSync(root, { withFileTypes: true })) {
    const file = path.join(root, entry.name);
    if (entry.isDirectory()) files.push(...sourceFiles(file));
    else if (/\.(?:ts|tsx|js|jsx|mjs)$/.test(entry.name)) files.push(file);
  }
  return files;
}

const activeFiles = activeRoots.flatMap(sourceFiles);
const activeText = activeFiles.map(read).join('\n');
const requiredText = requiredFiles.map(read).join('\n');
const legacyMatches = [];
for (const file of activeFiles) {
  const text = read(file);
  for (const pattern of forbiddenRuntimePatterns) {
    if (pattern.test(text)) legacyMatches.push(`${file}: ${pattern}`);
  }
}

const checks = [
  {
    id: 'cloudflare_runtime_contract_present',
    passed: fs.existsSync('scripts/verify-cloudflare-runtime-contract.mjs') &&
      requiredFiles.every((file) => fs.existsSync(file)),
  },
  {
    id: 'legacy_supabase_runtime_removed',
    passed: legacyMatches.length === 0,
    details: legacyMatches,
  },
  {
    id: 'cloudflare_auth_media_adapters_present',
    passed: requiredText.includes('createCloudflareBrowserAuth') &&
      requiredText.includes('cloudflare_r2') &&
      requiredText.includes('/v1/media'),
  },
  {
    id: 'cloudflare_ai_adapter_present',
    passed: activeText.includes('invokeProviderAction') &&
      (activeText.includes('model-matrix') || activeText.includes('generate-image')),
  },
  {
    id: 'no_legacy_edge_entrypoint_in_active_gate',
    passed: !activeText.includes('supabase/functions') &&
      !activeText.includes('deploy-edge-functions.sh'),
  },
];

const summary = {
  schema: 'heavy-chain.goal-readiness.v3',
  capturedAt: new Date().toISOString(),
  objective: 'Keep Heavy runtime and active readiness checks on Cloudflare auth, private media, and provider adapters.',
  irreversibleActions: {
    externalApiCall: 'not_touched',
    generationSubmit: 'not_clicked',
    migrationApply: 'not_run',
    deploy: 'not_run',
  },
  checks,
  ok: checks.every((check) => check.passed),
  proofLimits: [
    'This static verifier cannot establish authenticated production generation, AI quality, R2 persistence, or browser business completion.',
    'Production deployment and live traffic-zero evidence require separate same-run readback.',
  ],
};

if (outPath) {
  const resolved = path.resolve(outPath);
  fs.mkdirSync(path.dirname(resolved), { recursive: true });
  fs.writeFileSync(resolved, `${JSON.stringify(summary, null, 2)}\n`);
}

console.log(JSON.stringify(summary, null, 2));
process.exit(summary.ok || allowIncomplete ? 0 : 1);

function parseArgs(argv) {
  const parsed = {};
  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (!arg.startsWith('--')) continue;
    const key = arg.slice(2);
    const next = argv[index + 1];
    if (!next || next.startsWith('--')) parsed[key] = true;
    else {
      parsed[key] = next;
      index += 1;
    }
  }
  return parsed;
}
