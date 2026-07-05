#!/usr/bin/env node

import fs from 'node:fs';
import path from 'node:path';

const args = parseArgs(process.argv.slice(2));
const outDir = args.out || 'output/playwright/g619-real-beta-evidence';
const manifestPath = args.manifest || path.join(outDir, 'manifest.json');
const summaryPath = args.summary || path.join(outDir, 'readiness-summary.json');
const evidenceRoot = path.resolve(args.evidenceDir || args['evidence-dir'] || path.dirname(manifestPath));
const strict = args.strict === true;

const requiredWorkflows = [
  'lightchain_entry',
  'generate_readiness',
  'upload_material',
  'canvas_edit',
  'gallery_or_history_reuse',
  'jobs_or_failure_recovery',
];
const hardStopKeys = [
  'billingPurchasePaymentCheckout',
  'identityOtpCaptchaSecurityPrompt',
  'secretEntry',
  'externalPublicPublish',
  'destructiveCleanup',
];
const operatorOnlyHardStopKeys = [
  'appleLogin',
  'sandboxOrRealPurchase',
  'checkoutConfirmation',
  'legalPolicyFinalization',
];
const behaviorEvidenceTypes = new Set(['transcript', 'observation', 'observation_notes', 'recording', 'screenshots', 'screenshot']);
const placeholderPatterns = [
  /Replace this line with anonymized behavior and friction notes after the real session\./i,
];

const manifest = readJson(manifestPath);
const sessions = Array.isArray(manifest?.sessions) ? manifest.sessions : [];
const workflows = [...new Set(sessions.flatMap((session) => Array.isArray(session.workflows) ? session.workflows : []))].sort();
const sessionReports = sessions.map((session) => summarizeSession(session));
const manifestMissing = [];

if (!manifest) {
  manifestMissing.push('manifest_missing_or_unparseable');
} else {
  if (manifest.schema !== 'heavy-chain.g619.real-beta-evidence.v1') manifestMissing.push('manifest_schema');
  if (manifest.mode !== 'consent-safe-real-beta-no-payment-no-public-publish') manifestMissing.push('safe_mode');
  if (sessions.length < 3) manifestMissing.push('at_least_3_sessions');
  if (!requiredWorkflows.every((workflow) => workflows.includes(workflow))) manifestMissing.push('required_workflow_coverage');
  if (!hardStopKeys.every((key) => manifest.irreversibleActions?.[key] === 'not_touched')) manifestMissing.push('manifest_hard_stops_not_touched');
}

const readySessions = sessionReports.filter((session) => session.ready).length;
const missingBySession = Object.fromEntries(sessionReports.map((session) => [session.sessionId, session.missing]));
const summary = {
  schema: 'heavy-chain.g619.beta-readiness-not-acceptance.v1',
  capturedAt: new Date().toISOString(),
  mode: 'readiness-checklist-not-acceptance',
  ok: manifestMissing.length === 0 && sessionReports.every((session) => session.ready),
  acceptance: 'not_claimed',
  manifestPath,
  summaryPath,
  evidenceRoot,
  thresholds: {
    sessionsRequired: 3,
    requiredWorkflows,
  },
  summary: {
    sessions: sessions.length,
    readySessions,
    manifestMissing,
    workflows,
    missingCount: manifestMissing.length + sessionReports.reduce((sum, session) => sum + session.missing.length, 0),
  },
  sessions: sessionReports,
  nextActions: buildNextActions(manifestMissing, missingBySession),
  hardStops: {
    billingCheckoutPaymentPurchase: 'do_not_touch',
    appleLoginCredentialOtpCaptchaIdentitySecurityPrompt: 'do_not_touch',
    secretEntry: 'do_not_touch',
    externalPublish: 'do_not_touch',
    destructiveCleanup: 'do_not_touch',
  },
};

fs.mkdirSync(path.dirname(summaryPath), { recursive: true });
fs.writeFileSync(summaryPath, `${JSON.stringify(summary, null, 2)}\n`);
console.log(JSON.stringify({
  ok: summary.ok,
  acceptance: summary.acceptance,
  summaryPath,
  missingCount: summary.summary.missingCount,
  readySessions,
  sessions: sessionReports.map((session) => ({
    sessionId: session.sessionId,
    participantAlias: session.participantAlias,
    ready: session.ready,
    missing: session.missing,
  })),
}, null, 2));

process.exit(strict && !summary.ok ? 1 : 0);

