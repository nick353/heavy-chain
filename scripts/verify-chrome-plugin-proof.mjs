#!/usr/bin/env node

import { createHash } from 'node:crypto';
import { existsSync, readFileSync, statSync } from 'node:fs';

const args = process.argv.slice(2);
const options = {
  evidence: '',
  releaseDate: null,
  environment: null,
  gitCommit: null,
  maxAgeHours: 48,
};
const parseFailures = [];

function requireValue(arg, next) {
  if (!next || next.startsWith('--')) {
    parseFailures.push(`${arg} requires a value`);
    return null;
  }
  return next;
}

for (let index = 0; index < args.length; index += 1) {
  const arg = args[index];
  const next = args[index + 1];
  if (arg === '--evidence') {
    const value = requireValue(arg, next);
    if (value) {
      options.evidence = value;
      index += 1;
    }
  } else if (arg === '--expect-release-date') {
    const value = requireValue(arg, next);
    if (value) {
      options.releaseDate = value;
      index += 1;
    }
  } else if (arg === '--expect-environment') {
    const value = requireValue(arg, next);
    if (value) {
      options.environment = value;
      index += 1;
    }
  } else if (arg === '--expect-git-commit') {
    const value = requireValue(arg, next);
    if (value) {
      options.gitCommit = value;
      index += 1;
    }
  } else if (arg === '--max-age-hours') {
    const value = requireValue(arg, next);
    if (value) {
      options.maxAgeHours = Number(value);
      index += 1;
    }
  } else if (arg.startsWith('--')) {
    parseFailures.push(`unknown argument ${arg}`);
  }
}

const failures = [...parseFailures];
const addFailure = (message) => failures.push(message);
const isNonEmptyString = (value) => typeof value === 'string' && value.trim().length > 0;
const isIsoDate = (value) => isNonEmptyString(value) && !Number.isNaN(Date.parse(value));
const isSha256 = (value) => /^[a-f0-9]{64}$/i.test(String(value || ''));

if (!options.evidence) addFailure('--evidence is required');
if (options.releaseDate && !/^\d{4}-\d{2}-\d{2}$/.test(options.releaseDate)) {
  addFailure('--expect-release-date must be YYYY-MM-DD');
}
if (options.environment && !/^(staging|prod|production|preview|development|local)$/.test(options.environment)) {
  addFailure('--expect-environment is invalid');
}
if (options.gitCommit && !/^[0-9a-f]{40}$/i.test(options.gitCommit)) {
  addFailure('--expect-git-commit must be a 40 character hex commit');
}
if (!Number.isFinite(options.maxAgeHours) || options.maxAgeHours <= 0) {
  addFailure('--max-age-hours must be a positive number');
}

const likelySecretPatterns = [
  /eyJ[A-Za-z0-9_-]{20,}\.[A-Za-z0-9_-]{20,}\.[A-Za-z0-9_-]{20,}/,
  /(^|[^A-Za-z0-9_-])sk-[A-Za-z0-9_-]{20,}/,
  /AIza[0-9A-Za-z_-]{20,}/,
  /service_role[_-]?[A-Za-z0-9_-]{20,}/i,
];

let evidence = null;
if (options.evidence && existsSync(options.evidence)) {
  const raw = readFileSync(options.evidence, 'utf8');
  if (likelySecretPatterns.some((pattern) => pattern.test(raw))) {
    addFailure('evidence contains a value that looks like a secret');
  }
  try {
    evidence = JSON.parse(raw);
  } catch {
    addFailure('evidence is not valid JSON');
  }
} else if (options.evidence) {
  addFailure(`evidence file is missing: ${options.evidence}`);
}

const readback = evidence?.chromeContinuationHistoryGalleryJobsCanvasReadback20260818;
const rootSurface = evidence?.surface;
const rootTab = evidence?.tab;

