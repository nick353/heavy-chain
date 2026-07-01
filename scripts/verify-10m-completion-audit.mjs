#!/usr/bin/env node

import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';

const args = parseArgs(process.argv.slice(2));
const outDir = args.out || 'output/playwright/10m-completion-audit';
const summaryPath = args.summary || path.join(outDir, 'summary.json');
const allowIncomplete = args.allowIncomplete === true || args['allow-incomplete'] === true;
const g617Dir = args.g617Dir || 'output/playwright/g617-same-run-fresh-generation-hc-g617-same-run-fresh-20260630T063740Z';

const requiredHumanItemsClosed = ['H601', 'H602'];
const allGenerationFeatures = [
  'campaign-image',
  'product-shots',
  'model-matrix',
  'design-gacha',
  'scene-coordinate',
  'multilingual-banner',
  'remove-bg',
  'colorize',
  'upscale',
  'variations',
];

const requiredProofs = [
  {
    id: 'g617_same_run_fresh_all_10',
    goal: 'G617',
    path: path.join(g617Dir, 'readback.json'),
    validate: (json) => validateG617FreshGeneration(json, g617Dir),
    expect: 'same-run fresh generation completed all 10 features with no prior assets, no failed jobs, image/storage readback, and visual scorecard pass',
  },
  {
    id: 'g619_real_beta_evidence',
    goal: 'G619',
    path: 'output/playwright/g619-real-beta-evidence/summary.json',
    validate: (json) => json.ok === true && Number(json.summary?.sessions || 0) >= 3,
    expect: 'real consented beta evidence verifier ok=true with at least 3 sessions',
  },
  {
    id: 'g618_scale_ops',
    goal: 'G618',
    path: 'output/playwright/10m-product-readiness-g618/summary.json',
    validate: (json) => json.ok === true && Number(json.summary?.blockers || json.blockers?.length || 0) === 0,
    expect: 'G618 scale/ops baseline ok=true with no blockers',
  },
  {
    id: 'g620_security_ops',
    goal: 'G620',
    path: 'output/playwright/10m-product-readiness-g620/summary.json',
    validate: (json) => json.ok === true && Number(json.summary?.blockers || json.blockers?.length || 0) === 0,
    expect: 'G620 security operations ok=true with no blockers',
  },
  {
    id: 'g647_current_production_mass_market_qa',
    goal: 'G647',
    path: 'output/playwright/prod-post-g647-credits-actionable-20260701-r2/SUMMARY.json',
    validate: (json) =>
      json.ok === true &&
      Array.isArray(json.failed) &&
      json.failed.length === 0 &&
      Number(json.routeCount || 0) >= 17 &&
      Array.isArray(json.routes) &&
      json.routes.length >= 17 &&
      Array.isArray(json.mobile) &&
      json.mobile.length >= 8 &&
      json.cleanup?.contextClosed === true &&
      json.cleanup?.browserClosed === true &&
      Array.isArray(json.consoleMessages) &&
      json.consoleMessages.length === 0 &&
      Array.isArray(json.pageErrors) &&
      json.pageErrors.length === 0 &&
      Array.isArray(json.requestFailures) &&
      json.requestFailures.length === 0 &&
      hasRouteAssertion(json, 'gallery', 'meaningful_page_content') &&
      hasRouteAssertion(json, 'mobile-gallery', 'meaningful_page_content') &&
      hasRouteAssertion(json, 'gallery', 'gallery_no_scary_remote_failure_toast') &&
      hasRouteAssertion(json, 'mobile-gallery', 'gallery_no_scary_remote_failure_toast') &&
      hasRouteAssertion(json, 'generate-campaign', 'h601_rights_confirmation_visible') &&
      hasRouteAssertion(json, 'mobile-generate-campaign', 'h601_rights_confirmation_visible') &&
      hasRouteAssertion(json, 'mobile-lightchain', 'mobile_no_intrusive_floating_help_buttons') &&
      hasRouteAssertion(json, 'mobile-generate-campaign', 'mobile_no_intrusive_floating_help_buttons') &&
      hasRouteAssertion(json, 'mobile-generate-campaign', 'mobile_generate_hides_canvas_toolbar') &&
      hasRouteAssertion(json, 'mobile-generate-campaign', 'mobile_generate_starts_at_material_form') &&
      hasRouteAssertion(json, 'mobile-dashboard', 'mobile_dashboard_has_above_fold_quick_start') &&
      hasRouteAssertion(json, 'mobile-dashboard', 'mobile_dashboard_hides_duplicate_quick_action_cards') &&
      hasRouteAssertion(json, 'mobile-dashboard', 'mobile_dashboard_lightchain_has_all_tools_link') &&
      hasRouteAssertion(json, 'mobile-dashboard', 'mobile_dashboard_activity_uses_compact_summary') &&
      hasRouteAssertion(json, 'credits', 'credits_has_actionable_workspace_panel') &&
      hasRouteAssertion(json, 'mobile-lightchain', 'mobile_lightchain_tool_list_is_bounded') &&
      hasRouteAssertion(json, 'mobile-jobs', 'mobile_jobs_initial_list_is_bounded') &&
      hasRouteAssertion(json, 'mobile-canvas', 'mobile_canvas_content_fits_initial_view'),
    expect: 'current production mass-market QA ok=true with Gallery fallback, no scary Gallery remote-failure toast, H601-ready generate route, desktop/mobile coverage, actionable Credits workspace panel, no intrusive mobile floating help buttons, mobile Dashboard quick start without duplicate quick-action cards, compact mobile Dashboard Lightchain hub with all-tools link, compact mobile activity summary, mobile Generate starts at material form with canvas toolbar hidden, bounded mobile Lightchain tool list, bounded mobile Jobs list, mobile Canvas content fit on open, and no console/page/request failures',
  },
  {
    id: 'production_h601_rights_readback',
    goal: 'H601',
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
    id: 'production_public_domain_readback',
    goal: 'public-entrypoint',
    path: 'output/playwright/prod-domain-rights-check-20260630T0952Z/summary.json',
    validate: (json) => json.findings?.customDomain?.reachable === true,
    expect: 'chosen public custom domain is reachable',
  },
  {
    id: 'production_h602_billing_completion_readback',
    goal: 'H602',
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
      Array.isArray(json.remainingBlockers) &&
      json.remainingBlockers.length === 0,
    expect: 'production H602 readback ok=true with hardening/hash-only/artifact-allowlist migrations applied, raw receipt/payload storage blocked, verified no-real-charge proof, transaction/entitlement readback, and no remaining blockers',
  },
];

