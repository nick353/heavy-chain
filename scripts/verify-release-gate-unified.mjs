#!/usr/bin/env node

import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { verifyScaleOpsEvidence } from './cloudflare-scale-ops-evidence.mjs';

const args = parseArgs(process.argv.slice(2));
const capturedAt = new Date();
const outPath = args.out || 'output/playwright/10m-product-readiness-g615/release-gate-summary.json';
const allowDirty = Boolean(args.allowDirty || args['allow-dirty']);
const skipCommands = Boolean(args.skipCommands || args['skip-commands']);
const maxArtifactAgeHours = Number(args.maxArtifactAgeHours || args['max-artifact-age-hours'] || 48);
const defaultCommandTimeoutMs = Number(args.commandTimeoutMs || args['command-timeout-ms'] || 10 * 60 * 1000);
const PRODUCTION_ORIGIN = 'https://heavy-chain-web.nichika2000823.workers.dev';
const PRODUCTION_API_ORIGIN = 'https://heavy-chain-api.nichika2000823.workers.dev';
const CURRENT_UI_PAGE_NAMES = Object.freeze(['dashboard', 'generate', 'fitting', 'marketing', 'studio', 'models', 'patterns', 'video', 'lab', 'gallery', 'history', 'jobs', 'canvas', 'brand-settings']);
const CURRENT_UI_VIEWPORT_NAMES = Object.freeze(['desktop', 'mobile']);
const LIGHTCHAIN_VIDEO_ROW_IDS = new Set(['video-workstation', 'video-detail']);
const LIGHTCHAIN_VIDEO_ROUTE_RESULT_IDS = Object.freeze([
  'desktop-video-dashboard',
  'desktop-video-detail',
  'mobile-video-dashboard',
  'mobile-video-detail',
]);
const currentLightchainManifest = readCurrentLightchainManifest();
let report;

const REQUIRED_G608_REQUIREMENT_IDS = [
  'logged_in_production_ui',
  'local_production_build_full_ui',
  'logged_in_navigation',
  'approved_live_generation_readback',
  'workspace_readback_expected_task_codes',
  'approved_generation_cleanup',
];