function summarizeSession(session) {
  const artifacts = Array.isArray(session?.artifacts) ? session.artifacts : [];
  const consent = session?.consent || {};
  const friction = Array.isArray(session?.friction) ? session.friction : [];
  const missing = [];

  if (!session?.sessionId) missing.push('session_id');
  if (!/^beta-[0-9a-z-]+$/i.test(String(session?.participantAlias || ''))) missing.push('anonymized_participant_alias');
  if (!(consent.confirmed === true && consent.recordingAllowed === true && consent.publicSharing === false)) missing.push('consent_confirmed_recording_allowed_public_sharing_false');
  if (Number(session?.durationMinutes || 0) < 5) missing.push('duration_minutes_at_least_5');
  if (!hasFrictionOrNoFrictionNote(session, friction)) missing.push('friction_or_no_friction_note');
  if (!hardStopKeys.every((key) => session?.hardStops?.[key] === 'not_touched')) missing.push('session_hard_stops_not_touched');
  if (!operatorOnlyHardStopKeys.every((key) => session?.operatorOnlyHardStops?.[key] === 'not_touched')) missing.push('operator_only_hard_stops_not_touched');

  const consentArtifact = findArtifact(session, 'consent', session?.consentArtifact);
  const readbackArtifact = findArtifact(session, 'readback', session?.readbackArtifact);
  const redactionArtifact = findArtifact(session, 'redaction_review', session?.redactionReviewArtifact);
  const redactionJson = redactionArtifact ? readJson(resolveArtifactPath(redactionArtifact.path)) : null;

  if (!consentArtifact?.sha256 || !artifactExists(consentArtifact)) missing.push('consent_artifact');
  if (!readbackArtifact?.sha256 || !artifactExists(readbackArtifact)) missing.push('readback_artifact');
  if (!redactionArtifact?.sha256 || !redactionJson) {
    missing.push('redaction_review_artifact');
  } else if (redactionJson.noSensitiveTextFound !== true) {
    missing.push('redaction_review_passed');
  }

  if (!artifacts.some((artifact) => behaviorEvidenceTypes.has(artifact?.type) && artifactExists(artifact))) {
    missing.push('usable_behavior_evidence_artifact');
  }
  if (artifacts.some((artifact) => artifact?.type === 'notes' && artifactHasPlaceholder(artifact))) {
    missing.push('replace_scaffold_placeholder_notes');
  }

  return {
    sessionId: session?.sessionId || 'unknown',
    participantAlias: session?.participantAlias || null,
    platform: session?.platform || null,
    persona: session?.persona || null,
    workflows: Array.isArray(session?.workflows) ? session.workflows : [],
    ready: missing.length === 0,
    missing,
    nextActions: missing.map((item) => nextActionFor(item)),
  };
}

function hasFrictionOrNoFrictionNote(session, friction) {
  const meaningfulFriction = friction.some((item) => {
    if (typeof item === 'string') return item.trim().length > 0;
    return ['note', 'summary', 'description'].some((key) => String(item?.[key] || '').trim().length > 0);
  });
  return meaningfulFriction || String(session?.noFrictionNote || '').trim().length > 0;
}

function findArtifact(session, type, explicitPath) {
  const artifacts = Array.isArray(session?.artifacts) ? session.artifacts : [];
  if (explicitPath) return artifacts.find((artifact) => artifact?.type === type && artifact?.path === explicitPath) || null;
  return artifacts.find((artifact) => artifact?.type === type) || null;
}

function artifactExists(artifact) {
  const resolved = resolveArtifactPath(artifact?.path);
  return Boolean(resolved && fs.existsSync(resolved) && typeof artifact?.sha256 === 'string' && artifact.sha256.length === 64);
}

function artifactHasPlaceholder(artifact) {
  const resolved = resolveArtifactPath(artifact?.path);
  if (!resolved || !fs.existsSync(resolved)) return false;
  const ext = path.extname(String(artifact.path || '')).toLowerCase();
  if (!['.md', '.txt'].includes(ext)) return false;
  const text = fs.readFileSync(resolved, 'utf8');
  return placeholderPatterns.some((pattern) => pattern.test(text));
}

function resolveArtifactPath(artifactPath) {
  if (typeof artifactPath !== 'string' || !artifactPath || path.isAbsolute(artifactPath)) return null;
  const resolved = path.resolve(evidenceRoot, artifactPath);
  const relative = path.relative(evidenceRoot, resolved);
  if (relative.startsWith('..') || path.isAbsolute(relative)) return null;
  return resolved;
}

function buildNextActions(manifestMissing, missingBySession) {
  const actions = [];
  if (manifestMissing.length > 0) actions.push(`Fix manifest-level fields: ${manifestMissing.join(', ')}`);
  for (const [sessionId, missing] of Object.entries(missingBySession)) {
    if (missing.length === 0) continue;
    actions.push(`${sessionId}: ${missing.map((item) => nextActionFor(item)).join(' / ')}`);
  }
  if (actions.length === 0) actions.push('Run npm run verify:g619-beta-evidence for strict acceptance.');
  return actions;
}

function nextActionFor(item) {
  const labels = {
    consent_confirmed_recording_allowed_public_sharing_false: 'record consent confirmed=true, recordingAllowed=true, publicSharing=false',
    duration_minutes_at_least_5: 'record real durationMinutes >= 5',
    friction_or_no_friction_note: 'add a friction list or explicit noFrictionNote',
    redaction_review_passed: 'complete redaction review with noSensitiveTextFound=true',
    usable_behavior_evidence_artifact: 'attach observation/transcript/screenshot/recording evidence',
    replace_scaffold_placeholder_notes: 'replace scaffold placeholder text in notes.md',
  };
  return labels[item] || item;
}

function readJson(filePath) {
  try {
    return JSON.parse(fs.readFileSync(filePath, 'utf8'));
  } catch {
    return null;
  }
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
