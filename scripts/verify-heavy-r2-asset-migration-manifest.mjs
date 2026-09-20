#!/usr/bin/env node

import { existsSync, readFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import { buildMediaInventoryReconciliationPlan, HEAVY_R2_PRIVATE_BUCKETS } from '../src/lib/mediaInventoryReconciliation.ts';
import { createMediaReference } from '../src/lib/mediaReference.ts';

export const MANIFEST_PATH = 'work/heavy-r2-asset-migration-manifest.v1.json';
export const MANIFEST_SCHEMA = 'heavy-chain-r2-asset-migration-manifest.v1';
const SHA256 = /^[a-f0-9]{64}$/i;
const STATUSES = new Set(['migration_target', 'preserve_only', 'unresolved']);
const compare = (a, b) => (a < b ? -1 : a > b ? 1 : 0);

function record(value) { return value !== null && typeof value === 'object' && !Array.isArray(value); }
function nonEmpty(value) { return typeof value === 'string' && value.trim().length > 0; }
function issue(code, assetId, detail) { return { code, ...(assetId ? { assetId } : {}), detail }; }
function identity(entry, side) { return `${entry[side]?.bucket ?? ''}\u0000${entry[side]?.[side === 'source' ? 'objectKey' : 'key'] ?? ''}`; }

function validateReference(entry, assetId, side, issues) {
  const value = entry[side];
  const path = side === 'source' ? value?.objectKey : value?.key;
  try {
    const reference = createMediaReference({ provider: 'cloudflare_r2', bucket: value?.bucket, objectPath: path, contentType: entry.contentType, size: entry.declared?.bytes, sha256: entry.declared?.sha256, version: entry.version ?? 1 });
    return reference;
  } catch (error) {
    issues.push(issue(side === 'source' ? 'invalid_source_reference' : 'invalid_target_reference', assetId, error.code ?? 'reference_invalid'));
    return null;
  }
}

export function validateHeavyR2AssetMigrationManifest(manifest, options = {}) {
  const root = resolve(options.root ?? options.rootDir ?? process.cwd());
  const structuralIssues = [];
  const reconciliationIssues = [];
  if (!record(manifest) || manifest.schema !== MANIFEST_SCHEMA) structuralIssues.push(issue('invalid_manifest_schema', undefined, MANIFEST_SCHEMA));
  const entries = Array.isArray(manifest?.entries) ? manifest.entries : [];
  if (!Array.isArray(manifest?.entries)) structuralIssues.push(issue('missing_entries', undefined, 'entries must be an array'));
  const owners = new Set(Array.isArray(manifest?.ownerRegistry) ? manifest.ownerRegistry.filter(nonEmpty) : []);
  const sourceKeys = new Set();
  const targetKeys = new Set();
  const observedByBucket = new Map();
  const declaredByBucket = new Map();

  entries.forEach((entry, index) => {
    const assetId = nonEmpty(entry?.assetId) ? entry.assetId : `entry-${index + 1}`;
    if (!STATUSES.has(entry?.status)) structuralIssues.push(issue('invalid_status', assetId, 'status must be migration_target, preserve_only, or unresolved'));
    if (!nonEmpty(entry?.ownerId) || !owners.has(entry.ownerId)) structuralIssues.push(issue('unknown_owner', assetId, entry?.ownerId ?? null));
    if (!record(entry?.related) || !nonEmpty(entry.related.entity) || !nonEmpty(entry.related.id)) structuralIssues.push(issue('missing_related_entity', assetId, 'related.entity and related.id are required'));
    if (!record(entry?.source) || !HEAVY_R2_PRIVATE_BUCKETS.includes(entry.source.bucket) || !nonEmpty(entry.source.objectKey) || !nonEmpty(entry.source.publicScope)) structuralIssues.push(issue('invalid_source_declaration', assetId, 'source bucket, objectKey, and publicScope are required'));
    if (!record(entry?.declared) || !Number.isSafeInteger(entry.declared.bytes) || entry.declared.bytes < 0 || !SHA256.test(entry.declared.sha256 ?? '')) structuralIssues.push(issue('missing_declared_checksum', assetId, 'declared bytes and SHA-256 are required'));
    if (entry.status === 'migration_target') {
      if (!record(entry.target) || !HEAVY_R2_PRIVATE_BUCKETS.includes(entry.target.bucket) || !nonEmpty(entry.target.key)) structuralIssues.push(issue('missing_target_declaration', assetId, 'migration_target requires target bucket/key'));
      if (!record(entry.referenceRewriteTarget)) structuralIssues.push(issue('missing_reference_rewrite_target', assetId, 'migration_target requires referenceRewriteTarget'));
    }
    const sourceRef = record(entry.source) && record(entry.declared) && entry.source.bucket && entry.source.objectKey && entry.contentType ? validateReference(entry, assetId, 'source', structuralIssues) : null;
    const targetRef = entry.status === 'migration_target' && record(entry.target) && record(entry.declared) && entry.contentType ? validateReference(entry, assetId, 'target', structuralIssues) : null;
    const sourceIdentity = identity(entry, 'source');
    const targetIdentity = identity(entry, 'target');
    if (sourceIdentity !== '\u0000' && sourceKeys.has(sourceIdentity)) structuralIssues.push(issue('duplicate_source_object', assetId, sourceIdentity));
    if (sourceIdentity !== '\u0000') sourceKeys.add(sourceIdentity);
    if (entry.status === 'migration_target' && targetIdentity !== '\u0000' && targetKeys.has(targetIdentity)) structuralIssues.push(issue('target_key_collision', assetId, targetIdentity));
    if (entry.status === 'migration_target' && targetIdentity !== '\u0000') targetKeys.add(targetIdentity);
    if (entry.status === 'migration_target' && targetRef && record(entry.referenceRewriteTarget)) {
      const rewrite = entry.referenceRewriteTarget;
      if (rewrite.provider !== 'cloudflare_r2' || rewrite.bucket !== targetRef.bucket || rewrite.objectPath !== targetRef.objectPath || (rewrite.version ?? 1) !== targetRef.version) reconciliationIssues.push(issue('broken_reference_correspondence', assetId, 'referenceRewriteTarget does not match target reference'));
    }
    if (record(entry.observed)) {
      if (!Number.isSafeInteger(entry.observed.bytes) || entry.observed.bytes < 0 || !SHA256.test(entry.observed.sha256 ?? '')) reconciliationIssues.push(issue('invalid_observed_checksum', assetId, 'observed bytes and SHA-256 must be explicit'));
      else {
        if (entry.observed.bytes !== entry.declared.bytes) reconciliationIssues.push(issue('byte_count_mismatch', assetId, `${entry.declared.bytes} != ${entry.observed.bytes}`));
        if (entry.observed.sha256.toLowerCase() !== entry.declared.sha256.toLowerCase()) reconciliationIssues.push(issue('checksum_mismatch', assetId, 'declared and observed SHA-256 differ'));
        const bucket = entry.source?.bucket;
        const totals = observedByBucket.get(bucket) ?? { objectCount: 0, totalBytes: 0 };
        observedByBucket.set(bucket, { objectCount: totals.objectCount + 1, totalBytes: totals.totalBytes + entry.observed.bytes });
      }
    } else if (entry.status === 'migration_target') reconciliationIssues.push(issue('observed_checksum_missing', assetId, 'target migration requires observed bytes and SHA-256'));
    if (HEAVY_R2_PRIVATE_BUCKETS.includes(entry.source?.bucket) && Number.isSafeInteger(entry.declared?.bytes)) {
      const totals = declaredByBucket.get(entry.source.bucket) ?? { objectCount: 0, totalBytes: 0 };
      declaredByBucket.set(entry.source.bucket, { objectCount: totals.objectCount + 1, totalBytes: totals.totalBytes + entry.declared.bytes });
    }
    if (sourceRef && targetRef && sourceRef.size !== targetRef.size) reconciliationIssues.push(issue('source_target_bytes_differ', assetId, `${sourceRef.size} != ${targetRef.size}`));
  });

  const summaries = Array.isArray(manifest?.bucketSummaries) ? manifest.bucketSummaries : [];
  const summaryBuckets = new Set();
  for (const summary of summaries) {
    if (!HEAVY_R2_PRIVATE_BUCKETS.includes(summary.bucket) || summaryBuckets.has(summary.bucket)) structuralIssues.push(issue('invalid_bucket_summary', undefined, summary.bucket ?? null));
    summaryBuckets.add(summary.bucket);
    const observed = observedByBucket.get(summary.bucket) ?? { objectCount: 0, totalBytes: 0 };
    const declared = declaredByBucket.get(summary.bucket) ?? { objectCount: 0, totalBytes: 0 };
    if (Number.isSafeInteger(summary.declaredObjectCount) && summary.declaredObjectCount !== declared.objectCount) reconciliationIssues.push(issue('bucket_declared_object_count_mismatch', undefined, summary.bucket));
    if (Number.isSafeInteger(summary.declaredTotalBytes) && summary.declaredTotalBytes !== declared.totalBytes) reconciliationIssues.push(issue('bucket_declared_total_bytes_mismatch', undefined, summary.bucket));
    if (Number.isSafeInteger(summary.observedObjectCount) && summary.observedObjectCount !== observed.objectCount) reconciliationIssues.push(issue('bucket_object_count_mismatch', undefined, summary.bucket));
    if (Number.isSafeInteger(summary.observedTotalBytes) && summary.observedTotalBytes !== observed.totalBytes) reconciliationIssues.push(issue('bucket_total_bytes_mismatch', undefined, summary.bucket));
  }
  const allIssues = [...structuralIssues, ...reconciliationIssues].sort((a, b) => compare(JSON.stringify(a), JSON.stringify(b)));
  const contractValid = structuralIssues.length === 0;
  const sourceTargetReconciliationComplete = contractValid && reconciliationIssues.length === 0 && entries.length > 0 && entries.every((entry) => entry.status === 'migration_target' && record(entry.observed));
  const counts = { entries: entries.length, migrationTarget: entries.filter((entry) => entry.status === 'migration_target').length, preserveOnly: entries.filter((entry) => entry.status === 'preserve_only').length, unresolved: entries.filter((entry) => entry.status === 'unresolved').length, structuralIssues: structuralIssues.length, reconciliationIssues: reconciliationIssues.length, issues: allIssues.length };
  const summaryByBucket = new Map((Array.isArray(manifest?.bucketSummaries) ? manifest.bucketSummaries : []).map((summary) => [summary.bucket, summary]));
  const bucketNames = new Set([...HEAVY_R2_PRIVATE_BUCKETS, ...summaryByBucket.keys(), ...observedByBucket.keys()]);
  const bucketCounts = Object.fromEntries([...bucketNames].sort(compare).map((bucket) => {
    const summary = summaryByBucket.get(bucket) ?? {};
    return [bucket, {
      declaredObjectCount: summary.declaredObjectCount ?? declaredByBucket.get(bucket)?.objectCount ?? null,
      declaredTotalBytes: summary.declaredTotalBytes ?? declaredByBucket.get(bucket)?.totalBytes ?? null,
      observedObjectCount: observedByBucket.get(bucket)?.objectCount ?? summary.observedObjectCount ?? null,
      observedTotalBytes: observedByBucket.get(bucket)?.totalBytes ?? summary.observedTotalBytes ?? null,
    }];
  }));
  let sourceInventoryPlan = null;
  if (manifest?.sourceInventory !== undefined) sourceInventoryPlan = buildMediaInventoryReconciliationPlan(manifest.sourceInventory);
  return { schema: 'heavy-chain-r2-asset-migration-manifest-verifier.v1', contractValid, sourceTargetReconciliationComplete, counts, bucketCounts, issues: allIssues, sourceInventoryPlan, copyAllowed: false, sourceDeleteAllowed: false, externalEffects: 'none', root };
}

export default validateHeavyR2AssetMigrationManifest;

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const root = process.cwd();
  const path = join(root, MANIFEST_PATH);
  const manifest = existsSync(path) ? JSON.parse(readFileSync(path, 'utf8')) : null;
  const result = validateHeavyR2AssetMigrationManifest(manifest, { root });
  console.log(JSON.stringify(result, null, 2));
  if (!result.contractValid) process.exitCode = 1;
}