const requiredReadbacks = [
  {
    name: 'Companion authenticated production UI evidence',
    path: 'work/heavy-chain-companion-authenticated-evidence-20260921.json',
    validate: validateCompanionAuthenticatedEvidence,
    expect: 'fresh Companion same-session production evidence for /model, /gallery, /history, /jobs, and /canvas/new with semantic+visual readback and no exported auth secret',
  },
  {
    name: 'production monitor and UI pair',
    pair: {
      monitor: 'output/playwright/g835-production-monitor-current-r1/summary.json',
      ui: 'output/playwright/g835-production-ui-current-r1/summary.json',
    },
    validate: validateProductionMonitorReleasePair,
    expect: 'API-only production-monitor.v2 plus fresh authenticated production UI v2, exact origin, zero failures, cleanup, and matching nonempty runId',
  },
  {
    name: 'launch operations',
    path: 'output/playwright/g830-launch-ops-production-current-r2/summary.json',
    validate: (json) => json.ok === true && arrayFrom(json.failed).length === 0,
    expect: 'ok=true and failed=[]',
  },
  {
    name: 'production mass-market QA current',
    path: 'output/playwright/g831-prod-mass-market-current-r1/SUMMARY.json',
    validate: (json) =>
      json.ok === true &&
      arrayFrom(json.failed).length === 0 &&
      Number(json.routeCount || 0) >= 16 &&
      arrayFrom(json.routes).length >= 16 &&
      arrayFrom(json.mobile).length >= 8 &&
      json.cleanup?.contextClosed === true &&
      json.cleanup?.browserClosed === true &&
      arrayFrom(json.consoleMessages).length === 0 &&
      arrayFrom(json.pageErrors).length === 0 &&
      arrayFrom(json.requestFailures).length === 0 &&
      hasRouteAssertion(json, 'gallery', 'meaningful_page_content') &&
      hasRouteAssertion(json, 'mobile-gallery', 'meaningful_page_content') &&
      hasRouteAssertion(json, 'gallery', 'gallery_no_scary_remote_failure_toast') &&
      hasRouteAssertion(json, 'mobile-gallery', 'gallery_no_scary_remote_failure_toast') &&
      hasRouteAssertion(json, 'generate-campaign', 'lightchain_permission_surface_visible') &&
      hasRouteAssertion(json, 'mobile-generate-campaign', 'lightchain_permission_surface_visible') &&
      routeAssertionDetailsIncludes(json, 'generate-campaign', 'upload_first_generation_screen_hides_advanced_controls', 'で生成') &&
      routeAssertionDetailsIncludes(json, 'mobile-generate-campaign', 'upload_first_generation_screen_hides_advanced_controls', 'で生成') &&
      hasRouteAssertion(json, 'mobile-lightchain', 'mobile_no_intrusive_floating_help_buttons') &&
      hasRouteAssertion(json, 'mobile-generate-campaign', 'mobile_no_intrusive_floating_help_buttons') &&
      hasRouteAssertion(json, 'mobile-generate-campaign', 'mobile_generate_hides_canvas_toolbar') &&
      hasRouteAssertion(json, 'mobile-generate-campaign', 'mobile_generate_starts_at_material_form') &&
      hasRouteAssertion(json, 'dashboard', 'dashboard_recent_images_no_broken_placeholders') &&
      hasRouteAssertion(json, 'mobile-dashboard', 'mobile_dashboard_old_quick_start_hidden_by_design') &&
      hasRouteAssertion(json, 'mobile-dashboard', 'mobile_dashboard_hides_duplicate_quick_action_cards') &&
      hasRouteAssertion(json, 'mobile-dashboard', 'mobile_dashboard_lightchain_has_all_tools_link') &&
      hasRouteAssertion(json, 'mobile-dashboard', 'mobile_dashboard_lightchain_cards_open_detail_routes') &&
      hasRouteAssertion(json, 'mobile-dashboard', 'mobile_dashboard_activity_uses_compact_summary') &&
      hasRouteAssertion(json, 'mobile-dashboard', 'mobile_dashboard_next_action_hidden_by_design') &&
      hasRouteAssertion(json, 'mobile-dashboard', 'mobile_dashboard_hides_low_priority_desktop_panels') &&
      hasRouteAssertion(json, 'brand-settings', 'brand_settings_hides_removed_readiness_blocks') &&
      hasRouteAssertion(json, 'marketing', 'marketing_workspace_has_clear_generation_flow') &&
      hasRouteAssertion(json, 'marketing', 'marketing_preview_has_brief_context') &&
      hasRouteAssertion(json, 'fitting', 'fitting_workspace_has_clear_generation_flow') &&
      hasRouteAssertion(json, 'fitting', 'fitting_preview_has_model_matrix_context_when_visible') &&
      hasRouteAssertion(json, 'models', 'model_library_has_clear_generation_flow') &&
      hasRouteAssertion(json, 'patterns', 'pattern_workspace_has_clear_generation_flow') &&
      hasRouteAssertion(json, 'patterns', 'pattern_preview_uses_garment_mockup_context') &&
      hasRouteAssertion(json, 'video', 'video_workspace_has_clear_generation_flow') &&
      hasRouteAssertion(json, 'video', 'video_storyboard_preview_has_shot_context') &&
      hasRouteAssertion(json, 'video', 'video_shot_cards_are_meaningful') &&
      hasRouteAssertion(json, 'studio', 'studio_workspace_has_clear_generation_flow') &&
      hasRouteAssertion(json, 'studio', 'studio_preview_has_composition_context') &&
      hasRouteAssertion(json, 'lab', 'lab_workspace_has_clear_generation_flow') &&
      hasRouteAssertion(json, 'lab', 'lab_preview_has_evaluation_context') &&
      hasRouteAssertion(json, 'history', 'history_has_reuse_action_panel') &&
      hasRouteAssertion(json, 'history', 'desktop_history_timeline_is_bounded') &&
      hasRouteAssertion(json, 'mobile-history', 'history_has_reuse_action_panel') &&
      hasRouteAssertion(json, 'mobile-history', 'mobile_history_timeline_is_bounded') &&
      hasRouteAssertion(json, 'mobile-lightchain', 'mobile_lightchain_category_entry_is_compact') &&
      hasRouteAssertion(json, 'mobile-lightchain', 'mobile_lightchain_category_cards_open_real_feature_routes') &&
      hasRouteAssertion(json, 'mobile-jobs', 'mobile_jobs_initial_list_is_bounded') &&
      hasRouteAssertion(json, 'mobile-canvas', 'mobile_canvas_content_fits_initial_view'),
    expect: 'current production mass-market QA ok=true with 16 desktop routes, 9 mobile routes including mobile History, Gallery fallback visible without scary remote-failure toast, H601-ready generation route, Dashboard recent images without broken placeholders, Brand Settings removed readiness blocks hidden, clear Marketing generation flow with brief-context preview, clear Fitting generation flow with model-matrix context when preview is visible, clear Model Library generation flow, clear Pattern Workspace generation flow with garment mockup preview context, clear Video Workspace generation flow with storyboard context and meaningful shot cards, clear Studio generation flow with composition-context preview, clear Lab generation flow with evaluation-context preview, History reuse panel, bounded desktop and mobile History timelines, no intrusive mobile floating help buttons, mobile Dashboard old quick start and next action hidden by design, no duplicate quick-action cards, compact mobile Dashboard Lightchain hub with all-tools link and direct detail-route cards, compact mobile activity summary, hidden low-priority desktop panels on mobile, mobile Generate starts at material form with canvas toolbar hidden, compact mobile Lightchain category entry with real feature links, bounded mobile Jobs list, mobile Canvas content fit on open, no console/page/request failures, and cleanup closed',
  },
  {
    name: 'production Lightchain all-feature order previews',
    latestSummaryPrefix: 'g831-prod-lightchain-all-features-current-',
    validate: (json) => validateLightchainProductionReadback(json, currentLightchainManifest),
    expect: `current-manifest production Lightchain workflow ok=true for ${currentLightchainManifest.length} features, either as exact feature rows or 31 non-video rows plus four unique video route readbacks, with passing desktop/mobile assertions, no console/page/request failures, and cleanup closed`,
  },
  {
    name: 'G610 retention workspace search',
    path: 'output/playwright/g610-retention-project-search-current-20260910-r3/SUMMARY.json',
    validate: (json) =>
      json.ok === true &&
      arrayFrom(json.failed).length === 0 &&
      arrayFrom(json.assertions).length >= 10 &&
      json.cleanup?.contextClosed === true &&
      json.cleanup?.browserClosed === true &&
      json.cleanup?.previewProcessExit?.exited === true &&
      json.cleanup?.previewProcessExit?.portFree === true,
    expect: 'latest G610 summary ok=true, failed=[], >=10 assertions, browser/context closed, preview process exited and port free',
  },
  {
    name: 'G603 garment Canvas',
    path: 'output/playwright/g603-garment-layer-canvas-20260909T224537Z/SUMMARY.json',
    validate: (json) => json.ok === true && arrayFrom(json.failed).length === 0,
    expect: 'ok=true and failed=[]',
  },
  {
    name: 'G605 onboarding templates',
    path: 'output/playwright/g605-onboarding-templates-20260909T225306Z/SUMMARY.json',
    validate: (json) =>
      json.ok === true &&
      arrayFrom(json.failed).length === 0 &&
      json.cleanup?.previewProcessExit?.exited === true &&
      json.cleanup?.previewProcessExit?.portFree === true,
    expect: 'ok=true, failed=[], preview process exited, port free',
  },
  {
    name: 'G606 performance scale',
    path: 'output/playwright/g830-g606-performance-current-r1/summary.json',
    validate: (json) =>
      json.ok === true &&
      arrayFrom(json.issues).length === 0 &&
      Number(json.galleryStress?.renderedTilesInitial || 0) >= 60 &&
      Number(json.canvasStress?.persistedObjects || 0) >= 180 &&
      json.cleanup?.previewProcessCleanup?.groupAliveAfter === false,
    expect: 'ok=true with Gallery >=60 initial tiles and Canvas >=180 objects',
  },
  {
    name: 'G608 security audit',
    path: 'output/playwright/g831-g608-goal-readiness-current-r1/audit-readiness.json',
    validate: (json) => {
      const requirements = arrayFrom(json.requirements);
      const requirementIds = requirements.map((requirement) => requirement?.id).filter(Boolean);
      const uniqueRequirementIds = new Set(requirementIds);
      const expectedRequirementIds = new Set(REQUIRED_G608_REQUIREMENT_IDS);
      return (
        arrayFrom(json.blockers).length === 0 &&
        requirements.length === REQUIRED_G608_REQUIREMENT_IDS.length &&
        uniqueRequirementIds.size === requirements.length &&
        REQUIRED_G608_REQUIREMENT_IDS.every((id) => uniqueRequirementIds.has(id)) &&
        requirementIds.every((id) => expectedRequirementIds.has(id)) &&
        requirements.every((requirement) => requirement?.status === 'passed') &&
        Number(json.summary?.total || 0) === requirements.length &&
        Number(json.summary?.passed || 0) === requirements.length &&
        Number(json.summary?.failed || 0) === 0 &&
        Number(json.summary?.blocked_external || 0) === 0 &&
        Number(json.summary?.pending_after_blocker || 0) === 0 &&
        (json.complete === true || json.ok === true || json.passed === true)
      );
    },
    expect: 'complete/ok/passed with blockers=[], expected requirement IDs exactly once, all requirements passed, and summary counts matching requirements',
  },
  {
    name: 'G618 scale ops baseline',
    path: 'output/playwright/10m-product-readiness-g618/summary.json',
    validate: validateG618ScaleOps,
    expect: 'ok=true, blockers=[], v2 schema, explicit monitor expectations, commands/checks passed, imageCount>=1200, canvasObjectCount>=600, nested performance and production-monitor v2 evidence valid, and no unresolved warnings',
  },
  {
    name: 'G620 security operations',
    path: 'output/playwright/g764-g620-security-ops-r1/summary.json',
    validate: validateG620SecurityOps,
    expect: 'ok=true, current v3 static Cloudflare security schema, no retired-provider references, all required checks passed, and no irreversible actions touched',
  },
  {
    name: 'G632 incident response drill',
    path: 'output/playwright/g632-incident-response-drill/summary.json',
    validate: (json) =>
      json.ok === true &&
      json.schema === 'heavy-chain.g632.incident-response-drill.v1' &&
      arrayFrom(json.blockers).length === 0 &&
      Number(json.summary?.scenarios || 0) >= 5 &&
      Number(json.summary?.passedScenarios || 0) === Number(json.summary?.scenarios || 0) &&
      Object.values(json.irreversibleActions || {}).every((value) =>
        ['not_clicked', 'not_touched', 'not_run'].includes(value),
      ),
    expect: 'ok=true, blockers=[], >=5 incident scenarios passed, and no irreversible actions touched',
  },
  {
    name: 'G633 scale and alerting plan',
    path: 'output/playwright/g633-scale-alerting-plan/summary.json',
    validate: (json) =>
      json.ok === true &&
      json.schema === 'heavy-chain.g633.scale-alerting-plan.v1' &&
      arrayFrom(json.blockers).length === 0 &&
      Number(json.summary?.checks || 0) >= 35 &&
      Object.values(json.irreversibleActions || {}).every((value) =>
        ['not_clicked', 'not_touched', 'not_run'].includes(value),
      ),
    expect: 'ok=true, blockers=[], scale/load/alerting approval plan checked, and no irreversible actions touched',
  },
  {
    name: 'production H601 rights readback',
    path: 'output/playwright/g831-prod-h601-rights-check-r1/summary.json',
    validate: (json) =>
      json.ok === true &&
      hasPassingAssertion(json, 'generate_route_loaded') &&
      hasPassingAssertion(json, 'h601_permission_surface_visible') &&
      hasPassingAssertion(json, 'rights_checkbox_absent'),
    expect: 'production authenticated /generate exposes the Light permission surface and no rights checkbox',
  },
  {
    name: 'production chosen public entrypoint readback',
    path: 'output/playwright/g835-chosen-public-entrypoint-readback-r1/summary.json',
    validate: (json) =>
      json.ok === true &&
      json.urls?.chosenPublicEntrypoint === 'https://heavy-chain-web.nichika2000823.workers.dev' &&
      json.findings?.chosenPublicEntrypoint?.reachable === true &&
      Number(json.findings?.chosenPublicEntrypoint?.status || 0) >= 200 &&
      Number(json.findings?.chosenPublicEntrypoint?.status || 0) < 300 &&
      json.findings?.chosenPublicEntrypoint?.hasHeavyChainShell === true &&
      json.safetyBoundaries?.generationSubmit === 'not_clicked' &&
      json.safetyBoundaries?.billingCheckoutPayment === 'not_touched' &&
      json.safetyBoundaries?.externalPublish === 'not_touched',
    expect: 'chosen public entrypoint https://heavy-chain-web.nichika2000823.workers.dev is reachable without submit/payment/publish actions',
  },
  {
    name: 'production H602 billing completion readback',
    path: 'output/playwright/g774-h602-production-completion-current-r1/summary.json',
    validate: (json) =>
      json.ok === true &&
      json.migration?.applied === true &&
      json.purchaseProofMigration?.applied === true &&
      json.purchaseProofHardeningMigration?.applied === true &&
      json.purchaseProofHashOnlyMigration?.applied === true &&
      json.purchaseProofArtifactAllowlistMigration?.applied === true &&
      json.billingSettings?.generationQuotaEnforced === true &&
      json.billingSettings?.productionCheckoutEnabled === false &&
      json.securityReadback?.purchaseProofMetadataRawReceiptLikeBlocked === true &&
      json.securityReadback?.purchaseProofMetadataBareReceiptPayloadBlocked === true &&
      json.securityReadback?.purchaseProofHashFieldsSha256HexOnly === true &&
      json.securityReadback?.purchaseProofMetadataKeysAllowlisted === true &&
      json.securityReadback?.purchaseProofArtifactUriSafeLocatorOnly === true &&
      json.securityReadback?.purchaseProofSummaryRpcScope === 'brand_scoped_only; no user/email cross-brand aggregation' &&
      json.sandboxTester?.registered === true &&
      json.sandboxTester?.emailRedacted === true &&
      Number(json.purchaseProofReadback?.verifiedNoRealChargeProofCount || 0) > 0 &&
      json.purchaseProofReadback?.transactionOrEntitlementReadback === true &&
      arrayFrom(json.remainingBlockers).length === 0,
    expect: 'production H602 readback ok=true with quota enforcement, purchase-proof hardening/hash-only/artifact-allowlist migrations applied, raw receipt/payload storage blocked, checkout disabled until operator release, redacted sandbox tester, verified no-real-charge proof >0, transaction/entitlement readback=true, and no remaining blockers',
  },
];

