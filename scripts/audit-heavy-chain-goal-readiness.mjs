import fs from 'node:fs';
import path from 'node:path';

const args = parseArgs(process.argv.slice(2));
const statePath = 'STATE.md';
const stateText = readText(statePath);
const readinessPath = args.readiness || latestProofPath({
  fileName: 'readiness.json',
  checker: 'verify-runway-production-readiness',
}) || 'output/playwright/runway-production-readiness-20260623/readiness.json';
const uiPath = args.ui || latestSummaryPath({
  directoryPattern: /(?:^|\/)(?:ux-audit-\d{8}-production-ui|lightchain-production-ui-\d{8}|production-ui-after-frontend-deploy-full-\d{8}(?:-[^/]+)?|production-ui-after-bridge-first-deploy-\d{8}(?:-[^/]+)?)(?:\/|$)/,
  predicate: (summary) => Number.isInteger(summary?.resultCount) && Number.isInteger(summary?.failureCount),
}) || 'output/playwright/lightchain-production-ui-20260623/summary.json';
const localUiPath = args.localUi || latestSummaryPath({
  directoryPattern: /(?:^|\/)local-preview-full-ui-\d{8}(?:-[^/]+)?(?:\/|$)/,
  predicate: (summary) => isLoopbackUrl(summary?.baseUrl)
    && Number.isInteger(summary?.resultCount)
    && Number.isInteger(summary?.failureCount),
}) || null;
const navigationPath = args.navigation || latestSummaryPath({
  directoryPattern: /(?:^|\/)lightchain-production-navigation-\d{8}(?:\/|$)/,
  predicate: (summary) => Number.isInteger(summary?.resultCount) && Number.isInteger(summary?.failureCount),
}) || 'output/playwright/lightchain-production-navigation-20260623/summary.json';
const runwayUiPath = args.runwayUi || latestSummaryPath({
  directoryPattern: /(?:^|\/)local-preview-runway-ui-\d{8}(?:-[^/]+)?(?:\/|$)/,
  predicate: (summary) => Boolean(summary?.generate && summary?.brandSettings),
}) || null;
const massMarketQaPath = args.massMarketQa || 'output/playwright/mass-market-qa-prod-after-reference-handoff-20260625-rerun/SUMMARY.json';
const launchOpsPath = args.launchOps || 'output/playwright/launch-operations-readiness-20260625/summary.json';
const generationWorkbenchPath = args.generationWorkbench || 'output/playwright/lightchain-parity-generation-workbench-prod-20260625/summary.json';
const generationRedactionPath = args.generationRedaction || 'output/playwright/lightchain-parity-generation-workbench-prod-20260625/prod-redaction-readback.json';
const referenceStabilityPath = args.referenceStability || 'output/playwright/reference-image-stability-20260625/summary.json';
const liveWorkerSummaryPath = args.liveWorkerSummary || 'output/playwright/final-live-worker-uat-20260625/SUMMARY.json';
const liveWorkerDbPath = args.liveWorkerDb || 'output/playwright/final-live-worker-uat-20260625/06-db-storage-readback.json';
const liveWorkerUiPath = args.liveWorkerUi || 'output/playwright/final-live-worker-uat-20260625/07-ui-readback-summary.json';
const liveWorkerCleanupPath = args.liveWorkerCleanup || 'output/playwright/final-live-worker-uat-20260625/10-cleanup-readback.json';
const finalPolishDbPath = args.finalPolishDb || 'output/playwright/final-polish-upload-jobs-prod-20260625/prod-db-storage-readback.json';
const finalPolishSummaryPath = args.finalPolishSummary || 'output/playwright/final-polish-upload-jobs-prod-20260625/SUMMARY.json';
const finalPolishCleanupPath = args.finalPolishCleanup || 'output/playwright/final-polish-upload-jobs-prod-20260625/storage-cleanup-readback.json';
const finalPolishCurrentCleanupPath = args.finalPolishCurrentCleanup || 'output/playwright/final-polish-upload-jobs-prod-20260625/current-cleanup-readback.json';
const nonbillingCreatePath = args.nonbillingCreate || 'output/playwright/nonbilling-live-uat-1782396855131/01-create-job-summary.json';
const nonbillingReferencePath = args.nonbillingReference || 'output/playwright/nonbilling-live-uat-1782396855131/02-reference-handoff-readback.json';
const nonbillingDbPath = args.nonbillingDb || 'output/playwright/nonbilling-live-uat-1782396855131/04-db-storage-readback.json';
const nonbillingUiPath = args.nonbillingUi || 'output/playwright/nonbilling-live-uat-1782396855131/05-ui-readback-summary.json';
const nonbillingCleanupPath = args.nonbillingCleanup || 'output/playwright/nonbilling-live-uat-1782396855131/06-cleanup-readback.json';
const nonbillingUsageCleanupPath = args.nonbillingUsageCleanup || 'output/playwright/nonbilling-live-uat-1782396855131/07-usage-cleanup-readback.json';
const openaiFittingSubmitPath = args.openaiFittingSubmit || 'output/playwright/g705-visible-fitting-prod-submit-post-deploy-r8-accepted/summary.json';
const openaiFittingVisualReviewPath = args.openaiFittingVisualReview || 'output/playwright/g705-visible-fitting-prod-visual-review-r1/visual-review.json';
const outPath = args.out || 'output/playwright/heavy-chain-goal-readiness-current/audit.json';
const stateNextAction = stateField(stateText, 'next_action');

const paths = {
  state: statePath,
  ui: uiPath,
  localUi: localUiPath,
  navigation: navigationPath,
  runwayUi: runwayUiPath,
  readiness: readinessPath,
  freeDenial: 'output/playwright/runway-free-plan-denial-20260623/denial.json',
  unapprovedDenial: 'output/playwright/runway-unapproved-denial-20260623/denial.json',
  expiredDenial: 'output/playwright/runway-expired-subscription-denial-20260623/denial.json',
  massMarketQa: massMarketQaPath,
  launchOps: launchOpsPath,
  generationWorkbench: generationWorkbenchPath,
  generationRedaction: generationRedactionPath,
  referenceStability: referenceStabilityPath,
  liveWorkerSummary: liveWorkerSummaryPath,
  liveWorkerDb: liveWorkerDbPath,
  liveWorkerUi: liveWorkerUiPath,
  liveWorkerCleanup: liveWorkerCleanupPath,
  finalPolishDb: finalPolishDbPath,
  finalPolishSummary: finalPolishSummaryPath,
  finalPolishCleanup: finalPolishCleanupPath,
  finalPolishCurrentCleanup: finalPolishCurrentCleanupPath,
  nonbillingCreate: nonbillingCreatePath,
  nonbillingReference: nonbillingReferencePath,
  nonbillingDb: nonbillingDbPath,
  nonbillingUi: nonbillingUiPath,
  nonbillingCleanup: nonbillingCleanupPath,
  nonbillingUsageCleanup: nonbillingUsageCleanupPath,
  openaiFittingSubmit: openaiFittingSubmitPath,
  openaiFittingVisualReview: openaiFittingVisualReviewPath,
};

