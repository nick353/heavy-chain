/**
 * Read-only preparation boundary for Supabase -> private R2 reconciliation.
 *
 * This module never calls Supabase, R2, or a gateway. It only validates the
 * captured inventory and produces a fail-closed plan. Object copy/deletion is
 * not allowed until object-level checksums and target readback are present.
 */

import { createMediaReference } from './mediaReference.ts';

export const HEAVY_R2_PRIVATE_BUCKETS = ['generated-images', 'brand-assets', 'exports'] as const;
export type HeavyR2PrivateBucket = (typeof HEAVY_R2_PRIVATE_BUCKETS)[number];

type InventoryBucket = {
  bucket_id: unknown;
  object_count: unknown;
  total_bytes: unknown;
  r2_candidate?: unknown;
};

type InventoryProject = {
  project_name: unknown;
  project_ref: unknown;
  buckets: unknown;
  objects?: unknown;
};

type InventoryObject = {
  bucket_id: unknown;
  object_path: unknown;
  content_type: unknown;
  size: unknown;
  sha256: unknown;
  version?: unknown;
};

type InventorySafety = {
  source_objects_deleted: unknown;
  source_objects_overwritten: unknown;
  supabase_schema_changed: unknown;
  supabase_auth_changed: unknown;
  r2_credentials_embedded_in_client: unknown;
};

type MediaInventory = {
  schema: unknown;
  target: unknown;
  projects: unknown;
  safety: unknown;
};

export type MediaInventoryReconciliationStatus =
  | 'pending_source_checksum_inventory'
  | 'pending_target_readback'
  | 'invalid_inventory';

export type MediaInventoryReconciliationPlan = {
  ok: false;
  status: MediaInventoryReconciliationStatus;
  issues: string[];
  sourceProject: string | null;
  candidateBuckets: Array<{
    bucket: HeavyR2PrivateBucket;
    objectCount: number;
    totalBytes: number;
  }>;
  sourceChecksumsReady: boolean;
  targetReadbackRequired: true;
  sourceDeleteAllowed: false;
  copyAllowed: false;
};

const isRecord = (value: unknown): value is Record<string, unknown> => (
  typeof value === 'object' && value !== null
);

const isSafeCount = (value: unknown): value is number => (
  typeof value === 'number'
  && Number.isSafeInteger(value)
  && value >= 0
);

const readInventory = (value: unknown): MediaInventory | null => {
  if (!isRecord(value)) return null;
  return value as unknown as MediaInventory;
};

const readTarget = (value: unknown): Record<string, unknown> | null => (
  isRecord(value) ? value : null
);

const readSafety = (value: unknown): InventorySafety | null => (
  isRecord(value) ? value as unknown as InventorySafety : null
);

const readProjects = (value: unknown): InventoryProject[] | null => {
  if (!Array.isArray(value)) return null;
  return value.filter(isRecord).map((project) => project as unknown as InventoryProject);
};

const readBuckets = (value: unknown): InventoryBucket[] | null => {
  if (!Array.isArray(value)) return null;
  return value.filter(isRecord).map((bucket) => bucket as unknown as InventoryBucket);
};

const readObjects = (value: unknown): InventoryObject[] | null | undefined => {
  if (value === undefined) return undefined;
  if (!Array.isArray(value)) return null;
  return value.filter(isRecord).map((object) => object as unknown as InventoryObject);
};

/**
 * Produce a non-mutating reconciliation plan from a captured inventory.
 *
 * The current summary inventory intentionally returns pending because it has
 * no per-object path/content-type/size/SHA-256 rows. This prevents a future
 * copy or source deletion from being inferred from bucket totals alone.
 */