const commandChecks = [
  {
    name: 'node syntax: release gate',
    command: 'node',
    args: ['--check', 'scripts/verify-release-gate-unified.mjs'],
  },
  {
    name: 'node syntax: release doctor',
    command: 'node',
    args: ['--check', 'scripts/release-doctor.mjs'],
  },
  {
    name: 'node syntax: production monitor',
    command: 'node',
    args: ['--check', 'scripts/monitor-production-health.mjs'],
  },
  {
    name: 'node syntax: launch ops',
    command: 'node',
    args: ['--check', 'scripts/verify-launch-operations-readiness.mjs'],
  },
  {
    name: 'node syntax: mass-market QA',
    command: 'node',
    args: ['--check', 'scripts/verify-mass-market-qa.mjs'],
  },
  {
    name: 'node syntax: G614 operations verifier',
    command: 'node',
    args: ['--check', 'scripts/verify-g614-operations-docs.mjs'],
  },
  {
    name: 'node syntax: G618 scale ops verifier',
    command: 'node',
    args: ['--check', 'scripts/verify-g618-scale-ops-baseline.mjs'],
  },
  {
    name: 'node syntax: G620 security ops verifier',
    command: 'node',
    args: ['--check', 'scripts/verify-g620-security-ops.mjs'],
  },
  {
    name: 'node syntax: G632 incident response verifier',
    command: 'node',
    args: ['--check', 'scripts/verify-g632-incident-response-drill.mjs'],
  },
  {
    name: 'node syntax: G633 scale alerting verifier',
    command: 'node',
    args: ['--check', 'scripts/verify-g633-scale-alerting-plan.mjs'],
  },
  {
    name: 'node syntax: H601 legal safety verifier',
    command: 'node',
    args: ['--check', 'scripts/verify-h601-legal-safety-guard.mjs'],
  },
  {
    name: 'node syntax: H602 billing verifier',
    command: 'node',
    args: ['--check', 'scripts/verify-h602-cloudflare-billing-readiness.mjs'],
  },
  {
    name: 'security audit',
    command: 'npm',
    args: ['run', 'security:audit', '--silent'],
  },
  {
    name: 'generation scorecard',
    command: 'npm',
    args: ['run', 'verify:generation-scorecard', '--silent'],
  },
  {
    name: 'G614 operations docs',
    command: 'npm',
    args: ['run', 'verify:g614-ops', '--silent'],
  },
  {
    name: 'G632 incident response drill',
    command: 'npm',
    args: ['run', 'verify:g632-incident-response', '--silent'],
  },
  {
    name: 'G633 scale and alerting plan',
    command: 'npm',
    args: ['run', 'verify:g633-scale-alerting-plan', '--silent'],
  },
  {
    name: 'H601 legal safety guard',
    command: 'npm',
    args: ['run', 'verify:h601-legal-safety', '--silent'],
  },
  {
    name: 'H602 billing readiness',
    command: 'npm',
    args: ['run', 'verify:h602-billing', '--silent'],
  },
  {
    name: 'typecheck',
    command: 'npm',
    args: ['run', 'typecheck', '--silent'],
  },
  {
    name: 'build',
    command: 'npm',
    args: ['run', 'build', '--silent'],
  },
  {
    name: 'lint',
    command: 'npm',
    args: ['run', 'lint', '--silent', '--', '--max-warnings=0'],
  },
  {
    name: 'git diff check',
    command: 'git',
    args: ['diff', '--check'],
  },
];