const requiredCommands = [
  {
    name: 'g619 beta evidence verifier',
    args: ['npm', 'run', 'verify:g619-beta-evidence'],
  },
  {
    name: 'H601 legal safety verifier',
    args: ['npm', 'run', 'verify:h601-legal-safety'],
  },
  {
    name: 'H602 billing readiness verifier',
    args: ['npm', 'run', 'verify:h602-billing'],
  },
  {
    name: 'release gate verifier',
    args: ['npm', 'run', 'verify:release-gate', '--', '--out', path.join(outDir, 'release-gate-summary.json')],
  },
];

const report = {
  schema: 'heavy-chain.10m-completion-audit.v1',
  capturedAt: new Date().toISOString(),
  mode: 'read-only-completion-audit-no-submit-no-payment-no-publish',
  allowIncomplete,
  summaryPath,
  irreversibleActions: {
    generationSubmit: 'not_clicked',
    purchasePaymentCheckout: 'not_touched',
    identityOtpCaptchaSecrets: 'not_touched',
    externalPublish: 'not_touched',
    destructiveCleanup: 'not_touched',
    deploy: 'not_run',
  },
  goals: [],
  humanItems: [],
  proofs: [],
  commands: [],
  blockers: [],
  warnings: [],
  adoptedPaths: {
    g617Dir,
  },
};