const files = Object.fromEntries(
  Object.entries(paths).map(([key, filePath]) => [key, readJson(filePath)])
);
const readinessBlockers = Array.isArray(files.readiness.json?.blockers) ? files.readiness.json.blockers : [];
const blockerCodes = new Set(readinessBlockers.map((blocker) => blocker.code));
const stateMentionsApprovedRunwayClient = /approved (?:existing )?Runway MCP client/i.test(stateText)
  || /Codex-approved (?:existing )?Runway MCP client/i.test(stateText)
  || /use Codex-approved `mcp__runway\.\*` tools/i.test(stateText);
const stateDisallowsOldMcpRemotePath = /Do not use `localhost:15554` consent pages/i.test(stateText)
  || /older `mcp-remote` localhost consent path remains invalid/i.test(stateText)
  || /old autonomous `mcp-remote` localhost path remains disallowed/i.test(stateText);
const stateMentionsLocalWorkerPath = /local-worker jobs/i.test(stateText)
  || /local Runway worker handoff/i.test(stateText)
  || /local worker handoff/i.test(stateText)
  || /local worker import/i.test(stateText)
  || /worker:local-runway:watch/i.test(stateText)
  || /local Runway MCP worker queue/i.test(stateText);

const requirements = [
  requirement({
    id: 'logged_in_production_ui',
    title: 'Logged-in production UI proves Lightchain-style surfaces',
    status: currentProductionUiPassed() ? 'passed' : 'failed',
    evidence: [paths.massMarketQa, paths.launchOps],
    details: currentProductionUiDetails(),
    next_action: 'Rerun npm run verify:mass-market-qa against production and npm run verify:launch-ops with the saved production auth state.',
  }),
  requirement({
    id: 'local_production_build_full_ui',
    title: 'Local production build full UI passes desktop/mobile proof',
    status: localUiPassed() ? 'passed' : 'failed',
    evidence: paths.localUi ? [paths.localUi] : [],
    details: fullUiDetails(files.localUi),
    next_action: 'Build locally, run vite preview on loopback with local auth state, then rerun verify:lightchain-ui against that base URL.',
  }),
  requirement({
    id: 'logged_in_navigation',
    title: 'Desktop/mobile production click navigation is nonblank and error-free',
    status: navigationPassed() ? 'passed' : 'failed',
    evidence: [paths.navigation],
    details: {
      resultCount: files.navigation.json?.resultCount,
      failureCount: files.navigation.json?.failureCount,
    },
    next_action: 'Rerun npm run verify:lightchain-navigation and fix the failing route proof.',
  }),
  requirement({
    id: 'local_worker_operator_controls',
    title: 'Current local worker UI and operator controls allow generation through the approved path only',
    status: localWorkerOperatorControlsPassed() ? 'passed' : 'failed',
    evidence: [paths.launchOps, paths.nonbillingCreate, paths.state, 'docs/launch-operations-runbook-2026-06-25.md', 'package.json'],
    details: localWorkerOperatorControlsDetails(),
    next_action: 'Rerun launch ops and non-billing submit proof, then verify runbook/package local worker commands and override restrictions.',
  }),
  requirement({
    id: 'runway_site_approval',
    title: 'Target NiSEN brand is Runway MCP site-approved',
    status: checkPassed(files.readiness.json, 'Runway MCP site approval') ? 'passed' : 'failed',
    evidence: [paths.readiness],
    details: checkDetails(files.readiness.json, 'Runway MCP site approval'),
    next_action: 'Request connection from /brand/settings and approve the brand from /admin?tab=runway.',
  }),
  requirement({
    id: 'unapproved_denial',
    title: 'Unapproved temporary brand is denied and fully cleaned up',
    status: denialPassed(files.unapprovedDenial.json, { cleanupRequired: true }) ? 'passed' : 'failed',
    evidence: [paths.unapprovedDenial],
    details: cleanupDetails(files.unapprovedDenial.json),
    next_action: 'Rerun npm run verify:runway-unapproved-denial and inspect cleanup residuals.',
  }),
  requirement({
    id: 'local_worker_contract_redaction',
    title: 'Local worker contract stores reference images through private handoff redaction',
    status: localWorkerContractRedactionPassed() ? 'passed' : 'failed',
    evidence: [paths.generationRedaction, paths.nonbillingReference, paths.state],
    details: localWorkerContractRedactionDetails(),
    next_action: 'Rerun the generation workbench redaction proof and non-billing reference handoff readback.',
  }),
  requirement({
    id: 'runway_bridge_tools',
    title: 'Approved-client Runway MCP plus local worker path is the production route',
    status: approvedClientRunwayPathPassed() ? 'passed' : 'failed',
    evidence: [paths.referenceStability, paths.launchOps, paths.state],
    details: approvedClientRunwayPathDetails(),
    next_action: 'Use Codex-approved Runway MCP upload/generate tools and local worker handoff; do not reintroduce the hosted mcp-remote bridge as the production generation gate.',
  }),
  requirement({
    id: 'approved_live_generation_readback',
    title: 'Approved brand production generation has DB/Storage/UI readback',
    status: approvedLiveGenerationReadbackPassed() ? 'passed' : 'failed',
    evidence: [
      paths.nonbillingCreate,
      paths.nonbillingReference,
      paths.nonbillingDb,
      paths.nonbillingUi,
      paths.liveWorkerSummary,
      paths.liveWorkerDb,
      paths.liveWorkerUi,
      paths.openaiFittingSubmit,
      paths.openaiFittingVisualReview,
    ],
    details: approvedLiveGenerationReadbackDetails(),
    next_action: 'Run a fresh non-billing production UI submit, local worker import, DB/Storage readback, and UI readback if any proof regresses.',
  }),
  requirement({
    id: 'workspace_readback_expected_task_codes',
    title: 'Workspace and generation matrix cover the current Lightchain-style product flows',
    status: workspaceMatrixPassed() ? 'passed' : 'failed',
    evidence: [paths.generationWorkbench, paths.massMarketQa],
    details: workspaceMatrixDetails(),
    next_action: 'Rerun the production generation workbench proof and mass-market QA route recording.',
  }),
  requirement({
    id: 'approved_generation_cleanup',
    title: 'Approved-generation disposable proof artifacts are marker-scoped and cleaned up',
    status: approvedGenerationCleanupPassed() ? 'passed' : 'failed',
    evidence: [paths.liveWorkerCleanup, paths.finalPolishDb, paths.finalPolishSummary, paths.finalPolishCleanup, paths.finalPolishCurrentCleanup, paths.nonbillingCleanup, paths.nonbillingUsageCleanup],
    details: approvedGenerationCleanupDetails(),
    next_action: 'Rerun marker-scoped cleanup and record zero residual job/image/usage/storage readback.',
  }),
];

const statusCounts = countStatuses(requirements);
const blockers = requirements
  .filter((item) => item.status === 'blocked_external' || item.status === 'failed')
  .map((item) => ({
    id: item.id,
    status: item.status,
    title: item.title,
    next_action: item.next_action,
  }));