function runReleaseGate() {
report = {
  schema: 'heavy-chain.release-gate-unified.v1',
  capturedAt: capturedAt.toISOString(),
  mode: skipCommands
    ? 'readback-only-dry-run-no-submit-no-payment-no-cleanup'
    : 'readback-plus-local-static-checks-no-submit-no-payment-no-cleanup',
  outPath,
  allowDirty,
  maxArtifactAgeHours,
  irreversibleActions: {
    generationSubmit: 'not_clicked',
    purchasePaymentCheckout: 'not_touched',
    externalPublish: 'not_touched',
    destructiveCleanup: 'not_touched',
    deploy: 'not_run',
  },
  readbacks: [],
  commands: [],
  blockers: [],
  warnings: [],
  stopConditions: [
    'billing_purchase_payment_checkout',
    'identity_otp_captcha_security_prompt',
    'secret_entry',
    'external_public_publish',
    'destructive_cleanup_outside_marker_scoped_artifacts',
    'new_paid_external_vendor_or_monitoring_service',
  ],
};

if (!allowDirty) {
  checkGitClean();
} else {
  report.warnings.push({ id: 'git_dirty_allowed', message: '--allow-dirty was used; this proof is a development dry-run, not final release approval.' });
  report.blockers.push({
    id: 'allow_dirty_not_release_acceptance',
    message: '--allow-dirty cannot produce an accepted release gate proof.',
    next: 'Commit or park tracked changes, then rerun without --allow-dirty.',
  });
}

for (const item of requiredReadbacks) {
    report.readbacks.push(item.pair ? readbackPairCheck(item) : readbackCheck(item));
}

if (!skipCommands) {
  for (const item of commandChecks) {
    report.commands.push(runCommand(item));
  }
} else {
  report.warnings.push({ id: 'commands_skipped', message: '--skip-commands was used; static command gates were not executed.' });
  report.blockers.push({
    id: 'commands_skipped_not_release_acceptance',
    message: '--skip-commands cannot produce an accepted release gate proof.',
    next: 'Rerun without --skip-commands so security audit, scorecard, typecheck, lint, syntax checks, and git diff check execute.',
  });
}

report.ok =
  report.blockers.length === 0 &&
  report.readbacks.every((item) => item.passed) &&
  report.commands.every((item) => item.passed);
report.failed = [
  ...report.readbacks.filter((item) => !item.passed).map((item) => `readback:${item.name}`),
  ...report.commands.filter((item) => !item.passed).map((item) => `command:${item.name}`),
  ...report.blockers.map((item) => `blocker:${item.id}`),
];

fs.mkdirSync(path.dirname(outPath), { recursive: true });
fs.writeFileSync(outPath, `${JSON.stringify(report, null, 2)}\n`);

console.log(JSON.stringify({ ok: report.ok, outPath, failed: report.failed }, null, 2));
process.exit(report.ok ? 0 : 1);
}

function checkGitClean() {
  const result = spawnSync('git', ['status', '--short'], {
    cwd: process.cwd(),
    encoding: 'utf8',
    shell: false,
  });
  if (result.status !== 0) {
    report.blockers.push({
      id: 'git_status_failed',
      message: safeTail(`${result.stdout || ''}${result.stderr || ''}`).join('\n'),
      next: 'Fix git status execution before release gate.',
    });
    return;
  }
  if (result.stdout.trim()) {
    report.blockers.push({
      id: 'git_dirty',
      message: 'Working tree has uncommitted changes.',
      details: result.stdout.trim().split(/\r?\n/).slice(0, 20),
      next: 'Commit or intentionally park changes, then rerun without --allow-dirty.',
    });
  }
}

function readbackCheck(item) {
  let resolvedPath = item.path || `${item.latestSummaryPrefix || 'unknown'}*/SUMMARY.json`;
  const entry = {
    name: item.name,
    path: resolvedPath,
    expected: item.expect,
    passed: false,
  };

  try {
    resolvedPath = resolveReadbackPath(item);
    entry.path = resolvedPath;
    const raw = fs.readFileSync(resolvedPath, 'utf8');
    const stat = fs.statSync(resolvedPath);
    const json = JSON.parse(raw);
    entry.safeSummary = summarizeJson(json);
    entry.freshness = artifactFreshness(resolvedPath, json, stat);
    entry.passed = item.validate(json) && entry.freshness.passed;
    if (!entry.passed) {
      entry.next = entry.freshness.passed
        ? `Refresh or repair ${resolvedPath}; expected ${item.expect}.`
        : `Refresh ${resolvedPath}; artifact is older than ${maxArtifactAgeHours}h or lacks a usable timestamp/mtime.`;
    }
  } catch (error) {
    entry.error = error.message;
    entry.next = `Create or restore ${resolvedPath}; expected ${item.expect}.`;
  }

  return entry;
}

function readbackPairCheck(item) {
  const entry = { name: item.name, path: item.pair, expected: item.expect, passed: false };
  try {
    const artifacts = Object.fromEntries(Object.entries(item.pair).map(([key, artifactPath]) => {
      const raw = fs.readFileSync(artifactPath, 'utf8');
      const stat = fs.statSync(artifactPath);
      const json = JSON.parse(raw);
      return [key, { json, freshness: artifactFreshness(artifactPath, json, stat) }];
    }));
    entry.freshness = Object.fromEntries(Object.entries(artifacts).map(([key, value]) => [key, value.freshness]));
    entry.safeSummary = Object.fromEntries(Object.entries(artifacts).map(([key, value]) => [key, summarizeJson(value.json)]));
    entry.passed = item.validate(artifacts.monitor.json, artifacts.ui.json, { now: capturedAt, maxArtifactAgeHours }) && Object.values(artifacts).every((value) => value.freshness.passed);
    if (!entry.passed) entry.next = 'Refresh both same-run production monitor and UI artifacts; do not reuse or synthesize either artifact.';
  } catch (error) {
    entry.error = error.message;
    entry.next = `Create both ${item.pair.monitor} and ${item.pair.ui}; expected ${item.expect}.`;
  }
  return entry;
}