export const buildMediaInventoryReconciliationPlan = (
  source: unknown,
): MediaInventoryReconciliationPlan => {
  const issues: string[] = [];
  const inventory = readInventory(source);
  if (!inventory || inventory.schema !== 'supabase_cloudflare_media_inventory.v1') {
    issues.push('inventory_schema_invalid');
  }

  const target = readTarget(inventory?.target);
  if (!target || target.provider !== 'cloudflare_r2') issues.push('target_provider_invalid');
  if (target?.provisioned !== false) issues.push('r2_provisioning_must_remain_disabled');
  if (target?.copy_started !== false) issues.push('copy_must_not_have_started');

  const safety = readSafety(inventory?.safety);
  for (const [key, value] of [
    ['source_objects_deleted', safety?.source_objects_deleted],
    ['source_objects_overwritten', safety?.source_objects_overwritten],
    ['supabase_schema_changed', safety?.supabase_schema_changed],
    ['supabase_auth_changed', safety?.supabase_auth_changed],
    ['r2_credentials_embedded_in_client', safety?.r2_credentials_embedded_in_client],
  ] as const) {
    if (value !== false) issues.push(`safety_${key}_must_be_false`);
  }

  const projects = readProjects(inventory?.projects);
  const heavyProject = projects?.find((project) => project.project_name === 'heavy-chain-production') ?? null;
  if (!heavyProject) issues.push('heavy_source_project_missing');

  const candidateBuckets: MediaInventoryReconciliationPlan['candidateBuckets'] = [];
  const buckets = readBuckets(heavyProject?.buckets);
  if (!buckets) {
    issues.push('heavy_source_bucket_summary_missing');
  } else {
    for (const bucket of buckets) {
      if (bucket.r2_candidate !== true) continue;
      if (!HEAVY_R2_PRIVATE_BUCKETS.includes(bucket.bucket_id as HeavyR2PrivateBucket)) {
        issues.push('candidate_bucket_outside_private_allowlist');
        continue;
      }
      if (!isSafeCount(bucket.object_count) || !isSafeCount(bucket.total_bytes)) {
        issues.push('candidate_bucket_totals_invalid');
        continue;
      }
      candidateBuckets.push({
        bucket: bucket.bucket_id as HeavyR2PrivateBucket,
        objectCount: bucket.object_count,
        totalBytes: bucket.total_bytes,
      });
    }
  }

  let sourceChecksumsReady = false;
  const objectRows = readObjects((heavyProject as Record<string, unknown> | null)?.objects);
  if (objectRows === undefined) {
    // Summary totals cannot prove object identity. A future inventory must add
    // an explicit object-level array before any reconciliation action is allowed.
    issues.push('object_level_checksum_inventory_missing');
  } else if (objectRows === null) {
    issues.push('object_level_inventory_invalid');
  } else {
    const summaryByBucket = new Map(
      candidateBuckets.map((candidate) => [candidate.bucket, candidate]),
    );
    const observedByBucket = new Map<HeavyR2PrivateBucket, { objectCount: number; totalBytes: number }>();
    const identities = new Set<string>();

    for (const object of objectRows) {
      if (!HEAVY_R2_PRIVATE_BUCKETS.includes(object.bucket_id as HeavyR2PrivateBucket)) {
        issues.push('object_bucket_outside_private_allowlist');
        continue;
      }
      const bucket = object.bucket_id as HeavyR2PrivateBucket;
      if (!summaryByBucket.has(bucket)) {
        issues.push('object_bucket_missing_candidate_summary');
        continue;
      }

      try {
        const reference = createMediaReference({
          // The plan validates a future Cloudflare target reference only. It
          // never models the legacy source as an available runtime provider.
          provider: 'cloudflare_r2',
          bucket,
          objectPath: object.object_path,
          contentType: object.content_type,
          size: object.size,
          sha256: object.sha256,
          version: object.version ?? 1,
        });
        const identity = `${reference.bucket}\u0000${reference.objectPath}\u0000${reference.version}`;
        if (identities.has(identity)) {
          issues.push('object_identity_duplicate');
          continue;
        }
        identities.add(identity);
        const previous = observedByBucket.get(bucket) ?? { objectCount: 0, totalBytes: 0 };
        observedByBucket.set(bucket, {
          objectCount: previous.objectCount + 1,
          totalBytes: previous.totalBytes + reference.size,
        });
      } catch {
        issues.push('object_reference_invalid');
      }
    }

    for (const candidate of candidateBuckets) {
      const observed = observedByBucket.get(candidate.bucket) ?? { objectCount: 0, totalBytes: 0 };
      if (observed.objectCount !== candidate.objectCount || observed.totalBytes !== candidate.totalBytes) {
        issues.push('object_summary_mismatch');
      }
    }
    sourceChecksumsReady = issues.length === 0;
  }

  const uniqueIssues = [...new Set(issues)];
  return {
    ok: false,
    status: uniqueIssues.length === 0
      ? 'pending_target_readback'
      : uniqueIssues.length === 1 && uniqueIssues[0] === 'object_level_checksum_inventory_missing'
        ? 'pending_source_checksum_inventory'
        : 'invalid_inventory',
    issues: uniqueIssues,
    sourceProject: heavyProject ? String(heavyProject.project_ref ?? '') : null,
    candidateBuckets,
    sourceChecksumsReady,
    targetReadbackRequired: true,
    sourceDeleteAllowed: false,
    copyAllowed: false,
  };
};