const pending = requirements
  .filter((item) => item.status === 'pending_after_blocker')
  .map((item) => ({
    id: item.id,
    title: item.title,
    next_action: item.next_action,
  }));

const report = {
  captured_at: new Date().toISOString(),
  checker: 'audit-heavy-chain-goal-readiness',
  complete: blockers.length === 0 && pending.length === 0,
  source_of_truth: paths,
  summary: {
    total: requirements.length,
    ...statusCounts,
  },
  requirements,
  blockers,
  pending_after_blocker: pending,
  state_ignores_billing_gate: stateNextAction.includes('verify:runway-approved-generation')
    && !stateText.includes('heavy_chain_paid_subscription_pending'),
};

fs.mkdirSync(path.dirname(outPath), { recursive: true });
fs.writeFileSync(outPath, `${JSON.stringify(report, null, 2)}\n`);

if (!report.complete && !args.allowIncomplete) {
  console.error(`Heavy Chain goal readiness incomplete. Audit: ${outPath}`);
  for (const blocker of blockers) {
    console.error(`- ${blocker.status}: ${blocker.id}: ${blocker.next_action}`);
  }
  for (const item of pending) {
    console.error(`- pending_after_blocker: ${item.id}: ${item.next_action}`);
  }
  process.exit(1);
}

console.log(`Heavy Chain goal readiness audit written to ${outPath}. complete=${report.complete}`);
if (!report.complete) {
  console.log(`blocked_or_failed=${blockers.length} pending_after_blocker=${pending.length}`);
}

function parseArgs(rawArgs) {
  const parsed = {
    allowIncomplete: false,
    out: null,
    readiness: null,
    approvedProof: null,
    ui: null,
    localUi: null,
    navigation: null,
    runwayUi: null,
  };
  for (let index = 0; index < rawArgs.length; index += 1) {
    const arg = rawArgs[index];
    const next = rawArgs[index + 1];
    if (arg === '--allow-incomplete') parsed.allowIncomplete = true;
    if (arg === '--out' && next) {
      parsed.out = next;
      index += 1;
    } else if (arg === '--readiness' && next) {
      parsed.readiness = next;
      index += 1;
    } else if (arg === '--approved-proof' && next) {
      parsed.approvedProof = next;
      index += 1;
    } else if (arg === '--ui' && next) {
      parsed.ui = next;
      index += 1;
    } else if (arg === '--bridge-proof' && next) {
      parsed.bridgeProof = next;
      index += 1;
    } else if (arg === '--local-ui' && next) {
      parsed.localUi = next;
      index += 1;
    } else if (arg === '--navigation' && next) {
      parsed.navigation = next;
      index += 1;
    } else if (arg === '--runway-ui' && next) {
      parsed.runwayUi = next;
      index += 1;
    } else if (arg === '--mass-market-qa' && next) {
      parsed.massMarketQa = next;
      index += 1;
    } else if (arg === '--launch-ops' && next) {
      parsed.launchOps = next;
      index += 1;
    } else if (arg === '--generation-workbench' && next) {
      parsed.generationWorkbench = next;
      index += 1;
    } else if (arg === '--generation-redaction' && next) {
      parsed.generationRedaction = next;
      index += 1;
    } else if (arg === '--reference-stability' && next) {
      parsed.referenceStability = next;
      index += 1;
    } else if (arg === '--live-worker-summary' && next) {
      parsed.liveWorkerSummary = next;
      index += 1;
    } else if (arg === '--live-worker-db' && next) {
      parsed.liveWorkerDb = next;
      index += 1;
    } else if (arg === '--live-worker-ui' && next) {
      parsed.liveWorkerUi = next;
      index += 1;
    } else if (arg === '--live-worker-cleanup' && next) {
      parsed.liveWorkerCleanup = next;
      index += 1;
    } else if (arg === '--final-polish-db' && next) {
      parsed.finalPolishDb = next;
      index += 1;
    } else if (arg === '--final-polish-summary' && next) {
      parsed.finalPolishSummary = next;
      index += 1;
    } else if (arg === '--final-polish-cleanup' && next) {
      parsed.finalPolishCleanup = next;
      index += 1;
    } else if (arg === '--final-polish-current-cleanup' && next) {
      parsed.finalPolishCurrentCleanup = next;
      index += 1;
    } else if (arg === '--nonbilling-create' && next) {
      parsed.nonbillingCreate = next;
      index += 1;
    } else if (arg === '--nonbilling-reference' && next) {
      parsed.nonbillingReference = next;
      index += 1;
    } else if (arg === '--nonbilling-db' && next) {
      parsed.nonbillingDb = next;
      index += 1;
    } else if (arg === '--nonbilling-ui' && next) {
      parsed.nonbillingUi = next;
      index += 1;
    } else if (arg === '--nonbilling-cleanup' && next) {
      parsed.nonbillingCleanup = next;
      index += 1;
    } else if (arg === '--nonbilling-usage-cleanup' && next) {
      parsed.nonbillingUsageCleanup = next;
      index += 1;
    } else if (arg === '--openai-fitting-submit' && next) {
      parsed.openaiFittingSubmit = next;
      index += 1;
    } else if (arg === '--openai-fitting-visual-review' && next) {
      parsed.openaiFittingVisualReview = next;
      index += 1;
    }
  }
  return parsed;
}

function readJson(filePath) {
  try {
    return { exists: true, json: JSON.parse(fs.readFileSync(filePath, 'utf8')) };
  } catch (error) {
    return { exists: false, json: null, error: error.message };
  }
}

function readText(filePath) {
  try {
    return fs.readFileSync(filePath, 'utf8');
  } catch {
    return '';
  }
}

function requirement(item) {
  return {
    id: item.id,
    title: item.title,
    status: item.status,
    evidence: item.evidence,
    details: item.details ?? {},
    next_action: item.next_action,
  };
}

function firstReadinessVerificationBlocker() {
  return readinessBlockers.find((blocker) => [
    'production_runway_mcp_secret_inspection_failed',
    'production_runway_db_readback_failed',
  ].includes(blocker.code)) || null;
}

function uiPassed() {
  return files.ui.exists && files.ui.json?.resultCount >= 30 && files.ui.json?.failureCount === 0;
}

function localUiPassed() {
  return fullUiPassed(files.localUi, { requireLoopback: true });
}

function fullUiPassed(proof, { requireLoopback = false } = {}) {
  if (!proof?.exists) return false;
  if (requireLoopback && !isLoopbackUrl(proof.json?.baseUrl)) return false;
  return proof.json?.resultCount >= 30
    && proof.json?.failureCount === 0
    && (proof.json?.results || []).every((result) => result.passed === true
      && result.redirectedToLogin === false
      && result.consoleErrorCount === 0
      && result.pageErrorCount === 0);
}