const goalText = readText('GOAL.md');
const humanText = readText('goals/HUMAN_NEEDED.md');
const goalStatuses = mergeGoalStatuses(parseGoalMapStatuses(goalText), parseGoalStatuses(goalText));
const requiredAcceptedGoals = deriveRequiredAcceptedGoals(goalStatuses);
const humanStatuses = parseHumanStatuses(humanText);

for (const goalId of requiredAcceptedGoals) {
  const status = goalStatuses.get(goalId) || 'missing';
  const passed = isAcceptedGoalStatus(status);
  report.goals.push({ id: goalId, status, passed });
  if (!passed) {
    report.blockers.push({
      id: `goal_not_accepted:${goalId}`,
      message: `${goalId} is ${status}, not accepted.`,
    });
  }
}

function isAcceptedGoalStatus(status) {
  return typeof status === 'string' && /^accepted(?:$|-)/.test(status);
}

function deriveRequiredAcceptedGoals(statuses) {
  return [...statuses.keys()]
    .filter((goalId) => /^G6\d+$/.test(goalId))
    .sort((left, right) => Number(left.slice(1)) - Number(right.slice(1)));
}

for (const itemId of requiredHumanItemsClosed) {
  const status = humanStatuses.get(itemId) || 'missing';
  const passed = ['closed', 'accepted', 'resolved'].includes(status);
  report.humanItems.push({ id: itemId, status, passed });
  if (!passed) {
    report.blockers.push({
      id: `human_item_open:${itemId}`,
      message: `${itemId} is ${status}, not closed.`,
    });
  }
}

for (const proof of requiredProofs) {
  const json = readJson(proof.path);
  const passed = Boolean(json && proof.validate(json));
  report.proofs.push({
    id: proof.id,
    goal: proof.goal,
    path: proof.path,
    exists: Boolean(json),
    passed,
    expect: proof.expect,
  });
  if (!passed) {
    report.blockers.push({
      id: `proof_not_complete:${proof.id}`,
      message: `${proof.id} does not prove completion.`,
      path: proof.path,
      expect: proof.expect,
    });
  }
}

for (const command of requiredCommands) {
  report.commands.push(runCommand(command.name, command.args));
}
for (const command of report.commands) {
  if (command.status !== 0) {
    report.blockers.push({
      id: `command_failed:${slug(command.name)}`,
      message: `${command.name} failed.`,
      status: command.status,
    });
  }
}

report.ok = report.blockers.length === 0;
report.summary = {
  ok: report.ok,
  blockers: report.blockers.length,
  acceptedGoals: report.goals.filter((item) => item.passed).length,
  requiredGoals: report.goals.length,
  closedHumanItems: report.humanItems.filter((item) => item.passed).length,
  requiredHumanItems: report.humanItems.length,
  passedProofs: report.proofs.filter((item) => item.passed).length,
  requiredProofs: report.proofs.length,
};

writeJson(summaryPath, report);
console.log(JSON.stringify({ ok: report.ok, summaryPath, blockers: report.blockers.map((item) => item.id) }, null, 2));
process.exit(report.ok || allowIncomplete ? 0 : 1);

function parseGoalStatuses(text) {
  const statuses = new Map();
  const seen = new Map();
  for (const line of text.split('\n')) {
    const trimmed = line.trim();
    if (!/^\|\s*G\d+\s*\|/.test(trimmed)) continue;
    const cells = trimmed.split('|').map((cell) => cell.trim()).filter(Boolean);
    if (cells.length < 2) continue;
    const goalId = cells[0];
    const status = cells[1];
    if (!seen.has(goalId)) seen.set(goalId, new Set());
    seen.get(goalId).add(status);
    statuses.set(goalId, status);
  }
  for (const [goalId, goalStatusesForId] of seen.entries()) {
    if (goalStatusesForId.size > 1) {
      statuses.set(goalId, `conflict:${[...goalStatusesForId].sort().join(',')}`);
    }
  }
  return statuses;
}

