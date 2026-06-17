#!/usr/bin/env node

import { existsSync, readFileSync } from 'node:fs';

const defaults = {
  readback: 'output/playwright/prod-db-readback.json',
  cleanup: 'output/playwright/prod-cleanup.json',
  rateLimit: 'output/playwright/rate-limit-db-proof-2.json',
  rateLimitCleanup: 'output/playwright/rate-limit-cleanup-2.json',
};

const args = process.argv.slice(2);
const paths = { ...defaults };
const expectations = {
  releaseDate: null,
  environment: null,
  gitCommit: null,
};

for (let index = 0; index < args.length; index += 1) {
  const arg = args[index];
  const next = args[index + 1];
  if (arg === '--readback' && next) paths.readback = next;
  if (arg === '--cleanup' && next) paths.cleanup = next;
  if (arg === '--rate-limit' && next) paths.rateLimit = next;
  if (arg === '--rate-limit-cleanup' && next) paths.rateLimitCleanup = next;
  if (arg === '--expect-release-date' && next) expectations.releaseDate = next;
  if (arg === '--expect-environment' && next) expectations.environment = next;
  if (arg === '--expect-git-commit' && next) expectations.gitCommit = next;
  if (arg.startsWith('--') && next) index += 1;
}

const failures = [];

function addFailure(file, message) {
  failures.push(`${file}: ${message}`);
}

function readJson(file) {
  if (!existsSync(file)) {
    addFailure(file, 'missing proof file');
    return null;
  }

  const raw = readFileSync(file, 'utf8');
  if (containsLikelySecret(raw)) {
    addFailure(file, 'contains a value that looks like a secret; remove or redact it before release evidence');
    return null;
  }

  try {
    return JSON.parse(raw);
  } catch {
    addFailure(file, 'invalid JSON');
    return null;
  }
}

function containsLikelySecret(raw) {
  const patterns = [
    /eyJ[A-Za-z0-9_-]{20,}\.[A-Za-z0-9_-]{20,}\.[A-Za-z0-9_-]{20,}/,
    /sk-[A-Za-z0-9_-]{20,}/,
    /service_role[_-]?[A-Za-z0-9_-]{20,}/i,
    /AIza[0-9A-Za-z_-]{20,}/,
  ];
  return patterns.some((pattern) => pattern.test(raw));
}

function isNonEmptyString(value) {
  return typeof value === 'string' && value.trim().length > 0;
}

function isArrayWithRows(value) {
  return Array.isArray(value) && value.length > 0;
}

function hasPersistedImageUrl(value) {
  return value !== null && value !== undefined && !(typeof value === 'string' && value.trim().length === 0);
}

function expectsMetadata() {
  return Boolean(expectations.releaseDate || expectations.environment || expectations.gitCommit);
}

function metadataFor(json) {
  if (json?.metadata && typeof json.metadata === 'object' && !Array.isArray(json.metadata)) {
    return json.metadata;
  }
  return json && typeof json === 'object' && !Array.isArray(json) ? json : null;
}

function hasValidCapturedAt(value) {
  return isNonEmptyString(value) && !Number.isNaN(Date.parse(value));
}

function validateMetadata(file, json) {
  if (!expectsMetadata() || !json) return;

  const metadata = metadataFor(json);
  if (!metadata) {
    addFailure(file, 'metadata is missing');
    return;
  }

  if (expectations.releaseDate && metadata.release_date !== expectations.releaseDate) {
    addFailure(file, `metadata.release_date does not match ${expectations.releaseDate}`);
  }
  if (expectations.environment && metadata.environment !== expectations.environment) {
    addFailure(file, `metadata.environment does not match ${expectations.environment}`);
  }
  if (expectations.gitCommit && metadata.git_commit !== expectations.gitCommit) {
    addFailure(file, `metadata.git_commit does not match ${expectations.gitCommit}`);
  }
  if (!hasValidCapturedAt(metadata.captured_at)) {
    addFailure(file, 'metadata.captured_at is missing or invalid');
  }
}

const readback = readJson(paths.readback);
const cleanup = readJson(paths.cleanup);
const rateLimit = readJson(paths.rateLimit);
const rateLimitCleanup = readJson(paths.rateLimitCleanup);

validateMetadata(paths.readback, readback);
validateMetadata(paths.cleanup, cleanup);
validateMetadata(paths.rateLimit, rateLimit);
validateMetadata(paths.rateLimitCleanup, rateLimitCleanup);

