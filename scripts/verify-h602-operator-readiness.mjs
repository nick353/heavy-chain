#!/usr/bin/env node

import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';

const root = process.cwd();
const args = parseArgs(process.argv.slice(2));
const sourcePath =
  args.source || 'output/playwright/g774-h602-production-completion-current-r1/summary.json';
const outPath = args.summary || args.out || null;
const capturedAt = new Date().toISOString();
const sourceExists = existsSync(join(root, sourcePath));
const source = sourceExists ? readJson(sourcePath) : null;
const purchaseProof = source?.purchaseProofReadback || {};
const operatorDecision = readOperatorDecision(args.operatorDecision);
const operatorDecisionAllowedKeys = [
  'h602OperatorFinalDecisionAttached',
  'checkoutPublicReleaseDecision',
  'containsSensitivePaymentOrIdentityData',
  'containsRawReceiptJwtOrSignedPayload',
  'artifactUri',
  'operator',
  'decidedAt',
  'notes',
];
const operatorFinalDecisionAttached =
  operatorDecision?.h602OperatorFinalDecisionAttached === true &&
  ['approved', 'deferred', 'blocked'].includes(operatorDecision?.checkoutPublicReleaseDecision) &&
  operatorDecision?.containsSensitivePaymentOrIdentityData === false &&
  operatorDecision?.containsRawReceiptJwtOrSignedPayload === false &&
  objectKeysAllowed(operatorDecision, operatorDecisionAllowedKeys);
const blockers = unique([
  ...arrayFrom(source?.remainingBlockers),
  ...arrayFrom(source?.blockers),
  sourceExists ? null : 'h602_completion_source_readback_missing',
  purchaseProof.verifiedNoRealChargeProofCount > 0 ? null : 'verified_no_real_charge_proof_missing',
  purchaseProof.transactionOrEntitlementReadback === true
    ? null
    : 'transaction_or_entitlement_readback_missing',
  source?.liveProductionReadbackPerformed === true ? null : 'live_production_readback_not_performed_by_codex',
  source?.billingSettings?.productionCheckoutEnabled === false
    ? null
    : 'production_checkout_disabled_readback_missing',
  operatorFinalDecisionAttached ? null : 'operator_final_checkout_public_release_decision_missing',
].filter(Boolean));

const requiredEvidence = [
  evidence(
    'production completion readback exists',
    sourceExists,
    sourcePath,
    sourceExists ? null : 'Run npm run verify:h602-production-completion-readback first.',
  ),
  evidence(
    'quota enforcement is enabled',
    source?.billingSettings?.generationQuotaEnforced === true,
    sourcePath,
    'Confirm production billing_settings generation_quota_enforced=true.',
  ),
  evidence(
    'production checkout remains disabled until final operator approval',
    source?.billingSettings?.productionCheckoutEnabled === false,
    sourcePath,
    'Keep production_checkout_enabled=false until H602 is intentionally approved.',
  ),
  evidence(
    'sandbox tester is registered and redacted',
    source?.sandboxTester?.registered === true && source?.sandboxTester?.emailRedacted === true,
    source?.sandboxTester?.readbackArtifact || sourcePath,
    'Register the Apple sandbox tester in billing_test_accounts and keep identity redacted in proof.',
  ),
  evidence(
    'verified no-real-charge proof exists',
    Number(purchaseProof.verifiedNoRealChargeProofCount || 0) > 0,
    purchaseProof.readbackArtifact || sourcePath,
    'Attach redacted Apple sandbox no-real-charge proof using a safe artifact URI or hashes.',
  ),
  evidence(
    'transaction or entitlement readback exists',
    purchaseProof.transactionOrEntitlementReadback === true,
    purchaseProof.readbackArtifact || sourcePath,
    'Capture a transaction hash, receipt/server-notification hash, app-side entitlement, matching user row, or usage event readback.',
  ),
  evidence(
    'human attestation is not being treated as machine verification',
    purchaseProof.latestProofSource !== 'human_attestation' ||
      Number(purchaseProof.verifiedNoRealChargeProofCount || 0) === 0,
    purchaseProof.insertArtifact || sourcePath,
    'Do not mark human_attestation as verified purchase/no-charge proof.',
  ),
  evidence(
    'purchase proof storage is hash-only / allowlisted',
    source?.securityReadback?.purchaseProofHashFieldsSha256HexOnly === true &&
      source?.securityReadback?.purchaseProofMetadataKeysAllowlisted === true &&
      source?.securityReadback?.purchaseProofArtifactUriSafeLocatorOnly === true,
    sourcePath,
    'Keep raw receipts, JWTs, signed payloads, base64, and unrestricted metadata out of artifacts and DB fields.',
  ),
  evidence(
    'operator final checkout/public release decision is attached',
    operatorFinalDecisionAttached,
    args.operatorDecision || 'docs/h601-h602-operator-decision-checklist-2026-07-04.md',
    'Operator must attach a safe JSON decision with h602OperatorFinalDecisionAttached=true, checkoutPublicReleaseDecision approved/deferred/blocked, explicit sensitive-data flags false, and allowed keys only.',
  ),
];

