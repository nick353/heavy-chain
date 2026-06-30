#!/usr/bin/env node

import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';

const args = parseArgs(process.argv.slice(2));
const outDir = args.out || 'output/playwright/g619-real-beta-evidence';
const manifestPath = args.manifest || path.join(outDir, 'manifest.json');
const sessionId = requiredArg('session-id');
const participantAlias = args.alias || sessionId.replace(/^g619-/, '');
const sessionDir = path.join(outDir, 'sessions', participantAlias);
const collectorAlias = args.collectorAlias || args['collector-alias'] || 'collector-operator';
const reviewerAlias = args.reviewerAlias || args['reviewer-alias'] || collectorAlias;
const platform = args.platform || 'desktop';
const persona = args.persona || 'apparel-ec-operator';
const durationMinutes = Number(args.durationMinutes || args['duration-minutes'] || 0);
const baseUrl = args.baseUrl || args['base-url'] || 'https://heavy-chain.zeabur.app';
const workflows = listArg(args.workflows || 'lightchain_entry,generate_readiness');
const friction = listArg(args.friction || '').map((note) => ({ note }));
const noFrictionNote = args.noFrictionNote || args['no-friction-note'] || '';
const exactBlocker = args.exactBlocker || args['exact-blocker'] || '';
const observationNote = args.observationNote || args['observation-note'] || '';

const hardStopKeys = [
  'billingPurchasePaymentCheckout',
  'identityOtpCaptchaSecurityPrompt',
  'secretEntry',
  'externalPublicPublish',
  'destructiveCleanup',
];

const hardStops = Object.fromEntries(hardStopKeys.map((key) => [key, 'not_touched']));
const consent = {
  confirmed: booleanArg('consent-confirmed', false),
  recordingAllowed: booleanArg('recording-allowed', false),
  publicSharing: booleanArg('public-sharing', false),
};
const redactionReview = {
  noSensitiveTextFound: booleanArg('redaction-reviewed', false),
};

fs.mkdirSync(sessionDir, { recursive: true });

const notesRelative = path.join('sessions', participantAlias, 'notes.md');
const consentRelative = path.join('sessions', participantAlias, 'consent.json');
const redactionRelative = path.join('sessions', participantAlias, 'redaction-review.json');
const readbackRelative = path.join('sessions', participantAlias, 'readback.json');
const observationRelative = path.join('sessions', participantAlias, 'observation.md');
const instructionsRelative = path.join('sessions', participantAlias, 'session-instructions.md');
const checklistRelative = path.join('sessions', participantAlias, 'operator-checklist.md');

writeIfMissing(path.join(outDir, notesRelative), sessionNotes());
writeIfMissing(path.join(outDir, instructionsRelative), sessionInstructions());
writeIfMissing(path.join(outDir, checklistRelative), operatorChecklist());
writeJson(path.join(outDir, consentRelative), {
  schema: 'heavy-chain.g619.beta-session-consent.v1',
  sessionId,
  participantAlias,
  collectedAt: new Date().toISOString(),
  collectorAlias,
  consent,
  scope: {
    productionNonBillingUse: true,
    anonymizedEvidenceOnly: true,
    noPublicSharing: true,
  },
  hardStops,
});
writeJson(path.join(outDir, readbackRelative), {
  schema: 'heavy-chain.g619.beta-session-readback.v1',
  sessionId,
  participantAlias,
  capturedAt: new Date().toISOString(),
  baseUrl,
  platform,
  persona,
  workflows,
  durationMinutes,
  exactBlocker: exactBlocker || null,
  hardStops,
  irreversibleActions: hardStops,
});
if (observationNote) {
  writeIfMissing(path.join(outDir, observationRelative), `# ${sessionId} Observation\n\n${observationNote}\n`);
}
const checkedArtifacts = [notesRelative, instructionsRelative, checklistRelative, consentRelative, readbackRelative];
if (observationNote) checkedArtifacts.push(observationRelative);
writeJson(path.join(outDir, redactionRelative), {
  schema: 'heavy-chain.g619.beta-redaction-review.v1',
  sessionId,
  participantAlias,
  reviewedAt: new Date().toISOString(),
  reviewerAlias,
  noSensitiveTextFound: redactionReview.noSensitiveTextFound,
  checkedArtifacts,
  artifactSha256: Object.fromEntries(checkedArtifacts.map((artifactPath) => [
    artifactPath,
    sha256(path.join(outDir, artifactPath)),
  ])),
  patternsChecked: [
    'email_address',
    'phone_number',
    'payment_card_pattern',
    'otp_or_security_code',
    'api_key',
    'secret_assignment',
  ],
});

const manifest = readManifest();
const session = {
  sessionId,
  participantAlias,
  persona,
  platform,
  baseUrl,
  durationMinutes,
  consent,
  consentArtifact: consentRelative,
  redactionReviewArtifact: redactionRelative,
  readbackArtifact: readbackRelative,
  sessionInstructionsArtifact: instructionsRelative,
  operatorChecklistArtifact: checklistRelative,
  workflows,
  hardStops,
  artifacts: [
    artifact('notes', notesRelative),
    artifact('notes', instructionsRelative),
    artifact('notes', checklistRelative),
    ...(observationNote ? [artifact('observation', observationRelative)] : []),
    artifact('consent', consentRelative),
    artifact('redaction_review', redactionRelative),
    artifact('readback', readbackRelative),
  ],
  friction,
  noFrictionNote,
};
if (exactBlocker) session.exactBlocker = exactBlocker;