function freshTimestamp(value, options = {}) {
  const timestamp = Date.parse(value);
  const now = options.now instanceof Date ? options.now.getTime() : Date.now();
  const maxAgeMs = Number(options.maxArtifactAgeHours ?? 48) * 3600000;
  return Number.isFinite(timestamp) && timestamp <= now && now - timestamp <= maxAgeMs;
}

export function validateProductionMonitorReleasePair(monitor, ui, options = {}) {
  const empty = value => Array.isArray(value) && value.length === 0;
  const id = value => typeof value === 'string' && /^[A-Za-z0-9][A-Za-z0-9_-]{0,127}$/.test(value);
  const nonnegative = value => typeof value === 'number' && Number.isFinite(value) && value >= 0;
  const zeroCount = value => Number.isSafeInteger(value) && value === 0;
  const usageFields = ['plannedImages', 'completedImages', 'runningImages', 'uncertainImages',
    'attemptedImages', 'unknownEstimateCount', 'estimatedMicroUSD', 'estimatedNeurons',
    'averageInferenceMs', 'remainingUnits', 'monthlyQuota'];
  const coverage = monitor?.coverage;
  const generation = monitor?.sections?.generation;
  const usage = monitor?.sections?.usage;
  const storage = monitor?.sections?.storage;
  const counts = generation?.counts;
  const thresholds = monitor?.thresholds;
  const window = monitor?.window;
  const countValuesValid = counts && typeof counts === 'object' && !Array.isArray(counts) &&
    Object.entries(counts).every(([name, value]) =>
      ['pending', 'processing', 'queued', 'running', 'completed', 'failed', 'cancelled'].includes(name) &&
      Number.isInteger(value) && value >= 0,
    );
  const observedJobCount = countValuesValid ? Object.values(counts).reduce((sum, value) => sum + value, 0) : -1;
  const monitorShapeValid =
    monitor?.baseUrl === PRODUCTION_API_ORIGIN && monitor?.mode === 'cloudflare_authenticated_read_only' &&
    freshTimestamp(monitor?.capturedAt, options) && id(monitor?.brandId) &&
    Array.isArray(monitor?.blockers) && Array.isArray(monitor?.warnings) &&
    Number.isFinite(window?.hours) && window.hours >= 1 && Number.isFinite(window?.staleMinutes) && window.staleMinutes >= 1 &&
    Number.isFinite(thresholds?.maxFailureRate) && thresholds.maxFailureRate >= 0 && thresholds.maxFailureRate <= 1 &&
    Number.isInteger(thresholds?.maxRows) && thresholds.maxRows >= 100 &&
    Number.isInteger(thresholds?.sampleSize) && thresholds.sampleSize >= 1 &&
    Number.isInteger(thresholds?.maxFailedJobs) && thresholds.maxFailedJobs >= 0 &&
    Number.isInteger(thresholds?.maxStaleActiveJobs) && thresholds.maxStaleActiveJobs >= 0 &&
    Number.isInteger(thresholds?.maxStorageErrors) && thresholds.maxStorageErrors >= 0 &&
    coverage?.jobs === 'current_principal_and_brand' &&
    coverage?.media === 'current_principal_recent_sample' &&
    coverage?.usage === 'authorized_brand_current_month' &&
    coverage?.ui === 'not_checked' && coverage?.cpu === 'not_measured' &&
    coverage?.providerBilling === 'not_available' && coverage?.businessCompletion === 'not_verified' &&
    coverage?.pagination === 'bounded_nontransactional_observation' &&
    monitor?.sections?.api?.status === 'ok' && monitor.sections.api.media === 'private-r2' &&
    Number.isInteger(generation?.total) && generation.total > 0 &&
    countValuesValid && generation.total === observedJobCount &&
    Number.isInteger(generation?.terminal) && generation.terminal >= 0 &&
    Number.isInteger(generation?.failed) && generation.failed >= 0 &&
    generation.terminal === (counts.completed ?? 0) + (counts.failed ?? 0) &&
    Array.isArray(generation?.failedJobIds) && generation.failedJobIds.every(id) &&
    Array.isArray(generation?.staleJobIds) && generation.staleJobIds.every(id) &&
    Array.isArray(storage?.checks) && storage.checks.length > 0 &&
    Number.isInteger(storage?.checkedImages) && storage.checkedImages === storage.checks.length &&
    Number.isInteger(storage?.readable) && storage.readable === storage.checks.length &&
    Number.isInteger(storage?.errors) && storage.errors === 0 && storage.checks.every(check =>
      id(check?.imageId) && check?.ok === true && Number.isInteger(check?.bytes) && check.bytes > 0 &&
      /^[a-f0-9]{64}$/.test(check?.sha256 || '') && check?.checksumVerified === true,
    ) &&
    Number.isInteger(generation?.staleActive) && generation.staleActive >= 0 &&
    usage?.scope === 'authorized_brand_current_month' && usage.billing === 'estimate_not_invoice' &&
    usage.imageAIEnabled === true && usageFields.every(field => nonnegative(usage[field])) &&
    Number.isInteger(storage?.totalRecentImages) && storage.totalRecentImages >= storage.checkedImages;
  const now = options.now instanceof Date ? options.now.getTime() : Date.now();
  const maxAgeMs = Number(options.maxArtifactAgeHours ?? 48) * 3600000;
  const fresh = value => freshTimestamp(value, { now: new Date(now), maxArtifactAgeHours: maxAgeMs / 3600000 });
  const runId = monitor?.runId;
  const auth = ui?.authEvidence;
  const authPath = String(auth?.statePath || ui?.storageState || '');
  const localProof = /local-proof-jwt|localhost|127\.0\.0\.1/i.test(authPath);
  const results = arrayFrom(ui?.results);
  return fresh(monitor?.capturedAt) && fresh(ui?.finishedAt) && monitorShapeValid &&
    monitor?.schema === 'heavy-chain.production-monitor.v2' && monitor.ok === true &&
    monitor.coverage?.ui === 'not_checked' && empty(monitor.blockers) &&
    !Object.hasOwn(monitor, 'summary') && !Object.hasOwn(monitor, 'uiOk') &&
    !arrayFrom(monitor.warnings).some((warning) => warning?.code === 'ui_probe_skipped') &&
    id(runId) &&
    ui?.schema === 'heavy-chain.lightchain-production-ui.v2' && ui.mode === 'production' && ui.baseUrl === PRODUCTION_ORIGIN &&
    ui.targetOrigin?.origin === PRODUCTION_ORIGIN && ui.targetOrigin?.bound === true && ui.preflight?.ok === true &&
    auth?.source === 'explicit_env' && auth.supplied === true && auth.statePathExists === true && !localProof &&
    ui.storageState === auth.statePath && ui.runId === runId &&
    Array.isArray(ui.pages) && ui.pages.length === CURRENT_UI_PAGE_NAMES.length &&
    ui.pages.map((page) => page?.name).every((name, index) => name === CURRENT_UI_PAGE_NAMES[index]) &&
    Array.isArray(ui.viewports) && ui.viewports.length === CURRENT_UI_VIEWPORT_NAMES.length &&
    ui.viewports.map((viewport) => viewport?.name).every((name, index) => name === CURRENT_UI_VIEWPORT_NAMES[index]) &&
    ui.completion?.status === 'verified_read_only' && ui.completion?.externalActionsStarted === false &&
    ui.fatalRunnerError === null && ui.failureCount === 0 && ui.resultCount === results.length && results.length === 28 &&
    new Set(results.map((result) => `${result?.viewport}/${result?.page}`)).size === results.length &&
    results.every((result) => CURRENT_UI_VIEWPORT_NAMES.includes(result?.viewport) && CURRENT_UI_PAGE_NAMES.includes(result?.page)) &&
    CURRENT_UI_VIEWPORT_NAMES.every((viewport) => CURRENT_UI_PAGE_NAMES.every((page) => results.some((result) => result.viewport === viewport && result.page === page))) &&
    results.every((result) => result?.passed === true && result.redirectedToLogin === false &&
      zeroCount(result.consoleErrorCount) && zeroCount(result.pageErrorCount) &&
      zeroCount(result.requestFailureCount) &&
      empty(result.missingText) && empty(result.legacyViolations)) &&
    empty(ui.consoleMessages) && empty(ui.pageErrors) && empty(ui.requestFailures) &&
    empty(ui.legacyViolations) && ui.cleanup?.contextClosed === true && ui.cleanup?.browserClosed === true;
}