function fullUiDetails(proof) {
  if (!proof?.exists) return { exists: false, error: proof?.error };
  return {
    baseUrl: proof.json?.baseUrl,
    storageState: proof.json?.storageState,
    resultCount: proof.json?.resultCount,
    failureCount: proof.json?.failureCount,
    redirectCount: (proof.json?.results || []).filter((result) => result.redirectedToLogin === true).length,
    consoleErrorCount: (proof.json?.results || []).reduce((total, result) => total + (result.consoleErrorCount || 0), 0),
    pageErrorCount: (proof.json?.results || []).reduce((total, result) => total + (result.pageErrorCount || 0), 0),
  };
}

function navigationPassed() {
  return files.navigation.exists
    && files.navigation.json?.resultCount >= 12
    && files.navigation.json?.failureCount === 0
    && (files.navigation.json?.results || []).every((result) => result.passed === true
      && result.consoleErrorCount === 0
      && result.pageErrorCount === 0);
}

function runwayUiPassed() {
  if (!files.runwayUi.exists) return false;
  const generate = files.runwayUi.json?.generate ?? {};
  const brandSettings = files.runwayUi.json?.brandSettings ?? {};
  return generate.hasRunwayPrecheck === true
    && generate.generateButton?.disabled === true
    && (generate.hasOAuthIssue === true || generate.hasBridgeIssue === true)
    && generate.hasOldStandaloneBridgeLabel === false
    && brandSettings.hasRunwayConnection === true
    && (brandSettings.hasOAuthIssue === true || brandSettings.hasBridgeIssue === true)
    && brandSettings.hasGenerationAvailability === true
    && brandSettings.hasPlanMisleadingStopCopy === false
    && (files.runwayUi.json?.consoleErrors || []).length === 0;
}

function runwayUiDetails() {
  if (!files.runwayUi.exists) return { exists: false, error: files.runwayUi.error };
  return {
    generate: {
      hasRunwayPrecheck: files.runwayUi.json?.generate?.hasRunwayPrecheck,
      generateButtonDisabled: files.runwayUi.json?.generate?.generateButton?.disabled,
      hasOAuthIssue: files.runwayUi.json?.generate?.hasOAuthIssue,
      hasBridgeIssue: files.runwayUi.json?.generate?.hasBridgeIssue,
      hasOldStandaloneBridgeLabel: files.runwayUi.json?.generate?.hasOldStandaloneBridgeLabel,
    },
    brandSettings: {
      hasRunwayConnection: files.runwayUi.json?.brandSettings?.hasRunwayConnection,
      hasOAuthIssue: files.runwayUi.json?.brandSettings?.hasOAuthIssue,
      hasBridgeIssue: files.runwayUi.json?.brandSettings?.hasBridgeIssue,
      hasGenerationAvailability: files.runwayUi.json?.brandSettings?.hasGenerationAvailability,
      hasPlanMisleadingStopCopy: files.runwayUi.json?.brandSettings?.hasPlanMisleadingStopCopy,
    },
    consoleErrorCount: (files.runwayUi.json?.consoleErrors || []).length,
    screenshots: files.runwayUi.json?.screenshots ?? {},
  };
}

function currentProductionUiPassed() {
  const mass = files.massMarketQa.json;
  const launch = files.launchOps.json;
  return files.massMarketQa.exists
    && files.launchOps.exists
    && mass?.ok === true
    && mass?.baseUrl === 'https://heavy-chain.zeabur.app'
    && mass?.routeCount >= 17
    && (mass?.mobile || []).length >= 8
    && (mass?.routes || []).filter((route) => Boolean(route.video)).length >= 17
    && (mass?.mobile || []).filter((route) => Boolean(route.video)).length >= 8
    && (mass?.routes || []).every((route) => route.exactBlocker == null && (route.assertions || []).every((assertion) => assertion.passed === true))
    && (mass?.mobile || []).every((route) => route.exactBlocker == null && (route.assertions || []).every((assertion) => assertion.passed === true))
    && (mass?.consoleMessages || []).length === 0
    && (mass?.pageErrors || []).length === 0
    && (mass?.requestFailures || []).length === 0
    && mass?.cleanup?.contextClosed === true
    && mass?.cleanup?.browserClosed === true
    && mass?.irreversibleActions?.generationSubmit === 'not_clicked'
    && launch?.ok === true
    && launch?.baseUrl === 'https://heavy-chain.zeabur.app'
    && (launch?.consoleMessages || []).length === 0
    && (launch?.pageErrors || []).length === 0
    && (launch?.networkFailures || []).length === 0
    && launch?.irreversibleActions?.generationSubmit === 'not_clicked';
}

function currentProductionUiDetails() {
  const mass = files.massMarketQa.json || {};
  const launch = files.launchOps.json || {};
  return {
    massMarket: {
      exists: files.massMarketQa.exists,
      ok: mass.ok,
      baseUrl: mass.baseUrl,
      routeCount: mass.routeCount,
      mobileCount: (mass.mobile || []).length,
      routeVideoCount: (mass.routes || []).filter((route) => Boolean(route.video)).length,
      mobileVideoCount: (mass.mobile || []).filter((route) => Boolean(route.video)).length,
      routeAssertionFailures: (mass.routes || []).flatMap((route) => (route.assertions || []).filter((assertion) => assertion.passed !== true)).length,
      mobileAssertionFailures: (mass.mobile || []).flatMap((route) => (route.assertions || []).filter((assertion) => assertion.passed !== true)).length,
      exactBlockerCount: (mass.routes || []).filter((route) => route.exactBlocker != null).length
        + (mass.mobile || []).filter((route) => route.exactBlocker != null).length,
      consoleCount: (mass.consoleMessages || []).length,
      pageErrorCount: (mass.pageErrors || []).length,
      requestFailureCount: (mass.requestFailures || []).length,
      contextClosed: mass.cleanup?.contextClosed,
      browserClosed: mass.cleanup?.browserClosed,
      generationSubmit: mass.irreversibleActions?.generationSubmit,
    },
    launchOps: {
      exists: files.launchOps.exists,
      ok: launch.ok,
      expectedAsset: launch.expectedAsset,
      currentAsset: checkDetails(launch, 'Zeabur serves expected current asset')?.currentAsset,
      expectedAssetSource: launch.expectedAssetSource,
      networkFailureCount: (launch.networkFailures || []).length,
      generationSubmit: launch.irreversibleActions?.generationSubmit,
    },
  };
}

function localWorkerOperatorControlsPassed() {
  const launch = files.launchOps.json;
  const created = files.nonbillingCreate.json;
  const runbookText = readText('docs/launch-operations-runbook-2026-06-25.md');
  const packageText = readText('package.json');
  const afterSubmit = (created?.steps || []).find((step) => step.stage === 'after_submit');
  return files.launchOps.exists
    && files.nonbillingCreate.exists
    && launch?.ok === true
    && checkDetails(launch, 'Generate form is editable without submitting')?.buttonVisible === true
    && launch?.irreversibleActions?.generationSubmit === 'not_clicked'
    && created?.baseUrl === 'https://heavy-chain.zeabur.app'
    && (created?.steps || []).some((step) => step.stage === 'before_submit' && step.visible === true && step.enabled === true)
    && afterSubmit?.generateResponse?.status === 202
    && String(afterSubmit?.generateResponse?.body || '').includes('"provider":"runway_mcp_local_worker"')
    && stateMentionsApprovedRunwayClient
    && stateText.includes('`--live-runway` remains diagnostic only')
    && stateText.includes('only use `--allow-unmatched-mcp-result` for a deliberate one-off recovery')
    && runbookText.includes('Do not use it in watch mode')
    && runbookText.includes('output/runway-mcp-results/inbox')
    && packageText.includes('"worker:local-runway:watch"')
    && packageText.includes('--watch-mcp-results output/runway-mcp-results/inbox');
}

