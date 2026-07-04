#!/usr/bin/env node

import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';

const args = parseArgs(process.argv.slice(2));
const outDir = args.out || 'output/playwright/g619-real-beta-evidence';
const manifestPath = args.manifest || path.join(outDir, 'manifest.json');
const summaryPath = args.summary || path.join(outDir, 'summary.json');
const evidenceRoot = path.resolve(args.evidenceDir || args['evidence-dir'] || path.dirname(manifestPath));
const initTemplate = args.initTemplate === true || args['init-template'] === true;
const minSessions = Number(args.minSessions || args['min-sessions'] || 3);
const minWorkflows = Number(args.minWorkflows || args['min-workflows'] || 5);

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
const h601H602ChecklistPath = 'docs/h601-h602-operator-decision-checklist-2026-07-04.md';
const h601H602DecisionStatus = 'open_not_closed_by_g619';
const requiredChecklistPhrases = [
  h601H602ChecklistPath,
  'H601/H602 decisions remain separate and open',
  'Apple login',
  'OTP/CAPTCHA/security prompt',
  'checkout confirmation',
  'real or sandbox purchase',
  'identity verification',
  'external publishing',
  'legal-policy finalization',
];

const allowedArtifactTypes = new Set(['notes', 'transcript', 'observation', 'observation_notes', 'recording', 'screenshots', 'screenshot', 'readback', 'consent', 'redaction_review']);
const allowedArtifactExtensions = new Set(['.md', '.txt', '.json', '.webm', '.mp4', '.mov', '.png', '.jpg', '.jpeg']);
const textArtifactExtensions = new Set(['.md', '.txt', '.json']);
const artifactExtensionsByType = new Map([
  ['notes', new Set(['.md', '.txt'])],
  ['transcript', new Set(['.md', '.txt'])],
  ['observation', new Set(['.md', '.txt'])],
  ['observation_notes', new Set(['.md', '.txt'])],
  ['readback', new Set(['.json'])],
  ['consent', new Set(['.json'])],
  ['redaction_review', new Set(['.json'])],
  ['recording', new Set(['.webm', '.mp4', '.mov'])],
  ['screenshots', new Set(['.png', '.jpg', '.jpeg'])],
  ['screenshot', new Set(['.png', '.jpg', '.jpeg'])],
]);
const behaviorEvidenceTypes = new Set(['transcript', 'observation', 'observation_notes', 'recording', 'screenshots', 'screenshot']);
const scaffoldPlaceholderPatterns = [
  /Replace this line with anonymized behavior and friction notes after the real session\./i,
];

