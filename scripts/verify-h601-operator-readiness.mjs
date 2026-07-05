#!/usr/bin/env node

import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';

const root = process.cwd();
const args = parseArgs(process.argv.slice(2));
const sourcePath = args.source || 'output/playwright/g779-h601-legal-safety-current-r1/summary.json';
const outPath = args.summary || args.out || null;
const capturedAt = new Date().toISOString();
const sourceExists = existsSync(join(root, sourcePath));
const source = sourceExists ? readJson(sourcePath) : null;
const operatorDecision = readOperatorDecision(args.operatorDecision);

const allowedDecisionKeys = [
  'h601OperatorFinalDecisionAttached',
  'finalH601Status',
  'termsLocator',
  'privacyLocator',
  'retentionDecision',
  'uploadRightsPolicyDecision',
  'brandReferencePolicyDecision',
  'personLikenessPolicyDecision',
  'copyrightMarketingClaimsDecision',
  'commercialUseWordingDecision',
  'counselOrOperatorReviewAttached',
  'containsSecretsOrIdentityData',
  'artifactUri',
  'operator',
  'decidedAt',
  'notes',
];

const operatorFinalDecisionAttached =
  operatorDecision?.h601OperatorFinalDecisionAttached === true &&
  operatorDecision?.finalH601Status === 'closed-by-operator' &&
  operatorDecision?.counselOrOperatorReviewAttached === true &&
  operatorDecision?.containsSecretsOrIdentityData === false &&
  safeLocator(operatorDecision?.termsLocator) &&
  safeLocator(operatorDecision?.privacyLocator) &&
  safeOperatorDecisionValues(operatorDecision) &&
  nonEmpty(operatorDecision?.retentionDecision) &&
  nonEmpty(operatorDecision?.uploadRightsPolicyDecision) &&
  nonEmpty(operatorDecision?.brandReferencePolicyDecision) &&
  nonEmpty(operatorDecision?.personLikenessPolicyDecision) &&
  nonEmpty(operatorDecision?.copyrightMarketingClaimsDecision) &&
  nonEmpty(operatorDecision?.commercialUseWordingDecision) &&
  objectKeysAllowed(operatorDecision, allowedDecisionKeys);

const requiredEvidence = [
  evidence(
    'H601 source guard readback exists',
    sourceExists,
    sourcePath,
    'Run npm run verify:h601-legal-safety -- --out <summary> first.',
  ),
  evidence(
    'product-side H601 safety guard passes',
    source?.ok === true,
    sourcePath,
    'Repair product-side legal safety guard failures before operator finalization.',
  ),
  evidence(
    'H601 remains open until operator final decision',
    source?.irreversibleActions?.legalPolicyFinalization === 'not_run',
    sourcePath,
    'Do not treat static guard verification as final legal/operator policy approval.',
  ),
  evidence(
    'final Terms locator is attached',
    safeLocator(operatorDecision?.termsLocator),
    args.operatorDecision || 'docs/h601-h602-operator-readback-template-2026-07-04.md',
    'Attach a safe project-owned final Terms locator.',
  ),
  evidence(
    'final Privacy locator is attached',
    safeLocator(operatorDecision?.privacyLocator),
    args.operatorDecision || 'docs/h601-h602-operator-readback-template-2026-07-04.md',
    'Attach a safe project-owned final Privacy locator.',
  ),
  evidence(
    'retention/deletion/export decision is attached',
    nonEmpty(operatorDecision?.retentionDecision),
    args.operatorDecision || 'docs/h601-h602-operator-readback-template-2026-07-04.md',
    'Attach retention, deletion, and export policy decision.',
  ),
  evidence(
    'upload-rights policy decision is attached',
    nonEmpty(operatorDecision?.uploadRightsPolicyDecision),
    args.operatorDecision || 'docs/h601-h602-operator-readback-template-2026-07-04.md',
    'Attach upload-rights policy decision.',
  ),
  evidence(
    'brand/reference policy decision is attached',
    nonEmpty(operatorDecision?.brandReferencePolicyDecision),
    args.operatorDecision || 'docs/h601-h602-operator-readback-template-2026-07-04.md',
    'Attach third-party brand/reference policy decision.',
  ),
  evidence(
    'person/likeness policy decision is attached',
    nonEmpty(operatorDecision?.personLikenessPolicyDecision),
    args.operatorDecision || 'docs/h601-h602-operator-readback-template-2026-07-04.md',
    'Attach identifiable-person/model-likeness policy decision.',
  ),
  evidence(
    'copyright/marketing claims decision is attached',
    nonEmpty(operatorDecision?.copyrightMarketingClaimsDecision),
    args.operatorDecision || 'docs/h601-h602-operator-readback-template-2026-07-04.md',
    'Attach copyright and marketing-claims wording decision.',
  ),
  evidence(
    'commercial-use wording decision is attached',
    nonEmpty(operatorDecision?.commercialUseWordingDecision),
    args.operatorDecision || 'docs/h601-h602-operator-readback-template-2026-07-04.md',
    'Attach caveated commercial-use wording decision.',
  ),
  evidence(
    'counsel/operator review is attached',
    operatorDecision?.counselOrOperatorReviewAttached === true,
    args.operatorDecision || 'docs/h601-h602-operator-readback-template-2026-07-04.md',
    'Attach counsel/operator review readback.',
  ),
  evidence(
    'operator decision JSON uses safe summary fields only',
    operatorDecision
      ? operatorDecision.containsSecretsOrIdentityData === false &&
          objectKeysAllowed(operatorDecision, allowedDecisionKeys) &&
          safeOperatorDecisionValues(operatorDecision)
      : false,
    args.operatorDecision || 'docs/h601-h602-operator-readback-template-2026-07-04.md',
    'Use allowed keys only, safe project locators, short non-sensitive summaries, and containsSecretsOrIdentityData=false explicitly.',
  ),
];