function localWorkerOperatorControlsDetails() {
  const launch = files.launchOps.json || {};
  const created = files.nonbillingCreate.json || {};
  const runbookText = readText('docs/launch-operations-runbook-2026-06-25.md');
  const packageText = readText('package.json');
  const afterSubmit = (created.steps || []).find((step) => step.stage === 'after_submit');
  return {
    launchOpsOk: launch.ok,
    generateEditableWithoutSubmit: checkDetails(launch, 'Generate form is editable without submitting'),
    beforeSubmit: (created.steps || []).find((step) => step.stage === 'before_submit') || null,
    afterSubmitStatus: afterSubmit?.generateResponse?.status,
    afterSubmitUsesLocalWorker: String(afterSubmit?.generateResponse?.body || '').includes('"provider":"runway_mcp_local_worker"'),
    stateApprovedRunwayTools: stateMentionsApprovedRunwayClient,
    stateLiveRunwayDiagnosticOnly: stateText.includes('`--live-runway` remains diagnostic only'),
    stateAllowUnmatchedRestricted: stateText.includes('only use `--allow-unmatched-mcp-result` for a deliberate one-off recovery'),
    runbookAllowUnmatchedNotWatch: runbookText.includes('Do not use it in watch mode'),
    runbookInbox: runbookText.includes('output/runway-mcp-results/inbox'),
    packageWatchScript: packageText.includes('"worker:local-runway:watch"')
      && packageText.includes('--watch-mcp-results output/runway-mcp-results/inbox'),
  };
}

function localWorkerContractRedactionPassed() {
  const redaction = files.generationRedaction.json;
  const reference = files.nonbillingReference.json;
  return files.generationRedaction.exists
    && files.nonbillingReference.exists
    && stateText.includes('referenceImageHandoff')
    && redaction?.ok === true
    && redaction?.response?.provider === 'runway_mcp_local_worker'
    && redaction?.checks?.hasReferenceHandoff === true
    && redaction?.checks?.handoffObjectReadable === true
    && redaction?.checks?.materialImageUrlRemoved === true
    && redaction?.checks?.noRawReferenceImage === true
    && redaction?.persistedInputParams?.hasReferenceImage === true
    && redaction?.persistedInputParams?.provider === 'runway_mcp_local_worker'
    && redaction?.persistedInputParams?.referenceImageHandoff?.hasStoragePath === true
    && redaction?.cleanup?.job === 'deleted'
    && redaction?.cleanup?.usageEvent === 'deleted'
    && redaction?.cleanup?.storage === 'removed'
    && reference?.downloadOk === true
    && reference?.signedUrlOk === true
    && reference?.bytes > 0;
}

function localWorkerContractRedactionDetails() {
  const redaction = files.generationRedaction.json || {};
  const reference = files.nonbillingReference.json || {};
  return {
    stateMentionsReferenceImageHandoff: stateText.includes('referenceImageHandoff'),
    redactionOk: redaction.ok,
    responseProvider: redaction.response?.provider,
    redactionChecks: redaction.checks,
    persistedInputParams: redaction.persistedInputParams,
    cleanup: redaction.cleanup,
    nonbillingReference: {
      status: reference.status,
      downloadOk: reference.downloadOk,
      signedUrlOk: reference.signedUrlOk,
      bytes: reference.bytes,
    },
  };
}

function approvedClientRunwayPathPassed() {
  const reference = files.referenceStability.json;
  const launch = files.launchOps.json;
  return files.referenceStability.exists
    && files.launchOps.exists
    && stateMentionsLocalWorkerPath
    && stateDisallowsOldMcpRemotePath
    && reference?.uploadHttpCode === 200
    && Boolean(reference?.runwayHostedReferenceAsset)
    && Boolean(reference?.successfulRunwayHostedReferenceTask)
    && String(reference?.conclusion || '').includes('Use Runway-hosted upload asset URLs')
    && launch?.ok === true;
}

function approvedClientRunwayPathDetails() {
  const reference = files.referenceStability.json || {};
  return {
    stateUsesLocalWorker: stateMentionsLocalWorkerPath,
    oldMcpRemoteDisallowed: stateDisallowsOldMcpRemotePath,
    uploadHttpCode: reference.uploadHttpCode,
    runwayHostedReferenceAsset: Boolean(reference.runwayHostedReferenceAsset),
    successfulRunwayHostedReferenceTask: reference.successfulRunwayHostedReferenceTask,
    conclusion: reference.conclusion,
    launchOpsOk: files.launchOps.json?.ok,
  };
}

function approvedLiveGenerationReadbackPassed() {
  return nonbillingGenerationPassed() || openaiFittingGenerationPassed();
}

function approvedLiveGenerationReadbackDetails() {
  return {
    liveWorker: {
      summaryChecks: files.liveWorkerSummary.json?.checks,
      jobStatus: files.liveWorkerDb.json?.job?.status,
      storageDownloadOk: files.liveWorkerDb.json?.storage?.downloadOk,
      uiOk: files.liveWorkerUi.json?.checks,
      jobsHasJob: files.liveWorkerUi.json?.checks?.jobsHasJob,
      consoleCount: (files.liveWorkerUi.json?.consoleMessages || []).length,
      pageErrorCount: (files.liveWorkerUi.json?.pageErrors || []).length,
    },
    nonbilling: {
      createdJobId: files.nonbillingCreate.json?.job?.id,
      referenceJobId: files.nonbillingReference.json?.jobId,
      dbJobId: files.nonbillingDb.json?.job?.id,
      uiJobId: files.nonbillingUi.json?.jobId,
      imageId: files.nonbillingUi.json?.imageId,
      referenceReadback: files.nonbillingDb.json?.image?.metadata?.referenceImageHandoff,
      materialReferences: files.nonbillingDb.json?.image?.metadata?.materialReferences,
      jobStatus: files.nonbillingDb.json?.job?.status,
      inputHasRawData: files.nonbillingDb.json?.job?.inputHasRawData,
      storageDownloadOk: files.nonbillingDb.json?.storage?.downloadOk,
      ui: nonbillingUiRouteDetails(files.nonbillingUi.json, {
        jobId: files.nonbillingCreate.json?.job?.id,
        marker: nonbillingMarker(files.nonbillingDb.json),
      }),
      consoleCount: (files.nonbillingUi.json?.consoleErrors || []).length,
      pageErrorCount: (files.nonbillingUi.json?.pageErrors || []).length,
      requestFailureCount: (files.nonbillingUi.json?.failedRequests || []).length,
    },
    openaiFitting: openaiFittingGenerationDetails(),
  };
}