const piiPatterns = [
  { id: 'email_address', pattern: /[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/i },
  { id: 'phone_number', pattern: /\b(?:phone|tel|電話|携帯)\s*[:=]?\s*(?:\+?\d[\d\s().-]{8,}\d)/i },
  { id: 'payment_card_pattern', pattern: /\b(?:\d[ -]*?){13,19}\b/ },
  { id: 'otp_or_security_code', pattern: /\b(?:otp|security code|認証コード|確認コード)\s*[:=]?\s*\d{4,8}\b/i },
  { id: 'api_key', pattern: /\b(?:sk-[A-Za-z0-9_-]{12,}|AIza[0-9A-Za-z_-]{12,}|eyJ[A-Za-z0-9_-]{20,}\.[A-Za-z0-9_-]{20,}\.[A-Za-z0-9_-]{20,})\b/ },
  { id: 'secret_assignment', pattern: /\b(?:SUPABASE|OPENAI|GEMINI|RUNWAY|VITE)_[A-Z0-9_]*(?:KEY|TOKEN|SECRET)\s*[=:]\s*\S+/i },
];

if (initTemplate) {
  fs.mkdirSync(outDir, { recursive: true });
  if (!fs.existsSync(manifestPath)) {
    fs.writeFileSync(manifestPath, `${JSON.stringify(templateManifest(), null, 2)}\n`);
  }
  writeSummary({
    schema: 'heavy-chain.g619.real-beta-evidence-verifier.v1',
    ok: false,
    mode: 'template-created-not-accepted',
    manifestPath,
    summaryPath,
    blockers: [
      {
        id: 'real_beta_evidence_missing',
        message: 'Template manifest exists, but real consented beta evidence has not been collected.',
      },
    ],
    checks: [],
    warnings: [],
  });
  console.log(JSON.stringify({ ok: false, manifestPath, summaryPath, blocker: 'real_beta_evidence_missing' }, null, 2));
  process.exit(1);
}

const report = {
  schema: 'heavy-chain.g619.real-beta-evidence-verifier.v1',
  capturedAt: new Date().toISOString(),
  mode: 'consent-safe-real-beta-evidence-no-payment-no-public-publish',
  manifestPath,
  summaryPath,
  evidenceRoot,
  thresholds: {
    minSessions,
    minWorkflows,
    requiredWorkflows,
  },
  irreversibleActions: {
    billingPurchasePaymentCheckout: 'not_touched',
    identityOtpCaptchaSecurityPrompt: 'not_touched',
    secretEntry: 'not_touched',
    externalPublicPublish: 'not_touched',
    destructiveCleanup: 'not_touched',
  },
  checks: [],
  warnings: [],
  blockers: [],
};

const manifest = readJson(manifestPath);
addCheck('manifest exists and is parseable', Boolean(manifest), { manifestPath });

if (manifest) {
  validateManifest(manifest);
}

for (const check of report.checks) {
  if (!check.passed) {
    report.blockers.push({
      id: `check_failed:${slug(check.name)}`,
      message: `${check.name} failed.`,
      details: check.details,
    });
  }
}

report.ok = report.blockers.length === 0;
report.summary = {
  ok: report.ok,
  checks: report.checks.length,
  blockers: report.blockers.length,
  warnings: report.warnings.length,
  sessions: Array.isArray(manifest?.sessions) ? manifest.sessions.length : 0,
  workflows: manifest ? uniqueWorkflows(manifest).length : 0,
};

writeSummary(report);
console.log(JSON.stringify({ ok: report.ok, summaryPath, blockers: report.blockers.map((item) => item.id) }, null, 2));
process.exit(report.ok ? 0 : 1);

function validateManifest(manifest) {
  const sessions = Array.isArray(manifest.sessions) ? manifest.sessions : [];
  const workflows = uniqueWorkflows(manifest);
  const personas = new Set(sessions.map((session) => session.persona).filter(Boolean));
  const platforms = new Set(sessions.map((session) => session.platform).filter(Boolean));

  addCheck('manifest schema is G619 real beta evidence', manifest.schema === 'heavy-chain.g619.real-beta-evidence.v1', {
    schema: manifest.schema ?? null,
  });
  addCheck('manifest declares safe mode', manifest.mode === 'consent-safe-real-beta-no-payment-no-public-publish', {
    mode: manifest.mode ?? null,
  });
  addCheck('manifest has at least required sessions', sessions.length >= minSessions, {
    sessions: sessions.length,
    minSessions,
  });
  addCheck('manifest covers desktop and mobile', platforms.has('desktop') && platforms.has('mobile'), {
    platforms: [...platforms],
  });
  addCheck('manifest covers at least two personas', personas.size >= 2, {
    personas: [...personas],
  });
  addCheck('manifest covers enough distinct workflows', workflows.length >= minWorkflows, {
    workflows,
    minWorkflows,
  });
  addCheck('manifest covers required workflows', requiredWorkflows.every((workflow) => workflows.includes(workflow)), {
    workflows,
    requiredWorkflows,
  });
  addCheck('manifest declares no irreversible actions', hardStopKeys.every((key) => manifest.irreversibleActions?.[key] === 'not_touched'), {
    irreversibleActions: manifest.irreversibleActions ?? null,
  });

  const textBlobs = [JSON.stringify(manifest)];
  const evidenceFiles = [];
  for (const session of sessions) {
    validateSession(session, evidenceFiles, textBlobs);
  }

  const piiFindings = findSensitiveText(textBlobs.join('\n'));
  addCheck('manifest and notes contain no sensitive text patterns', piiFindings.length === 0, {
    findings: piiFindings,
  });
  addCheck('every referenced evidence file exists', evidenceFiles.every((filePath) => fs.existsSync(filePath)), {
    missing: evidenceFiles.filter((filePath) => !fs.existsSync(filePath)),
    evidenceFiles,
  });
}

function validateSession(session, evidenceFiles, textBlobs) {
  const prefix = `session ${session?.sessionId || 'unknown'}`;
  const artifacts = Array.isArray(session?.artifacts) ? session.artifacts : [];
  const friction = Array.isArray(session?.friction) ? session.friction : [];
  const meaningfulFriction = friction.filter(hasMeaningfulFriction);
  const workflows = Array.isArray(session?.workflows) ? session.workflows : [];
  const consent = session?.consent || {};
  const hardStops = session?.hardStops || {};
  const consentArtifact = findRegisteredArtifact(session, 'consent', session?.consentArtifact);
  const redactionArtifact = findRegisteredArtifact(session, 'redaction_review', session?.redactionReviewArtifact);
  const readbackArtifact = findRegisteredArtifact(session, 'readback', session?.readbackArtifact);
  const instructionsArtifact = findExplicitRegisteredArtifact(session, 'notes', session?.sessionInstructionsArtifact);
  const checklistArtifact = findExplicitRegisteredArtifact(session, 'notes', session?.operatorChecklistArtifact);
  const consentJson = consentArtifact ? readJson(resolveArtifactPath(consentArtifact.path)) : null;
  const redactionJson = redactionArtifact ? readJson(resolveArtifactPath(redactionArtifact.path)) : null;
  const readbackJson = readbackArtifact ? readJson(resolveArtifactPath(readbackArtifact.path)) : null;
  const checklistText = checklistArtifact?.path ? readText(resolveArtifactPath(checklistArtifact.path)) : '';
  const nonRedactionArtifactPaths = artifacts
    .filter((artifact) => artifact?.type !== 'redaction_review')
    .map((artifact) => artifact.path)
    .filter(Boolean);

  addCheck(`${prefix} uses anonymized participant alias`, /^beta-[0-9a-z-]+$/i.test(String(session?.participantAlias || '')), {
    participantAlias: session?.participantAlias ?? null,
  });
  addCheck(`${prefix} has consent`, consent.confirmed === true && consent.recordingAllowed === true && consent.publicSharing === false, {
    consent,
  });
  addCheck(`${prefix} consent artifact is registered with sha256`, Boolean(consentArtifact?.sha256), {
    consentArtifact: session?.consentArtifact ?? null,
    registeredArtifact: consentArtifact ?? null,
  });
  addCheck(`${prefix} has consent artifact`, Boolean(consentJson), {
    consentArtifact: consentArtifact?.path ?? null,
  });
  addCheck(`${prefix} consent artifact matches manifest`, Boolean(
    consentJson &&
    consentJson.schema === 'heavy-chain.g619.beta-session-consent.v1' &&
    consentJson.sessionId === session?.sessionId &&
    consentJson.participantAlias === session?.participantAlias &&
    consentJson.collectorAlias &&
    consentJson.consent?.confirmed === consent.confirmed &&
    consentJson.consent?.recordingAllowed === consent.recordingAllowed &&
    consentJson.consent?.publicSharing === consent.publicSharing &&
    consentJson.scope?.productionNonBillingUse === true &&
    consentJson.scope?.anonymizedEvidenceOnly === true &&
    consentJson.scope?.noPublicSharing === true &&
    consentJson.scope?.h601H602ChecklistPath === h601H602ChecklistPath &&
    consentJson.scope?.h601H602DecisionStatus === h601H602DecisionStatus &&
    hardStopKeys.every((key) => consentJson.hardStops?.[key] === 'not_touched') &&
    operatorOnlyHardStopKeys.every((key) => consentJson.operatorOnlyHardStops?.[key] === 'not_touched')
  ), {
    consentArtifact: consentArtifact?.path ?? null,
  });
  addCheck(`${prefix} has participant instructions artifact`, Boolean(instructionsArtifact?.sha256), {
    sessionInstructionsArtifact: session?.sessionInstructionsArtifact ?? null,
    registeredArtifact: instructionsArtifact ?? null,
  });
  addCheck(`${prefix} has operator checklist artifact`, Boolean(checklistArtifact?.sha256), {
    operatorChecklistArtifact: session?.operatorChecklistArtifact ?? null,
    registeredArtifact: checklistArtifact ?? null,
  });
  addCheck(`${prefix} has H601/H602 checklist linkage`, Boolean(
    session?.h601H602ChecklistPath === h601H602ChecklistPath &&
    session?.h601H602DecisionStatus === h601H602DecisionStatus &&
    requiredChecklistPhrases.every((phrase) => checklistText.includes(phrase))
  ), {
    h601H602ChecklistPath: session?.h601H602ChecklistPath ?? null,
    h601H602DecisionStatus: session?.h601H602DecisionStatus ?? null,
    missingPhrases: requiredChecklistPhrases.filter((phrase) => !checklistText.includes(phrase)),
  });
  addCheck(`${prefix} uses production target`, /^https:\/\/heavy-chain\.zeabur\.app(?:\/|$)/.test(String(session?.baseUrl || '')), {
    baseUrl: session?.baseUrl ?? null,
  });
  addCheck(`${prefix} has useful duration`, Number(session?.durationMinutes || 0) >= 5, {
    durationMinutes: session?.durationMinutes ?? null,
  });
  addCheck(`${prefix} has workflow coverage`, workflows.length >= 2, {
    workflows,
  });
  addCheck(`${prefix} hard stops were respected`, hardStopKeys.every((key) => hardStops[key] === 'not_touched'), {
    hardStops,
  });
  addCheck(`${prefix} operator-only hard stops were respected`, operatorOnlyHardStopKeys.every((key) => session?.operatorOnlyHardStops?.[key] === 'not_touched'), {
    operatorOnlyHardStops: session?.operatorOnlyHardStops ?? null,
  });
  addCheck(`${prefix} has readback artifact`, Boolean(readbackArtifact?.sha256 && readbackJson), {
    readbackArtifact: session?.readbackArtifact ?? null,
    registeredArtifact: readbackArtifact ?? null,
  });
  addCheck(`${prefix} readback artifact matches manifest`, Boolean(
    readbackJson &&
    readbackJson.schema === 'heavy-chain.g619.beta-session-readback.v1' &&
    readbackJson.sessionId === session?.sessionId &&
    readbackJson.participantAlias === session?.participantAlias &&
    readbackJson.baseUrl === session?.baseUrl &&
    readbackJson.platform === session?.platform &&
    readbackJson.persona === session?.persona &&
    Number(readbackJson.durationMinutes || 0) === Number(session?.durationMinutes || 0) &&
    arraysEqual(readbackJson.workflows, workflows) &&
    readbackJson.h601H602ChecklistPath === h601H602ChecklistPath &&
    readbackJson.h601H602DecisionStatus === h601H602DecisionStatus &&
    hardStopKeys.every((key) => readbackJson.hardStops?.[key] === 'not_touched') &&
    operatorOnlyHardStopKeys.every((key) => readbackJson.operatorOnlyHardStops?.[key] === 'not_touched') &&
    hardStopKeys.every((key) => readbackJson.irreversibleActions?.[key] === 'not_touched')
  ), {
    readbackArtifact: readbackArtifact?.path ?? null,
  });
  addCheck(`${prefix} redaction review artifact is registered with sha256`, Boolean(redactionArtifact?.sha256), {
    redactionReviewArtifact: session?.redactionReviewArtifact ?? null,
    registeredArtifact: redactionArtifact ?? null,
  });
  addCheck(`${prefix} has redaction review artifact`, Boolean(redactionJson), {
    redactionReviewArtifact: redactionArtifact?.path ?? null,
  });
  addCheck(`${prefix} redaction review passed`, Boolean(
    redactionJson &&
    redactionJson.schema === 'heavy-chain.g619.beta-redaction-review.v1' &&
    redactionJson.sessionId === session?.sessionId &&
    redactionJson.participantAlias === session?.participantAlias &&
    redactionJson.reviewerAlias &&
    redactionJson.noSensitiveTextFound === true &&
    Array.isArray(redactionJson.checkedArtifacts) &&
    redactionJson.checkedArtifacts.length > 0 &&
    nonRedactionArtifactPaths.every((artifactPath) => redactionJson.checkedArtifacts.includes(artifactPath)) &&
    nonRedactionArtifactPaths.every((artifactPath) => {
      const artifact = artifacts.find((item) => item.path === artifactPath);
      return artifact?.sha256 && redactionJson.artifactSha256?.[artifactPath] === artifact.sha256;
    })
  ), {
    redactionReviewArtifact: redactionArtifact?.path ?? null,
    checkedArtifacts: redactionJson?.checkedArtifacts ?? null,
    requiredArtifacts: nonRedactionArtifactPaths,
  });
  addCheck(`${prefix} has friction list or no-friction note`, meaningfulFriction.length > 0 || String(session?.noFrictionNote || '').trim().length > 0, {
    frictionCount: friction.length,
    meaningfulFrictionCount: meaningfulFriction.length,
    noFrictionNote: session?.noFrictionNote ?? null,
  });
  textBlobs.push(JSON.stringify({
    sessionId: session?.sessionId,
    participantAlias: session?.participantAlias,
    persona: session?.persona,
    workflows,
    friction,
    noFrictionNote: session?.noFrictionNote ?? null,
    exactBlocker: session?.exactBlocker ?? null,
  }));

  let usableBehaviorArtifactCount = 0;
  for (const artifact of artifacts) {
    addCheck(`${prefix} artifact has path`, typeof artifact?.path === 'string' && artifact.path.trim().length > 0, {
      artifact,
    });
    if (!artifact?.path) continue;
    const resolved = resolveArtifactPath(artifact.path);
    const extension = path.extname(String(artifact.path || '')).toLowerCase();
    const expectedExtensions = artifactExtensionsByType.get(artifact.type) || new Set();
    const hasMatchingTypeAndExtension =
      allowedArtifactTypes.has(artifact.type) &&
      allowedArtifactExtensions.has(extension) &&
      expectedExtensions.has(extension);
    const exists = Boolean(resolved) && fs.existsSync(resolved);
    addCheck(`${prefix} artifact ${artifact.path} stays inside evidence root`, Boolean(resolved), {
      artifactPath: artifact.path,
      evidenceRoot,
      resolved,
    });
    addCheck(`${prefix} artifact ${artifact.path} uses matching allowed type and extension`, hasMatchingTypeAndExtension, {
      type: artifact.type ?? null,
      extension,
      expectedExtensions: [...expectedExtensions],
    });
    if (!resolved) continue;
    evidenceFiles.push(resolved);
    addCheck(`${prefix} artifact ${artifact.path} has sha256`, typeof artifact.sha256 === 'string' && /^[a-f0-9]{64}$/i.test(artifact.sha256), {
      artifactPath: artifact.path,
    });
    addCheck(`${prefix} artifact ${artifact.path} sha256 matches`, Boolean(artifact.sha256) && exists && sha256(resolved) === artifact.sha256, {
      artifactPath: artifact.path,
      hasSha256: Boolean(artifact.sha256),
    });
    if (hasMatchingTypeAndExtension && exists && behaviorEvidenceTypes.has(artifact.type) && isUsableBehaviorArtifact(artifact, resolved)) {
      usableBehaviorArtifactCount += 1;
    }
    if (textArtifactExtensions.has(extension) && fs.existsSync(resolved)) {
      const text = fs.readFileSync(resolved, 'utf8');
      textBlobs.push(text);
      addCheck(`${prefix} artifact ${artifact.path} is not scaffold placeholder text`, !scaffoldPlaceholderPatterns.some((pattern) => pattern.test(text)), {
        artifactPath: artifact.path,
      });
    }
  }
  addCheck(`${prefix} has usable behavior evidence artifact`, usableBehaviorArtifactCount > 0, {
    artifacts,
    usableBehaviorArtifactCount,
    acceptedTypes: [...behaviorEvidenceTypes],
  });
}

function findRegisteredArtifact(session, type, explicitPath) {
  const artifacts = Array.isArray(session?.artifacts) ? session.artifacts : [];
  if (explicitPath) {
    return artifacts.find((artifact) => artifact?.type === type && artifact?.path === explicitPath) || null;
  }
  return artifacts.find((artifact) => artifact?.type === type) || null;
}

function findExplicitRegisteredArtifact(session, type, explicitPath) {
  if (!explicitPath) return null;
  return findRegisteredArtifact(session, type, explicitPath);
}

function resolveArtifactPath(artifactPath) {
  if (typeof artifactPath !== 'string' || !artifactPath || path.isAbsolute(artifactPath)) return null;
  const resolved = path.resolve(evidenceRoot, artifactPath);
  const relative = path.relative(evidenceRoot, resolved);
  if (relative.startsWith('..') || path.isAbsolute(relative)) return null;
  return resolved;
}

function uniqueWorkflows(manifest) {
  return [...new Set((manifest.sessions || []).flatMap((session) =>
    Array.isArray(session.workflows) ? session.workflows : []
  ))].sort();
}

function findSensitiveText(text) {
  const findings = [];
  for (const item of piiPatterns) {
    if (item.pattern.test(text)) findings.push(item.id);
  }
  return findings;
}

function sha256(filePath) {
  return crypto.createHash('sha256').update(fs.readFileSync(filePath)).digest('hex');
}

function hasMeaningfulFriction(item) {
  if (typeof item === 'string') return item.trim().length > 0;
  if (!item || typeof item !== 'object') return false;
  return ['note', 'summary', 'description'].some((key) => String(item[key] || '').trim().length > 0);
}

function isUsableBehaviorArtifact(artifact, filePath) {
  const extension = path.extname(String(artifact.path || '')).toLowerCase();
  const stats = fs.statSync(filePath);
  if (['.md', '.txt'].includes(extension)) {
    const text = fs.readFileSync(filePath, 'utf8').trim();
    return text.length >= 200 && !scaffoldPlaceholderPatterns.some((pattern) => pattern.test(text));
  }
  if (['.png', '.jpg', '.jpeg'].includes(extension)) {
    return stats.size >= 1024 && hasImageMagicBytes(filePath, extension);
  }
  if (['.webm', '.mp4', '.mov'].includes(extension)) {
    return stats.size >= 4096;
  }
  return false;
}

function hasImageMagicBytes(filePath, extension) {
  const header = fs.readFileSync(filePath).subarray(0, 12);
  if (extension === '.png') return header.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]));
  if (extension === '.jpg' || extension === '.jpeg') return header[0] === 0xff && header[1] === 0xd8 && header[2] === 0xff;
  return false;
}

