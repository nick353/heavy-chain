#!/usr/bin/env node

import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

export const H602_CLOUDFLARE_CONTRACT_PATHS = [
  'cloudflare/heavy-api/wrangler.production.jsonc',
  'cloudflare/heavy-api/migrations/0011_image_ai.sql',
  'cloudflare/heavy-api/src/index.ts',
  'cloudflare/heavy-api/src/image-ai.ts',
  'cloudflare/heavy-api/src/image-ai-contracts.ts',
  'cloudflare/heavy-api/test/image-ai.test.ts',
  'cloudflare/heavy-api/test/image-ai.runtime.ts',
  'cloudflare/heavy-api/MONITORING.md',
  'cloudflare/heavy-api/IMAGE_AI.md',
];

export const DEFAULT_CLOUDFLARE_PRODUCTION_PROOF_PATH =
  'output/playwright/cloudflare-h602-production-proof.json';

const ACTIVE_CLOUDFLARE_PATHS = [
  'cloudflare/heavy-api/wrangler.production.jsonc',
  'cloudflare/heavy-api/migrations/0011_image_ai.sql',
  'cloudflare/heavy-api/src/index.ts',
  'cloudflare/heavy-api/src/image-ai.ts',
  'cloudflare/heavy-api/src/image-ai-contracts.ts',
];

const REQUIRED_ACTIONS = new Set(['generate-image', 'edit-image', 'model-matrix']);

/**
 * Validate only the local Cloudflare H602 contract. This is intentionally a
 * static/read-only readiness check: it never loads legacy provider artifacts,
 * contacts a Worker, or treats a local contract as production approval.
 */