function openaiFittingGenerationPassed() {
  const submit = files.openaiFittingSubmit.json;
  const review = files.openaiFittingVisualReview.json;
  const response = (submit?.responses || [])[submit?.submittedResponseIndex ?? 0]?.body || {};
  const request = (submit?.requests || [])[0] || {};
  const image = (submit?.readback?.images || [])[0] || {};
  const download = submit?.readback?.downloadedImage || {};
  return files.openaiFittingSubmit.exists
    && files.openaiFittingVisualReview.exists
    && submit?.baseUrl === 'https://heavy-chain.zeabur.app'
    && submit?.mode === 'submit-e2e'
    && submit?.submit === true
    && submit?.irreversibleActions?.purchasePaymentCheckout === 'not_touched'
    && submit?.irreversibleActions?.externalPublish === 'not_touched'
    && request.method === 'POST'
    && String(request.url || '').endsWith('/functions/v1/model-matrix')
    && request.hasRightsConfirmed === true
    && response.success === true
    && response.persistenceStatus === 'completed'
    && response.failedStage == null
    && submit?.readback?.job?.status === 'completed'
    && submit?.readback?.job?.featureType === 'model-matrix'
    && submit?.readback?.job?.errorMessage == null
    && image.featureType === 'model-matrix'
    && image.modelUsed === 'gpt-image-1-mini'
    && download.bytes > 0
    && download.png?.valid === true
    && download.png?.width >= 512
    && download.png?.height >= 512
    && Boolean(download.sha256)
    && review?.ok === true
    && review?.sourceSummary === paths.openaiFittingSubmit
    && review?.sourceOk === true
    && review?.technicalOk === true
    && review?.visualQualityAccepted === true
    && review?.artifactMatchesDownloadedImage === true
    && review?.downloadedSha256 === download.sha256;
}

function openaiFittingGenerationDetails() {
  const submit = files.openaiFittingSubmit.json || {};
  const response = (submit.responses || [])[submit.submittedResponseIndex ?? 0]?.body || {};
  const request = (submit.requests || [])[0] || {};
  const image = (submit.readback?.images || [])[0] || {};
  const download = submit.readback?.downloadedImage || {};
  const review = files.openaiFittingVisualReview.json || {};
  return {
    submitExists: files.openaiFittingSubmit.exists,
    reviewExists: files.openaiFittingVisualReview.exists,
    baseUrl: submit.baseUrl,
    mode: submit.mode,
    submit: submit.submit,
    generationSubmit: submit.irreversibleActions?.generationSubmit,
    purchasePaymentCheckout: submit.irreversibleActions?.purchasePaymentCheckout,
    externalPublish: submit.irreversibleActions?.externalPublish,
    request: {
      method: request.method,
      modelMatrix: String(request.url || '').endsWith('/functions/v1/model-matrix'),
      hasRightsConfirmed: request.hasRightsConfirmed,
      bodyTypes: request.bodyTypes,
      ageGroups: request.ageGroups,
    },
    response: {
      success: response.success,
      jobId: response.jobId,
      persistenceStatus: response.persistenceStatus,
      failedStage: response.failedStage,
    },
    readback: {
      jobStatus: submit.readback?.job?.status,
      featureType: submit.readback?.job?.featureType,
      imageId: image.id,
      modelUsed: image.modelUsed,
      downloadedBytes: download.bytes,
      png: download.png,
      sha256: download.sha256,
    },
    visualReview: {
      ok: review.ok,
      sourceOk: review.sourceOk,
      technicalOk: review.technicalOk,
      visualQualityAccepted: review.visualQualityAccepted,
      artifactMatchesDownloadedImage: review.artifactMatchesDownloadedImage,
      downloadedSha256: review.downloadedSha256,
    },
  };
}

function liveWorkerSmokePassed() {
  const summary = files.liveWorkerSummary.json;
  const db = files.liveWorkerDb.json;
  const ui = files.liveWorkerUi.json;
  return files.liveWorkerSummary.exists
    && files.liveWorkerDb.exists
    && files.liveWorkerUi.exists
    && summary?.checks?.allCriticalPassed === true
    && db?.checks?.jobCompleted === true
    && db?.checks?.storageDownloadOk === true
    && db?.checks?.usageSucceeded === true
    && db?.job?.status === 'completed'
    && ui?.checks?.galleryLoads === true
    && ui?.checks?.historyLoads === true
    && ui?.checks?.canvasLoads === true
    && ui?.checks?.jobsLoads === true
    && ui?.checks?.mobileGalleryLoads === true
    && ui?.checks?.mobileCanvasLoads === true
    && ui?.checks?.mobileGenerateLoads === true
    && ui?.checks?.noPageErrors === true
    && (ui?.consoleMessages || []).length === 0
    && (ui?.pageErrors || []).length === 0;
}

function nonbillingGenerationPassed() {
  const created = files.nonbillingCreate.json;
  const reference = files.nonbillingReference.json;
  const db = files.nonbillingDb.json;
  const ui = files.nonbillingUi.json;
  const jobId = created?.job?.id;
  const metadata = db?.image?.metadata || {};
  const handoff = metadata.referenceImageHandoff || {};
  const marker = nonbillingMarker(db);
  const routes = nonbillingUiRouteDetails(ui, { jobId, marker });
  return files.nonbillingCreate.exists
    && files.nonbillingReference.exists
    && files.nonbillingDb.exists
    && files.nonbillingUi.exists
    && Boolean(jobId)
    && Boolean(marker)
    && reference?.jobId === jobId
    && db?.job?.id === jobId
    && ui?.jobId === jobId
    && ui?.imageId === db?.image?.id
    && created?.baseUrl === 'https://heavy-chain.zeabur.app'
    && created?.job?.hasReferenceImage === true
    && created?.job?.hasReferenceImageHandoff === true
    && created?.job?.hasRawDataImageInInputParams === false
    && (created?.steps || []).some((step) => step.stage === 'after_submit'
      && step.generateResponse?.status === 202
      && String(step.generateResponse?.body || '').includes('"provider":"runway_mcp_local_worker"')
      && String(step.bodyExcerpt || '').includes('素材認識済み'))
    && reference?.downloadOk === true
    && reference?.signedUrlOk === true
    && reference?.bytes > 0
    && handoff.storagePath === reference?.storagePath
    && handoff.bytes === reference?.bytes
    && handoff.bytes > 0
    && metadata.hasReferenceImage === true
    && metadata.referenceImagePresent === true
    && metadata.localRunwayMcpWorker === true
    && metadata.provider === 'runway_mcp_local_worker'
    && metadata.noHostedBridge === true
    && metadata.sourceJobId === jobId
    && Array.isArray(metadata.materialReferences)
    && metadata.materialReferences.some((item) => item.hasImage === true && item.materialKind === '商品画像')
    && db?.job?.status === 'completed'
    && db?.job?.inputHasRawData === false
    && db?.image?.image_url_present === false
    && db?.storage?.downloadOk === true
    && db?.storage?.bytes > 0
    && ui?.ok === true
    && routes.jobs === true
    && routes.gallery === true
    && routes.history === true
    && routes.canvas === true
    && routes.mobileGenerate === true
    && routes.mobileJobs === true
    && routes.mobileGallery === true
    && routes.mobileCanvas === true
    && (ui?.consoleErrors || []).length === 0
    && (ui?.pageErrors || []).length === 0
    && (ui?.failedRequests || []).length === 0;
}

