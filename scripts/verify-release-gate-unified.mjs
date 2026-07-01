#!/usr/bin/env node

import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';

const args = parseArgs(process.argv.slice(2));
const capturedAt = new Date();
const outPath = args.out || 'output/playwright/10m-product-readiness-g615/release-gate-summary.json';
const allowDirty = Boolean(args.allowDirty || args['allow-dirty']);
const skipCommands = Boolean(args.skipCommands || args['skip-commands']);
const maxArtifactAgeHours = Number(args.maxArtifactAgeHours || args['max-artifact-age-hours'] || 48);

const REQUIRED_G608_REQUIREMENT_IDS = [
  'logged_in_production_ui',
  'local_production_build_full_ui',
  'logged_in_navigation',
  'local_worker_operator_controls',
  'runway_site_approval',
  'unapproved_denial',
  'local_worker_contract_redaction',
  'runway_bridge_tools',
  'approved_live_generation_readback',
  'workspace_readback_expected_task_codes',
  'approved_generation_cleanup',
];

const requiredReadbacks = [
  {
    name: 'production monitor',
    path: 'output/playwright/production-monitor-post-g660-20260701-r2/summary.json',
    validate: (json) =>
      json.ok === true &&
      arrayFrom(json.blockers).length === 0 &&
      Number(json.summary?.blockers ?? 0) === 0 &&
      json.summary?.uiOk === true &&
      !arrayFrom(json.warnings).some((warning) => warning?.code === 'ui_probe_skipped'),
    expect: 'ok=true, blockers=[], summary.blockers=0, uiOk=true, and UI probe not skipped',
  },
  {
    name: 'launch operations',
    path: 'output/playwright/launch-operations-readiness-20260701-g623-r4/summary.json',
    validate: (json) => json.ok === true && arrayFrom(json.failed).length === 0,
    expect: 'ok=true and failed=[]',
  },
  {
    name: 'production mass-market QA current',
    path: 'output/playwright/prod-post-g662-gemini-provider-default-20260701-r3/SUMMARY.json',
    validate: (json) =>
      json.ok === true &&
      arrayFrom(json.failed).length === 0 &&
      Number(json.routeCount || 0) >= 17 &&
      arrayFrom(json.routes).length >= 17 &&
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
      hasRouteAssertion(json, 'generate-campaign', 'h601_rights_confirmation_visible') &&
      hasRouteAssertion(json, 'mobile-generate-campaign', 'h601_rights_confirmation_visible') &&
      routeAssertionDetailsIncludes(json, 'generate-campaign', 'upload_first_generation_screen_hides_advanced_controls', 'Geminiで生成') &&
      routeAssertionDetailsIncludes(json, 'mobile-generate-campaign', 'upload_first_generation_screen_hides_advanced_controls', 'Geminiで生成') &&
      hasRouteAssertion(json, 'mobile-lightchain', 'mobile_no_intrusive_floating_help_buttons') &&
      hasRouteAssertion(json, 'mobile-generate-campaign', 'mobile_no_intrusive_floating_help_buttons') &&
      hasRouteAssertion(json, 'mobile-generate-campaign', 'mobile_generate_hides_canvas_toolbar') &&
      hasRouteAssertion(json, 'mobile-generate-campaign', 'mobile_generate_starts_at_material_form') &&
      hasRouteAssertion(json, 'mobile-dashboard', 'mobile_dashboard_has_above_fold_quick_start') &&
      hasRouteAssertion(json, 'mobile-dashboard', 'mobile_dashboard_hides_duplicate_quick_action_cards') &&
      hasRouteAssertion(json, 'mobile-dashboard', 'mobile_dashboard_lightchain_has_all_tools_link') &&
      hasRouteAssertion(json, 'mobile-dashboard', 'mobile_dashboard_lightchain_cards_open_detail_routes') &&
      hasRouteAssertion(json, 'mobile-dashboard', 'mobile_dashboard_activity_uses_compact_summary') &&
      hasRouteAssertion(json, 'mobile-dashboard', 'mobile_dashboard_has_single_primary_next_action') &&
      hasRouteAssertion(json, 'mobile-dashboard', 'mobile_dashboard_hides_low_priority_desktop_panels') &&
      hasRouteAssertion(json, 'brand-settings', 'brand_settings_has_readiness_and_safe_next_actions') &&
      hasRouteAssertion(json, 'marketing', 'marketing_workspace_has_clear_generation_flow') &&
      hasRouteAssertion(json, 'marketing', 'marketing_preview_has_brief_context') &&
      hasRouteAssertion(json, 'fitting', 'fitting_workspace_has_clear_generation_flow') &&
      hasRouteAssertion(json, 'fitting', 'fitting_preview_has_model_matrix_context') &&
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
      hasRouteAssertion(json, 'credits', 'credits_has_actionable_workspace_panel') &&
      hasRouteAssertion(json, 'history', 'history_has_reuse_action_panel') &&
      hasRouteAssertion(json, 'history', 'desktop_history_timeline_is_bounded') &&
      hasRouteAssertion(json, 'mobile-history', 'history_has_reuse_action_panel') &&
      hasRouteAssertion(json, 'mobile-history', 'mobile_history_timeline_is_bounded') &&
      hasRouteAssertion(json, 'mobile-lightchain', 'mobile_lightchain_tool_list_is_bounded') &&
      hasRouteAssertion(json, 'mobile-jobs', 'mobile_jobs_initial_list_is_bounded') &&
      hasRouteAssertion(json, 'mobile-canvas', 'mobile_canvas_content_fits_initial_view'),
    expect: 'current production mass-market QA ok=true with 17 desktop routes, 9 mobile routes including mobile History, Gallery fallback visible without scary remote-failure toast, H601-ready Gemini generate route, Brand Settings readiness and safe next actions, clear Marketing generation flow with brief-context preview, clear Fitting generation flow with model-matrix preview/context, clear Model Library generation flow, clear Pattern Workspace generation flow with garment mockup preview context, clear Video Workspace generation flow with storyboard context and meaningful shot cards, clear Studio generation flow with composition-context preview, clear Lab generation flow with evaluation-context preview, actionable Credits workspace panel, History reuse panel, bounded desktop and mobile History timelines, no intrusive mobile floating help buttons, mobile Dashboard quick start with one primary next action, no duplicate quick-action cards, compact mobile Dashboard Lightchain hub with all-tools link and direct detail-route cards, compact mobile activity summary, hidden low-priority desktop panels on mobile, mobile Generate starts at material form with canvas toolbar hidden, bounded mobile Lightchain tool list, bounded mobile Jobs list, mobile Canvas content fit on open, no console/page/request failures, and cleanup closed',
  },
  {
    name: 'production Lightchain all-feature order previews',
    path: 'output/playwright/prod-post-g659-lightchain-order-preview-20260701-r2/SUMMARY.json',
    validate: (json) =>
      json.ok === true &&
      arrayFrom(json.failed).length === 0 &&
      Number(json.featureCount || 0) >= 33 &&
      arrayFrom(json.featureResults).length >= 33 &&
      arrayFrom(json.assertions).filter((assertion) =>
        String(assertion?.id ?? '').includes('workspace_artifact_preview_is_tool_specific_order_sheet') &&
        assertion?.ok === true
      ).length >= 33 &&
      json.cleanup?.contextClosed === true &&
      json.cleanup?.browserClosed === true &&
      arrayFrom(json.consoleMessages).length === 0 &&
      arrayFrom(json.pageErrors).length === 0 &&
      arrayFrom(json.requestFailures).length === 0,
    expect: 'production Lightchain all-feature workflow ok=true with 33 features, 33 tool-specific order-sheet preview assertions, no console/page/request failures, and cleanup closed',
  },
  {
    name: 'G610 retention workspace search',
    path: 'output/playwright/g610-retention-project-search-20260701-g624-r1/SUMMARY.json',
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
    path: 'output/playwright/g603-garment-layer-canvas-20260701-g624-r1/SUMMARY.json',
    validate: (json) => json.ok === true && arrayFrom(json.failed).length === 0,
    expect: 'ok=true and failed=[]',
  },
  {
    name: 'G605 onboarding templates',
    path: 'output/playwright/g605-onboarding-templates-20260701-g624-r1/SUMMARY.json',
    validate: (json) =>
      json.ok === true &&
      arrayFrom(json.failed).length === 0 &&
      json.cleanup?.previewProcessExit?.exited === true &&
      json.cleanup?.previewProcessExit?.portFree === true,
    expect: 'ok=true, failed=[], preview process exited, port free',
  },
  {
    name: 'G606 performance scale',
    path: 'output/playwright/g606-performance-scale-20260701-g624-r2/summary.json',
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
    path: 'output/playwright/g608-security-audit-20260701-g624-r2/audit-readiness.json',
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
    expect: 'ok=true, blockers=[], expected schema, commands/checks passed, imageCount>=1200, canvasObjectCount>=600, monitor/performance nested artifacts valid, and only allowed monitor warnings',
  },
  {
    name: 'G620 security operations',
    path: 'output/playwright/10m-product-readiness-g620/summary.json',
    validate: validateG620SecurityOps,
    expect: 'ok=true, blockers=[], expected schema, monitor readback safe, abuse/permission/audit/incident checks passed, and only allowed monitor warnings',
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
    path: 'output/playwright/prod-h601-rights-check-20260701-r1/summary.json',
    validate: (json) =>
      json.ok === true &&
      hasPassingAssertion(json, 'generate_route_loaded') &&
      hasPassingAssertion(json, 'h601_rights_label_visible') &&
      hasPassingAssertion(json, 'h601_commercial_caveat_visible') &&
      hasPassingAssertion(json, 'rights_checkbox_exists'),
    expect: 'production authenticated /generate shows H601 rights label, commercial caveat, and rights checkbox',
  },
  {
    name: 'production public domain readback',
    path: 'output/playwright/prod-domain-rights-check-20260630T0952Z/summary.json',
    validate: (json) => json.findings?.customDomain?.reachable === true,
    expect: 'chosen public custom domain is reachable',
  },
  {
    name: 'production H602 billing completion readback',
    path: 'output/playwright/h602-production-billing-readback-20260630/summary.json',
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
    args: ['--check', 'scripts/verify-h602-billing-readiness.mjs'],
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

const report = {
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
  report.readbacks.push(readbackCheck(item));
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
  const result = spawnSync(item.command, item.args, {
    cwd: process.cwd(),
    encoding: 'utf8',
    env: process.env,
    shell: false,
    maxBuffer: 10 * 1024 * 1024,
  });
  const output = `${result.stdout || ''}${result.stderr || ''}`;
  return {
    name: item.name,
    command: [item.command, ...item.args].join(' '),
    startedAt: startedAt.toISOString(),
    durationMs: Date.now() - startedAt.getTime(),
    status: result.status,
    passed: result.error === undefined && result.status === 0,
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

function validateG618ScaleOps(json) {
  if (
    json.schema !== 'heavy-chain.g618.scale-ops-baseline.v1' ||
    json.ok !== true ||
    arrayFrom(json.blockers).length !== 0 ||
    Number(json.summary?.checks || 0) !== 16 ||
    Number(json.summary?.imageCount || 0) < 1200 ||
    Number(json.summary?.canvasObjectCount || 0) < 600 ||
    Number(json.thresholds?.maxFailureRate ?? -1) !== 0 ||
    Number(json.thresholds?.productionReadbackWindowHours || 0) < 96 ||
    Number(json.thresholds?.minStorageImages || 0) < 4 ||
    json.summary?.performanceOk !== true ||
    json.summary?.monitorOk !== true ||
    !arrayFrom(json.commands).every((command) => command?.passed === true) ||
    !arrayFrom(json.checks).every((check) => check?.passed === true)
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
  if (!performancePath || !monitorPath || !fs.existsSync(performancePath) || !fs.existsSync(monitorPath)) return false;

  const performance = JSON.parse(fs.readFileSync(performancePath, 'utf8'));
  const monitor = JSON.parse(fs.readFileSync(monitorPath, 'utf8'));
  const monitorWarningCodes = arrayFrom(monitor.warnings).map((warning) => warning?.code).filter(Boolean).sort();
  const allowedMonitorWarnings = new Set(['local_worker_inbox_stale_files', 'ui_probe_skipped']);
  const warningsAllowed = monitorWarningCodes.every((code) => allowedMonitorWarnings.has(code));

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
    performance.cleanup?.previewProcessCleanup?.groupAliveAfter === false &&
    monitor.schema === 'heavy-chain.production-monitor.v1' &&
    monitor.ok === true &&
    Number(monitor.window?.hours || 0) >= 96 &&
    arrayFrom(monitor.blockers).length === 0 &&
    warningsAllowed &&
    Number(monitor.sections?.generation?.failureRate ?? 0) === 0 &&
    Number(monitor.sections?.generation?.staleActive ?? 0) === 0 &&
    Number(monitor.sections?.storage?.checkedImages ?? 0) >= 4 &&
    Number(monitor.sections?.storage?.signedUrlOk ?? 0) === Number(monitor.sections?.storage?.checkedImages ?? 0) &&
    Number(monitor.sections?.storage?.errors ?? 0) === 0 &&
    Number(monitor.sections?.usage?.failed ?? 0) === 0 &&
    Number(monitor.sections?.usage?.staleReserved ?? 0) === 0 &&
    Number(monitor.sections?.edgeFunctions?.failed ?? 0) === 0 &&
    Number(monitor.sections?.edgeFunctions?.staleStarted ?? 0) === 0
  );
}

function validateG620SecurityOps(json) {
  const checks = arrayFrom(json.checks);
  const hasMeteredEdgeObservabilityCheck = checks.some((check) =>
    check?.name === 'all metered functions are edge-observed' && check?.passed === true
  );
  if (
    json.schema !== 'heavy-chain.g620.security-operations.v1' ||
    json.ok !== true ||
    arrayFrom(json.blockers).length !== 0 ||
    Number(json.summary?.checks || 0) !== checks.length ||
    checks.length < 124 ||
    !arrayFrom(json.commands).every((command) => command?.passed === true) ||
    !checks.every((check) => check?.passed === true) ||
    !hasMeteredEdgeObservabilityCheck ||
    Number(json.thresholds?.monitorWindowHours || 0) < 96 ||
    Number(json.thresholds?.maxGenerationFailureRate ?? -1) !== 0 ||
    Number(json.thresholds?.maxFailedGenerationJobs ?? -1) !== 0 ||
    Number(json.thresholds?.maxStaleActiveJobs ?? -1) !== 0 ||
    Number(json.thresholds?.maxStorageErrors ?? -1) !== 0 ||
    Number(json.thresholds?.maxUsageFailures ?? -1) !== 0 ||
    Number(json.thresholds?.maxStaleUsageReservations ?? -1) !== 0 ||
    Number(json.thresholds?.maxEdgeFunctionFailures ?? -1) !== 0 ||
    Number(json.thresholds?.maxStaleStartedEdgeRuns ?? -1) !== 0
  ) {
    return false;
  }

  const irreversibleActions = json.irreversibleActions || {};
  const safeIrreversibleActions =
    irreversibleActions.generationSubmit === 'not_clicked' &&
    irreversibleActions.purchasePaymentCheckout === 'not_touched' &&
    irreversibleActions.identityOtpCaptchaSecrets === 'not_touched' &&
    irreversibleActions.externalPublish === 'not_touched' &&
    irreversibleActions.destructiveCleanup === 'not_touched' &&
    irreversibleActions.deploy === 'not_run';
  if (!safeIrreversibleActions) return false;

  const monitorPath = json.artifacts?.productionMonitorSummary;
  const runbookPath = json.artifacts?.runbook;
  if (!monitorPath || !runbookPath || !fs.existsSync(monitorPath) || !fs.existsSync(runbookPath)) return false;
  const monitor = JSON.parse(fs.readFileSync(monitorPath, 'utf8'));
  const monitorFreshness = artifactFreshness(monitorPath, monitor, fs.statSync(monitorPath));
  const monitorWarningCodes = arrayFrom(monitor.warnings).map((warning) => warning?.code).filter(Boolean).sort();
  const allowedMonitorWarnings = new Set(['local_worker_inbox_stale_files', 'ui_probe_skipped']);
  const warningsAllowed = monitorWarningCodes.every((code) => allowedMonitorWarnings.has(code));
  const g620WarningIds = arrayFrom(json.warnings).map((warning) => warning?.id).filter(Boolean);
  const allowedG620Warnings = new Set(['production_usage_sample_absent', 'production_edge_function_sample_absent']);
  const g620WarningsAllowed = g620WarningIds.every((id) => allowedG620Warnings.has(id));
  const usageTotal = Number(monitor.sections?.usage?.total ?? 0);
  const edgeTotal = Number(monitor.sections?.edgeFunctions?.total ?? 0);
  const usageSampleAccountedFor = usageTotal >= 1 || g620WarningIds.includes('production_usage_sample_absent');
  const edgeSampleAccountedFor = edgeTotal >= 1 || g620WarningIds.includes('production_edge_function_sample_absent');

  return (
    monitor.schema === 'heavy-chain.production-monitor.v1' &&
    monitor.ok === true &&
    monitor.mode === 'read-only-no-submit-no-payment-no-cleanup' &&
    monitorFreshness.passed &&
    Number(monitor.window?.hours || 0) >= 96 &&
    arrayFrom(monitor.blockers).length === 0 &&
    warningsAllowed &&
    g620WarningsAllowed &&
    usageSampleAccountedFor &&
    edgeSampleAccountedFor &&
    Number(monitor.sections?.generation?.failureRate ?? 0) === 0 &&
    Number(monitor.sections?.generation?.counts?.failed ?? 0) === 0 &&
    Number(monitor.sections?.generation?.staleActive ?? 0) === 0 &&
    Number(monitor.sections?.storage?.signedUrlOk ?? 0) === Number(monitor.sections?.storage?.checkedImages ?? 0) &&
    Number(monitor.sections?.storage?.errors ?? 0) === 0 &&
    Number(monitor.sections?.usage?.failed ?? 0) === 0 &&
    Number(monitor.sections?.usage?.staleReserved ?? 0) === 0 &&
    Number(monitor.sections?.edgeFunctions?.failed ?? 0) === 0 &&
    Number(monitor.sections?.edgeFunctions?.staleStarted ?? 0) === 0
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
    .replace(/((?:SUPABASE|OPENAI|GEMINI|RUNWAY|VITE)_[A-Z0-9_]*(?:KEY|TOKEN|SECRET|URL)?\s*[=:]\s*)\S+/gi, '$1[redacted]');
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