const missing = requiredEvidence.filter((item) => !item.ok);
const blockers = unique([
  sourceExists ? null : 'h601_source_readback_missing',
  source?.ok === true ? null : 'h601_static_guard_readback_not_passing',
  operatorFinalDecisionAttached ? null : 'operator_final_h601_decision_missing',
  ...missing.map((item) => slug(item.label)),
].filter(Boolean));

const summary = {
  ok: false,
  schema: 'heavy-chain.h601.operator-readiness-not-acceptance.v1',
  stage: 'h601_operator_readiness_not_acceptance',
  capturedAt,
  acceptance: 'not_claimed',
  sourceReadbackPath: sourcePath,
  sourceReadbackExists: sourceExists,
  h601StaticGuardOk: source?.ok === true,
  operatorDecisionReadback: {
    path: args.operatorDecision || null,
    attached: operatorFinalDecisionAttached,
    read: Boolean(operatorDecision),
    finalH601Status: operatorDecision?.finalH601Status || null,
    allowedKeysOnly: operatorDecision ? objectKeysAllowed(operatorDecision, allowedDecisionKeys) : null,
    safeValuesOnly: operatorDecision ? safeOperatorDecisionValues(operatorDecision) : null,
  },
  requiredEvidence,
  missing,
  missingCount: missing.length,
  blockers,
  nextActions: [
    'Operator approves final Terms and Privacy wording using safe project-owned locators.',
    'Operator attaches retention, upload-rights, brand/reference, person/likeness, copyright/marketing, and commercial-use decisions.',
    'Operator attaches counsel/operator review readback with containsSecretsOrIdentityData=false and allowed keys only.',
    'Rerun npm run verify:h601-legal-safety and then npm run verify:h601-operator-readiness -- --source <h601-summary> --operator-decision <safe-json> --strict.',
  ],
  hardStops: [
    'legal finalization by Codex',
    'identity verification',
    'OTP/CAPTCHA/security prompt handling',
    'secret entry',
    'external public publishing',
    'billing/checkout/payment/purchase',
  ],
  actionsNotPerformedByCodex: [
    'legal/operator final approval',
    'identity verification',
    'OTP/CAPTCHA/security prompt handling',
    'secret entry',
    'external public publishing',
    'billing/checkout/payment/purchase',
  ],
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

function nonEmpty(value) {
  return typeof value === 'string' && value.trim().length > 0;
}

function safeLocator(value) {
  return (
    typeof value === 'string' &&
    /^(docs|goals|output)\//.test(value) &&
    !/(data:|base64|jwt|signed|secret|password|otp|receipt|payload|eyJ)/i.test(value)
  );
}

function safeOperatorDecisionValues(value) {
  if (!value || typeof value !== 'object') return false;
  if (value.artifactUri !== undefined && !safeLocator(value.artifactUri)) return false;
  if (value.operator !== undefined && !safeFreeText(value.operator, 80)) return false;
  if (value.decidedAt !== undefined && !safeTimestamp(value.decidedAt)) return false;
  if (value.notes !== undefined && !safeFreeText(value.notes, 240)) return false;

  return Object.entries(value).every(([key, entryValue]) => {
    if (typeof entryValue !== 'string') return true;
    if (key === 'decidedAt') return safeTimestamp(entryValue);
    if (key === 'operator') return safeFreeText(entryValue, 80);
    if (key === 'notes') return safeFreeText(entryValue, 240);
    if (key === 'termsLocator' || key === 'privacyLocator' || key === 'artifactUri') {
      return safeLocator(entryValue);
    }
    return safeFreeText(entryValue, 500);
  });
}

function safeFreeText(value, maxLength) {
  return (
    typeof value === 'string' &&
    value.trim().length > 0 &&
    value.length <= maxLength &&
    !unsafeTextPattern().test(value)
  );
}

function safeTimestamp(value) {
  return (
    typeof value === 'string' &&
    /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{3})?Z$/.test(value) &&
    !Number.isNaN(Date.parse(value))
  );
}

function unsafeTextPattern() {
  return /(data:|base64|jwt|signed|secret|password|otp|receipt|payload|eyJ|sk-[a-z0-9_-]|[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}|\+?\d[\d\s().-]{8,}\d)/i;
}

function objectKeysAllowed(value, allowedKeys) {
  return value && Object.keys(value).every((key) => allowedKeys.includes(key));
}

function unique(values) {
  return [...new Set(values)];
}

function slug(value) {
  return value.toLowerCase().replace(/[^a-z0-9]+/g, '_').replace(/^_|_$/g, '');
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