export function validateCompanionAuthenticatedEvidence(evidence) {
  const expectedOrigin = PRODUCTION_ORIGIN;
  const expectedRoutes = ['/model', '/gallery', '/history', '/jobs', '/canvas/new'];
  const routes = Array.isArray(evidence?.routes) ? evidence.routes : [];
  const routeByPath = new Map(routes.map((route) => [route?.path, route]));
  return evidence?.schema === 'heavy-chain.companion-authenticated-production-evidence.v1' &&
    evidence?.source === 'aos_chrome_companion_profile_instance' &&
    typeof evidence?.taskId === 'string' && evidence.taskId.length > 0 &&
    typeof evidence?.sessionId === 'string' && evidence.sessionId.length > 0 &&
    Number.isInteger(evidence?.tabId) && evidence.tabId > 0 &&
    typeof evidence?.generation === 'string' && evidence.generation.length > 0 &&
    evidence?.origin === expectedOrigin && evidence?.authSecretExported === false &&
    routes.length === expectedRoutes.length && expectedRoutes.every((routePath) => {
      const route = routeByPath.get(routePath);
      return route?.readyState === 'complete' &&
        ['avatar', 'canvas-save'].includes(route?.authMarker) &&
        route?.semanticReadback === 'verified' &&
        route?.visualReadback === 'verified' &&
        Array.isArray(route?.routeMarkers) && route.routeMarkers.length > 0;
    }) &&
    evidence?.businessCompletion?.providerReceipt === 'unverified' &&
    evidence?.businessCompletion?.sourceSync === 'unverified' &&
    evidence?.businessCompletion?.reconciliation === 'unverified';
}

function resolveReadbackPath(item) {
  if (!item.latestSummaryPrefix) return item.path;
  const baseDir = 'output/playwright';
  const candidates = [];
  const invalidCandidates = [];
  for (const summaryPath of fs
    .readdirSync(baseDir, { withFileTypes: true })
    .filter((entry) => entry.isDirectory() && entry.name.startsWith(item.latestSummaryPrefix))
    .map((entry) => path.join(baseDir, entry.name, 'SUMMARY.json'))
    .filter((summaryPath) => fs.existsSync(summaryPath))) {
    try {
      const json = JSON.parse(fs.readFileSync(summaryPath, 'utf8'));
      const timestamp =
        json.capturedAt ||
        json.measuredAt ||
        json.captured_at ||
        json.verifiedAt ||
        json.completedAt ||
        json.finishedAt ||
        json.generatedAt ||
        null;
      const timestampMs = timestamp ? Date.parse(timestamp) : Number.NaN;
      if (!Number.isFinite(timestampMs)) {
        invalidCandidates.push(`${summaryPath}:missing_or_invalid_timestamp`);
      } else {
        candidates.push({ path: summaryPath, timestampMs });
      }
    } catch (error) {
      invalidCandidates.push(`${summaryPath}:${error.message}`);
    }
  }
  if (invalidCandidates.length > 0) {
    throw new Error(`Invalid latest-summary candidates for ${item.latestSummaryPrefix}: ${invalidCandidates.join('; ')}`);
  }
  candidates.sort((left, right) => right.timestampMs - left.timestampMs || right.path.localeCompare(left.path));
  if (!candidates[0]) {
    return path.join(baseDir, `${item.latestSummaryPrefix}*/SUMMARY.json`);
  }
  return candidates[0].path;
}

function artifactFreshness(filePath, json, stat) {
  const timestamp =
    json.capturedAt ||
    json.measuredAt ||
    json.captured_at ||
    json.verifiedAt ||
    json.completedAt ||
    json.finishedAt ||
    json.generatedAt ||
    null;
  const timestampMs = timestamp ? Date.parse(timestamp) : Number.NaN;
  const source = 'artifact_timestamp';
  const observedMs = timestampMs;
  const ageHours = (capturedAt.getTime() - observedMs) / (60 * 60 * 1000);
  return {
    source,
    timestamp: Number.isFinite(timestampMs) ? new Date(timestampMs).toISOString() : null,
    mtime: stat.mtime.toISOString(),
    ageHours: Number(ageHours.toFixed(2)),
    maxArtifactAgeHours,
    passed: Number.isFinite(ageHours) && ageHours >= 0 && ageHours <= maxArtifactAgeHours,
  };
}

function runCommand(item) {
  const startedAt = new Date();
  const timeoutMs = Number(item.timeoutMs || defaultCommandTimeoutMs);
  const result = spawnSync(item.command, item.args, {
    cwd: process.cwd(),
    encoding: 'utf8',
    env: process.env,
    shell: false,
    maxBuffer: 10 * 1024 * 1024,
    timeout: timeoutMs,
    killSignal: 'SIGTERM',
  });
  const output = `${result.stdout || ''}${result.stderr || ''}`;
  const timedOut = result.error?.code === 'ETIMEDOUT';
  return {
    name: item.name,
    command: [item.command, ...item.args].join(' '),
    startedAt: startedAt.toISOString(),
    durationMs: Date.now() - startedAt.getTime(),
    timeoutMs,
    status: result.status,
    passed: result.error === undefined && result.status === 0,
    timedOut,
    signal: result.signal ?? null,
    outputTail: safeTail(output),
    error: result.error?.message,
  };
}

function summarizeJson(json) {
  return {
    ok: json.ok,
    passed: json.passed,
    failed: arrayFrom(json.failed).slice(0, 10),
    blockers: arrayFrom(json.blockers).length,
    warnings: arrayFrom(json.warnings).length,
    capturedAt: json.capturedAt || json.verifiedAt || json.completedAt || null,
    workflow: json.workflow || json.schema || null,
  };
}

