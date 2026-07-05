#!/usr/bin/env node

import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';

const root = process.cwd();
const args = parseArgs(process.argv.slice(2));
const sourcePath = args.source || 'output/playwright/h602-production-billing-readback-20260630/summary.json';
const outPath = args.out || 'output/playwright/g774-h602-production-completion-current-r1/summary.json';
const capturedAt = new Date().toISOString();
const source = readJson(sourcePath);

const purchaseProof = source.purchaseProofReadback || {};
const verifiedNoRealChargeProofCount = Number(purchaseProof.verifiedNoRealChargeProofCount || 0);
const transactionOrEntitlementReadback = purchaseProof.transactionOrEntitlementReadback === true;
const remainingBlockers = unique([
  ...arrayFrom(source.remainingBlockers),
  verifiedNoRealChargeProofCount > 0 ? null : 'verified_no_real_charge_proof_missing',
  transactionOrEntitlementReadback ? null : 'transaction_or_entitlement_readback_missing',
  'operator_final_checkout_public_release_decision_missing',
].filter(Boolean));

const checks = [
  check('source_readback_exists', Boolean(source)),
  check('quota_enforcement_enabled', source.billingSettings?.generationQuotaEnforced === true),
  check('production_checkout_disabled', source.billingSettings?.productionCheckoutEnabled === false),
  check('purchase_proof_migrations_applied', migrationsApplied(source)),
  check('purchase_proof_security_fail_closed', securityFailClosed(source)),
  check('sandbox_tester_registered_redacted', source.sandboxTester?.registered === true && source.sandboxTester?.emailRedacted === true),
  check('human_attestation_is_not_machine_verification', purchaseProof.latestProofSource === 'human_attestation' && verifiedNoRealChargeProofCount === 0),
  check('transaction_or_entitlement_readback_missing', transactionOrEntitlementReadback === false),
  check('h602_still_incomplete_fail_closed', source.ok === false && remainingBlockers.length > 0),
];

const summary = {
  ok: false,
  schema: 'heavy-chain.h602.production-completion-readback.v1',
  stage: 'h602_production_completion_fail_closed_readback',
  capturedAt,
  readbackMode: 'existing_production_readback_fail_closed_assessment',
  liveProductionReadbackPerformed: false,
  liveProductionReadbackBlocker:
    'No Apple login, checkout/payment, identity verification, or transaction/entitlement lookup was performed by Codex; this artifact refreshes the fail-closed assessment from the existing production readback.',
  sourceReadbackPath: sourcePath,
  sourceCheckedAtJst: source.checkedAtJst || null,
  projectRef: source.projectRef || null,
  projectName: source.projectName || null,
  migration: source.migration || null,
  purchaseProofMigration: source.purchaseProofMigration || null,
  purchaseProofHardeningMigration: source.purchaseProofHardeningMigration || null,
  purchaseProofHashOnlyMigration: source.purchaseProofHashOnlyMigration || null,
  purchaseProofArtifactAllowlistMigration: source.purchaseProofArtifactAllowlistMigration || null,
  billingSettings: source.billingSettings || null,
  securityReadback: source.securityReadback || null,
  sandboxTester: source.sandboxTester || null,
  purchaseProofReadback: {
    ...purchaseProof,
    verifiedNoRealChargeProofCount,
    transactionOrEntitlementReadback,
  },
  checks,
  blockers: remainingBlockers,
  remainingBlockers,
  actionsNotPerformedByCodex: unique([
    ...arrayFrom(source.actionsNotPerformedByCodex),
    'billing checkout/payment confirmation',
    'Apple ID credential entry',
    'OTP/security prompt handling',
    'real or sandbox purchase',
    'external public publishing',
    'identity verification',
  ]),
  failClosedReason:
    'H602 cannot be completed until a transaction, receipt/server notification, app-side entitlement, matching user row, or usage event proves the sandbox no-real-charge path and the operator makes the final checkout/public release decision.',
};

writeJson(outPath, summary);
console.log(JSON.stringify(summary, null, 2));
process.exit(1);

function migrationsApplied(json) {
  return (
    json.migration?.applied === true &&
    json.purchaseProofMigration?.applied === true &&
    json.purchaseProofHardeningMigration?.applied === true &&
    json.purchaseProofHashOnlyMigration?.applied === true &&
    json.purchaseProofArtifactAllowlistMigration?.applied === true
  );
}

function securityFailClosed(json) {
  return (
    json.securityReadback?.purchaseProofMetadataRawReceiptLikeBlocked === true &&
    json.securityReadback?.purchaseProofMetadataBareReceiptPayloadBlocked === true &&
    json.securityReadback?.purchaseProofHashFieldsSha256HexOnly === true &&
    json.securityReadback?.purchaseProofMetadataKeysAllowlisted === true &&
    json.securityReadback?.purchaseProofArtifactUriSafeLocatorOnly === true
  );
}

function check(label, ok) {
  return { label, ok: Boolean(ok) };
}

function readJson(relativePath) {
  return JSON.parse(readFileSync(join(root, relativePath), 'utf8'));
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

function parseArgs(rawArgs) {
  const parsed = {};
  for (let index = 0; index < rawArgs.length; index += 1) {
    const arg = rawArgs[index];
    const next = rawArgs[index + 1];
    if ((arg === '--out' || arg === '--source') && next) {
      parsed[arg.slice(2)] = next;
      index += 1;
    }
  }
  return parsed;
}