manifest.sessions = Array.isArray(manifest.sessions) ? manifest.sessions : [];
const existingIndex = manifest.sessions.findIndex((item) => item.sessionId === sessionId);
if (existingIndex >= 0) {
  manifest.sessions[existingIndex] = session;
} else {
  manifest.sessions.push(session);
}
manifest.capturedAt = new Date().toISOString();
writeJson(manifestPath, manifest);

console.log(JSON.stringify({
  ok: true,
  manifestPath,
  sessionId,
  participantAlias,
  sessionDir,
  note: 'Session scaffold created. G619 is not complete until real consent, real evidence artifacts, redaction review, and npm run verify:g619-beta-evidence pass.',
}, null, 2));

function readManifest() {
  const existing = readJson(manifestPath);
  if (existing) return existing;
  return {
    schema: 'heavy-chain.g619.real-beta-evidence.v1',
    mode: 'consent-safe-real-beta-no-payment-no-public-publish',
    capturedAt: new Date().toISOString(),
    irreversibleActions: hardStops,
    sessions: [],
  };
}

function artifact(type, relativePath) {
  return {
    type,
    path: relativePath,
    sha256: sha256(path.join(outDir, relativePath)),
  };
}

function sessionNotes() {
  return `# ${sessionId} Observation Notes

Participant alias: ${participantAlias}
Persona: ${persona}
Platform: ${platform}
Base URL: ${baseUrl}

## Consent

- Confirmed: ${consent.confirmed}
- Recording allowed: ${consent.recordingAllowed}
- Public sharing: ${consent.publicSharing}

## Workflows

${workflows.map((workflow) => `- ${workflow}`).join('\n')}

## Observations

${observationNote ? `- ${observationNote}` : '- Replace this line with anonymized behavior and friction notes after the real session.'}

## Hard Stops

- Billing/payment/checkout: not touched
- Identity/OTP/CAPTCHA/security prompt: not touched
- Secrets: not touched
- External public publishing: not touched
- Destructive cleanup: not touched
`;
}

function sessionInstructions() {
  return `# ${sessionId} Participant Instructions

This session is for consent-safe Heavy Chain beta evidence. Use only anonymized participant alias \`${participantAlias}\`.

## Allowed

- Open ${baseUrl} and use non-billing product flows.
- Upload only materials the participant confirms they may use for testing.
- Think aloud about confusion, friction, missing labels, and whether the flow feels usable without help.
- Stop before any billing, checkout, payment, public publishing, OTP, CAPTCHA, identity verification, secret entry, or destructive cleanup screen.

## Workflows To Try

${workflows.map((workflow) => `- ${workflow}`).join('\n')}

## What To Capture

- Anonymized behavior notes or transcript.
- Screenshot set or recording when consent allows it.
- Exact blocker text if the participant cannot continue.
- A friction list, or an explicit no-friction note if no meaningful friction was observed.
`;
}

function operatorChecklist() {
  return `# ${sessionId} Operator Checklist

## Before Session

- [ ] Participant consent is confirmed.
- [ ] Recording/screenshot permission is confirmed.
- [ ] Public sharing is disabled.
- [ ] Participant alias is anonymized: ${participantAlias}
- [ ] No personal email, phone number, payment card, OTP, API key, token, or secret will be written into notes.

## During Session

- [ ] Do not coach the participant through the UI unless safety requires stopping.
- [ ] Record friction in participant behavior terms, not personal identity terms.
- [ ] Stop at billing, payment, checkout, OTP/CAPTCHA/security prompt, identity verification, secret entry, external public publish, or destructive cleanup.
- [ ] Record exact blocker if a hard stop is reached.

## After Session

- [ ] Add real observation notes, transcript, screenshots, or recording.
- [ ] Replace scaffold placeholder text in notes.
- [ ] Set durationMinutes to the real duration.
- [ ] Update consent.json and manifest consent fields to match the signed/confirmed consent.
- [ ] Run redaction review over every non-redaction artifact.
- [ ] Run npm run verify:g619-beta-evidence.
`;
}

function requiredArg(name) {
  const value = args[toCamel(name)] || args[name];
  if (!value) {
    console.error(`Missing required --${name}`);
    process.exit(2);
  }
  return value;
}

function booleanArg(name, defaultValue) {
  const value = args[toCamel(name)] ?? args[name];
  if (value === undefined) return defaultValue;
  if (value === true) return true;
  return ['1', 'true', 'yes'].includes(String(value).toLowerCase());
}

function listArg(value) {
  return String(value || '')
    .split(',')
    .map((item) => item.trim())
    .filter(Boolean);
}

function readJson(filePath) {
  try {
    return JSON.parse(fs.readFileSync(filePath, 'utf8'));
  } catch {
    return null;
  }
}

function writeJson(filePath, data) {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  fs.writeFileSync(filePath, `${JSON.stringify(data, null, 2)}\n`);
}

function writeIfMissing(filePath, value) {
  if (fs.existsSync(filePath)) return;
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  fs.writeFileSync(filePath, value);
}

function sha256(filePath) {
  return crypto.createHash('sha256').update(fs.readFileSync(filePath)).digest('hex');
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
      parsed[toCamel(key)] = true;
    } else {
      parsed[key] = next;
      parsed[toCamel(key)] = next;
      index += 1;
    }
  }
  return parsed;
}

function toCamel(value) {
  return value.replace(/-([a-z])/g, (_, char) => char.toUpperCase());
}