function parseGoalMapStatuses(text) {
  const line = text.split('\n').find((item) => item.trim().startsWith('Goal map status:'));
  if (!line) return null;
  const statuses = new Map();
  const seen = new Map();
  const body = line.replace(/^Goal map status:\s*/, '');
  for (const segment of body.split(',')) {
    const item = segment.trim();
    const acceptedMatch = item.match(/^(.+?)\s+accepted$/);
    if (acceptedMatch) {
      for (const goalId of expandGoalList(acceptedMatch[1])) {
        rememberGoalStatus(statuses, seen, goalId, 'accepted');
      }
      continue;
    }
    const statusMatch = item.match(/^(G\d+)\s+(accepted|blocked-exact|queued|human-needed|blocked)$/);
    if (statusMatch) {
      rememberGoalStatus(statuses, seen, statusMatch[1], statusMatch[2]);
    }
  }
  markGoalStatusConflicts(statuses, seen);
  return statuses.size > 0 ? statuses : null;
}

function expandGoalList(value) {
  return value.split('/').flatMap((item) => {
    const token = item.trim();
    const rangeMatch = token.match(/^G(\d+)-G(\d+)$/);
    if (!rangeMatch) return /^G\d+$/.test(token) ? [token] : [];
    const start = Number(rangeMatch[1]);
    const end = Number(rangeMatch[2]);
    const width = rangeMatch[1].length;
    const goals = [];
    for (let valueInRange = start; valueInRange <= end; valueInRange += 1) {
      goals.push(`G${String(valueInRange).padStart(width, '0')}`);
    }
    return goals;
  });
}

function parseHumanStatuses(text) {
  const statuses = new Map();
  for (const line of text.split('\n')) {
    const trimmed = line.trim();
    if (!/^\|\s*H\d+\s*\|/.test(trimmed)) continue;
    const cells = trimmed.split('|').map((cell) => cell.trim()).filter(Boolean);
    if (cells.length < 4) continue;
    statuses.set(cells[0], cells[cells.length - 1].toLowerCase());
  }
  return statuses;
}

function validateG617FreshGeneration(readback, artifactDir) {
  const manifest = readJson(path.join(artifactDir, 'run-manifest.json'));
  const scorecard = readJson(path.join(artifactDir, 'visual-scorecard.json'));
  const readbackCounts = readback?.counts || {};
  const manifestJobs = Array.isArray(manifest?.jobs) ? manifest.jobs : [];
  const readbackJobs = Array.isArray(readback?.jobs) ? readback.jobs : [];
  const readbackImages = Array.isArray(readback?.images) ? readback.images : [];
  const readbackStorage = Array.isArray(readback?.storage) ? readback.storage : [];
  const manifestFeatures = manifestJobs.map((job) => job.feature).filter(Boolean).sort();
  const readbackFeatures = readbackJobs.map((job) => job.feature).filter(Boolean).sort();
  const scorecardRows = normalizeScorecardRows(scorecard);
  const scorecardFeatures = scorecardRows.map((row) => row.feature).filter(Boolean).sort();
  const expectedFeatures = [...allGenerationFeatures].sort();
  const runId = readback?.runId;
  const readbackRefsByFeature = buildReadbackRefsByFeature(readbackJobs, readbackImages, readbackStorage);
  return (
    manifest?.schema === 'heavy-chain.10m-real-generation-qa.v1' &&
    readback?.schema === 'heavy-chain.10m-real-generation-qa-readback.v1' &&
    scorecard?.runId === runId &&
    typeof runId === 'string' &&
    runId.length > 0 &&
    manifest.runId === runId &&
    arraysEqual(manifestFeatures, expectedFeatures) &&
    arraysEqual(readbackFeatures, expectedFeatures) &&
    arraysEqual(scorecardFeatures, expectedFeatures) &&
    manifestJobs.length === allGenerationFeatures.length &&
    readbackJobs.length === allGenerationFeatures.length &&
    scorecardRows.length === allGenerationFeatures.length &&
    manifestJobs.every((job) => String(job.prompt || '').includes(`Marker: ${runId}:`)) &&
    readbackJobs.every((job) => job.marker === runId && job.status === 'completed' && Array.isArray(job.workerImageIds) && job.workerImageIds.length > 0) &&
    scorecardRows.every((row) => row.runId === runId && row.status === 'pass' && scorecardRowMatchesReadback(row, readbackRefsByFeature)) &&
    Number(readbackCounts.jobs || 0) === allGenerationFeatures.length &&
    Number(readbackCounts.completedJobs || 0) === allGenerationFeatures.length &&
    Number(readbackCounts.failedJobs || 0) === 0 &&
    Number(readbackCounts.images || 0) >= allGenerationFeatures.length &&
    Number(readbackCounts.storage || 0) >= allGenerationFeatures.length &&
    Number(readbackCounts.signedUrlOk || 0) >= allGenerationFeatures.length &&
    readbackStorage.length >= allGenerationFeatures.length &&
    readbackStorage.every((row) => row.signedUrlOk === true || row.signed_url_ok === true || row.downloadOk === true || row.download_ok === true) &&
    scorecard?.ok === true &&
    Number(scorecard.summary?.fail || scorecard.fail || 0) === 0 &&
    Number(scorecard.summary?.pass || scorecard.pass || 0) >= allGenerationFeatures.length
  );
}

