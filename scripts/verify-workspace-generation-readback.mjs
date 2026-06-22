#!/usr/bin/env node

import { existsSync, readFileSync } from 'node:fs';

const DEFAULT_WORKSPACES = ['patterns', 'studio', 'video', 'lab'];
const WORKFLOW_BY_WORKSPACE = {
  patterns: 'pattern-preview-local-v1',
  studio: 'studio-selection-local-v1',
  video: 'video-storyboard-local-v1',
  lab: 'lab-evaluation-local-v1',
};

const args = parseArgs(process.argv.slice(2));
if (!args.readback) {
  console.error('Workspace generation readback verification failed. --readback is required.');
  process.exit(1);
}
if (!args.cleanup) {
  console.error('Workspace generation readback verification failed. --cleanup is required for production closeout proof.');
  process.exit(1);
}

const workspaces = parseList(args.workspaces, DEFAULT_WORKSPACES);
const expectedLightchainTaskCodes = parseList(args.expectLightchainTaskCodes, []);
const failures = [];
const readback = readJson(args.readback);
const cleanup = readJson(args.cleanup);

validateMetadata(args.readback, readback);
validateMetadata(args.cleanup, cleanup);
validateReadback(args.readback, readback);
validateCleanup(args.cleanup, cleanup, readback);

if (failures.length > 0) {
  console.error('Workspace generation readback verification failed. Secret values were not printed.');
  for (const failure of failures) console.error(`- ${failure}`);
  process.exit(1);
}

console.log('Workspace generation readback verification passed. Secret values were not printed.');

function parseArgs(argv) {
  const parsed = {};
  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    const next = argv[index + 1];
    if (arg === '--readback' && next) parsed.readback = next;
    if (arg === '--cleanup' && next) parsed.cleanup = next;
    if (arg === '--expect-release-date' && next) parsed.expectReleaseDate = next;
    if (arg === '--expect-environment' && next) parsed.expectEnvironment = next;
    if (arg === '--expect-git-commit' && next) parsed.expectGitCommit = next;
    if (arg === '--workspaces' && next) parsed.workspaces = next;
    if (arg === '--expect-lightchain-task-codes' && next) parsed.expectLightchainTaskCodes = next;
    if (arg.startsWith('--') && next) index += 1;
  }
  return parsed;
}

