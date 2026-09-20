#!/usr/bin/env node

import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { isAbsolute, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { verifyScaleOpsEvidence } from './cloudflare-scale-ops-evidence.mjs';
import { verifyWorkspaceEvidence } from './cloudflare-workspace-evidence.mjs';
import { apiOrigin, validID } from './monitor-production-health.mjs';

export const CONTRACT_SCHEMA = 'heavy-chain.cloudflare-release-readback-contract.v1';
export const MAX_FRESHNESS_MS = 15 * 60 * 1000;

const REQUIRED_EVIDENCE = new Map([
  ['workspace_readback', {
    schema: 'heavy-chain.workspace-readback.v2',
    validator: 'verifyWorkspaceEvidence',
  }],
  ['provider_receipt_readback', {
    schema: 'heavy-chain.cloudflare-provider-receipt.v1',
    validator: 'unsupported',
  }],
  ['authenticated_production_readback', {
    schema: 'heavy-chain.cloudflare-authenticated-production-readback.v1',
    validator: 'unsupported',
  }],
]);

const SUPPORTING_EVIDENCE = new Map([
  ['g618_local', {
    schemas: new Set(['heavy-chain.g618.scale-ops-baseline.v2', 'heavy-chain.production-monitor.v2']),
    validators: new Set(['verifyG618LocalEvidence', 'verifyScaleOpsEvidence']),
  }],
  ['h602_local', {
    schemas: new Set(['heavy-chain.h602.cloudflare-billing-readiness.v1']),
    validators: new Set(['verifyH602LocalEvidence']),
  }],
]);

const resultBase = () => ({
  schema: CONTRACT_SCHEMA,
  mode: 'local_only',
  ok: false,
  valid: false,
  contractValid: false,
  accepted: false,
  releaseApproval: false,
  businessCompletion: 'not_verified',
  productionStatus: 'not_verified',
  failures: [],
  evidence: [],
  productionProof: { status: 'not_verified' },
});

/**
 * Validate a caller-supplied local Cloudflare release manifest. This function
 * only reads paths explicitly named by the manifest or by inputPaths. It does
 * not contact a service, invoke a process, or promote local evidence to an
 * approval or a production-completion claim.
 */
export function verifyCloudflareReleaseReadback(options = {}) {
  const result = resultBase();
  const failures = [];
  const fail = code => {
    if (!failures.includes(code)) failures.push(code);
  };
  const finish = () => ({
    ...result,
    ok: failures.length === 0,
    valid: failures.length === 0,
    contractValid: failures.length === 0,
    failures,
  });

  const manifestPath = options.manifestPath ?? options.manifest ?? options.contractPath;
  if (!isLocalPath(manifestPath)) {
    fail('manifest_path_required');
    return finish();
  }

  const root = resolve(typeof options.root === 'string' && options.root.trim() ? options.root : process.cwd());
  const now = parseNow(options.now, fail);
  if (!Number.isFinite(now)) return finish();

  const manifestRead = readJsonAtPath(resolveLocalPath(root, manifestPath));
  if (!manifestRead.ok) {
    fail(manifestRead.code === 'missing_input' ? 'manifest_missing' : 'manifest_invalid_json');
    return finish();
  }
  const manifest = manifestRead.value;
  if (!isRecord(manifest)) {
    fail('manifest_not_object');
    return finish();
  }

  if (manifest.schema !== CONTRACT_SCHEMA) fail('unknown_contract_schema');
  if (manifest.mode !== 'local_only') fail('invalid_mode');
  if (manifest.releaseApproval !== false) fail('release_approval_must_be_false');
  if (manifest.businessCompletion !== 'not_verified') fail('business_completion_must_be_not_verified');

  const context = normalizeReleaseContext(manifest.releaseContext, now, fail);
  if (!context) return finish();

  const required = validateDeclarations(manifest.requiredEvidence, REQUIRED_EVIDENCE, 'required', context, fail);
  const supporting = validateDeclarations(manifest.supportingEvidence, SUPPORTING_EVIDENCE, 'supporting', context, fail);
  if (!required || !supporting) return finish();

  const inputOverrides = normalizeInputOverrides(options.inputPaths ?? options.inputs, fail);
  const declaredArtifacts = collectDeclaredArtifacts([...required, ...supporting], inputOverrides, root, fail);
  const artifactRefs = validateArtifactRefs(manifest.artifactRefs, declaredArtifacts, root, fail);
  if (!artifactRefs) return finish();

  const parsedInputs = new Map();
  for (const artifact of declaredArtifacts) {
    const path = resolveLocalPath(root, artifact.path);
    const ref = artifactRefs.get(path);
    const read = readAndVerifyArtifact(path, ref);
    if (!read.ok) {
      fail(read.code);
      continue;
    }
    parsedInputs.set(path, read.value);
  }

  for (const entry of [...required, ...supporting]) {
    const inputPath = inputPathFor(entry, inputOverrides);
    if (!inputPath) {
      if (entry.id === 'provider_receipt_readback' || entry.id === 'authenticated_production_readback') {
        validateUnverifiedDeclaration(entry, fail);
      } else {
        fail('incomplete_evidence');
      }
      continue;
    }

    const parsed = parsedInputs.get(resolveLocalPath(root, inputPath));
    if (parsed === undefined) continue;
    validateEvidenceFreshness(entry, parsed, context, now, fail);
    validateEvidence(entry, parsed, context, manifest, root, fail);
  }

  const final = finish();
  final.evidence = [...required, ...supporting].map(entry => ({
    id: entry.id,
    schema: entry.schema,
    status: entry.status ?? null,
    materialized: Boolean(inputPathFor(entry, inputOverrides)),
  }));
  final.unverified = ['provider_receipt_readback', 'authenticated_production_readback'];
  return final;
}

function validateEvidence(entry, evidence, context, manifest, root, fail) {
  if (!isRecord(evidence)) {
    fail('incomplete_evidence');
    return;
  }
  if (evidence.releaseApproval === true || evidence.accepted === true) fail('self_asserted_release_approval');

  if (entry.id === 'workspace_readback') {
    validateWorkspaceEvidence(entry, evidence, context, root, fail);
    return;
  }
  if (entry.id === 'g618_local') {
    validateG618Evidence(entry, evidence, context, fail);
    return;
  }
  if (entry.id === 'h602_local') {
    validateH602Evidence(evidence, context, fail);
    return;
  }
  if (entry.id === 'provider_receipt_readback' || entry.id === 'authenticated_production_readback') {
    fail('unsupported_evidence_contract');
    return;
  }
  fail('unknown_evidence_schema');
}

function validateWorkspaceEvidence(entry, report, context, root, fail) {
  if (report.schema !== 'heavy-chain.workspace-readback.v2') {
    fail('unknown_evidence_schema');
    return;
  }

  const expectationsPath = entry.expectationsPath ?? entry.expectedPath ?? entry.expectations;
  if (!isLocalPath(expectationsPath)) {
    fail('incomplete_evidence');
    return;
  }

  const expectedRead = readJsonAtPath(resolveLocalPath(root, expectationsPath));
  if (!expectedRead.ok) {
    fail(expectedRead.code === 'missing_input' ? 'missing_input' : 'invalid_json');
    return;
  }
  const expected = expectedRead.value;
  const expectedJobs = context.jobs;
  if (!isRecord(expected) || expected.apiOrigin !== context.apiOrigin || expected.brandId !== context.brandId ||
      expected.userId !== context.ownerId || Date.parse(expected.since) !== Date.parse(context.observation.since) ||
      !sameJobs(expected.jobs, expectedJobs)) {
    fail('scope_mismatch');
    return;
  }

  let checked;
  try {
    checked = verifyWorkspaceEvidence(report, expected, context.now);
  } catch {
    fail('incomplete_evidence');
    return;
  }
  if (checked.persistedEvidenceConsistent !== true || checked.businessCompletion !== 'not_verified') {
    for (const code of checked.failures ?? []) mapWorkspaceFailure(code, fail);
    if (checked.persistedEvidenceConsistent !== true && !(checked.failures ?? []).length) fail('incomplete_evidence');
  }
}

function validateG618Evidence(entry, report, context, fail) {
  if (report.schema === 'heavy-chain.production-monitor.v2') {
    const scope = entry.scope;
    if (!isRecord(scope) || scope.apiOrigin !== context.apiOrigin || scope.brandId !== context.brandId) {
      fail('scope_mismatch');
      return;
    }
    const expected = {
      apiOrigin: context.apiOrigin,
      brandId: context.brandId,
      windowHours: scope.windowHours,
      maxFailureRate: scope.maxFailureRate,
      minStorageImages: scope.minStorageImages,
    };
    const checks = verifyScaleOpsEvidence(report, expected, context.now);
    if (!checks.length || !checks.every(check => check?.passed === true)) fail('incomplete_evidence');
    return;
  }

  if (report.schema !== 'heavy-chain.g618.scale-ops-baseline.v2') {
    fail('unknown_evidence_schema');
    return;
  }
  const scope = entry.scope;
  const expectations = report.monitorExpectations;
  if (report.ok !== true || report.businessCompletion !== 'not_verified' || !Array.isArray(report.blockers) || report.blockers.length ||
      !isRecord(scope) || scope.apiOrigin !== context.apiOrigin || scope.brandId !== context.brandId ||
      !isRecord(expectations) || expectations.apiOrigin !== context.apiOrigin || expectations.brandId !== context.brandId ||
      expectations.windowHours !== scope.windowHours || expectations.maxFailureRate !== scope.maxFailureRate ||
      expectations.minStorageImages !== scope.minStorageImages) {
    fail('incomplete_evidence');
  }
  if (report.releaseApproval === true) fail('self_asserted_release_approval');
}

function validateH602Evidence(report, context, fail) {
  if (report.schema !== 'heavy-chain.h602.cloudflare-billing-readiness.v1' || report.ok !== true ||
      report.mode !== 'local_cloudflare_contract_only' || report.contractStatus !== 'verified_local' ||
      report.releaseApproval !== false || report.productionProof?.status !== 'not_verified') {
    fail('incomplete_evidence');
  }
  if (report.productionProof?.status === 'verified' || report.authenticated === true) {
    fail('unsupported_evidence_contract');
  }
  if (report.scope?.apiOrigin && report.scope.apiOrigin !== context.apiOrigin) fail('scope_mismatch');
  if (report.scope?.brandId && report.scope.brandId !== context.brandId) fail('scope_mismatch');
}

function validateEvidenceFreshness(entry, evidence, context, now, fail) {
  const raw = evidence.capturedAt ?? evidence.checkedAt ?? evidence.observedAt;
  const timestamp = Date.parse(raw);
  if (!Number.isFinite(timestamp)) {
    fail('incomplete_evidence');
    return;
  }
  if (timestamp > now) fail('future_observation');
  if (now - timestamp > MAX_FRESHNESS_MS) fail('stale_observation');
  const since = Date.parse(context.observation.since);
  const until = Date.parse(context.observation.until);
  if (timestamp < since || timestamp > until) fail('scope_mismatch');
  if (entry.freshness !== '15_minutes') fail('invalid_freshness_contract');
}

function validateUnverifiedDeclaration(entry, fail) {
  const allowed = REQUIRED_EVIDENCE.get(entry.id);
  if (!allowed || entry.schema !== allowed.schema || entry.validator !== 'unsupported' || entry.status !== 'not_verified') {
    fail('unsupported_evidence_contract');
  }
  if (entry.inputPath !== null && entry.inputPath !== undefined) fail('unsupported_evidence_contract');
  if (entry.scope?.status !== 'not_verified') fail('unsupported_evidence_contract');
  if (entry.verified === true || entry.authenticated === true || entry.productionVerified === true || entry.releaseApproval === true) {
    fail('unsupported_evidence_contract');
  }
}

function validateDeclarations(value, allowed, kind, context, fail) {
  if (!Array.isArray(value) || value.length !== allowed.size) {
    fail(kind === 'required' ? 'incomplete_required_evidence' : 'incomplete_supporting_evidence');
    return null;
  }
  const seen = new Set();
  for (const entry of value) {
    if (!isRecord(entry) || typeof entry.id !== 'string' || seen.has(entry.id)) {
      fail('duplicate_evidence');
      continue;
    }
    seen.add(entry.id);
    const declaration = allowed.get(entry.id);
    if (!declaration) {
      fail('unknown_evidence_schema');
      continue;
    }
    if (declaration.schema && entry.schema !== declaration.schema) {
      if (!(declaration.schemas instanceof Set && declaration.schemas.has(entry.schema))) fail('unknown_evidence_schema');
    }
    if (declaration.validator && entry.validator !== declaration.validator) {
      if (!(declaration.validators instanceof Set && declaration.validators.has(entry.validator))) fail('unsupported_evidence_contract');
    }
    const inputPath = entry.inputPath ?? entry.input ?? entry.path;
    if (inputPath !== null && inputPath !== undefined && !isLocalPath(inputPath)) fail('invalid_input_path');
    if (kind === 'supporting' && entry.status !== 'supporting') fail('incomplete_supporting_evidence');
    if (kind === 'required' && entry.status !== 'required' && entry.status !== 'not_verified') fail('incomplete_required_evidence');
    if (entry.freshness !== '15_minutes') fail('invalid_freshness_contract');
    validateDeclarationScope(entry, context, fail);
  }
  for (const id of allowed.keys()) if (!seen.has(id)) fail(kind === 'required' ? 'incomplete_required_evidence' : 'incomplete_supporting_evidence');
  return value;
}

function validateDeclarationScope(entry, context, fail) {
  const scope = entry.scope;
  if (!isRecord(scope)) {
    fail('incomplete_evidence');
    return;
  }
  if (entry.id === 'workspace_readback') {
    if (scope.apiOrigin !== context.apiOrigin || scope.ownerId !== context.ownerId || scope.brandId !== context.brandId ||
        scope.observation !== 'releaseContext.observation' || scope.jobs !== 'releaseContext.jobs') fail('scope_mismatch');
    return;
  }
  if (entry.id === 'g618_local' || entry.id === 'h602_local') {
    if (scope.apiOrigin !== context.apiOrigin || scope.brandId !== context.brandId) fail('scope_mismatch');
    return;
  }
  if ((entry.id === 'provider_receipt_readback' || entry.id === 'authenticated_production_readback') &&
      scope.status !== 'not_verified') fail('unsupported_evidence_contract');
}

function collectDeclaredArtifacts(entries, overrides, root, fail) {
  const artifacts = [];
  const seen = new Set();
  for (const entry of entries) {
    const inputPath = inputPathFor(entry, overrides);
    if (inputPath) {
      const artifact = { evidenceId: entry.id, path: inputPath };
      addArtifact(artifact, artifacts, seen, root, fail);
    }
    if (entry.id === 'workspace_readback') {
      const expectationsPath = entry.expectationsPath ?? entry.expectedPath ?? entry.expectations;
      if (expectationsPath) addArtifact({ evidenceId: 'workspace_readback.expectations', path: expectationsPath }, artifacts, seen, root, fail);
    }
  }
  return artifacts;
}

function addArtifact(artifact, artifacts, seen, root, fail) {
  if (!isLocalPath(artifact.path)) {
    fail('invalid_input_path');
    return;
  }
  const key = resolveLocalPath(root, artifact.path);
  if (seen.has(key)) {
    fail('duplicate_evidence');
    return;
  }
  seen.add(key);
  artifacts.push(artifact);
}

function validateArtifactRefs(value, artifacts, root, fail) {
  if (!Array.isArray(value)) {
    fail('incomplete_artifact_refs');
    return null;
  }
  const expected = new Map(artifacts.map(artifact => [resolveLocalPath(root, artifact.path), artifact]));
  const seenPaths = new Set();
  const refs = new Map();
  for (const ref of value) {
    const evidenceId = ref?.evidenceId ?? ref?.id;
    if (!isRecord(ref) || typeof evidenceId !== 'string' || !isLocalPath(ref.path) ||
        typeof ref.sha256 !== 'string' || !/^[a-f0-9]{64}$/i.test(ref.sha256)) {
      fail('incomplete_artifact_refs');
      continue;
    }
    const path = resolveLocalPath(root, ref.path);
    if (seenPaths.has(path) || refs.has(path)) {
      fail('duplicate_evidence');
      continue;
    }
    const declaration = expected.get(path);
    if (!declaration || declaration.evidenceId !== evidenceId) {
      fail('unexpected_artifact_ref');
      continue;
    }
    seenPaths.add(path);
    refs.set(path, { ...ref, evidenceId, sha256: ref.sha256.toLowerCase() });
  }
  for (const [path] of expected) if (!refs.has(path)) fail('missing_artifact_ref');
  return refs;
}

function readAndVerifyArtifact(path, ref) {
  if (!ref) return { ok: false, code: 'missing_artifact_ref' };
  let raw;
  try {
    raw = readFileSync(path);
  } catch (error) {
    return { ok: false, code: error?.code === 'ENOENT' ? 'missing_input' : 'invalid_input' };
  }
  const actual = createHash('sha256').update(raw).digest('hex');
  if (actual !== ref.sha256) return { ok: false, code: 'artifact_hash_mismatch' };
  try {
    const value = JSON.parse(raw.toString('utf8'));
    return { ok: isRecord(value) ? true : false, code: 'invalid_json', value };
  } catch {
    return { ok: false, code: 'invalid_json' };
  }
}

function readJsonAtPath(path) {
  try {
    const value = JSON.parse(readFileSync(path, 'utf8'));
    return { ok: isRecord(value), value, code: isRecord(value) ? null : 'invalid_json' };
  } catch (error) {
    return { ok: false, code: error?.code === 'ENOENT' ? 'missing_input' : 'invalid_json' };
  }
}

function normalizeReleaseContext(value, now, fail) {
  if (!isRecord(value)) {
    fail('incomplete_release_context');
    return null;
  }
  const observation = isRecord(value.observation)
    ? value.observation
    : { since: value.since, until: value.until };
  const commit = value.commit ?? value.gitCommit;
  if (!validID(value.runId) || !/^[a-f0-9]{40}$/i.test(commit ?? '') || value.environment !== 'local' ||
      !isValidApiOrigin(value.apiOrigin) || !validID(value.ownerId) || !validID(value.brandId) ||
      !isRecord(observation) || !validTimestamp(observation.since) || !validTimestamp(observation.until)) {
    fail('incomplete_release_context');
    return null;
  }
  const since = Date.parse(observation.since);
  const until = Date.parse(observation.until);
  if (since > until) fail('scope_mismatch');
  if (until - since > MAX_FRESHNESS_MS) fail('scope_mismatch');
  if (until > now) fail('future_observation');
  if (now - until > MAX_FRESHNESS_MS) fail('stale_observation');
  if (!Array.isArray(value.jobs) || value.jobs.length === 0 || value.jobs.length > 100) {
    fail('incomplete_release_context');
    return null;
  }
  const jobs = value.jobs.map(job => ({
    id: job?.id,
    requestId: job?.requestId,
    candidateCount: job?.candidateCount,
    protectedEdit: job?.protectedEdit,
  }));
  if (jobs.some(job => !validID(job.id) || !validID(job.requestId) || !Number.isInteger(job.candidateCount) ||
      job.candidateCount < 1 || job.candidateCount > 4 || typeof job.protectedEdit !== 'boolean') ||
      new Set(jobs.map(job => job.id)).size !== jobs.length || new Set(jobs.map(job => job.requestId)).size !== jobs.length) {
    fail('incomplete_release_context');
  }
  return {
    ...value,
    commit,
    observation: { since: new Date(since).toISOString(), until: new Date(until).toISOString() },
    jobs,
    now,
  };
}

function normalizeInputOverrides(value, fail) {
  if (value === undefined || value === null) return {};
  if (!isRecord(value)) {
    fail('invalid_input_path');
    return {};
  }
  const overrides = {};
  for (const [id, path] of Object.entries(value)) {
    if (!isLocalPath(path)) fail('invalid_input_path');
    else overrides[id] = path;
  }
  return overrides;
}

function inputPathFor(entry, overrides) {
  return overrides[entry.id] ?? entry.inputPath ?? entry.input ?? (entry.id === 'workspace_readback' ? entry.readbackPath : entry.path) ?? null;
}

function mapWorkspaceFailure(code, fail) {
  if (/missing_or_duplicate_execution_step/.test(code)) {
    fail('execution_step_evidence_missing');
    fail('duplicate_evidence');
    return;
  }
  if (/scope|owner|origin|brand|row_scope/.test(code)) fail('scope_mismatch');
  else if (/duplicate/.test(code)) fail('duplicate_evidence');
  else if (/private_image|storage/.test(code)) fail('private_r2_evidence_missing');
  else if (/execution_step|candidate_image/.test(code)) fail('execution_step_evidence_missing');
  else if (/stale|future|observation/.test(code)) fail(code);
  else fail('incomplete_evidence');
}

function sameJobs(actual, expected) {
  return Array.isArray(actual) && actual.length === expected.length && actual.every((job, index) => {
    const wanted = expected[index];
    return isRecord(job) && job.id === wanted.id && job.requestId === wanted.requestId &&
      job.candidateCount === wanted.candidateCount && job.protectedEdit === wanted.protectedEdit;
  });
}

function parseNow(value, fail) {
  if (value === undefined) return Date.now();
  const parsed = typeof value === 'number' ? value : Date.parse(value);
  if (!Number.isFinite(parsed)) {
    fail('invalid_now');
    return null;
  }
  return parsed;
}

function isValidApiOrigin(value) {
  try {
    return apiOrigin(value) === value;
  } catch {
    return false;
  }
}

function validTimestamp(value) {
  return typeof value === 'string' && Number.isFinite(Date.parse(value));
}

function isLocalPath(value) {
  return typeof value === 'string' && value.trim().length > 0 && !value.includes('\0') &&
    !/^[a-z][a-z0-9+.-]*:\/\//i.test(value) && !/^data:/i.test(value);
}

function resolveLocalPath(root, value) {
  return isAbsolute(value) ? resolve(value) : resolve(root, value);
}

function isRecord(value) {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}

function parseArgs(argv) {
  const parsed = { inputPaths: {} };
  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    const next = argv[index + 1];
    if ((arg === '--manifest' || arg === '--contract') && next) parsed.manifestPath = next;
    else if (arg === '--root' && next) parsed.root = next;
    else if (arg === '--now' && next) parsed.now = next;
    else if (arg === '--input' && next) {
      const separator = next.indexOf('=');
      if (separator <= 0 || separator === next.length - 1) parsed.invalidInput = true;
      else parsed.inputPaths[next.slice(0, separator)] = next.slice(separator + 1);
    } else if (arg.startsWith('--')) {
      parsed.invalidInput = true;
    }
    if (arg === '--manifest' || arg === '--contract' || arg === '--root' || arg === '--now' || arg === '--input') index += 1;
  }
  return parsed;
}

async function main(argv = process.argv.slice(2)) {
  const args = parseArgs(argv);
  const report = args.invalidInput
    ? { ...resultBase(), failures: ['invalid_input_path'] }
    : verifyCloudflareReleaseReadback(args);
  const output = JSON.stringify(report, null, 2);
  if (report.ok) console.log(output);
  else console.error(output);
  process.exitCode = report.ok ? 0 : 1;
}

if (process.argv[1] && fileURLToPath(import.meta.url) === resolve(process.argv[1])) {
  await main();
}
