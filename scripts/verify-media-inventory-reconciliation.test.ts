import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';
import {
  buildMediaInventoryReconciliationPlan,
  HEAVY_R2_PRIVATE_BUCKETS,
} from '../src/lib/mediaInventoryReconciliation.ts';

const inventoryPath = `${process.cwd()}/../../../New project/work/supabase-cloudflare-media-inventory-20260824.json`;

test('current Heavy inventory produces a read-only pending checksum plan', async () => {
  const inventory = JSON.parse(await readFile(inventoryPath, 'utf8')) as unknown;
  const plan = buildMediaInventoryReconciliationPlan(inventory);

  assert.equal(plan.ok, false);
  assert.equal(plan.status, 'pending_source_checksum_inventory');
  assert.deepEqual(plan.candidateBuckets, [
    { bucket: 'brand-assets', objectCount: 1, totalBytes: 31776 },
    { bucket: 'generated-images', objectCount: 1245, totalBytes: 637252116 },
  ]);
  assert.deepEqual(plan.issues, ['object_level_checksum_inventory_missing']);
  assert.equal(plan.sourceChecksumsReady, false);
  assert.equal(plan.targetReadbackRequired, true);
  assert.equal(plan.sourceDeleteAllowed, false);
  assert.equal(plan.copyAllowed, false);
});

test('valid object-level rows advance only to target-readback pending', () => {
  const plan = buildMediaInventoryReconciliationPlan({
    schema: 'supabase_cloudflare_media_inventory.v1',
    target: { provider: 'cloudflare_r2', provisioned: false, copy_started: false },
    projects: [{
      project_name: 'heavy-chain-production',
      project_ref: 'heavy',
      buckets: [{ bucket_id: 'generated-images', object_count: 1, total_bytes: 42, r2_candidate: true }],
      objects: [{
        bucket_id: 'generated-images',
        object_path: 'brand-1/result.png',
        content_type: 'image/png',
        size: 42,
        sha256: 'a'.repeat(64),
        version: 1,
      }],
    }],
    safety: {
      source_objects_deleted: false,
      source_objects_overwritten: false,
      supabase_schema_changed: false,
      supabase_auth_changed: false,
      r2_credentials_embedded_in_client: false,
    },
  });

  assert.equal(plan.status, 'pending_target_readback');
  assert.deepEqual(plan.issues, []);
  assert.equal(plan.sourceChecksumsReady, true);
  assert.equal(plan.targetReadbackRequired, true);
  assert.equal(plan.copyAllowed, false);
  assert.equal(plan.sourceDeleteAllowed, false);
});

test('object-level rows must match summary totals before target readback', () => {
  const plan = buildMediaInventoryReconciliationPlan({
    schema: 'supabase_cloudflare_media_inventory.v1',
    target: { provider: 'cloudflare_r2', provisioned: false, copy_started: false },
    projects: [{
      project_name: 'heavy-chain-production',
      project_ref: 'heavy',
      buckets: [{ bucket_id: 'exports', object_count: 2, total_bytes: 42, r2_candidate: true }],
      objects: [{
        bucket_id: 'exports',
        object_path: 'brand-1/export.png',
        content_type: 'image/png',
        size: 42,
        sha256: 'b'.repeat(64),
      }],
    }],
    safety: {
      source_objects_deleted: false,
      source_objects_overwritten: false,
      supabase_schema_changed: false,
      supabase_auth_changed: false,
      r2_credentials_embedded_in_client: false,
    },
  });

  assert.equal(plan.status, 'invalid_inventory');
  assert.ok(plan.issues.includes('object_summary_mismatch'));
  assert.equal(plan.sourceChecksumsReady, false);
  assert.equal(plan.copyAllowed, false);
});

test('the plan never widens the private bucket allowlist', () => {
  assert.deepEqual(HEAVY_R2_PRIVATE_BUCKETS, ['generated-images', 'brand-assets', 'exports']);

  const plan = buildMediaInventoryReconciliationPlan({
    schema: 'supabase_cloudflare_media_inventory.v1',
    target: { provider: 'cloudflare_r2', provisioned: false, copy_started: false },
    projects: [{
      project_name: 'heavy-chain-production',
      project_ref: 'heavy',
      buckets: [{ bucket_id: 'feedback-screenshots', object_count: 1, total_bytes: 1, r2_candidate: true }],
    }],
    safety: {
      source_objects_deleted: false,
      source_objects_overwritten: false,
      supabase_schema_changed: false,
      supabase_auth_changed: false,
      r2_credentials_embedded_in_client: false,
    },
  });

  assert.equal(plan.status, 'invalid_inventory');
  assert.ok(plan.issues.includes('candidate_bucket_outside_private_allowlist'));
  assert.equal(plan.candidateBuckets.length, 0);
  assert.equal(plan.copyAllowed, false);
});

test('invalid safety flags fail closed without producing an action plan', () => {
  const plan = buildMediaInventoryReconciliationPlan({
    schema: 'supabase_cloudflare_media_inventory.v1',
    target: { provider: 'cloudflare_r2', provisioned: false, copy_started: false },
    projects: [],
    safety: {
      source_objects_deleted: true,
      source_objects_overwritten: false,
      supabase_schema_changed: false,
      supabase_auth_changed: false,
      r2_credentials_embedded_in_client: false,
    },
  });

  assert.equal(plan.status, 'invalid_inventory');
  assert.ok(plan.issues.includes('safety_source_objects_deleted_must_be_false'));
  assert.equal(plan.sourceDeleteAllowed, false);
  assert.equal(plan.copyAllowed, false);
});
