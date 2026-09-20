#!/usr/bin/env node

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

export const G632_SCHEMA = 'heavy-chain.g632.incident-response-drill.v1';
export const G620_SCHEMA = 'heavy-chain.g620.security-ops.v3';
export const DEFAULT_OUT_DIR = 'output/playwright/g632-incident-response-drill';

export const CLOUDFLARE_CONTRACT_FILES = [
  {
    path: 'scripts/verify-g620-security-ops.mjs',
    checks: [
      ['current G620 schema', /schema:\s*['"]heavy-chain\.g620\.security-ops\.v3['"]/i],
      ['Cloudflare source roots', /cloudflare\/heavy-api\/src/i],
      ['Cloudflare API adapter', /src\/lib\/cloudflareApi\.ts/i],
      ['Cloudflare browser auth adapter', /src\/lib\/cloudflareBrowserAuth\.ts/i],
      ['private media adapter', /src\/lib\/mediaGateway\.ts/i],
      ['Cloudflare Worker entrypoint', /cloudflare\/heavy-api\/src\/index\.ts/i],
      ['provider-actions marker', /provider-actions/i],
      ['private media route marker', /\/v1\/media/i],
      ['consumer-auth boundary marker', /consumer-auth/i],
      ['read-only safety mode', /read-only-static-cloudflare-no-submit-no-payment-no-deploy/i],
    ],
  },
  {
    path: 'cloudflare/heavy-api/IMAGE_AI.md',
    checks: [
      ['Cloudflare image contract heading', /# Heavy image AI\s+[—-]\s+Cloudflare/i],
      ['provider-actions routes', /\/v1\/provider-actions\/(?:generate-image|edit-image|model-matrix)/i],
      ['private request receipt route', /\/v1\/image-ai\/requests\/:requestId/i],
      ['durable admission and recovery', /## Durable admission and recovery/i],
      ['receipt/readback semantics', /receipt[\s\S]{0,500}read\s*back/i],
      ['verified session and role boundary', /verified current session[\s\S]{0,180}editor role/i],
      ['private R2 media', /private R2/i],
      ['no production inference boundary', /production image inference remains disabled|production image inference stays off/i],
      ['no deployment boundary', /no deployment|not deployed/i],
    ],
  },
  {
    path: 'cloudflare/heavy-api/MONITORING.md',
    checks: [
      ['Cloudflare monitor heading', /# Cloudflare read-only API monitor/i],
      ['local/business completion boundary', /businessCompletion:not_verified/i],
      ['private image evidence', /private[- ]image samples|Private media/i],
      ['receipt/readback evidence', /receipt[\s\S]{0,500}read\s*back/i],
      ['no automatic retry', /no retry/i],
      ['consumer-auth token boundary', /consumer-auth/i],
      ['no production invocation boundary', /no (?:authenticated )?production (?:invocation|baseline|monitor request)/i],
      ['no deployment boundary', /no production [^\n.]*deployment|no live [^\n.]*deployment/i],
    ],
  },
  {
    path: 'cloudflare/heavy-api/FEEDBACK_ADMIN.md',
    checks: [
      ['Cloudflare feedback/admin heading', /# Heavy feedback \/ admin\s+[—-]\s+Cloudflare contract/i],
      ['verified auth and role boundary', /verified issuer\/subject|live session/i],
      ['private media response boundary', /private\/no-store|private R2|private media/i],
      ['immutable receipt', /immutable receipt/i],
      ['exact receipt/readback recovery', /Read the exact key after uncertain writes|readback/i],
      ['no silent retry/fallback', /does not persist screenshots[\s\S]{0,160}retry\/fallback|never fall back to the legacy provider/i],
      ['no production completion claim', /not proof of authenticated production use|production authenticated feedback/i],
      ['no deployment boundary', /Web was \*\*not\*\* deployed|not deployed/i],
    ],
  },
  {
    path: 'cloudflare/heavy-api/CANVAS_SAVE_RECOVERY.md',
    checks: [
      ['Canvas recovery heading', /# Canvas stable-save and reload recovery/i],
      ['no old data copy boundary', /no migration, new database\/bucket, test-data copy/i],
      ['bearer and route boundary', /current bearer\/user[\s\S]{0,180}route boundaries/i],
      ['GET-only recovery', /GET inspection only, never POST\/PATCH/i],
      ['receipt/readback recovery', /response failure triggers only exact-ID GET|readback/i],
      ['private R2 evidence', /private R2/i],
      ['not authenticated production', /not authenticated production|not image-quality or production\/private-media E2E proof/i],
      ['no paid purchase/data copy boundary', /paid purchase|source-data copy/i],
    ],
  },
];

const LOCAL_EVIDENCE_FILES = [
  'output/playwright/g672-api-less-generation-readiness/summary.json',
  'output/playwright/g764-g620-security-ops-r1/summary.json',
  'docs/generation-quality-rubric-2026-06-26.md',
];

const SCENARIOS = [
  {
    id: 'provider-adapter-failure',
    detection: 'provider-action failure',
    firstAction: 'do not retry automatically',
    proof: 'verify:g620-security-ops',
  },
  {
    id: 'job-readback-stall',
    detection: 'pending',
    firstAction: 'compare Jobs, History, and usage readback',
    proof: 'cloudflare/heavy-api/MONITORING.md',
  },
  {
    id: 'storage-readback-failure',
    detection: 'private media readback failure',
    firstAction: 'do not trust the Gallery card',
    proof: 'cloudflare/heavy-api/MONITORING.md',
  },
  {
    id: 'auth-boundary-anomaly',
    detection: 'auth boundary anomaly',
    firstAction: 'do not bypass the auth boundary',
    proof: 'cloudflare/heavy-api/FEEDBACK_ADMIN.md',
  },
  {
    id: 'generation-quality-regression',
    detection: 'needs-polish',
    firstAction: 'do not submit a replacement',
    proof: 'cloudflare/heavy-api/IMAGE_AI.md',
  },
];

/**
 * Check the current local Cloudflare contract without invoking a provider,
 * reading production data, or loading credentials. The G620 source is part
 * of the evidence because its schema and static markers define the security
 * operations baseline used by this drill.
 */
export function verifyCloudflareContract(options = {}) {
  const root = path.resolve(options.root ?? process.cwd());
  const checks = [];
  const failures = [];
  const sources = new Map();

  const check = (id, passed, details = {}) => {
    const result = { id, passed: Boolean(passed) };
    if (Object.keys(details).length > 0) result.details = details;
    checks.push(result);
    if (!passed) failures.push({ id, details });
    return Boolean(passed);
  };

  for (const evidence of CLOUDFLARE_CONTRACT_FILES) {
    const absolutePath = path.join(root, evidence.path);
    const exists = fs.existsSync(absolutePath);
    check(`${evidence.path}:exists`, exists, { path: evidence.path });
    if (!exists) continue;

    let source = '';
    try {
      source = fs.readFileSync(absolutePath, 'utf8');
      sources.set(evidence.path, source);
      check(`${evidence.path}:readable`, source.length > 0, { path: evidence.path });
    } catch {
      check(`${evidence.path}:readable`, false, { path: evidence.path });
      continue;
    }

    for (const [label, pattern] of evidence.checks) {
      check(`${evidence.path}:${label}`, pattern.test(source), { path: evidence.path });
    }
  }

  const contractText = [...sources.values()].join('\n');
  const g620Source = sources.get('scripts/verify-g620-security-ops.mjs') ?? '';
  const g620Schema = extractSchema(g620Source);
  check('g620:source_schema_matches_current_contract', g620Schema === G620_SCHEMA, {
    expected: G620_SCHEMA,
    actual: g620Schema,
  });

  check('contract:cloudflare_provider_actions', /(?:\/v1\/provider-actions|provider-actions)/i.test(contractText));
  check('contract:durable_receipt_readback', /receipt/i.test(contractText) && /read\s*back/i.test(contractText));
  check('contract:private_media', /private(?: media| R2|[- ]image)|R2/i.test(contractText));
  check('contract:auth_boundary', /consumer-auth|verified current session|verified issuer\/subject|live session/i.test(contractText));
  check('contract:no_submit_language', /no-submit|do not [^\n.]*submit|no automatic enqueue/i.test(contractText));
  check('contract:no_payment_language', /no-payment|do not [^\n.]*payment|paid purchase/i.test(contractText));
  check('contract:no_deploy_language', /no-deploy|no deployment|not deployed/i.test(contractText));

  return {
    schema: 'heavy-chain.g632.cloudflare-contract.v1',
    ok: failures.length === 0,
    checked: CLOUDFLARE_CONTRACT_FILES.map(({ path: relativePath }) => relativePath),
    g620Schema,
    checks,
    failures,
    scope: {
      provider: 'cloudflare',
      media: 'private-r2',
      receipts: 'durable-readback',
      auth: 'consumer-auth-and-current-session',
      notPerformed: ['network', 'credentials', 'provider action', 'deployment', 'production data', 'old data copy'],
    },
  };
}

export function buildG632Report(options = {}) {
  const root = path.resolve(options.root ?? process.cwd());
  const summaryPath = resolveSummaryPath(root, options.out);
  const outDir = path.dirname(summaryPath);
  const report = {
    schema: G632_SCHEMA,
    capturedAt: new Date().toISOString(),
    mode: 'local-cloudflare-contract-only-no-submit-no-payment-no-deploy',
    localRehearsalReadiness: 'not_verified',
    productionCompletion: 'not_verified',
    zeroRealSupabaseCommunication: 'not_verified',
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
    externalEffects: {
      network: false,
      credentials: false,
      providerAction: false,
      productionData: false,
      oldDataCopy: false,
      deployment: false,
    },
    proofLimits: [
      'This output is local rehearsal readiness only, not production completion.',
      'It does not prove zero real Supabase communication, runtime retirement, provider execution, or authenticated production completion.',
      'No network, credentials, provider action, deployment, production data, or old data copy is used by this verifier.',
    ],
    artifacts: {
      summary: summaryPath,
      drill: 'docs/g632-incident-response-drill-2026-07-01.md',
      cloudflareContract: CLOUDFLARE_CONTRACT_FILES.map(({ path: relativePath }) => relativePath),
    },
  };

  const doc = readText(root, report.artifacts.drill);
  const packageJson = readJson(root, 'package.json');
  const releaseGate = readText(root, 'scripts/verify-release-gate-unified.mjs');
  const cloudflareContract = verifyCloudflareContract({ root });
  report.cloudflareContract = cloudflareContract;

  addCheck(report, 'G632 document exists', doc.length > 0, { file: report.artifacts.drill });
  for (const phrase of ['Hard Stops', 'Drill Matrix', 'Rehearsal Commands', 'no irreversible action requirement']) {
    addCheck(report, `drill document includes ${phrase}`, doc.includes(phrase), { phrase });
  }
  addCheck(report, 'drill document declares safe command boundary', /do not authorize[\s\S]{0,180}generation[\s\S]{0,180}submission[\s\S]{0,180}retry[\s\S]{0,180}billing[\s\S]{0,180}deployment/i.test(doc));
  addCheck(report, 'drill document declares local-only production boundary', /local rehearsal readiness[\s\S]{0,180}not\s+production\s+completion/i.test(doc));
  addCheck(report, 'drill document names current Cloudflare proof', ['provider-action', 'private media', 'auth boundary', 'receipt/readback'].every((phrase) => doc.toLowerCase().includes(phrase)));
  addCheck(report, 'drill document has no retired provider reference', !/\b(?:runway|runway_mcp|local-runway|edge function|supabase|rls)\b/i.test(doc));
  addCheck(report, 'package exposes G632 verifier command', packageJson?.scripts?.['verify:g632-incident-response'] === 'node scripts/verify-g632-incident-response-drill.mjs', {
    script: packageJson?.scripts?.['verify:g632-incident-response'] ?? null,
  });
  addCheck(report, 'release gate references G632 verifier', releaseGate.includes('scripts/verify-g632-incident-response-drill.mjs') && releaseGate.includes('verify:g632-incident-response'));

  for (const file of LOCAL_EVIDENCE_FILES) {
    addCheck(report, `required local drill evidence exists: ${file}`, fs.existsSync(path.join(root, file)), { file });
  }

  const apiLess = readJson(root, LOCAL_EVIDENCE_FILES[0]);
  const security = readJson(root, LOCAL_EVIDENCE_FILES[1]);
  addCheck(report, 'API-less readiness evidence is passed', apiLess?.ok === true, { ok: apiLess?.ok ?? null });
  addCheck(report, 'security operations evidence matches current G620 source/schema', security?.ok === true && security?.schema === cloudflareContract.g620Schema, {
    ok: security?.ok ?? null,
    expectedSchema: cloudflareContract.g620Schema,
    actualSchema: security?.schema ?? null,
  });

  for (const check of cloudflareContract.checks) {
    addCheck(report, `Cloudflare contract: ${check.id}`, check.passed, check.details);
  }

  const loweredDoc = doc.toLowerCase();
  for (const scenario of SCENARIOS) {
    const checks = {
      detection: doc.includes(`\`${scenario.id}\``) && loweredDoc.includes(scenario.detection.toLowerCase()),
      firstAction: loweredDoc.includes(scenario.firstAction.toLowerCase()),
      proof: loweredDoc.includes(scenario.proof.toLowerCase()),
      stopCondition: /stop condition/i.test(doc),
    };
    const passed = Object.values(checks).every(Boolean);
    report.scenarios.push({ id: scenario.id, passed, checks });
    addCheck(report, `scenario is rehearsal-ready: ${scenario.id}`, passed, scenario);
  }

  for (const check of report.checks) {
    if (!check.passed) {
      report.blockers.push({
        id: `check_failed:${slug(check.name)}`,
        message: check.name,
        details: check.details,
      });
    }
  }

  report.localRehearsalReadiness = report.blockers.length === 0 ? 'ready' : 'blocked';
  report.ok = report.blockers.length === 0 && report.scenarios.every((scenario) => scenario.passed);
  report.summary = {
    ok: report.ok,
    scenarios: report.scenarios.length,
    passedScenarios: report.scenarios.filter((scenario) => scenario.passed).length,
    checks: report.checks.length,
    blockers: report.blockers.length,
  };
  return report;
}

export function resolveSummaryPath(root, requestedOut) {
  const requested = requestedOut || DEFAULT_OUT_DIR;
  const resolved = path.resolve(root, requested);
  return path.extname(resolved).toLowerCase() === '.json' ? resolved : path.join(resolved, 'summary.json');
}

function main() {
  const args = parseArgs(process.argv.slice(2));
  const report = buildG632Report({ root: args.root, out: args.out });
  writeJson(report.artifacts.summary, report);
  console.log(JSON.stringify({ ok: report.ok, summaryPath: report.artifacts.summary, blockers: report.blockers.map((item) => item.id) }, null, 2));
  process.exitCode = report.ok ? 0 : 1;
}

function addCheck(report, name, passed, details = {}) {
  report.checks.push({ name, passed: Boolean(passed), details });
}

function extractSchema(source) {
  return source.match(/schema:\s*['"]([^'"]+)['"]/i)?.[1] ?? null;
}

function readText(root, file) {
  try {
    return fs.readFileSync(path.join(root, file), 'utf8');
  } catch {
    return '';
  }
}

function readJson(root, file) {
  try {
    return JSON.parse(fs.readFileSync(path.join(root, file), 'utf8'));
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
    parsed[key] = next && !next.startsWith('--') ? (index += 1, next) : true;
  }
  return parsed;
}

const invokedPath = process.argv[1] ? path.resolve(process.argv[1]) : '';
if (invokedPath === fileURLToPath(import.meta.url)) main();