export function verifyH602CloudflareBillingReadiness(options = {}) {
  const root = resolve(options.root ?? process.cwd());
  const checks = [];
  const failures = [];
  const sources = new Map();

  const check = (label, passed, detail = undefined) => {
    const result = { label, ok: Boolean(passed) };
    if (detail !== undefined) result.detail = detail;
    checks.push(result);
    if (!passed) failures.push(label);
    return Boolean(passed);
  };

  for (const relativePath of H602_CLOUDFLARE_CONTRACT_PATHS) {
    const absolutePath = join(root, relativePath);
    const exists = existsSync(absolutePath);
    check(`${relativePath}:exists`, exists);
    if (!exists) continue;
    try {
      sources.set(relativePath, readFileSync(absolutePath, 'utf8'));
    } catch {
      check(`${relativePath}:readable`, false);
    }
  }

  const configPath = H602_CLOUDFLARE_CONTRACT_PATHS[0];
  const configText = sources.get(configPath) ?? '';
  let config = null;
  if (configText) {
    try {
      config = parseJsonc(configText);
      check('wrangler.production.jsonc:valid_jsonc', true);
    } catch {
      check('wrangler.production.jsonc:valid_jsonc', false);
    }
  }

  const vars = isRecord(config?.vars) ? config.vars : {};
  check('wrangler.production.jsonc:heavy_worker_identity', config?.name === 'heavy-chain-api' && config?.main === 'src/index.ts');
  check('wrangler.production.jsonc:workers_ai_binding', config?.ai?.binding === 'AI');
  check('wrangler.production.jsonc:d1_db_binding', findBinding(config?.d1_databases, 'DB')?.migrations_dir === 'migrations');
  check('wrangler.production.jsonc:private_r2_binding', findBinding(config?.r2_buckets, 'PRIVATE_MEDIA')?.bucket_name === 'heavy-chain-private-media');
  check('wrangler.production.jsonc:explicit_image_ai_flag', vars.AI_IMAGE_ENABLED === 'true' || vars.AI_IMAGE_ENABLED === 'false');
  check('wrangler.production.jsonc:bounded_monthly_quota', boundedInteger(vars.AI_MONTHLY_IMAGE_UNITS, 1, 10000));
  check('wrangler.production.jsonc:bounded_daily_quota', boundedInteger(vars.AI_DAILY_IMAGE_UNITS, 1, 10000));
  check('wrangler.production.jsonc:bounded_daily_estimated_neurons', boundedInteger(vars.AI_DAILY_ESTIMATED_NEURONS, 1, 1000000));
  const configuredActions = typeof vars.AI_IMAGE_ALLOWED_ACTIONS === 'string'
    ? vars.AI_IMAGE_ALLOWED_ACTIONS.split(',').map((value) => value.trim()).filter(Boolean)
    : [];
  check(
    'wrangler.production.jsonc:allowlisted_image_actions',
    configuredActions.length === REQUIRED_ACTIONS.size &&
      new Set(configuredActions).size === REQUIRED_ACTIONS.size &&
      configuredActions.every((action) => REQUIRED_ACTIONS.has(action)),
  );

  const migration = sources.get('cloudflare/heavy-api/migrations/0011_image_ai.sql') ?? '';
  for (const [label, needle] of [
    ['h602_migration:request_receipt_table', 'CREATE TABLE heavy_ai_requests'],
    ['h602_migration:request_owner_scope', 'user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE'],
    ['h602_migration:request_brand_scope', 'brand_id TEXT NOT NULL REFERENCES brands(id) ON DELETE CASCADE'],
    ['h602_migration:request_fingerprint', 'fingerprint TEXT NOT NULL'],
    ['h602_migration:request_execution_id', 'execution_id TEXT NOT NULL'],
    ['h602_migration:request_quota_units', 'quota_units INTEGER NOT NULL CHECK (quota_units >= 0)'],
    ['h602_migration:request_candidate_bound', "candidate_count INTEGER NOT NULL CHECK (candidate_count BETWEEN 1 AND 4)"],
    ['h602_migration:request_neuron_reservation', 'reserved_centi_neurons INTEGER NOT NULL CHECK (reserved_centi_neurons >= 0)'],
    ['h602_migration:request_time_buckets', 'utc_month TEXT NOT NULL'],
    ['h602_migration:request_state_fail_closed', "state TEXT NOT NULL CHECK (state IN ('running','completed','failed','unknown'))"],
    ['h602_migration:candidate_receipt_table', 'CREATE TABLE heavy_ai_candidates'],
    ['h602_migration:candidate_identity', 'candidate_index INTEGER NOT NULL'],
    ['h602_migration:candidate_state_fail_closed', "state TEXT NOT NULL CHECK (state IN ('planned','running','storing','completed','failed','unknown'))"],
    ['h602_migration:candidate_digest', 'sha256 TEXT'],
    ['h602_migration:candidate_usage_estimate', 'estimated_micro_usd INTEGER'],
    ['h602_migration:candidate_neuron_estimate', 'estimated_neurons REAL'],
    ['h602_migration:daily_admission_counter', 'CREATE TABLE heavy_ai_daily'],
    ['h602_migration:daily_admission_trigger', 'CREATE TRIGGER heavy_ai_admitted AFTER INSERT ON heavy_ai_requests'],
    ['h602_migration:no_old_data_import', 'No old provider usage or test data is imported'],
  ]) check(label, hasText(migration, needle));

  const imageAI = sources.get('cloudflare/heavy-api/src/image-ai.ts') ?? '';
  for (const [label, needle] of [
    ['image_ai:env_quota_limits', 'AI_MONTHLY_IMAGE_UNITS'],
    ['image_ai:env_daily_limits', 'AI_DAILY_IMAGE_UNITS'],
    ['image_ai:env_neuron_limits', 'AI_DAILY_ESTIMATED_NEURONS'],
    ['image_ai:bounded_candidate_admission', 'candidate_count'],
    ['image_ai:quota_rejection', 'image_quota_or_concurrency_limit'],
    ['image_ai:immutable_request_conflict', 'image_request_conflict'],
    ['image_ai:readback_after_uncertain_write', 'image_receipt_readback_required'],
    ['image_ai:receipt_usage_estimate_marker', "billing: 'estimate_not_invoice'"],
    ['image_ai:usage_measurement_scope', "measurementScope: 'cloudflare_image_ai_only'"],
    ['image_ai:no_invoice_claim', 'providerBilling: null'],
    ['image_ai:no_account_wide_budget_claim', 'accountWideBudgetGuaranteed: false'],
    ['image_ai:request_receipt_route', 'url.pathname.match'],
    ['image_ai:usage_readback_route', "'/v1/image-ai/usage'"],
    ['image_ai:workers_ai_provider_identity', "provider: 'workers_ai'"],
  ]) check(label, hasText(imageAI, needle));

  const imageContracts = sources.get('cloudflare/heavy-api/src/image-ai-contracts.ts') ?? '';
  for (const [label, needle] of [
    ['image_contract:model_identity', "export const IMAGE_MODEL = '@cf/black-forest-labs/flux-2-klein-4b'"],
    ['image_contract:action_allowlist', "export const IMAGE_ACTIONS = new Set(['generate-image', 'edit-image', 'model-matrix'])"],
    ['image_contract:estimate_function', 'export function imageEstimate'],
    ['image_contract:input_tile_estimate', 'inputTiles'],
    ['image_contract:output_tile_estimate', 'outputTiles'],
  ]) check(label, hasText(imageContracts, needle));
  check('image_contract:known_cost_estimate_constants',
    hasText(imageContracts, 'inputTiles * 59 + outputTiles * 287') &&
      hasText(imageContracts, 'inputTiles * 5.37 + outputTiles * 26.05'));

  const workerEntry = sources.get('cloudflare/heavy-api/src/index.ts') ?? '';
  check('worker_entry:image_readback_handler', hasText(workerEntry, 'handleImageAIRead'));
  check('worker_entry:health_route', hasText(workerEntry, 'url.pathname === "/v1/health"'));
  check('worker_entry:private_r2_health_marker', hasText(workerEntry, 'media: "private-r2"'));

  const localTest = sources.get('cloudflare/heavy-api/test/image-ai.test.ts') ?? '';
  const localRuntimeTest = sources.get('cloudflare/heavy-api/test/image-ai.runtime.ts') ?? '';
  check('local_fixture:sqlite_r2_image_contract', hasText(localTest, 'real SQLite/R2 contract'));
  check('local_fixture:quota_readback', hasText(localTest, 'usage.remainingUnits'));
  check('local_fixture:unknown_receipt_state', hasText(localTest, "result.state,'unknown'"));
  check('local_fixture:runtime_readback', hasText(localRuntimeTest, 'image-ai/usage'));
  check('local_fixture:no_reinference_recovery', hasText(localRuntimeTest, 'calls.length'));

  const monitoring = sources.get('cloudflare/heavy-api/MONITORING.md') ?? '';
  const imageDoc = sources.get('cloudflare/heavy-api/IMAGE_AI.md') ?? '';
  check('cloudflare_docs:monitor_business_completion_unverified', hasText(monitoring, 'businessCompletion:not_verified'));
  check('cloudflare_docs:monitor_provider_billing_unavailable', hasText(monitoring, 'provider invoices'));
  check('cloudflare_docs:image_estimates_not_invoice', hasText(imageDoc, 'not an invoice'));
  check('cloudflare_docs:production_proof_boundary', hasText(imageDoc, 'production image inference stays off') || hasText(imageDoc, 'production auth remains'));

  const activeSource = ACTIVE_CLOUDFLARE_PATHS.map((relativePath) => sources.get(relativePath) ?? '').join('\n');
  for (const [label, pattern] of [
    ['cloudflare_active_path:no_checkout_surface', /\bcheckout\b/i],
    ['cloudflare_active_path:no_payment_surface', /\bpayment\b/i],
    ['cloudflare_active_path:no_purchase_surface', /\bpurchase\b/i],
    ['cloudflare_active_path:no_charge_surface', /\bcharge\b/i],
    ['cloudflare_active_path:no_apple_billing_surface', /\b(?:apple[_ -]?id|app[_ -]?store)\b/i],
    ['cloudflare_active_path:no_transaction_entitlement_surface', /\b(?:transaction|entitlement)\b/i],
  ]) check(label, !pattern.test(activeSource));

  const localContractOk = failures.length === 0;
  const productionProofPath = options.productionProofPath ?? DEFAULT_CLOUDFLARE_PRODUCTION_PROOF_PATH;
  const productionProof = {
    status: 'not_verified',
    present: false,
    path: productionProofPath,
    reason: 'No authenticated Cloudflare production proof is evaluated by this local contract verifier.',
  };
  if (existsSync(resolve(root, productionProofPath))) {
    productionProof.present = true;
    productionProof.reason = 'A production artifact exists, but this static verifier does not promote supplied artifacts to authenticated proof.';
  }

  return {
    ok: localContractOk,
    schema: 'heavy-chain.h602.cloudflare-billing-readiness.v1',
    stage: 'h602_cloudflare_contract_readiness',
    checkedAt: new Date().toISOString(),
    mode: 'local_cloudflare_contract_only',
    contractStatus: localContractOk ? 'verified_local' : 'failed',
    productionProof,
    releaseApproval: false,
    releaseApprovalReason: 'Local Cloudflare contract readiness and any production artifact are not release approval.',
    checks,
    failures,
    scope: {
      reads: H602_CLOUDFLARE_CONTRACT_PATHS,
      provider: 'cloudflare_workers_ai',
      quota: 'bounded_worker_and_brand_admission',
      receipts: 'd1_request_and_candidate_readback',
      notPerformed: ['provider call', 'billing or checkout operation', 'deployment', 'external write'],
    },
    externalEffects: {
      network: false,
      provider: false,
      billing: false,
      checkout: false,
      deployment: false,
      writes: false,
    },
  };
}