function parseList(value, fallback) {
  if (!value) return fallback;
  const values = value
    .split(',')
    .map((item) => item.trim())
    .filter(Boolean);
  return values.length ? values : fallback;
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

function validateMetadata(file, json) {
  if (!json) return;
  const metadata = json.metadata;
  if (!metadata || typeof metadata !== 'object' || Array.isArray(metadata)) {
    addFailure(file, 'metadata is missing');
    return;
  }

  if (!hasValidCapturedAt(metadata.captured_at)) addFailure(file, 'metadata.captured_at is missing or invalid');
  if (args.expectReleaseDate && metadata.release_date !== args.expectReleaseDate) {
    addFailure(file, `metadata.release_date does not match ${args.expectReleaseDate}`);
  }
  if (args.expectEnvironment && metadata.environment !== args.expectEnvironment) {
    addFailure(file, `metadata.environment does not match ${args.expectEnvironment}`);
  }
  if (args.expectGitCommit && metadata.git_commit !== args.expectGitCommit) {
    addFailure(file, `metadata.git_commit does not match ${args.expectGitCommit}`);
  }
}

function validateReadback(file, json) {
  if (!json) return;

  for (const key of ['jobs', 'images', 'usage', 'runs', 'storage']) {
    if (!Array.isArray(json[key]) || json[key].length === 0) {
      addFailure(file, `${key} readback is empty`);
    }
  }
  if (expectedLightchainTaskCodes.length && (!Array.isArray(json.lightchainTaskSteps) || json.lightchainTaskSteps.length === 0)) {
    addFailure(file, 'lightchainTaskSteps readback is empty');
  }

  const jobs = json.jobs ?? [];
  const images = json.images ?? [];
  const usage = json.usage ?? [];
  const runs = json.runs ?? [];
  const storage = json.storage ?? [];
  const lightchainTaskSteps = json.lightchainTaskSteps ?? [];
  const lightchainHitsByTaskCode = new Map(expectedLightchainTaskCodes.map((taskCode) => [taskCode, new Set()]));
  const durableStepHitsByTaskCode = new Map(expectedLightchainTaskCodes.map((taskCode) => [taskCode, new Set()]));

  const jobIdsByWorkspace = new Map();
  const imageStorageByWorkspace = new Map();
  const usageRequestIdsByWorkspace = new Map();
  const runRequestIdsByWorkspace = new Map();

  for (const workspace of workspaces) {
    jobIdsByWorkspace.set(workspace, new Set());
    imageStorageByWorkspace.set(workspace, new Set());
    usageRequestIdsByWorkspace.set(workspace, new Set());
    runRequestIdsByWorkspace.set(workspace, new Set());
  }

  for (const [index, job] of jobs.entries()) {
    const source = sourceInfo(job);
    validateWorkspaceAndVersion(file, `jobs[${index}]`, source);
    validateLightchainCompat(file, `jobs[${index}]`, job, lightchainHitsByTaskCode);
    if (job.status !== 'completed') addFailure(file, `jobs[${index}] is not completed`);
    if (!isNonEmptyString(job.completed_at)) addFailure(file, `jobs[${index}] has no completed_at`);
    if (source.sourceWorkspace && job.id) jobIdsByWorkspace.get(source.sourceWorkspace)?.add(job.id);
  }

  for (const [index, image] of images.entries()) {
    const source = sourceInfo(image);
    validateWorkspaceAndVersion(file, `images[${index}]`, source);
    validateLightchainCompat(file, `images[${index}]`, image, lightchainHitsByTaskCode);
    if (!isNonEmptyString(image.storage_path)) addFailure(file, `images[${index}] has no storage_path`);
    if (hasPersistedImageUrl(image.image_url)) {
      addFailure(file, `images[${index}] persists image_url; expected null, missing, or empty string`);
    }
    if (source.sourceWorkspace && isNonEmptyString(image.storage_path)) {
      imageStorageByWorkspace.get(source.sourceWorkspace)?.add(image.storage_path);
    }
    const knownJobIds = jobIdsByWorkspace.get(source.sourceWorkspace);
    if (source.sourceWorkspace && image.job_id && knownJobIds?.size && !knownJobIds.has(image.job_id)) {
      addFailure(file, `images[${index}] job_id does not match ${source.sourceWorkspace} jobs`);
    }
  }

  for (const [index, row] of usage.entries()) {
    const source = sourceInfo(row);
    validateWorkspaceAndVersion(file, `usage[${index}]`, source);
    if (row.status !== 'succeeded') addFailure(file, `usage[${index}] is not succeeded`);
    if (!Number.isFinite(row.units) || row.units <= 0) addFailure(file, `usage[${index}] has invalid units`);
    if (!isNonEmptyString(row.request_id)) addFailure(file, `usage[${index}] has no request_id`);
    if (!isNonEmptyString(row.completed_at)) addFailure(file, `usage[${index}] has no completed_at`);
    if (source.sourceWorkspace && isNonEmptyString(row.request_id)) {
      usageRequestIdsByWorkspace.get(source.sourceWorkspace)?.add(row.request_id);
    }
  }

  for (const [index, row] of runs.entries()) {
    const source = sourceInfo(row);
    validateWorkspaceAndVersion(file, `runs[${index}]`, source);
    if (row.status !== 'succeeded') addFailure(file, `runs[${index}] is not succeeded`);
    if (!isNonEmptyString(row.request_id)) addFailure(file, `runs[${index}] has no request_id`);
    if (!isNonEmptyString(row.completed_at)) addFailure(file, `runs[${index}] has no completed_at`);
    if (source.sourceWorkspace && isNonEmptyString(row.request_id)) {
      runRequestIdsByWorkspace.get(source.sourceWorkspace)?.add(row.request_id);
    }
  }

  for (const [index, row] of storage.entries()) {
    const source = sourceInfo(row);
    validateWorkspaceAndVersion(file, `storage[${index}]`, source);
    if (!isNonEmptyString(row.storage_path)) addFailure(file, `storage[${index}] has no storage_path`);
    if (row.signedUrlOk !== true) addFailure(file, `storage[${index}] signedUrlOk is not true`);
    const knownPaths = imageStorageByWorkspace.get(source.sourceWorkspace);
    if (source.sourceWorkspace && row.storage_path && knownPaths?.size && !knownPaths.has(row.storage_path)) {
      addFailure(file, `storage[${index}] storage_path does not match ${source.sourceWorkspace} images`);
    }
  }

  for (const [index, row] of lightchainTaskSteps.entries()) {
    const source = sourceInfo(row);
    validateWorkspaceAndVersion(file, `lightchainTaskSteps[${index}]`, source);
    if (!isNonEmptyString(row.job_id)) addFailure(file, `lightchainTaskSteps[${index}] has no job_id`);
    if (!isNonEmptyString(row.task_code)) addFailure(file, `lightchainTaskSteps[${index}] has no task_code`);
    if (!Number.isFinite(row.step_index)) addFailure(file, `lightchainTaskSteps[${index}] has invalid step_index`);
    if (!['queued', 'processing', 'completed', 'failed', 'retryable'].includes(row.status)) {
      addFailure(file, `lightchainTaskSteps[${index}] has invalid status`);
    }
    if (!isNonEmptyString(row.lightchain_feature_id)) addFailure(file, `lightchainTaskSteps[${index}] has no lightchain_feature_id`);
    if (!isNonEmptyString(row.lightchain_feature_title)) addFailure(file, `lightchainTaskSteps[${index}] has no lightchain_feature_title`);
    if (source.sourceWorkspace && row.job_id && !jobIdsByWorkspace.get(source.sourceWorkspace)?.has(row.job_id)) {
      addFailure(file, `lightchainTaskSteps[${index}] job_id does not match ${source.sourceWorkspace} jobs`);
    }
    if (durableStepHitsByTaskCode.has(row.task_code)) {
      durableStepHitsByTaskCode.get(row.task_code)?.add(`lightchainTaskSteps[${index}]`);
    }
  }

  for (const workspace of workspaces) {
    if (!jobIdsByWorkspace.get(workspace)?.size) addFailure(file, `${workspace}: missing completed job readback`);
    if (!imageStorageByWorkspace.get(workspace)?.size) addFailure(file, `${workspace}: missing generated image readback`);
    if (!usageRequestIdsByWorkspace.get(workspace)?.size) addFailure(file, `${workspace}: missing usage request_id readback`);
    if (!runRequestIdsByWorkspace.get(workspace)?.size) addFailure(file, `${workspace}: missing edge run request_id readback`);

    const usageIds = usageRequestIdsByWorkspace.get(workspace) ?? new Set();
    const runIds = runRequestIdsByWorkspace.get(workspace) ?? new Set();
    const hasMatchedRequestId = [...runIds].some((requestId) => usageIds.has(requestId));
    if (usageIds.size && runIds.size && !hasMatchedRequestId) {
      addFailure(file, `${workspace}: usage/runs request_id values do not correspond`);
    }
  }

  for (const taskCode of expectedLightchainTaskCodes) {
    const hitRows = lightchainHitsByTaskCode.get(taskCode);
    if (!hitRows?.size) {
      addFailure(file, `missing Lightchain task code readback: ${taskCode}`);
    }
    const durableStepRows = durableStepHitsByTaskCode.get(taskCode);
    if (!durableStepRows?.size) {
      addFailure(file, `missing durable Lightchain task step row: ${taskCode}`);
    }
  }
}

function validateCleanup(file, cleanup, readback) {
  if (!cleanup) return;

  const remainingProdSmokeUsers = firstFiniteNumber(
    cleanup.remainingProdSmokeUsers,
    cleanup.remainingCounts?.remainingProdSmokeUsers,
  );
  const remainingStorageRows = firstFiniteNumber(
    cleanup.remainingStorageRows,
    cleanup.remainingCounts?.remainingStorageRows,
  );
  const removedStoragePaths = firstFiniteNumber(
    cleanup.removedStoragePaths,
    cleanup.cleanupCounts?.removed_storage_paths,
  );

  if (remainingProdSmokeUsers !== 0) addFailure(file, 'remainingProdSmokeUsers is not zero');
  if (remainingStorageRows !== 0) addFailure(file, 'remainingStorageRows is not zero');

  const readbackStorageCount = Array.isArray(readback?.storage) ? readback.storage.length : workspaces.length;
  if (!Number.isFinite(removedStoragePaths) || removedStoragePaths < readbackStorageCount) {
    addFailure(file, 'removedStoragePaths is missing or less than readback storage count');
  }

  const removedPaths = Array.isArray(cleanup.removedStoragePathList)
    ? cleanup.removedStoragePathList
    : Array.isArray(cleanup.removedStoragePathsList)
      ? cleanup.removedStoragePathsList
      : Array.isArray(cleanup.storageRemoved)
        ? cleanup.storageRemoved
        : [];
  const remainingStorage = Array.isArray(cleanup.remainingStorage)
    ? cleanup.remainingStorage
    : Array.isArray(cleanup.remainingStoragePaths)
      ? cleanup.remainingStoragePaths
      : [];

  for (const row of readback?.storage ?? []) {
    if (!isNonEmptyString(row.storage_path)) continue;
    if (remainingStorage.includes(row.storage_path)) {
      addFailure(file, `storage path still present after cleanup: ${row.storage_path}`);
    }
    if (removedPaths.length && !removedPaths.includes(row.storage_path)) {
      addFailure(file, `storage path missing from cleanup removal list: ${row.storage_path}`);
    }
  }
}

function firstFiniteNumber(...values) {
  for (const value of values) {
    if (Number.isFinite(value)) return value;
  }
  return null;
}

function validateWorkspaceAndVersion(file, label, source) {
  if (!source.sourceWorkspace || !workspaces.includes(source.sourceWorkspace)) {
    addFailure(file, `${label} has invalid sourceWorkspace`);
    return;
  }
  const expectedVersion = WORKFLOW_BY_WORKSPACE[source.sourceWorkspace];
  if (source.workflowVersion !== expectedVersion) {
    addFailure(file, `${label} workflowVersion does not match ${expectedVersion}`);
  }
}

function sourceInfo(row) {
  const candidates = [
    row,
    row.sourceReadback,
    row.generationIntent,
    row.input_params,
    row.input_params?.sourceReadback,
    row.input_params?.generationIntent,
    row.input_params?.generationIntent?.sourceReadback,
    row.metadata,
    row.metadata?.sourceReadback,
    row.metadata?.generationIntent,
    row.metadata?.generationIntent?.sourceReadback,
    row.generation_params,
  ];

  for (const candidate of candidates) {
    if (!candidate || typeof candidate !== 'object' || Array.isArray(candidate)) continue;
    const sourceWorkspace = readString(candidate, 'sourceWorkspace') ?? readString(candidate, 'source_workspace');
    const workflowVersion = readString(candidate, 'workflowVersion') ?? readString(candidate, 'workflow_version');
    if (sourceWorkspace || workflowVersion) return { sourceWorkspace, workflowVersion };
  }
  return {};
}

function validateLightchainCompat(file, label, row, hitsByTaskCode) {
  if (!hitsByTaskCode.size) return;
  const compat = lightchainInfo(row);
  if (!compat) {
    addFailure(file, `${label} is missing lightchainCompat`);
    return;
  }

  if (!isNonEmptyString(compat.lightchainFeatureId)) addFailure(file, `${label} lightchainFeatureId is missing`);
  if (!isNonEmptyString(compat.lightchainFeatureTitle)) addFailure(file, `${label} lightchainFeatureTitle is missing`);
  if (!Array.isArray(compat.lightchainTaskCodes) || compat.lightchainTaskCodes.length === 0) {
    addFailure(file, `${label} lightchainTaskCodes is empty`);
    return;
  }
  if (!Array.isArray(compat.lightchainTaskSteps) || compat.lightchainTaskSteps.length === 0) {
    addFailure(file, `${label} lightchainTaskSteps is empty`);
    return;
  }

  const stepTaskCodes = new Set();
  for (const [stepIndex, step] of compat.lightchainTaskSteps.entries()) {
    if (!step || typeof step !== 'object' || Array.isArray(step)) {
      addFailure(file, `${label} lightchainTaskSteps[${stepIndex}] is invalid`);
      continue;
    }
    if (!isNonEmptyString(step.taskCode)) addFailure(file, `${label} lightchainTaskSteps[${stepIndex}].taskCode is missing`);
    if (!isNonEmptyString(step.status)) addFailure(file, `${label} lightchainTaskSteps[${stepIndex}].status is missing`);
    if (isNonEmptyString(step.taskCode)) stepTaskCodes.add(step.taskCode);
  }

  for (const taskCode of compat.lightchainTaskCodes) {
    if (!stepTaskCodes.has(taskCode)) {
      addFailure(file, `${label} lightchainTaskSteps is missing task ${taskCode}`);
    }
    if (hitsByTaskCode.has(taskCode)) {
      hitsByTaskCode.get(taskCode)?.add(label);
    }
  }
}

function lightchainInfo(row) {
  const candidates = [
    row.lightchainCompat,
    row.input_params?.lightchainCompat,
    row.input_params?.generationIntent?.lightchainCompat,
    row.metadata?.lightchainCompat,
    row.metadata?.generationIntent?.lightchainCompat,
    row.generation_params?.lightchainCompat,
  ];

  for (const candidate of candidates) {
    if (!candidate || typeof candidate !== 'object' || Array.isArray(candidate)) continue;
    return candidate;
  }
  return null;
}

function readString(value, key) {
  const item = value?.[key];
  return typeof item === 'string' && item.trim() ? item.trim() : null;
}

function hasValidCapturedAt(value) {
  return isNonEmptyString(value) && !Number.isNaN(Date.parse(value));
}

function isNonEmptyString(value) {
  return typeof value === 'string' && value.trim().length > 0;
}

function hasPersistedImageUrl(value) {
  return value !== null && value !== undefined && !(typeof value === 'string' && value.trim().length === 0);
}

function addFailure(file, message) {
  failures.push(`${file}: ${message}`);
}

function containsLikelySecret(raw) {
  const patterns = [
    /eyJ[A-Za-z0-9_-]{20,}\.[A-Za-z0-9_-]{20,}\.[A-Za-z0-9_-]{20,}/,
    /sk-[A-Za-z0-9_-]{20,}/,
    /service_role[_-]?[A-Za-z0-9_-]{20,}/i,
    /AIza[0-9A-Za-z_-]{20,}/,
    /sb_secret_[A-Za-z0-9_-]{20,}/i,
  ];
  return patterns.some((pattern) => pattern.test(raw));
}
