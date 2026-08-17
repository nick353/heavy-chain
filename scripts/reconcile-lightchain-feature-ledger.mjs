#!/usr/bin/env node

import { existsSync, readFileSync, mkdirSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';

const args = parseArgs(process.argv.slice(2));
const sourcePath = resolve(args.source || 'src/pages/LightchainWorkbenchPage.tsx');
const catalogAuditPath = requiredPath(args['catalog-audit'], '--catalog-audit');
const cardAuditPath = requiredPath(args['card-audit'], '--card-audit');
const evidencePath = requiredPath(args.evidence, '--evidence');
const outPath = args.out ? resolve(args.out) : null;

const failures = [];
const source = readJsonSafe(sourcePath, failures, 'source');
const catalogAudit = readJsonSafe(catalogAuditPath, failures, 'catalog audit');
const cardAudit = readJsonSafe(cardAuditPath, failures, 'card audit');
const evidence = readJsonSafe(evidencePath, failures, 'current evidence');

const sourceFeatures = source ? parseSourceFeatures(source) : [];
if (!sourceFeatures.length) failures.push('source feature catalog is empty or could not be parsed');

const outcomes = evidence ? collectFeatureOutcomes(evidence) : [];
const outcomeByFeature = new Map();
for (const outcome of outcomes) {
  const current = outcomeByFeature.get(outcome.feature);
  if (!current || outcomeRank(outcome.status) > outcomeRank(current.status)) {
    outcomeByFeature.set(outcome.feature, outcome);
  }
}

const permissionRoutes = evidence?.permissionRouteFreshReadback20260818?.routes ?? [];
const recording = evidence?.recordingLedgerReaudit20260818;
const screenshot = evidence?.screenshotMediaReaudit20260818;
const cardRecords = Array.isArray(cardAudit?.records) ? cardAudit.records : [];
const cardCount = Number(cardAudit?.cardCount);

if (!Number.isInteger(cardCount) || cardCount < 0) failures.push('card audit cardCount is invalid');
if (Number.isInteger(cardCount) && cardRecords.length !== cardCount) {
  failures.push(`card audit record count ${cardRecords.length} does not match cardCount ${cardCount}`);
}
if (!Array.isArray(permissionRoutes)) failures.push('permission route evidence is missing');

const sourceIds = sourceFeatures.map((feature) => feature.id);
const nonVideoFeatures = sourceFeatures.filter((feature) => !feature.id.startsWith('video-'));
const confirmedSuccess = [...outcomeByFeature.values()].filter((item) => item.status === 'confirmed_success');
const confirmedFailure = [...outcomeByFeature.values()].filter((item) => item.status === 'confirmed_failure');

const report = {
  schema: 'heavy-chain.lightchain-feature-ledger-reconciliation.v1',
  generatedAt: new Date().toISOString(),
  inputs: {
    source: sourcePath,
    catalogAudit: catalogAuditPath,
    cardAudit: cardAuditPath,
    evidence: evidencePath,
  },
  scope: {
    sourceFeatureCount: sourceFeatures.length,
    sourceNonVideoFeatureCount: nonVideoFeatures.length,
    videoFeatureIds: sourceFeatures.filter((feature) => feature.id.startsWith('video-')).map((feature) => feature.id),
    sourceFeatureIds: sourceIds,
    catalogAudit: {
      routeCards: Number(catalogAudit?.routeCards || 0),
      caseCards: Number(catalogAudit?.caseCards || 0),
      catalogEffectfulSkipped: catalogAudit?.catalogEffectfulSkipped || [],
      permissionSkipped: catalogAudit?.permissionSkipped || [],
    },
  },
  cardInteractionLedger: {
    surface: cardAudit?.surface || null,
    sameSession: cardAudit?.sameSession ?? null,
    cardCount: Number.isInteger(cardCount) ? cardCount : null,
    recordCount: cardRecords.length,
    permissionCardCount: cardRecords.filter((record) => record.permission === true).length,
    providerBlockedCardCount: cardRecords.filter((record) => record.providerBlocked === true).length,
    generationSubmits: Number(cardAudit?.generationSubmits || 0),
    openAiApiCalls: Number(cardAudit?.openaiApiCalls || 0),
  },
  liveOutcomeLedger: {
    confirmedSuccessCount: confirmedSuccess.length,
    confirmedSuccessFeatureIds: confirmedSuccess.map((item) => item.feature).sort(),
    confirmedFailureCount: confirmedFailure.length,
    confirmedFailures: confirmedFailure.map(({ feature, error, result, path }) => ({ feature, error, result, path })),
    sourceIdsWithoutDirectOutcomeEvidence: nonVideoFeatures
      .filter((feature) => !outcomeByFeature.has(feature.id))
      .map((feature) => feature.id),
  },
  permissionUiLedger: {
    exactCopy: evidence?.permissionRouteFreshReadback20260818?.exactPermissionCopy || '権限がありません',
    routes: permissionRoutes.map((route) => ({
      route: route.route,
      permissionTextCount: route.permissionTextCount,
      disabled: route.disabled || [],
      majorControls: route.majorControls || [],
    })),
    generationClicked: evidence?.permissionRouteFreshReadback20260818?.generationClicked ?? null,
  },
  mediaLedger: {
    verifiedRecordings: Number(recording?.mediaVerified?.count || 0),
    blockedRecordings: Number(recording?.blocked?.count || 0),
    analysisOnlyManifests: Number(recording?.analysisOnlyManifests || 0),
    extensionCaptureCount: Number(recording?.mediaVerified?.extensionCapture || 0),
    validImageFiles: Number(screenshot?.validImageMime || 0),
  },
  checks: {
    sourceCatalogLoaded: sourceFeatures.length > 0,
    cardRecordCountMatches: Number.isInteger(cardCount) && cardRecords.length === cardCount,
    cardQaDidNotClaimGeneration: Number(cardAudit?.generationSubmits || 0) === 0,
    outcomeEvidenceEntries: outcomes.length,
    distinctOutcomeFeatureCount: outcomeByFeature.size,
    outcomeEvidenceMultiplicityIsExplicit: outcomes.length >= outcomeByFeature.size,
    permissionRoutesRead: permissionRoutes.length > 0,
    mediaCountsAreExplicit: Number.isInteger(recording?.mediaVerified?.count) && Number.isInteger(recording?.blocked?.count),
  },
  interpretation: 'This report separates source inventory, card/route interaction, permission UI, confirmed provider outcomes, and media inventory. It does not treat route reach, a card click, a screenshot, or a queued job as a generation success.',
  ok: failures.length === 0,
  failures,
};

if (outPath) {
  mkdirSync(dirname(outPath), { recursive: true });
  writeFileSync(outPath, `${JSON.stringify(report, null, 2)}\n`);
}

console.log(JSON.stringify({
  ok: report.ok,
  output: outPath,
  sourceFeatureCount: report.scope.sourceFeatureCount,
  sourceNonVideoFeatureCount: report.scope.sourceNonVideoFeatureCount,
  cardCount: report.cardInteractionLedger.cardCount,
  confirmedSuccessCount: report.liveOutcomeLedger.confirmedSuccessCount,
  confirmedFailureCount: report.liveOutcomeLedger.confirmedFailureCount,
  permissionRouteCount: report.permissionUiLedger.routes.length,
  verifiedRecordingCount: report.mediaLedger.verifiedRecordings,
  failures: report.failures,
}, null, 2));

if (!report.ok) process.exitCode = 1;

function parseSourceFeatures(text) {
  const start = text.indexOf('const tools: CompatTool[] = [');
  const end = start >= 0 ? text.indexOf('];\n\n', start) : -1;
  if (start < 0 || end < 0) return [];
  const block = text.slice(start, end);
  return [...block.matchAll(/\{\s*id: '([^']+)'[\s\S]+?title: '([^']+)'[\s\S]+?category: '([^']+)'/g)]
    .map((match) => ({ id: match[1], title: match[2], category: match[3] }));
}

function collectFeatureOutcomes(value, path = '$', results = []) {
  if (Array.isArray(value)) {
    value.forEach((item, index) => collectFeatureOutcomes(item, `${path}[${index}]`, results));
    return results;
  }
  if (!value || typeof value !== 'object') return results;
  if (typeof value.feature === 'string' && (value.status || value.result || value.exactError)) {
    const status = value.status === 'confirmed_success' || value.result === 'completed'
      ? 'confirmed_success'
      : value.status === 'confirmed_failure' || value.exactError
        ? 'confirmed_failure'
        : 'observed_no_result';
    results.push({
      feature: value.feature,
      status,
      result: value.result || null,
      error: value.exactError || null,
      path,
    });
  }
  Object.entries(value).forEach(([key, child]) => collectFeatureOutcomes(child, `${path}.${key}`, results));
  return results;
}

function outcomeRank(status) {
  return { observed_no_result: 1, confirmed_failure: 2, confirmed_success: 3 }[status] || 0;
}

function readJsonSafe(filePath, target, label) {
  if (!filePath || !existsSync(filePath)) {
    target.push(`${label} file is missing: ${filePath || '(not provided)'}`);
    return null;
  }
  try {
    return label === 'source'
      ? readFileSync(filePath, 'utf8')
      : JSON.parse(readFileSync(filePath, 'utf8'));
  } catch (error) {
    target.push(`${label} could not be read: ${error.message}`);
    return null;
  }
}

function requiredPath(value, flag) {
  if (!value) {
    console.error(`${flag} is required`);
    process.exit(2);
  }
  return resolve(value);
}

function parseArgs(argv) {
  const parsed = {};
  for (let index = 0; index < argv.length; index += 1) {
    const argument = argv[index];
    if (!argument.startsWith('--')) continue;
    const key = argument.slice(2);
    const value = argv[index + 1];
    if (!value || value.startsWith('--')) {
      parsed[key] = true;
      continue;
    }
    parsed[key] = value;
    index += 1;
  }
  return parsed;
}