function readArgs(rawArgs) {
  const parsed = { root: process.cwd(), out: null, productionProofPath: DEFAULT_CLOUDFLARE_PRODUCTION_PROOF_PATH };
  for (let index = 0; index < rawArgs.length; index += 1) {
    const arg = rawArgs[index];
    const next = rawArgs[index + 1];
    if ((arg === '--root' || arg === '--out' || arg === '--production-proof') && next) {
      if (arg === '--root') parsed.root = next;
      if (arg === '--out') parsed.out = next;
      if (arg === '--production-proof') parsed.productionProofPath = next;
      index += 1;
    }
  }
  return parsed;
}

function main() {
  const args = readArgs(process.argv.slice(2));
  const report = verifyH602CloudflareBillingReadiness(args);
  if (args.out) {
    const outputPath = resolve(args.root, args.out);
    mkdirSync(dirname(outputPath), { recursive: true });
    writeFileSync(outputPath, `${JSON.stringify(report, null, 2)}\n`);
  }
  console.log(JSON.stringify(report, null, 2));
  process.exitCode = report.ok ? 0 : 1;
}

function boundedInteger(value, minimum, maximum) {
  const number = Number(value);
  return typeof value === 'string' && Number.isSafeInteger(number) && number >= minimum && number <= maximum;
}