function normalizeScorecardRows(scorecard) {
  const rawRows = Array.isArray(scorecard?.rows)
    ? scorecard.rows
    : Array.isArray(scorecard?.features)
      ? scorecard.features
      : Array.isArray(scorecard?.items)
        ? scorecard.items
        : [];
  return rawRows.map((row) => ({
    feature: String(row.feature || ''),
    runId: String(row.runId || scorecard?.runId || ''),
    status: String(row.status || row.decision || '').toLowerCase(),
    jobId: String(row.jobId || row.job_id || row.readbackJobId || row.readback_job_id || ''),
    imageId: String(row.imageId || row.image_id || ''),
    imagePath: String(row.imagePath || row.image || row.imageUrl || ''),
    storagePath: String(row.storagePath || row.storage_path || ''),
  }));
}

function buildReadbackRefsByFeature(readbackJobs, readbackImages, readbackStorage) {
  const byFeature = new Map();
  for (const feature of allGenerationFeatures) {
    byFeature.set(feature, { jobIds: new Set(), imageIds: new Set(), storagePaths: new Set() });
  }
  for (const job of readbackJobs) {
    const refs = byFeature.get(job.feature);
    if (refs && job.id) refs.jobIds.add(String(job.id));
  }
  for (const image of readbackImages) {
    const refs = byFeature.get(image.feature);
    if (!refs) continue;
    if (image.id) refs.imageIds.add(String(image.id));
    if (image.jobId || image.job_id) refs.jobIds.add(String(image.jobId || image.job_id));
    if (image.storagePath || image.storage_path) refs.storagePaths.add(String(image.storagePath || image.storage_path));
  }
  for (const row of readbackStorage) {
    const refs = byFeature.get(row.feature);
    if (!refs) continue;
    if (row.imageId || row.image_id) refs.imageIds.add(String(row.imageId || row.image_id));
    if (row.jobId || row.job_id) refs.jobIds.add(String(row.jobId || row.job_id));
    if (row.storagePath || row.storage_path) refs.storagePaths.add(String(row.storagePath || row.storage_path));
  }
  return byFeature;
}