export function validateG618ScaleOps(json, now = Date.now()) {
  const checks = arrayFrom(json?.checks);
  const commands = arrayFrom(json?.commands);
  const thresholds = json?.thresholds || {};
  const monitorExpectations = json?.monitorExpectations;
  const requiredLocalChecks = [
    'performance summary readable',
    'production monitor summary readable',
    'production readback window covers G618 baseline',
    'local scale fixture size',
    'local scale performance passed',
    'local route SLO',
    'gallery virtualization guard',
    'canvas object readback',
    'preview cleanup proof',
  ];
  const requiredUnverified = [
    'production_concurrent_load',
    'worker_cpu',
    'provider_invoice',
    'fleet_wide_slo',
    'browser_business_workflow',
  ];
  if (
    json?.schema !== 'heavy-chain.g618.scale-ops-baseline.v2' ||
    json.ok !== true ||
    arrayFrom(json.blockers).length !== 0 ||
    json.businessCompletion !== 'not_verified' ||
    !Array.isArray(json.unverified) ||
    !requiredUnverified.every((item) => json.unverified.includes(item)) ||
    Number(json.summary?.checks ?? -1) !== checks.length ||
    Number(json.summary?.commands ?? -1) !== commands.length ||
    Number(json.summary?.imageCount ?? 0) < 1200 ||
    Number(json.summary?.canvasObjectCount ?? 0) < 600 ||
    Number(thresholds.maxFailureRate ?? -1) !== 0 ||
    Number(thresholds.productionReadbackWindowHours ?? 0) < 96 ||
    Number(thresholds.minStorageImages ?? 0) < 4 ||
    json.summary?.performanceOk !== true ||
    json.summary?.monitorOk !== true ||
    !commands.length ||
    !commands.every((command) => command?.passed === true) ||
    !checks.length ||
    !checks.every((check) => check?.passed === true) ||
    !requiredLocalChecks.every((name) => checks.some((check) => check?.name === name && check?.passed === true)) ||
    !monitorExpectations ||
    monitorExpectations.source !== 'explicit_cli_or_environment' ||
    monitorExpectations.windowHours !== thresholds.productionReadbackWindowHours ||
    monitorExpectations.maxFailureRate !== thresholds.maxFailureRate ||
    monitorExpectations.minStorageImages !== thresholds.minStorageImages
  ) {
    return false;
  }

  const irreversibleActions = json.irreversibleActions || {};
  const safeIrreversibleActions =
    irreversibleActions.generationSubmit === 'not_clicked' &&
    irreversibleActions.purchasePaymentCheckout === 'not_touched' &&
    irreversibleActions.externalPublish === 'not_touched' &&
    irreversibleActions.destructiveCleanup === 'not_touched' &&
    irreversibleActions.deploy === 'not_run';
  if (!safeIrreversibleActions) return false;

  const performancePath = json.artifacts?.performanceSummary;
  const monitorPath = json.artifacts?.productionMonitorSummary;
  if (typeof performancePath !== 'string' || typeof monitorPath !== 'string') return false;
  const performanceFile = path.resolve(process.cwd(), performancePath);
  const monitorFile = path.resolve(process.cwd(), monitorPath);
  if (!fs.existsSync(performanceFile) || !fs.existsSync(monitorFile)) return false;

  let performance;
  let monitor;
  try {
    performance = JSON.parse(fs.readFileSync(performanceFile, 'utf8'));
    monitor = JSON.parse(fs.readFileSync(monitorFile, 'utf8'));
  } catch {
    return false;
  }

  const monitorChecks = verifyScaleOpsEvidence(monitor, monitorExpectations, now);
  if (!monitorChecks.length || !monitorChecks.every((check) => check?.passed === true)) return false;
  if (
    monitor.thresholds?.maxFailureRate !== monitorExpectations.maxFailureRate ||
    monitor.thresholds?.maxFailedJobs !== 0 ||
    monitor.thresholds?.maxStaleActiveJobs !== 0 ||
    monitor.thresholds?.maxStorageErrors !== 0 ||
    Number(monitor.thresholds?.sampleSize ?? 0) < monitorExpectations.minStorageImages
  ) return false;

  return (
    performance.ok === true &&
    arrayFrom(performance.issues).length === 0 &&
    Number(performance.fixture?.imageCount || 0) >= 1200 &&
    Number(performance.fixture?.canvasObjectCount || 0) >= 600 &&
    Number(performance.galleryStress?.renderedTilesInitial || 0) === 60 &&
    Number(performance.canvasStress?.persistedObjects || 0) >= 600 &&
    performance.canvasStress?.export?.validPng === true &&
    Number(performance.canvasStress?.export?.width || 0) > 3000 &&
    Number(performance.canvasStress?.export?.height || 0) > 8000 &&
    Number(performance.canvasStress?.export?.edgeColorSamples?.top || 0) > 20 &&
    Number(performance.canvasStress?.export?.edgeColorSamples?.bottom || 0) > 20 &&
    performance.cleanup?.previewProcessCleanup?.groupAliveAfter === false
  );
}

export function validateLightchainProductionReadback(json, manifest = currentLightchainManifest) {
  const featureResults = arrayFrom(json?.featureResults);
  const videoResults = arrayFrom(json?.videoResults);
  const assertions = arrayFrom(json?.assertions);
  const manifestIds = Array.isArray(manifest) ? manifest.map((id) => String(id)) : [];
  const nonVideoManifestIds = manifestIds.filter((id) => !LIGHTCHAIN_VIDEO_ROW_IDS.has(id));
  const resultIds = featureResults.map((result) => result?.id);
  const resultIdSet = new Set(resultIds);
  const manifestIdSet = new Set(manifestIds);
  const nonVideoManifestIdSet = new Set(nonVideoManifestIds);
  const exactManifestOrder = resultIds.length === manifestIds.length && resultIds.every((id, index) => id === manifestIds[index]);
  const exactNonVideoOrder = resultIds.length === nonVideoManifestIds.length && resultIds.every((id, index) => id === nonVideoManifestIds[index]);
  const currentFeatureAssertionsPass = manifestIds.every((id) =>
    hasPassingAssertion(json, `${id}:shared_workflow_contract_readback`) &&
    hasPassingAssertion(json, `${id}:route_loaded_without_login`) &&
    hasPassingAssertion(json, `mobile_screen:${id}`)
  );
  const currentNonVideoFeatureAssertionsPass = nonVideoManifestIds.every((id) =>
    hasPassingAssertion(json, `${id}:shared_workflow_contract_readback`) &&
    hasPassingAssertion(json, `${id}:route_loaded_without_login`) &&
    hasPassingAssertion(json, `mobile_screen:${id}`)
  );
  const fullManifestReadback =
    Number(json.featureCount || 0) === manifestIds.length &&
    featureResults.length === manifestIds.length &&
    resultIds.every((id) => typeof id === 'string') &&
    resultIdSet.size === resultIds.length &&
    resultIdSet.size === manifestIdSet.size &&
    manifestIds.every((id) => resultIdSet.has(id)) &&
    exactManifestOrder &&
    currentFeatureAssertionsPass;
  const splitManifestReadback =
    Number(json.featureCount || 0) === nonVideoManifestIds.length &&
    featureResults.length === nonVideoManifestIds.length &&
    resultIds.every((id) => typeof id === 'string') &&
    resultIdSet.size === resultIds.length &&
    resultIdSet.size === nonVideoManifestIdSet.size &&
    nonVideoManifestIds.every((id) => resultIdSet.has(id)) &&
    exactNonVideoOrder &&
    currentNonVideoFeatureAssertionsPass &&
    validateLightchainVideoRouteReadback(videoResults);

  return (
    json?.ok === true &&
    arrayFrom(json.failed).length === 0 &&
    json.baseUrl === PRODUCTION_ORIGIN &&
    typeof json.authState === 'string' &&
    json.authState !== 'local-proof-jwt' &&
    !json.authState.includes('127.0.0.1') &&
    (fullManifestReadback || splitManifestReadback) &&
    assertions.length > 0 &&
    json.cleanup?.contextClosed === true &&
    json.cleanup?.browserClosed === true &&
    json.cleanup?.previewStopped === true &&
    arrayFrom(json.consoleMessages).length === 0 &&
    arrayFrom(json.pageErrors).length === 0 &&
    arrayFrom(json.requestFailures).length === 0
  );
}