function findBinding(value, binding) {
  return Array.isArray(value) ? value.find((entry) => isRecord(entry) && entry.binding === binding) : null;
}

function hasText(source, needle) {
  return collapse(source).includes(collapse(needle));
}

function collapse(value) {
  return String(value).replace(/\s+/g, ' ').trim();
}

function isRecord(value) {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}

export function parseJsonc(source) {
  let result = '';
  let inString = false;
  let escaped = false;
  for (let index = 0; index < source.length; index += 1) {
    const current = source[index];
    const next = source[index + 1];
    if (inString) {
      result += current;
      if (escaped) escaped = false;
      else if (current === '\\') escaped = true;
      else if (current === '"') inString = false;
      continue;
    }
    if (current === '"') {
      inString = true;
      result += current;
      continue;
    }
    if (current === '/' && next === '/') {
      index += 2;
      while (index < source.length && source[index] !== '\n') index += 1;
      result += '\n';
      continue;
    }
    if (current === '/' && next === '*') {
      index += 2;
      while (index + 1 < source.length && !(source[index] === '*' && source[index + 1] === '/')) index += 1;
      index += 1;
      result += ' ';
      continue;
    }
    result += current;
  }
  return JSON.parse(result.replace(/,\s*([}\]])/g, '$1'));
}

const invokedPath = process.argv[1] ? resolve(process.argv[1]) : '';
if (invokedPath === fileURLToPath(import.meta.url)) main();
