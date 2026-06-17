#!/usr/bin/env node

import { readFileSync } from 'node:fs';

const guarded = [
  'generate-image',
  'remove-background',
  'upscale',
  'colorize',
  'generate-variations',
  'design-gacha',
  'product-shots',
  'model-matrix',
  'multilingual-banner',
  'optimize-prompt',
  'bulk-download',
];

const observedOnly = ['share-link'];
const failures = [];
const quotaGuardMigration = 'supabase/migrations/20260617080031_harden_usage_quota_guards.sql';

function hasUnsafePersistedImageUrl(text) {
  const imageUrlAssignments = text.match(/image_url\s*:\s*[^,\n}]+/g) || [];
  return imageUrlAssignments.some((assignment) =>
    /\b(storageUrl|imageDataUrl|dataUrl|signedUrl)\b/.test(assignment) ||
    /storageUrl\s*\|\|\s*imageDataUrl/.test(assignment)
  );
}

for (const name of guarded) {
  const file = `supabase/functions/${name}/index.ts`;
  const text = readFileSync(file, 'utf8');
  if (!text.includes('reserveBrandUsage')) failures.push(`${name}: missing quota reserve`);
  if (!text.includes('completeBrandUsage')) failures.push(`${name}: missing usage completion`);
  if (!text.includes('recordEdgeFunctionRun')) failures.push(`${name}: missing edge run observability`);
  if (hasUnsafePersistedImageUrl(text)) {
    failures.push(`${name}: persists signed/data URL as image_url`);
  }
}

for (const name of observedOnly) {
  const text = readFileSync(`supabase/functions/${name}/index.ts`, 'utf8');
  if (!text.includes('recordEdgeFunctionRun')) failures.push(`${name}: missing edge run observability`);
}

const quotaGuardSql = readFileSync(quotaGuardMigration, 'utf8');
const quotaGuardChecks = [
  ['stale reservation release', "reservation_stale"],
  ['stale reservation status release', "status = 'released'"],
  ['15 minute stale threshold', "INTERVAL '15 minutes'"],
  ['brand one-minute rate window', "brand_id = p_brand_id"],
  ['brand rate cap', 'v_brand_recent_units + p_units > 5'],
  ['user one-minute rate window', 'user_id = p_user_id'],
  ['user rate cap', 'v_user_recent_units + p_units > 3'],
  ['idempotency preservation', 'idempotency_key = p_idempotency_key'],
  ['monthly quota preservation', 'Brand usage quota exceeded'],
];

for (const [label, needle] of quotaGuardChecks) {
  if (!quotaGuardSql.includes(needle)) {
    failures.push(`${quotaGuardMigration}: missing ${label}`);
  }
}

if (failures.length > 0) {
  console.error('Edge smoke failed:');
  for (const failure of failures) console.error(`- ${failure}`);
  process.exit(1);
}

console.log('Edge smoke passed without external API calls.');