function validateLightchainVideoRouteReadback(videoResults) {
  const videoResultIds = videoResults.map((result) => result?.id);
  if (
    videoResults.length !== LIGHTCHAIN_VIDEO_ROUTE_RESULT_IDS.length ||
    new Set(videoResultIds).size !== videoResultIds.length
  ) return false;
  const resultsById = new Map(videoResults.map((result) => [result?.id, result]));
  return LIGHTCHAIN_VIDEO_ROUTE_RESULT_IDS.every((id) => {
    const result = resultsById.get(id);
    return (
      result &&
      !result.exactBlocker &&
      arrayFrom(result.assertions).length > 0 &&
      arrayFrom(result.assertions).every((assertion) => assertion?.ok === true) &&
      result.observed?.visibleCheckboxCount === 0
    );
  });
}

const REQUIRED_G620_CHECK_IDS = [
  'cloudflare_entrypoints_exist',
  'legacy_runtime_markers_absent',
  'private_media_route_present',
  'provider_action_route_present',
  'runtime_auth_boundary_present',
];

export function validateG620SecurityOps(json) {
  if (
    json.schema !== 'heavy-chain.g620.security-ops.v3' ||
    json.ok !== true ||
    arrayFrom(json.failures).length !== 0 ||
    json.mode !== 'read-only-static-cloudflare-no-submit-no-payment-no-deploy'
  ) {
    return false;
  }

  const checks = arrayFrom(json.checks);
  const checkIds = checks.map((check) => check?.id);
  const checkIdSet = new Set(checkIds);
  if (
    checkIds.some((id) => typeof id !== 'string') ||
    checkIdSet.size !== checkIds.length ||
    REQUIRED_G620_CHECK_IDS.some((id) => !checks.some((check) => check?.id === id && check?.passed === true))
  ) {
    return false;
  }

  const irreversibleActions = json.irreversibleActions || {};
  return (
    irreversibleActions.generationSubmit === 'not_clicked' &&
    irreversibleActions.purchasePaymentCheckout === 'not_touched' &&
    irreversibleActions.deploy === 'not_run'
  );
}

function safeTail(text) {
  return redact(String(text || ''))
    .split(/\r?\n/)
    .map((line) => line.trimEnd())
    .filter(Boolean)
    .slice(-12);
}

function redact(text) {
  return text
    .replace(/eyJ[A-Za-z0-9_-]{20,}\.[A-Za-z0-9_-]{20,}\.[A-Za-z0-9_-]{20,}/g, '[redacted]')
    .replace(/sk-[A-Za-z0-9_-]{12,}/g, '[redacted]')
    .replace(/AIza[0-9A-Za-z_-]{12,}/g, '[redacted]')
    .replace(/((?:SUPABASE|OPENAI|GEMINI|VITE)_[A-Z0-9_]*(?:KEY|TOKEN|SECRET|URL)?\s*[=:]\s*)\S+/gi, '$1[redacted]');
}

function arrayFrom(value) {
  return Array.isArray(value) ? value : [];
}

function hasPassingAssertion(json, assertionId) {
  return arrayFrom(json?.assertions).some((assertion) =>
    assertion?.id === assertionId && assertion?.ok === true
  );
}

function hasRouteAssertion(json, routeKey, assertionName) {
  const route = [...arrayFrom(json?.routes), ...arrayFrom(json?.mobile)]
    .find((item) => item?.key === routeKey);
  return arrayFrom(route?.assertions).some((assertion) =>
    assertion?.name === assertionName && assertion?.passed === true
  );
}

function routeAssertionDetailsIncludes(json, routeKey, assertionName, expectedText) {
  const route = [...arrayFrom(json?.routes), ...arrayFrom(json?.mobile)]
    .find((item) => item?.key === routeKey);
  const assertion = arrayFrom(route?.assertions).find((item) =>
    item?.name === assertionName && item?.passed === true
  );
  return JSON.stringify(assertion?.details || {}).includes(expectedText);
}

export function readCurrentLightchainManifest() {
  const sourcePath = path.join(process.cwd(), 'src/pages/LightchainWorkbenchPage.tsx');
  const source = fs.readFileSync(sourcePath, 'utf8');
  const toolsBlock = source.match(/const tools: CompatTool\[\] = \[([\s\S]+?)\];\n\nconst statusLabel/)
    ?? source.match(/const tools: CompatTool\[\] = \[([\s\S]+?)\];\n\nfor \(const \[index, tool\] of tools\.entries\(\)/);
  if (!toolsBlock) throw new Error(`lightchain_manifest_not_found:${sourcePath}`);
  const ids = [];
  for (const match of toolsBlock[1].matchAll(/\{\s*id: '([^']+)'[\s\S]+?title: '([^']+)'[\s\S]+?category: '([^']+)'/g)) {
    ids.push(match[1]);
  }
  const requiredVideoIds = ['video-workstation', 'video-detail'];
  if (
    ids.length === 0 ||
    new Set(ids).size !== ids.length ||
    requiredVideoIds.some((id) => !ids.includes(id))
  ) {
    throw new Error(`lightchain_manifest_invalid:${sourcePath}`);
  }
  return Object.freeze(ids);
}

function parseArgs(argv) {
  const parsed = {};
  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (!arg.startsWith('--')) continue;
    const key = arg.slice(2);
    const next = argv[index + 1];
    if (!next || next.startsWith('--')) {
      parsed[key] = true;
    } else {
      parsed[key] = next;
      index += 1;
    }
  }
  return parsed;
}

function dateStamp(date) {
  return date.toISOString().replace(/[-:]/g, '').replace(/\.\d{3}Z$/, 'Z');
}

if (process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href) {
  runReleaseGate();
}