function arraysEqual(left, right) {
  if (!Array.isArray(left) || !Array.isArray(right) || left.length !== right.length) return false;
  return left.every((value, index) => value === right[index]);
}

function templateManifest() {
  return {
    schema: 'heavy-chain.g619.real-beta-evidence.v1',
    mode: 'consent-safe-real-beta-no-payment-no-public-publish',
    capturedAt: new Date().toISOString(),
    irreversibleActions: Object.fromEntries(hardStopKeys.map((key) => [key, 'not_touched'])),
    operatorOnlyHardStops: Object.fromEntries(operatorOnlyHardStopKeys.map((key) => [key, 'not_touched'])),
    sessions: [
      {
        sessionId: 'g619-beta-001',
        participantAlias: 'beta-001',
        persona: 'apparel-ec-operator',
        platform: 'desktop',
        baseUrl: 'https://heavy-chain.zeabur.app',
        durationMinutes: 0,
        consent: {
          confirmed: false,
          recordingAllowed: false,
          publicSharing: false,
        },
        workflows: ['lightchain_entry', 'generate_readiness', 'upload_material'],
        h601H602ChecklistPath,
        h601H602DecisionStatus,
        hardStops: Object.fromEntries(hardStopKeys.map((key) => [key, 'not_touched'])),
        operatorOnlyHardStops: Object.fromEntries(operatorOnlyHardStopKeys.map((key) => [key, 'not_touched'])),
        readbackArtifact: 'sessions/beta-001/readback.json',
        sessionInstructionsArtifact: 'sessions/beta-001/session-instructions.md',
        operatorChecklistArtifact: 'sessions/beta-001/operator-checklist.md',
        artifacts: [
          { type: 'notes', path: 'sessions/beta-001/notes.md' },
          { type: 'notes', path: 'sessions/beta-001/session-instructions.md' },
          { type: 'notes', path: 'sessions/beta-001/operator-checklist.md' },
          { type: 'recording', path: 'sessions/beta-001-recording.webm' },
        ],
        friction: [],
        noFrictionNote: '',
      },
    ],
  };
}

function readJson(filePath) {
  try {
    return JSON.parse(fs.readFileSync(filePath, 'utf8'));
  } catch {
    return null;
  }
}

function readText(filePath) {
  try {
    return fs.readFileSync(filePath, 'utf8');
  } catch {
    return '';
  }
}

function addCheck(name, passed, details = {}) {
  report.checks.push({ name, passed: Boolean(passed), details });
}

function writeSummary(summary) {
  fs.mkdirSync(path.dirname(summaryPath), { recursive: true });
  fs.writeFileSync(summaryPath, `${JSON.stringify(summary, null, 2)}\n`);
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

function slug(value) {
  return String(value).replace(/[^a-z0-9]+/gi, '_').replace(/^_+|_+$/g, '').toLowerCase();
}
