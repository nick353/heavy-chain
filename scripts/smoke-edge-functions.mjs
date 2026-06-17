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
const geminiModelGuardFiles = ['supabase/functions/_shared/geminiModels.ts'];
const failures = [];
const quotaGuardMigration = 'supabase/migrations/20260617080031_harden_usage_quota_guards.sql';
const authenticatedUsageSummaryMigration =
  'supabase/migrations/20260617184720_authenticated_usage_summary_rpc.sql';
const deprecatedGeminiModelPattern = /gemini-2\.0-flash-exp(?:-image-generation)?/;

function hasUnsafePersistedImageUrl(text) {
  const imageUrlAssignments = text.match(/image_url\s*:\s*[^,\n}]+/g) || [];
  return imageUrlAssignments.some((assignment) =>
    /\b(storageUrl|imageDataUrl|dataUrl|signedUrl)\b/.test(assignment) ||
    /storageUrl\s*\|\|\s*imageDataUrl/.test(assignment)
  );
}

function hasUpscaleInlineReferenceGeneration(text) {
  const generateBlock = text.match(
    /const generateResponse = await fetch\([\s\S]*?\n\s*const generateData = await generateResponse\.json\(\);/
  )?.[0] || '';

  return (
    generateBlock.includes('inlineData') &&
    generateBlock.includes('mimeType') &&
    generateBlock.includes('originalBase64') &&
    /inlineData\s*:\s*\{[^}]*mimeType[^}]*data\s*:\s*originalBase64[^}]*\}/s.test(generateBlock)
  );
}

function validateMultilingualBanner(text) {
  const issues = [];
  const imagePromptAssignments = text.match(/const prompt = `[\s\S]*?`;/g) || [];
  const unsafeImagePrompt = imagePromptAssignments.some((assignment) =>
    /with text|textContent|professional typography|high contrast text|readable typography/i.test(assignment)
  );

  if (unsafeImagePrompt) {
    issues.push('multilingual-banner: image prompt appears to ask AI to draw copy text');
  }
  for (const needle of ['text-free', 'no letters', 'no typography']) {
    if (!text.includes(needle)) {
      issues.push(`multilingual-banner: missing background prompt guard "${needle}"`);
    }
  }
  if (!/contentType:\s*['"]image\/svg\+xml['"]/.test(text)) {
    issues.push('multilingual-banner: generated asset must be saved as image/svg+xml');
  }
  if (!/\.svg`/.test(text) && !/\.svg['"]/.test(text)) {
    issues.push('multilingual-banner: storage path must use .svg');
  }
  for (const needle of ['buildBannerSvg', 'escapeXml', 'wrapText', 'fitWrappedText', 'textWidth', 'dedupeSubheadline']) {
    if (!text.includes(needle)) {
      issues.push(`multilingual-banner: missing deterministic SVG text helper ${needle}`);
    }
  }
  if (!/maxWidth\s*\/\s*fontSize/.test(text)) {
    issues.push('multilingual-banner: SVG text wrapping must derive maxWeight from rendered maxWidth and fontSize');
  }
  if (/textLength=|lengthAdjust=|transform="scale/.test(text)) {
    issues.push('multilingual-banner: SVG text fitting must prefer wrapping over textLength/lengthAdjust/scale');
  }
  if (!/data:image\/svg\+xml;base64/.test(text)) {
    issues.push('multilingual-banner: result fallback must point to composed SVG data URL');
  }
  if (!/image_url:\s*null/.test(text)) {
    issues.push('multilingual-banner: generated_images.image_url must not persist signed/data URLs');
  }

  return issues;
}

for (const name of guarded) {
  const file = `supabase/functions/${name}/index.ts`;
  const text = readFileSync(file, 'utf8');
  if (deprecatedGeminiModelPattern.test(text)) {
    failures.push(`${name}: deprecated Gemini 2.0 model reference`);
  }
  if (!text.includes('reserveBrandUsage')) failures.push(`${name}: missing quota reserve`);
  if (!text.includes('completeBrandUsage')) failures.push(`${name}: missing usage completion`);
  if (!text.includes('recordEdgeFunctionRun')) failures.push(`${name}: missing edge run observability`);
  if (hasUnsafePersistedImageUrl(text)) {
    failures.push(`${name}: persists signed/data URL as image_url`);
  }
  if (name === 'upscale' && !hasUpscaleInlineReferenceGeneration(text)) {
    failures.push('upscale: generated image request must include inlineData with originalBase64');
  }
  if (name === 'multilingual-banner') {
    failures.push(...validateMultilingualBanner(text));
  }
}

for (const name of observedOnly) {
  const text = readFileSync(`supabase/functions/${name}/index.ts`, 'utf8');
  if (deprecatedGeminiModelPattern.test(text)) {
    failures.push(`${name}: deprecated Gemini 2.0 model reference`);
  }
  if (!text.includes('recordEdgeFunctionRun')) failures.push(`${name}: missing edge run observability`);
}

for (const file of geminiModelGuardFiles) {
  const text = readFileSync(file, 'utf8');
  if (deprecatedGeminiModelPattern.test(text)) {
    failures.push(`${file}: deprecated Gemini 2.0 model reference`);
  }
}

const quotaGuardSql = readFileSync(quotaGuardMigration, 'utf8');
const authenticatedUsageSummarySql = readFileSync(authenticatedUsageSummaryMigration, 'utf8');
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

const authenticatedUsageSummaryChecks = [
  ['authenticated summary function', 'public.get_brand_usage_summary'],
  ['role check', "private.has_brand_role(p_brand_id, 'viewer')"],
  ['admin check', 'private.is_current_user_admin()'],
  ['no event detail return', 'RETURNS TABLE'],
  ['fallback free plan', "WHERE p.code = 'free'"],
  ['period start filter', 'ue.created_at >= s.current_period_start'],
  ['period end filter', 'ue.created_at < s.current_period_end'],
  ['authenticated grant', 'GRANT EXECUTE ON FUNCTION public.get_brand_usage_summary(UUID) TO authenticated'],
];

for (const [label, needle] of authenticatedUsageSummaryChecks) {
  if (!authenticatedUsageSummarySql.includes(needle)) {
    failures.push(`${authenticatedUsageSummaryMigration}: missing ${label}`);
  }
}

if (failures.length > 0) {
  console.error('Edge smoke failed:');
  for (const failure of failures) console.error(`- ${failure}`);
  process.exit(1);
}

console.log('Edge smoke passed without external API calls.');
