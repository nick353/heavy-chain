import assert from 'node:assert/strict';
import test from 'node:test';

import { validateHeavyR2AssetMigrationManifest } from './verify-heavy-r2-asset-migration-manifest.mjs';

const HASH = 'a'.repeat(64);
const otherHash = 'b'.repeat(64);

function asset(overrides = {}) {
  const base = {
    assetId: 'asset-1',
    source: { bucket: 'generated-images', objectKey: 'brand-1/image.png', publicScope: 'private-signed-url' },
    related: { entity: 'generated_images', id: 'image-1' },
    ownerId: 'user-1',
    contentType: 'image/png',
    version: 1,
    target: { bucket: 'generated-images', key: 'heavy/brand-1/image.png' },
    declared: { bytes: 42, sha256: HASH },
    observed: { bytes: 42, sha256: HASH },
    referenceRewriteTarget: { provider: 'cloudflare_r2', bucket: 'generated-images', objectPath: 'heavy/brand-1/image.png', version: 1 },
    status: 'migration_target',
    transformRules: ['Preserve bytes and rewrite the reference only after target readback.'],
    unresolvedItems: [],
  };
  return { ...base, ...overrides, source: { ...base.source, ...(overrides.source ?? {}) }, target: { ...base.target, ...(overrides.target ?? {}) }, declared: { ...base.declared, ...(overrides.declared ?? {}) }, observed: overrides.observed === null ? null : { ...base.observed, ...(overrides.observed ?? {}) }, referenceRewriteTarget: { ...base.referenceRewriteTarget, ...(overrides.referenceRewriteTarget ?? {}) } };
}

function manifest(entries) {
  return { schema: 'heavy-chain-r2-asset-migration-manifest.v1', ownerRegistry: ['user-1'], entries, bucketSummaries: [] };
}

test('normal manifest validates but reconciliation remains distinct and copy stays disabled', () => {
  const result = validateHeavyR2AssetMigrationManifest(manifest([asset()]));
  assert.equal(result.contractValid, true);
  assert.equal(result.sourceTargetReconciliationComplete, true);
  assert.equal(result.copyAllowed, false);
  assert.equal(result.sourceDeleteAllowed, false);
  assert.deepEqual(result.bucketCounts['generated-images'], { declaredObjectCount: 1, declaredTotalBytes: 42, observedObjectCount: 1, observedTotalBytes: 42 });
});

test('target key collisions and duplicate source objects are rejected', () => {
  const result = validateHeavyR2AssetMigrationManifest(manifest([asset(), asset({ assetId: 'asset-2' })]));
  assert.equal(result.contractValid, false);
  assert.equal(result.issues.some((item) => item.code === 'duplicate_source_object'), true);
  assert.equal(result.issues.some((item) => item.code === 'target_key_collision'), true);
});

test('broken reference and unknown owner are reported separately', () => {
  const result = validateHeavyR2AssetMigrationManifest(manifest([asset({
    ownerId: 'unknown-user',
    referenceRewriteTarget: { objectPath: 'wrong/path.png' },
  })]));
  assert.equal(result.contractValid, false);
  assert.equal(result.issues.some((item) => item.code === 'unknown_owner'), true);
  assert.equal(result.issues.some((item) => item.code === 'broken_reference_correspondence'), true);
});

test('missing and mismatched checksums are fail-closed', () => {
  const missing = validateHeavyR2AssetMigrationManifest(manifest([asset({ declared: { sha256: '' } })]));
  assert.equal(missing.contractValid, false);
  assert.equal(missing.issues.some((item) => item.code === 'missing_declared_checksum'), true);

  const mismatch = validateHeavyR2AssetMigrationManifest(manifest([asset({ observed: { sha256: otherHash } })]));
  assert.equal(mismatch.contractValid, true);
  assert.equal(mismatch.sourceTargetReconciliationComplete, false);
  assert.equal(mismatch.issues.some((item) => item.code === 'checksum_mismatch'), true);
});

test('preserve_only and unresolved entries are accepted without forced target mapping', () => {
  const result = validateHeavyR2AssetMigrationManifest(manifest([
    asset({ status: 'preserve_only', target: null, referenceRewriteTarget: null, observed: null }),
    asset({ assetId: 'asset-2', status: 'unresolved', target: null, referenceRewriteTarget: null, observed: null, source: { objectKey: 'brand-1/missing.png' } }),
  ]));
  assert.equal(result.contractValid, true);
  assert.equal(result.sourceTargetReconciliationComplete, false);
  assert.equal(result.counts.preserveOnly, 1);
  assert.equal(result.counts.unresolved, 1);
});