function scorecardRowMatchesReadback(row, readbackRefsByFeature) {
  const refs = readbackRefsByFeature.get(row.feature);
  if (!refs) return false;
  if (row.jobId && refs.jobIds.has(row.jobId)) return true;
  if (row.imageId && refs.imageIds.has(row.imageId)) return true;
  if (row.storagePath && refs.storagePaths.has(row.storagePath)) return true;
  const imagePath = row.imagePath || '';
  if (!imagePath) return false;
  for (const jobId of refs.jobIds) {
    if (imagePath.includes(jobId)) return true;
  }
  for (const imageId of refs.imageIds) {
    if (imagePath.includes(imageId)) return true;
  }
  for (const storagePath of refs.storagePaths) {
    if (imagePath.includes(storagePath)) return true;
  }
  return false;
}

function arraysEqual(left, right) {
  return left.length === right.length && left.every((value, index) => value === right[index]);
}

function rememberGoalStatus(statuses, seen, goalId, status) {
  if (!seen.has(goalId)) seen.set(goalId, new Set());
  seen.get(goalId).add(status);
  statuses.set(goalId, status);
}

function markGoalStatusConflicts(statuses, seen) {
  for (const [goalId, goalStatusesForId] of seen.entries()) {
    if (goalStatusesForId.size > 1) {
      statuses.set(goalId, `conflict:${[...goalStatusesForId].sort().join(',')}`);
    }
  }
}

function mergeGoalStatuses(summaryStatuses, tableStatuses) {
  if (!summaryStatuses) return tableStatuses;
  if (!tableStatuses) return summaryStatuses;
  const merged = new Map(summaryStatuses);
  const goalIds = new Set([...summaryStatuses.keys(), ...tableStatuses.keys()]);
  for (const goalId of goalIds) {
    const summaryStatus = summaryStatuses.get(goalId);
    const tableStatus = tableStatuses.get(goalId);
    if (!summaryStatus && tableStatus) {
      merged.set(goalId, tableStatus);
      continue;
    }
    if (summaryStatus && tableStatus && summaryStatus !== tableStatus) {
      merged.set(goalId, `conflict:goal-map=${summaryStatus};table=${tableStatus}`);
    }
  }
  return merged;
}

function runCommand(name, command) {
  const result = spawnSync(command[0], command.slice(1), {
    encoding: 'utf8',
    maxBuffer: 1024 * 1024 * 5,
  });
  return {
    name,
    command: command.join(' '),
    status: result.status ?? 1,
    stdoutTail: tail(result.stdout || ''),
    stderrTail: tail(result.stderr || ''),
  };
}

function readText(filePath) {
  try {
    return fs.readFileSync(filePath, 'utf8');
  } catch {
    return '';
  }
}

function readJson(filePath) {
  try {
    return JSON.parse(fs.readFileSync(filePath, 'utf8'));
  } catch {
    return null;
  }
}

function hasPassingAssertion(json, assertionId) {
  return Array.isArray(json?.assertions) && json.assertions.some((assertion) =>
    assertion?.id === assertionId && assertion?.ok === true
  );
}

function hasRouteAssertion(json, routeKey, assertionName) {
  const routes = [
    ...(Array.isArray(json?.routes) ? json.routes : []),
    ...(Array.isArray(json?.mobile) ? json.mobile : []),
  ];
  const route = routes.find((item) => item?.key === routeKey);
  return Array.isArray(route?.assertions) && route.assertions.some((assertion) =>
    assertion?.name === assertionName && assertion?.passed === true
  );
}

function writeJson(filePath, data) {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  fs.writeFileSync(filePath, `${JSON.stringify(data, null, 2)}\n`);
}

function tail(value) {
  return value.split('\n').slice(-30).join('\n').trim();
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
    if (!next || next.startsWith('--')) {
      parsed[toCamel(key)] = true;
      parsed[key] = true;
    } else {
      parsed[toCamel(key)] = next;
      parsed[key] = next;
      index += 1;
    }
  }
  return parsed;
}

function toCamel(value) {
  return value.replace(/-([a-z])/g, (_, char) => char.toUpperCase());
}