function nonbillingMarker(db) {
  const values = [
    db?.image?.metadata?.originalUserBrief,
    db?.image?.metadata?.prompt,
    db?.image?.metadata?.campaignTitle,
  ];
  const match = values.join('\n').match(/nonbilling-live-uat-\d+/i);
  return match ? match[0] : null;
}

function nonbillingUiRouteDetails(ui, expected = {}) {
  const routes = ui?.routes || [];
  const mobile = ui?.mobile || [];
  const hasExpectedProof = (text) => {
    const body = String(text || '');
    return Boolean((expected.jobId && body.includes(expected.jobId))
      || (expected.marker && body.includes(expected.marker)));
  };
  const routeCheck = (key, checkName, options = {}) => routes.some((route) => route.key === key
    && route.checks?.notLogin === true
    && route.checks?.noLoading === true
    && route.checks?.hasJobOrImage === true
    && (options.requireExpectedProof === false || hasExpectedProof(route.bodyExcerpt))
    && (checkName ? route.checks?.[checkName] === true : true));
  const mobileCheck = (key) => mobile.some((route) => route.key === key
    && route.checks?.notLogin === true
    && route.checks?.meaningful === true
    && hasExpectedProof(route.bodyExcerpt));
  return {
    jobs: routeCheck('05-jobs', 'jobsShowsCompleted'),
    gallery: routeCheck('06-gallery', 'detailButton'),
    history: routeCheck('07-history'),
    canvas: routeCheck('08-canvas', 'galleryPickerOpen', { requireExpectedProof: false }),
    mobileGenerate: mobile.some((route) => route.key === '09-mobile-generate'
      && route.checks?.notLogin === true
      && route.checks?.meaningful === true
      && /生成する/.test(String(route.bodyExcerpt || ''))),
    mobileJobs: mobileCheck('10-mobile-jobs'),
    mobileGallery: mobile.some((route) => route.key === '11-mobile-gallery'
      && route.checks?.notLogin === true
      && route.checks?.meaningful === true),
    mobileCanvas: mobile.some((route) => route.key === '12-mobile-canvas'
      && route.checks?.notLogin === true
      && route.checks?.meaningful === true),
  };
}

function workspaceMatrixPassed() {
  const workbench = files.generationWorkbench.json;
  const mass = files.massMarketQa.json;
  const expectedFeatures = [
    'campaign-image',
    'design-gacha',
    'product-shots',
    'model-matrix',
    'scene-coordinate',
    'colorize',
    'remove-bg',
    'upscale',
    'variations',
    'multilingual-banner',
  ];
  const features = (workbench?.generation || []).map((item) => item.featureId);
  return files.generationWorkbench.exists
    && files.massMarketQa.exists
    && workbench?.baseUrl === 'https://heavy-chain.zeabur.app'
    && expectedFeatures.every((feature) => features.includes(feature))
    && (workbench?.consoleMessages || []).length === 0
    && localWorkerContractRedactionPassed()
    && mass?.ok === true
    && (mass?.routes || []).some((route) => route.key === 'lightchain')
    && (mass?.routes || []).some((route) => route.key === 'canvas')
    && (mass?.routes || []).some((route) => route.key === 'jobs');
}

function workspaceMatrixDetails() {
  const workbench = files.generationWorkbench.json || {};
  const mass = files.massMarketQa.json || {};
  return {
    generationFeatureIds: (workbench.generation || []).map((item) => item.featureId),
    generationConsoleCount: (workbench.consoleMessages || []).length,
    redaction: localWorkerContractRedactionDetails(),
    massMarketRouteKeys: (mass.routes || []).map((route) => route.key),
    massMarketMobileCount: (mass.mobile || []).length,
  };
}

function approvedGenerationCleanupPassed() {
  const live = files.liveWorkerCleanup.json;
  const finalPolishSummary = files.finalPolishSummary.json;
  const finalPolishDb = files.finalPolishDb.json?.dbReadback;
  const finalPolish = files.finalPolishCleanup.json;
  const finalPolishCurrent = files.finalPolishCurrentCleanup.json;
  const nonbilling = files.nonbillingCleanup.json;
  const usage = files.nonbillingUsageCleanup.json;
  const finalPolishStoragePath = files.finalPolishDb.json?.job?.input_params?.referenceImageHandoff?.storagePath;
  return files.liveWorkerCleanup.exists
    && files.finalPolishDb.exists
    && files.finalPolishSummary.exists
    && files.finalPolishCleanup.exists
    && files.finalPolishCurrentCleanup.exists
    && files.nonbillingCleanup.exists
    && files.nonbillingUsageCleanup.exists
    && live?.checks?.allActionsOk === true
    && live?.checks?.jobDeleted === true
    && live?.checks?.imageDeleted === true
    && live?.checks?.usageDeleted === true
    && live?.checks?.storageDeleted === true
    && Boolean(finalPolishStoragePath)
    && finalPolish?.storagePath === finalPolishStoragePath
    && finalPolishSummary?.jobId === files.finalPolishDb.json?.job?.id
    && finalPolishDb?.jobId === files.finalPolishDb.json?.job?.id
    && finalPolishSummary?.cleanup?.attempted === true
    && finalPolishSummary?.cleanup?.jobDeleted === true
    && finalPolishSummary?.cleanup?.usageDeleted === true
    && finalPolishSummary?.cleanup?.storageRemoved === true
    && finalPolishSummary?.cleanup?.finalStorageDeleted === true
    && finalPolishSummary?.cleanup?.storageVerifiedByListAndDownload?.storagePath === finalPolishStoragePath
    && finalPolishSummary?.cleanup?.storageVerifiedByListAndDownload?.existsAfter === false
    && finalPolishSummary?.cleanup?.storageVerifiedByListAndDownload?.downloadAfterDelete?.exists === false
    && finalPolish?.existsBefore === false
    && finalPolish?.existsAfter === false
    && finalPolish?.downloadAfterDelete?.exists === false
    && finalPolish?.remove2Error === null
    && finalPolishCurrent?.jobId === files.finalPolishDb.json?.job?.id
    && finalPolishCurrent?.summaryJobId === files.finalPolishDb.json?.job?.id
    && finalPolishCurrent?.dbReadbackJobId === files.finalPolishDb.json?.job?.id
    && finalPolishCurrent?.storagePath === finalPolishStoragePath
    && finalPolishCurrent?.checks?.sameJob === true
    && finalPolishCurrent?.checks?.jobAbsent === true
    && finalPolishCurrent?.checks?.imageAbsent === true
    && finalPolishCurrent?.checks?.usageAbsent === true
    && finalPolishCurrent?.checks?.storageDownloadAbsent === true
    && finalPolishCurrent?.checks?.storageListAbsent === true
    && nonbilling?.attempted === true
    && nonbilling?.postJob?.data === null
    && nonbilling?.postImage?.data === null
    && nonbilling?.generatedDownload?.exists === false
    && nonbilling?.handoffDownload?.exists === false
    && usage?.after?.exists === false;
}