if (!isNonEmptyString(rootSurface) || !/Chrome Plugin/i.test(rootSurface)) {
  addFailure('root evidence surface is not Chrome Plugin');
}
if (!isNonEmptyString(rootTab?.id)) addFailure('root evidence tab id is missing');
if (!/^https:\/\/heavy-chain\.zeabur\.app\//.test(rootTab?.urlAfterScan || '')) {
  addFailure('root evidence tab is not the Heavy Chain production host');
}
if (!readback || typeof readback !== 'object') {
  addFailure('fresh History/Gallery/Jobs/Canvas readback is missing');
}

if (readback) {
  if (!/^Chrome Plugin \/ same authenticated session \/ fresh tab \S+$/.test(readback.surface || '')) {
    addFailure('readback surface is not a same-session fresh Chrome Plugin tab');
  }
  if (!isIsoDate(readback.observedAt)) {
    addFailure('readback observedAt is missing or invalid');
  } else {
    const ageHours = (Date.now() - Date.parse(readback.observedAt)) / 3600000;
    if (ageHours < -0.25) addFailure('readback observedAt is in the future');
    if (ageHours > options.maxAgeHours) addFailure(`readback is older than ${options.maxAgeHours} hours`);
    if (options.releaseDate && readback.observedAt.slice(0, 10) !== options.releaseDate) {
      addFailure(`readback observedAt does not match release date ${options.releaseDate}`);
    }
  }
  if (options.environment && !/production|prod/i.test(rootSurface || '')) {
    addFailure(`root evidence surface does not identify ${options.environment}`);
  }

  if (readback.history?.route !== '/history' || Number(readback.history?.timelineItems) < 1) {
    addFailure('History readback is missing a non-empty timeline');
  }
  if (readback.gallery?.route !== '/gallery' || Number(readback.gallery?.totalImages) < 1) {
    addFailure('Gallery readback is missing a non-empty library');
  }
  if (readback.jobs?.route !== '/jobs' || Number(readback.jobs?.completed) < 0 || Number(readback.jobs?.stopped) < 0) {
    addFailure('Jobs readback is missing completed/stopped counts');
  }
  if (readback.canvas?.route !== '/canvas' || readback.canvas?.gallerySelection !== 'selected from existing Gallery') {
    addFailure('Canvas readback is missing existing Gallery selection');
  }
  if (readback.canvas?.devLogReadback?.errors !== 0) addFailure('Canvas readback contains runtime errors');

  for (const [label, artifact] of [['download', readback.canvas?.download], ['export', readback.canvas?.export]]) {
    if (!artifact?.filesystemVerified) {
      addFailure(`${label} artifact was not filesystem verified`);
      continue;
    }
    if (!isNonEmptyString(artifact.path) || !artifact.path.startsWith('/')) {
      addFailure(`${label} artifact path is not absolute`);
      continue;
    }
    if (!existsSync(artifact.path)) {
      addFailure(`${label} artifact is missing: ${artifact.path}`);
      continue;
    }
    const info = statSync(artifact.path);
    if (!info.isFile() || info.size !== Number(artifact.bytes)) {
      addFailure(`${label} artifact size does not match evidence`);
      continue;
    }
    const digest = createHash('sha256').update(readFileSync(artifact.path)).digest('hex');
    if (!isSha256(artifact.sha256) || digest !== artifact.sha256.toLowerCase()) {
      addFailure(`${label} artifact SHA-256 does not match evidence`);
    }
  }
}

const output = {
  schema: 'heavy-chain.chrome-plugin-proof.v1',
  checkedAt: new Date().toISOString(),
  evidence: options.evidence,
  surface: 'Chrome Plugin',
  accepted: failures.length === 0,
  failures,
  irreversibleActions: {
    openAiApi: 'not_touched',
    generation: 'not_clicked',
    retry: 'not_clicked',
    billing: 'not_touched',
    runway: 'not_invoked',
  },
};

if (failures.length) {
  console.error(JSON.stringify(output, null, 2));
  process.exit(1);
}

console.log(JSON.stringify(output, null, 2));
