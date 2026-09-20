import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import test from 'node:test';
import { verifyCloudflareReleaseReadback } from './verify-cloudflare-release-readback.mjs';

const now = Date.parse('2026-09-08T12:00:00.000Z');
const since = '2026-09-08T11:50:00.000Z';
const until = '2026-09-08T12:00:00.000Z';
const commit = 'a'.repeat(40);

function hashFile(path) {
  return createHash('sha256').update(readFileSync(path)).digest('hex');
}

function writeJson(path, value) {
  writeFileSync(path, `${JSON.stringify(value, null, 2)}\n`);
}

function writeRaw(path, value) {
  writeFileSync(path, value);
}

function validWorkspaceReport() {
  const bytes = Buffer.from('fixture image');
  const sha256 = createHash('sha256').update(bytes).digest('hex');
  return {
    schema: 'heavy-chain.workspace-readback.v2',
    collectionComplete: true,
    businessCompletion: 'not_verified',
    blockers: [],
    capturedAt: '2026-09-08T11:59:00.000Z',
    scope: {
      apiOrigin: 'https://fixture.invalid',
      brandId: 'brand',
      since,
      principal: 'current_consumer_auth_session',
      observation: 'nontransactional_read_only',
      requestedJobIds: ['job'],
    },
    jobs: [{
      id: 'job',
      requestId: 'request',
      brand_id: 'brand',
      user_id: 'owner',
      created_at: '2026-09-08T11:55:00.000Z',
      status: 'completed',
    }],
    images: [{
      id: 'image',
      job_id: 'job',
      brand_id: 'brand',
      user_id: 'owner',
      created_at: '2026-09-08T11:56:00.000Z',
    }],
    executionSteps: [0, 1].map(phase => ({
      id: `request:0:${phase}`,
      job_id: 'job',
      image_id: 'image',
      task_code: 'phase',
      step_index: phase,
      status: 'completed',
      basis: 'cloudflare_execution_ledger',
    })),
    canonicalFinalLinks: [],
    storage: [{
      imageId: 'image',
      jobId: 'job',
      readable: true,
      checksumVerified: true,
      bytes: bytes.length,
      sha256,
    }],
  };
}

function validG618Report() {
  return {
    schema: 'heavy-chain.g618.scale-ops-baseline.v2',
    ok: true,
    businessCompletion: 'not_verified',
    blockers: [],
    capturedAt: '2026-09-08T11:59:00.000Z',
    monitorExpectations: {
      apiOrigin: 'https://fixture.invalid',
      brandId: 'brand',
      windowHours: 96,
      maxFailureRate: 0,
      minStorageImages: 1,
    },
  };
}

function validH602Report() {
  return {
    schema: 'heavy-chain.h602.cloudflare-billing-readiness.v1',
    ok: true,
    checkedAt: '2026-09-08T11:59:00.000Z',
    mode: 'local_cloudflare_contract_only',
    contractStatus: 'verified_local',
    releaseApproval: false,
    productionProof: { status: 'not_verified' },
    scope: { apiOrigin: 'https://fixture.invalid', brandId: 'brand' },
  };
}