function approvedGenerationCleanupDetails() {
  return {
    liveWorkerCleanup: files.liveWorkerCleanup.json?.checks,
    finalPolishSummaryCleanup: files.finalPolishSummary.json?.cleanup,
    finalPolishDbStoragePath: files.finalPolishDb.json?.job?.input_params?.referenceImageHandoff?.storagePath,
    finalPolishCleanup: {
      storagePath: files.finalPolishCleanup.json?.storagePath,
      existsBefore: files.finalPolishCleanup.json?.existsBefore,
      existsAfter: files.finalPolishCleanup.json?.existsAfter,
      downloadAfterDelete: files.finalPolishCleanup.json?.downloadAfterDelete,
      remove2Error: files.finalPolishCleanup.json?.remove2Error,
    },
    finalPolishCurrentCleanup: files.finalPolishCurrentCleanup.json?.checks,
    nonbillingCleanup: {
      attempted: files.nonbillingCleanup.json?.attempted,
      generatedDownload: files.nonbillingCleanup.json?.generatedDownload,
      handoffDownload: files.nonbillingCleanup.json?.handoffDownload,
      postJob: files.nonbillingCleanup.json?.postJob,
      postImage: files.nonbillingCleanup.json?.postImage,
    },
    usageCleanup: files.nonbillingUsageCleanup.json,
  };
}

function bridgeToolsPassed() {
  if (!files.bridgeProof.exists) return false;
  return files.bridgeProof.json?.ok === true
    && (files.bridgeProof.json?.checks || []).some((check) => check.name === 'health' && check.ok === true)
    && (files.bridgeProof.json?.checks || []).some((check) => check.name === 'tools' && check.ok === true && check.tool_count > 0);
}

function bridgeToolsDetails() {
  if (!files.bridgeProof.exists) return { exists: false, error: files.bridgeProof.error };
  const checks = files.bridgeProof.json?.checks || [];
  return {
    ok: files.bridgeProof.json?.ok === true,
    bridge_url_host: files.bridgeProof.json?.bridge_url_host,
    health: checks.find((check) => check.name === 'health') || null,
    tools: checks.find((check) => check.name === 'tools') || null,
    blockers: files.bridgeProof.json?.blockers || [],
  };
}

function checkPassed(proof, checkName) {
  return Boolean((proof?.checks || []).find((check) => check.name === checkName && check.passed === true));
}

function checkDetails(proof, checkName) {
  return (proof?.checks || []).find((check) => check.name === checkName)?.details ?? {};
}

function denialPassed(proof, options = {}) {
  if (!proof?.passed) return false;
  if ((proof.blockers || []).length) return false;
  if (!(proof.checks || []).every((check) => check.passed === true)) return false;
  if (options.cleanupRequired && proof.cleanup?.passed !== true) return false;
  const sideEffectCheck = (proof.checks || []).find((check) => check.name.includes('no usage/job/image'));
  if (!sideEffectCheck?.passed) return false;
  if (options.storageRequired && sideEffectCheck.details?.storageByPromptMarker !== 0) return false;
  return true;
}

function sideEffectDetails(proof) {
  return (proof?.checks || []).find((check) => check.name.includes('no usage/job/image'))?.details ?? {};
}

function cleanupDetails(proof) {
  return {
    side_effects: sideEffectDetails(proof),
    cleanup: proof?.cleanup ?? {},
  };
}

function blockerDetails(code) {
  const blocker = readinessBlockers.find((candidate) => candidate.code === code)
    || approvedBlockers.find((candidate) => candidate.code === code);
  return blocker ?? null;
}

function countStatuses(items) {
  return items.reduce((acc, item) => {
    acc[item.status] = (acc[item.status] || 0) + 1;
    return acc;
  }, {
    passed: 0,
    failed: 0,
    blocked_external: 0,
    pending_after_blocker: 0,
  });
}

function latestProofPath({ fileName, checker }) {
  const candidates = findFiles('output/playwright', fileName)
    .map((filePath) => {
      const proof = readJson(filePath).json;
      if (proof?.checker !== checker) return null;
      const capturedAt = Date.parse(proof.captured_at || '');
      return {
        filePath,
        capturedAt: Number.isFinite(capturedAt) ? capturedAt : 0,
        mtimeMs: fileMtimeMs(filePath),
      };
    })
    .filter(Boolean)
    .sort((a, b) => (b.capturedAt - a.capturedAt) || (b.mtimeMs - a.mtimeMs));
  return candidates[0]?.filePath || null;
}

function latestSummaryPath({ directoryPattern, predicate }) {
  const candidates = findFiles('output/playwright', 'summary.json')
    .filter((filePath) => directoryPattern.test(filePath))
    .map((filePath) => {
      const summary = readJson(filePath).json;
      if (!predicate(summary)) return null;
      const capturedAt = summaryTimestamp(summary);
      return {
        filePath,
        capturedAt,
        mtimeMs: fileMtimeMs(filePath),
      };
    })
    .filter(Boolean)
    .sort((a, b) => (b.capturedAt - a.capturedAt) || (b.mtimeMs - a.mtimeMs));
  return candidates[0]?.filePath || null;
}

function summaryTimestamp(summary) {
  const candidates = [
    summary?.finishedAt,
    summary?.generatedAt,
    summary?.startedAt,
    summary?.captured_at,
  ];
  for (const value of candidates) {
    const parsed = Date.parse(value || '');
    if (Number.isFinite(parsed)) return parsed;
  }
  return 0;
}

function isLoopbackUrl(value) {
  try {
    const url = new URL(String(value || ''));
    return ['127.0.0.1', 'localhost', '[::1]', '::1'].includes(url.hostname);
  } catch {
    return false;
  }
}

function findFiles(root, fileName) {
  if (!fs.existsSync(root)) return [];
  const results = [];
  const stack = [root];
  while (stack.length) {
    const current = stack.pop();
    let entries = [];
    try {
      entries = fs.readdirSync(current, { withFileTypes: true });
    } catch {
      continue;
    }
    for (const entry of entries) {
      const entryPath = path.join(current, entry.name);
      if (entry.isDirectory()) {
        stack.push(entryPath);
      } else if (entry.isFile() && entry.name === fileName) {
        results.push(entryPath);
      }
    }
  }
  return results;
}

function fileMtimeMs(filePath) {
  try {
    return fs.statSync(filePath).mtimeMs;
  } catch {
    return 0;
  }
}

function stateField(text, fieldName) {
  const prefix = `${fieldName}:`;
  const line = text.split(/\r?\n/).find((candidate) => candidate.startsWith(prefix));
  return line ? line.slice(prefix.length).trim() : '';
}