if (readback) {
  if (!isArrayWithRows(readback.jobs)) addFailure(paths.readback, 'jobs readback is empty');
  if (!isArrayWithRows(readback.images)) addFailure(paths.readback, 'generated image readback is empty');
  if (!isArrayWithRows(readback.usage)) addFailure(paths.readback, 'usage event readback is empty');
  if (!isArrayWithRows(readback.runs)) addFailure(paths.readback, 'edge function run readback is empty');
  if (!isArrayWithRows(readback.storage)) addFailure(paths.readback, 'storage readback is empty');

  for (const [index, job] of (readback.jobs || []).entries()) {
    if (job.status !== 'completed') addFailure(paths.readback, `jobs[${index}] is not completed`);
    if (!isNonEmptyString(job.completed_at)) addFailure(paths.readback, `jobs[${index}] has no completed_at`);
  }

  for (const [index, image] of (readback.images || []).entries()) {
    if (!isNonEmptyString(image.storage_path)) addFailure(paths.readback, `images[${index}] has no storage_path`);
    if (hasPersistedImageUrl(image.image_url)) {
      addFailure(paths.readback, `images[${index}] persists image_url; expected null, missing, or empty string`);
    }
  }

  const usageRequestIds = new Set();
  for (const [index, usage] of (readback.usage || []).entries()) {
    if (usage.status !== 'succeeded') addFailure(paths.readback, `usage[${index}] is not succeeded`);
    if (!Number.isFinite(usage.units) || usage.units <= 0) addFailure(paths.readback, `usage[${index}] has invalid units`);
    if (!isNonEmptyString(usage.request_id)) addFailure(paths.readback, `usage[${index}] has no request_id`);
    if (!isNonEmptyString(usage.completed_at)) addFailure(paths.readback, `usage[${index}] has no completed_at`);
    if (isNonEmptyString(usage.request_id)) usageRequestIds.add(usage.request_id);
  }

  for (const [index, run] of (readback.runs || []).entries()) {
    if (run.status !== 'succeeded') addFailure(paths.readback, `runs[${index}] is not succeeded`);
    if (!isNonEmptyString(run.request_id)) addFailure(paths.readback, `runs[${index}] has no request_id`);
    if (isNonEmptyString(run.request_id) && usageRequestIds.size > 0 && !usageRequestIds.has(run.request_id)) {
      addFailure(paths.readback, `runs[${index}] request_id does not match usage readback`);
    }
  }

  for (const [index, object] of (readback.storage || []).entries()) {
    if (!isNonEmptyString(object.storage_path)) addFailure(paths.readback, `storage[${index}] has no storage_path`);
    if (object.signedUrlOk !== true) addFailure(paths.readback, `storage[${index}] did not prove signed URL access`);
  }
}

if (cleanup) {
  if (!Array.isArray(cleanup.deletedUsers)) addFailure(paths.cleanup, 'deletedUsers is missing');
  if (cleanup.remainingProdSmokeUsers !== 0) addFailure(paths.cleanup, 'remainingProdSmokeUsers is not zero');
  if (!Number.isFinite(cleanup.removedStoragePaths) || cleanup.removedStoragePaths < 1) {
    addFailure(paths.cleanup, 'removedStoragePaths is missing or zero');
  }
}

if (rateLimit) {
  if (rateLimit.staleTriggerOk !== true) addFailure(paths.rateLimit, 'stale reservation trigger did not succeed');
  if (rateLimit.staleAfter?.status !== 'released') addFailure(paths.rateLimit, 'stale reservation was not released');
  if (rateLimit.staleAfter?.metadata?.reservation_stale !== true) {
    addFailure(paths.rateLimit, 'stale reservation metadata is missing reservation_stale');
  }

  const attempts = rateLimit.brandAttempts || [];
  if (!isArrayWithRows(attempts)) addFailure(paths.rateLimit, 'brandAttempts is empty');
  const failedRateLimit = attempts.some(
    (attempt) => attempt.ok === false && /rate limit exceeded/i.test(attempt.message || ''),
  );
  const successfulAttempts = attempts.filter((attempt) => attempt.ok === true).length;
  if (successfulAttempts < 5) addFailure(paths.rateLimit, 'not enough successful attempts before rate-limit denial');
  if (!failedRateLimit) addFailure(paths.rateLimit, 'missing explicit rate-limit denial');
}

if (rateLimitCleanup) {
  if (!Array.isArray(rateLimitCleanup.deletedUsers)) addFailure(paths.rateLimitCleanup, 'deletedUsers is missing');
  if (rateLimitCleanup.remainingRateSmokeUsers !== 0) {
    addFailure(paths.rateLimitCleanup, 'remainingRateSmokeUsers is not zero');
  }
}

if (failures.length > 0) {
  console.error('Release readback verification failed. Secret values were not printed.');
  for (const failure of failures) console.error(`- ${failure}`);
  process.exit(1);
}

console.log('Release readback verification passed. Secret values were not printed.');
