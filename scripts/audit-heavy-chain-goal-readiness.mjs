import fs from 'node:fs';
import path from 'node:path';

const args = parseArgs(process.argv.slice(2));
const outPath = args.out || 'output/playwright/heavy-chain-goal-readiness-20260623/audit.json';

const paths = {
  state: 'STATE.md',
  ui: 'output/playwright/lightchain-production-ui-20260623/summary.json',
  navigation: 'output/playwright/lightchain-production-navigation-20260623/summary.json',
  approvedProof: 'output/playwright/runway-approved-generation-readback-20260623/proof.json',
  readiness: 'output/playwright/runway-approved-generation-readback-20260623/readiness.json',
  freeDenial: 'output/playwright/runway-free-plan-denial-20260623/denial.json',
  unapprovedDenial: 'output/playwright/runway-unapproved-denial-20260623/denial.json',
  expiredDenial: 'output/playwright/runway-expired-subscription-denial-20260623/denial.json',
};

const files = Object.fromEntries(
  Object.entries(paths).map(([key, filePath]) => [key, readJson(filePath)])
);
const stateText = readText(paths.state);
const readinessBlockers = Array.isArray(files.readiness.json?.blockers) ? files.readiness.json.blockers : [];
const approvedBlockers = Array.isArray(files.approvedProof.json?.blockers) ? files.approvedProof.json.blockers : [];
const blockerCodes = new Set([...readinessBlockers, ...approvedBlockers].map((blocker) => blocker.code));

const requirements = [
  requirement({
    id: 'logged_in_production_ui',
    title: 'Logged-in production UI proves Lightchain-style surfaces',
    status: uiPassed() ? 'passed' : 'failed',
    evidence: [paths.ui],
    details: {
      resultCount: files.ui.json?.resultCount,
      failureCount: files.ui.json?.failureCount,
    },
    next_action: 'Rerun npm run verify:lightchain-ui with a fresh logged-in production auth state.',
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
    id: 'runway_site_approval',
    title: 'Target NiSEN brand is Runway MCP site-approved',
    status: checkPassed(files.readiness.json, 'Runway MCP site approval') ? 'passed' : 'failed',
    evidence: [paths.readiness],
    details: checkDetails(files.readiness.json, 'Runway MCP site approval'),
    next_action: 'Request connection from /brand/settings and approve the brand from /admin?tab=runway.',
  }),
  requirement({
    id: 'free_plan_denial',
    title: 'Approved Free-plan brand is denied before generation with no side effects',
    status: denialPassed(files.freeDenial.json, { cleanupRequired: false, storageRequired: true }) ? 'passed' : 'failed',
    evidence: [paths.freeDenial],
    details: sideEffectDetails(files.freeDenial.json),
    next_action: 'Rerun npm run verify:runway-free-denial and inspect side_effect_readback.',
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
    id: 'expired_subscription_denial',
    title: 'Approved expired-subscription brand is denied and fully cleaned up',
    status: denialPassed(files.expiredDenial.json, { cleanupRequired: true }) ? 'passed' : 'failed',
    evidence: [paths.expiredDenial],
    details: cleanupDetails(files.expiredDenial.json),
    next_action: 'Rerun npm run verify:runway-expired-denial and inspect cleanup residuals.',
  }),
  requirement({
    id: 'runway_bridge_secrets',
    title: 'Production Runway MCP bridge secrets are configured',
    status: blockerCodes.has('production_runway_mcp_bridge_pending') ? 'blocked_external' : 'passed',
    evidence: [paths.readiness, paths.approvedProof],
    details: blockerDetails('production_runway_mcp_bridge_pending'),
    next_action: 'Set RUNWAY_MCP_BRIDGE_URL and RUNWAY_MCP_BRIDGE_TOKEN to a bridge connected to official Runway MCP, then rerun npm run verify:runway-readiness.',
  }),
  requirement({
    id: 'paid_subscription',
    title: 'Target brand has an active Runway-eligible paid Heavy Chain subscription',
    status: blockerCodes.has('heavy_chain_paid_subscription_pending') ? 'blocked_external' : 'passed',
    evidence: [paths.readiness, paths.approvedProof],
    details: blockerDetails('heavy_chain_paid_subscription_pending'),
    next_action: 'Complete the billing/subscription decision without bypassing payment rules, then rerun npm run verify:runway-readiness.',
  }),
  requirement({
    id: 'approved_live_generation_readback',
    title: 'Approved brand production generation has DB/Storage/UI readback',
    status: files.approvedProof.json?.generation_attempted === true && files.approvedProof.json?.passed === true
      ? 'passed'
      : 'pending_after_blocker',
    evidence: [paths.approvedProof],
    details: {
      generation_attempted: files.approvedProof.json?.generation_attempted,
      blockers: approvedBlockers.map((blocker) => blocker.code),
    },
    next_action: 'After readiness passes, run strict npm run verify:runway-approved-generation and logged-in UI readback.',
  }),
  requirement({
    id: 'workspace_readback_expected_task_codes',
    title: 'Workspace readback covers expected Lightchain task codes',
    status: 'pending_after_blocker',
    evidence: [paths.state],
    details: {
      expected_task_codes: [
        'PatternToVector',
        'LineArtVectorConvert',
        'OneClickIntegration',
        'DirectionalIntegration',
        'FashionStudio',
        'Video Workstation',
        'ChangeDetail',
        'ClothingOrientationDesign',
      ],
    },
    next_action: 'After approved live generation, run npm run verify:workspace-readback with the expected task codes.',
  }),
  requirement({
    id: 'approved_generation_cleanup',
    title: 'Approved-generation disposable proof artifacts are marker-scoped and cleaned up',
    status: 'pending_after_blocker',
    evidence: [paths.approvedProof],
    details: {
      reason: 'Strict approved generation has not run because readiness is false.',
    },
    next_action: 'After strict approved generation and readback, perform marker-scoped cleanup and record zero residual rows/processes.',
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
  state_mentions_goal_blocker: stateText.includes('production_runway_mcp_bridge_pending')
    && stateText.includes('heavy_chain_paid_subscription_pending'),
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
  const parsed = { allowIncomplete: false, out: null };
  for (let index = 0; index < rawArgs.length; index += 1) {
    const arg = rawArgs[index];
    const next = rawArgs[index + 1];
    if (arg === '--allow-incomplete') parsed.allowIncomplete = true;
    if (arg === '--out' && next) {
      parsed.out = next;
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

function uiPassed() {
  return files.ui.exists && files.ui.json?.resultCount >= 30 && files.ui.json?.failureCount === 0;
}

function navigationPassed() {
  return files.navigation.exists
    && files.navigation.json?.resultCount >= 12
    && files.navigation.json?.failureCount === 0
    && (files.navigation.json?.results || []).every((result) => result.passed === true
      && result.consoleErrorCount === 0
      && result.pageErrorCount === 0);
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
  const blocker = [...readinessBlockers, ...approvedBlockers].find((candidate) => candidate.code === code);
  return blocker ?? {};
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