function makeFixture() {
  const root = mkdtempSync(join(tmpdir(), 'heavy-cloudflare-release-'));
  const paths = {
    manifest: join(root, 'manifest.json'),
    workspace: join(root, 'workspace.json'),
    expectations: join(root, 'workspace-expectations.json'),
    g618: join(root, 'g618.json'),
    h602: join(root, 'h602.json'),
  };
  const context = {
    runId: 'run-local',
    commit,
    environment: 'local',
    apiOrigin: 'https://fixture.invalid',
    ownerId: 'owner',
    brandId: 'brand',
    observation: { since, until },
    jobs: [{ id: 'job', requestId: 'request', candidateCount: 1, protectedEdit: false }],
  };
  writeJson(paths.workspace, validWorkspaceReport());
  writeJson(paths.expectations, {
    apiOrigin: context.apiOrigin,
    brandId: context.brandId,
    userId: context.ownerId,
    since,
    jobs: context.jobs,
  });
  writeJson(paths.g618, validG618Report());
  writeJson(paths.h602, validH602Report());

  const manifest = {
    schema: 'heavy-chain.cloudflare-release-readback-contract.v1',
    mode: 'local_only',
    releaseApproval: false,
    businessCompletion: 'not_verified',
    releaseContext: context,
    requiredEvidence: [
      {
        id: 'workspace_readback',
        schema: 'heavy-chain.workspace-readback.v2',
        validator: 'verifyWorkspaceEvidence',
        status: 'required',
        inputPath: paths.workspace,
        expectationsPath: paths.expectations,
        scope: {
          apiOrigin: context.apiOrigin,
          ownerId: context.ownerId,
          brandId: context.brandId,
          observation: 'releaseContext.observation',
          jobs: 'releaseContext.jobs',
        },
        freshness: '15_minutes',
      },
      {
        id: 'provider_receipt_readback',
        schema: 'heavy-chain.cloudflare-provider-receipt.v1',
        validator: 'unsupported',
        status: 'not_verified',
        inputPath: null,
        scope: { status: 'not_verified' },
        freshness: '15_minutes',
      },
      {
        id: 'authenticated_production_readback',
        schema: 'heavy-chain.cloudflare-authenticated-production-readback.v1',
        validator: 'unsupported',
        status: 'not_verified',
        inputPath: null,
        scope: { status: 'not_verified' },
        freshness: '15_minutes',
      },
    ],
    supportingEvidence: [
      {
        id: 'g618_local',
        schema: 'heavy-chain.g618.scale-ops-baseline.v2',
        validator: 'verifyG618LocalEvidence',
        status: 'supporting',
        inputPath: paths.g618,
        scope: { ...validG618Report().monitorExpectations },
        freshness: '15_minutes',
      },
      {
        id: 'h602_local',
        schema: 'heavy-chain.h602.cloudflare-billing-readiness.v1',
        validator: 'verifyH602LocalEvidence',
        status: 'supporting',
        inputPath: paths.h602,
        scope: { apiOrigin: context.apiOrigin, brandId: context.brandId, status: 'verified_local' },
        freshness: '15_minutes',
      },
    ],
    artifactRefs: [],
  };
  manifest.artifactRefs = [
    { evidenceId: 'workspace_readback', path: paths.workspace, sha256: hashFile(paths.workspace) },
    { evidenceId: 'workspace_readback.expectations', path: paths.expectations, sha256: hashFile(paths.expectations) },
    { evidenceId: 'g618_local', path: paths.g618, sha256: hashFile(paths.g618) },
    { evidenceId: 'h602_local', path: paths.h602, sha256: hashFile(paths.h602) },
  ];
  writeJson(paths.manifest, manifest);
  return { root, paths, manifest, context };
}

function updateArtifactRef(fixture, evidenceId, path) {
  const ref = fixture.manifest.artifactRefs.find(item => item.evidenceId === evidenceId);
  if (ref) {
    ref.path = path;
    ref.sha256 = hashFile(path);
  } else {
    fixture.manifest.artifactRefs.push({ evidenceId, path, sha256: hashFile(path) });
  }
}

function rewriteEvidence(fixture, key, value) {
  writeJson(fixture.paths[key], value);
  const evidenceId = key === 'workspace' ? 'workspace_readback' : `${key}_local`;
  updateArtifactRef(fixture, evidenceId, fixture.paths[key]);
  writeJson(fixture.paths.manifest, fixture.manifest);
}

function removeFixture(fixture) {
  rmSync(fixture.root, { recursive: true, force: true });
}

function assertRejected(fixture, code) {
  const report = verifyCloudflareReleaseReadback({
    manifestPath: fixture.paths.manifest,
    root: fixture.root,
    now,
  });
  assert.equal(report.ok, false);
  assert.equal(report.accepted, false);
  assert.equal(report.releaseApproval, false);
  assert.equal(report.businessCompletion, 'not_verified');
  if (code) assert.ok(report.failures.includes(code), `expected ${code}, got ${report.failures.join(',')}`);
  return report;
}