const missing = requiredEvidence.filter((item) => !item.ok);
const summary = {
  ok: false,
  schema: 'heavy-chain.h602.operator-readiness-not-acceptance.v1',
  stage: 'h602_operator_readiness_not_acceptance',
  capturedAt,
  acceptance: 'not_claimed',
  sourceReadbackPath: sourcePath,
  sourceReadbackExists: sourceExists,
  h602CompletionOk: source?.ok === true,
  operatorDecisionReadback: {
    path: args.operatorDecision || null,
    attached: operatorFinalDecisionAttached,
    read: Boolean(operatorDecision),
    decision: operatorDecision?.checkoutPublicReleaseDecision || null,
    allowedKeysOnly: operatorDecision ? objectKeysAllowed(operatorDecision, operatorDecisionAllowedKeys) : null,
  },
  billingSettings: source?.billingSettings || null,
  purchaseProofReadback: source
    ? {
        verifiedNoRealChargeProofCount: Number(purchaseProof.verifiedNoRealChargeProofCount || 0),
        latestProofSource: purchaseProof.latestProofSource || null,
        latestProofStatus: purchaseProof.latestProofStatus || null,
        transactionOrEntitlementReadback: purchaseProof.transactionOrEntitlementReadback === true,
      }
    : null,
  requiredEvidence,
  missing,
  missingCount: missing.length,
  blockers,
  nextActions: [
    'Operator captures redacted Apple sandbox no-real-charge proof without raw receipts/JWTs/signed payloads.',
    'Operator captures transaction hash, StoreKit/server-notification hash, app entitlement, matching user row, or usage-event readback.',
    'Operator attaches a safe final checkout/public-release decision JSON after H602 completion readback can pass.',
    'Rerun npm run verify:h602-production-completion-readback and then npm run verify:h602-operator-readiness -- --source <current-h602-summary> --operator-decision <safe-json> --strict.',
  ],
  hardStops: [
    'Apple ID login',
    'credential entry',
    'OTP/security prompt handling',
    'checkout/payment confirmation',
    'real purchase',
    'identity verification',
    'tax/invoice setup',
    'refund policy acceptance',
    'external public publishing',
  ],
  actionsNotPerformedByCodex: unique([
    ...arrayFrom(source?.actionsNotPerformedByCodex),
    'Apple ID login',
    'credential entry',
    'checkout/payment confirmation',
    'real or sandbox purchase',
    'identity verification',
    'external public publishing',
  ]),
};

if (outPath) writeJson(outPath, summary);
console.log(JSON.stringify(summary, null, 2));
if (args.strict && missing.length > 0) process.exit(1);

function evidence(label, ok, artifact, nextAction) {
  return { label, ok: Boolean(ok), artifact, nextAction: ok ? null : nextAction };
}

function readJson(relativePath) {
  return JSON.parse(readFileSync(join(root, relativePath), 'utf8'));
}

function readOperatorDecision(relativePath) {
  if (!relativePath) return null;
  const absolutePath = join(root, relativePath);
  if (!existsSync(absolutePath)) return null;
  return JSON.parse(readFileSync(absolutePath, 'utf8'));
}

function writeJson(relativePath, value) {
  const absolutePath = join(root, relativePath);
  mkdirSync(dirname(absolutePath), { recursive: true });
  writeFileSync(absolutePath, `${JSON.stringify(value, null, 2)}\n`);
}

function arrayFrom(value) {
  return Array.isArray(value) ? value : [];
}

function unique(values) {
  return [...new Set(values)];
}

function objectKeysAllowed(value, allowedKeys) {
  return value && Object.keys(value).every((key) => allowedKeys.includes(key));
}

function parseArgs(rawArgs) {
  const parsed = { strict: false };
  for (let index = 0; index < rawArgs.length; index += 1) {
    const arg = rawArgs[index];
    const next = rawArgs[index + 1];
    if ((arg === '--summary' || arg === '--out' || arg === '--source') && next) {
      parsed[arg.slice(2)] = next;
      index += 1;
    } else if (arg === '--operator-decision' && next) {
      parsed.operatorDecision = next;
      index += 1;
    } else if (arg === '--strict') {
      parsed.strict = true;
    }
  }
  return parsed;
}