test('checked-in contract fixes the local-only and non-approval boundary', () => {
  const contract = JSON.parse(readFileSync(new URL('../contracts/cloudflare-release-readback.v1.json', import.meta.url), 'utf8'));
  assert.equal(contract.schema, 'heavy-chain.cloudflare-release-readback-contract.v1');
  assert.equal(contract.mode, 'local_only');
  assert.equal(contract.releaseApproval, false);
  assert.equal(contract.businessCompletion, 'not_verified');
  assert.ok(contract.releaseContext);
  assert.ok(Array.isArray(contract.requiredEvidence));
  assert.ok(Array.isArray(contract.supportingEvidence));
  assert.ok(Array.isArray(contract.artifactRefs));
});

test('valid local contract passes local evidence while remaining non-approving', () => {
  const fixture = makeFixture();
  try {
    const report = verifyCloudflareReleaseReadback({ manifestPath: fixture.paths.manifest, root: fixture.root, now });
    assert.equal(report.ok, true);
    assert.equal(report.valid, true);
    assert.equal(report.contractValid, true);
    assert.equal(report.accepted, false);
    assert.equal(report.releaseApproval, false);
    assert.equal(report.businessCompletion, 'not_verified');
    assert.equal(report.productionStatus, 'not_verified');
    assert.deepEqual(report.unverified, ['provider_receipt_readback', 'authenticated_production_readback']);
  } finally {
    removeFixture(fixture);
  }
});

test('requires an explicit manifest and rejects missing or unknown schemas', () => {
  const missing = verifyCloudflareReleaseReadback({ root: process.cwd(), now });
  assert.equal(missing.ok, false);
  assert.ok(missing.failures.includes('manifest_path_required'));

  const fixture = makeFixture();
  try {
    fixture.manifest.schema = 'heavy-chain.cloudflare-release-readback-contract.v99';
    writeJson(fixture.paths.manifest, fixture.manifest);
    assertRejected(fixture, 'unknown_contract_schema');
  } finally {
    removeFixture(fixture);
  }
});

test('rejects missing input artifacts and incomplete evidence declarations', () => {
  const missing = makeFixture();
  try {
    const missingPath = join(missing.root, 'not-present.json');
    const g618 = missing.manifest.supportingEvidence.find(item => item.id === 'g618_local');
    g618.inputPath = missingPath;
    const ref = missing.manifest.artifactRefs.find(item => item.evidenceId === 'g618_local');
    ref.path = missingPath;
    ref.sha256 = '0'.repeat(64);
    writeJson(missing.paths.manifest, missing.manifest);
    assertRejected(missing, 'missing_input');
  } finally {
    removeFixture(missing);
  }

  const incomplete = makeFixture();
  try {
    incomplete.manifest.requiredEvidence = incomplete.manifest.requiredEvidence.slice(0, 2);
    writeJson(incomplete.paths.manifest, incomplete.manifest);
    assertRejected(incomplete, 'incomplete_required_evidence');
  } finally {
    removeFixture(incomplete);
  }
});

test('rejects bad JSON and artifact hash mismatches without falling back to another path', () => {
  const badJson = makeFixture();
  try {
    writeRaw(badJson.paths.g618, '{');
    updateArtifactRef(badJson, 'g618_local', badJson.paths.g618);
    writeJson(badJson.paths.manifest, badJson.manifest);
    assertRejected(badJson, 'invalid_json');
  } finally {
    removeFixture(badJson);
  }

  const badHash = makeFixture();
  try {
    const changed = validH602Report();
    changed.ok = false;
    writeJson(badHash.paths.h602, changed);
    assertRejected(badHash, 'artifact_hash_mismatch');
  } finally {
    removeFixture(badHash);
  }
});

test('rejects stale, future, and scope-mismatched observations', () => {
  const stale = makeFixture();
  try {
    const report = validG618Report();
    report.capturedAt = '2026-09-08T11:40:00.000Z';
    rewriteEvidence(stale, 'g618', report);
    assertRejected(stale, 'stale_observation');
  } finally {
    removeFixture(stale);
  }

  const future = makeFixture();
  try {
    const report = validG618Report();
    report.capturedAt = '2026-09-08T12:00:01.000Z';
    rewriteEvidence(future, 'g618', report);
    assertRejected(future, 'future_observation');
  } finally {
    removeFixture(future);
  }

  const scope = makeFixture();
  try {
    const report = validWorkspaceReport();
    report.scope.brandId = 'other-brand';
    rewriteEvidence(scope, 'workspace', report);
    assertRejected(scope, 'scope_mismatch');
  } finally {
    removeFixture(scope);
  }
});

test('rejects duplicate, incomplete, and private-R2 evidence through the workspace verifier', () => {
  const duplicate = makeFixture();
  try {
    const report = validWorkspaceReport();
    report.executionSteps.push({ ...report.executionSteps[0] });
    rewriteEvidence(duplicate, 'workspace', report);
    assertRejected(duplicate, 'duplicate_evidence');
  } finally {
    removeFixture(duplicate);
  }

  const incomplete = makeFixture();
  try {
    const report = validWorkspaceReport();
    report.executionSteps.pop();
    rewriteEvidence(incomplete, 'workspace', report);
    const result = assertRejected(incomplete);
    assert.ok(result.failures.includes('execution_step_evidence_missing'));
  } finally {
    removeFixture(incomplete);
  }

  const privateR2 = makeFixture();
  try {
    const report = validWorkspaceReport();
    report.storage[0].checksumVerified = false;
    rewriteEvidence(privateR2, 'workspace', report);
    const result = assertRejected(privateR2);
    assert.ok(result.failures.includes('private_r2_evidence_missing'));
  } finally {
    removeFixture(privateR2);
  }
});

test('rejects unsupported provider or authenticated-production artifacts and self-asserted verification', () => {
  const fixture = makeFixture();
  try {
    const providerPath = join(fixture.root, 'provider.json');
    writeJson(providerPath, {
      schema: 'heavy-chain.cloudflare-provider-receipt.v1',
      capturedAt: '2026-09-08T11:59:00.000Z',
      verified: true,
    });
    const provider = fixture.manifest.requiredEvidence.find(item => item.id === 'provider_receipt_readback');
    provider.inputPath = providerPath;
    fixture.manifest.artifactRefs.push({ evidenceId: provider.id, path: providerPath, sha256: hashFile(providerPath) });
    writeJson(fixture.paths.manifest, fixture.manifest);
    const report = assertRejected(fixture, 'unsupported_evidence_contract');
    assert.equal(report.releaseApproval, false);
  } finally {
    removeFixture(fixture);
  }
});

test('rejects non-local input URLs and duplicate artifact declarations', () => {
  const remote = makeFixture();
  try {
    remote.manifest.supportingEvidence[0].inputPath = 'https://example.invalid/evidence.json';
    writeJson(remote.paths.manifest, remote.manifest);
    assertRejected(remote, 'invalid_input_path');
  } finally {
    removeFixture(remote);
  }

  const duplicate = makeFixture();
  try {
    duplicate.manifest.artifactRefs.push({ ...duplicate.manifest.artifactRefs[0] });
    writeJson(duplicate.paths.manifest, duplicate.manifest);
    assertRejected(duplicate, 'duplicate_evidence');
  } finally {
    removeFixture(duplicate);
  }
});

test('validator has no network or child-process implementation and does not use implicit defaults', () => {
  const source = readFileSync(new URL('./verify-cloudflare-release-readback.mjs', import.meta.url), 'utf8');
  assert.doesNotMatch(source, /node:child_process|node:(?:http|https)|\b(?:spawnSync|execSync|fork|fetch)\s*\(/);
  assert.match(source, /manifest_path_required/);
  assert.match(source, /inputPaths/);

  const fixture = makeFixture();
  const previousFetch = globalThis.fetch;
  try {
    globalThis.fetch = () => { throw new Error('network must not be called'); };
    const report = verifyCloudflareReleaseReadback({ manifestPath: fixture.paths.manifest, root: fixture.root, now });
    assert.equal(report.ok, true);
  } finally {
    globalThis.fetch = previousFetch;
    removeFixture(fixture);
  }
});
