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
const serviceRoleWriteFunctions = ['marketing-workspace-artifact'];
const runwayImageFunctions = [
  'generate-image',
  'remove-background',
  'upscale',
  'colorize',
  'generate-variations',
  'design-gacha',
  'product-shots',
  'model-matrix',
  'multilingual-banner',
];
const failures = [];
const quotaGuardMigration = 'supabase/migrations/20260617080031_harden_usage_quota_guards.sql';
const authenticatedUsageSummaryMigration =
  'supabase/migrations/20260617184720_authenticated_usage_summary_rpc.sql';
const runwayApiUsageProviderMigration =
  'supabase/migrations/20260622230000_allow_runway_api_usage_provider.sql';
const runwayMcpPlanFeatureMigration =
  'supabase/migrations/20260622141350_require_runway_mcp_generation_plan_feature.sql';
const runwayMcpConnectionApprovalMigration =
  'supabase/migrations/20260623090000_runway_mcp_connection_approvals.sql';
const deprecatedGeminiModelPattern = /gemini-2\.0-flash-exp(?:-image-generation)?/;

function hasUnsafePersistedImageUrl(text) {
  const imageUrlAssignments = text.match(/image_url\s*:\s*[^,\n}]+/g) || [];
  return imageUrlAssignments.some((assignment) =>
    /\b(storageUrl|imageDataUrl|dataUrl|signedUrl)\b/.test(assignment) ||
    /storageUrl\s*\|\|\s*imageDataUrl/.test(assignment)
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

function validateRunwayApprovalOrder(name, text) {
  const serveStart = text.indexOf('serve(async');
  const runtimeText = serveStart >= 0 ? text.slice(serveStart) : text;
  const approvalIndex = runtimeText.indexOf('requireRunwayMcpConnectionApproval');
  const reserveIndex = runtimeText.indexOf('reserveBrandUsage');

  if (approvalIndex < 0) {
    return [`${name}: missing Runway MCP connection approval gate`];
  }
  if (reserveIndex < 0) {
    return [`${name}: missing quota reserve`];
  }
  if (approvalIndex > reserveIndex) {
    return [`${name}: Runway MCP approval gate must run before usage reservation`];
  }
  return [];
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
  if (runwayImageFunctions.includes(name) && name !== 'upscale' && !text.includes('generateRunwayImage')) {
    failures.push(`${name}: missing Runway image generation helper`);
  }
  if (runwayImageFunctions.includes(name) && /Deno\.env\.get\(['"](GEMINI_API_KEY|OPENAI_API_KEY|OPENAI_CHAT_[A-Z_]+)['"]\)/.test(text)) {
    failures.push(`${name}: still requires OpenAI/Gemini environment`);
  }
  if (runwayImageFunctions.includes(name)) {
    failures.push(...validateRunwayApprovalOrder(name, text));
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

for (const name of serviceRoleWriteFunctions) {
  const text = readFileSync(`supabase/functions/${name}/index.ts`, 'utf8');
  if (deprecatedGeminiModelPattern.test(text)) {
    failures.push(`${name}: deprecated Gemini 2.0 model reference`);
  }
  if (hasUnsafePersistedImageUrl(text)) {
    failures.push(`${name}: persists signed/data URL as image_url`);
  }
  if (!text.includes('createServiceClient')) failures.push(`${name}: missing service-role client`);
  if (!text.includes('requireBrandRole')) failures.push(`${name}: missing brand role guard`);
  if (!/image_url:\s*null/.test(text)) {
    failures.push(`${name}: generated_images.image_url must not persist signed/data URLs`);
  }
}

const runwayHelper = readFileSync('supabase/functions/_shared/runway.ts', 'utf8');
const runwayApprovalHelper = readFileSync('supabase/functions/_shared/runwayApproval.ts', 'utf8');
for (const needle of [
  'RUNWAY_MCP_BRIDGE_URL',
  'RUNWAY_MCP_BRIDGE_TOKEN',
  '/text-to-image',
  'referenceImages',
  '/image-upscale',
  'magnific_precision_upscaler_v2',
  'runway_mcp_bridge_not_configured',
  'runway_mcp_auth_required',
  'runway_mcp_subscription_inactive',
  'runwayImageDataUri',
  'runwayReferenceImage',
  'runwayImageArtifact',
  'contentType',
  'extension',
  'dataUrl',
  'arrayBuffer()',
  'btoa',
]) {
  if (!runwayHelper.includes(needle)) {
    failures.push(`supabase/functions/_shared/runway.ts: missing ${needle}`);
  }
}

for (const needle of [
  'runway_mcp_connection_approvals',
  'approved_at',
  'runway_mcp_connection_status_unavailable',
  'runway_mcp_connection_not_approved',
]) {
  if (!runwayApprovalHelper.includes(needle)) {
    failures.push(`supabase/functions/_shared/runwayApproval.ts: missing ${needle}`);
  }
}
for (const forbidden of [
  'RUNWAYML_API_SECRET',
  'https://api.dev.runwayml.com/v1',
  '/text_to_image',
  '/image_upscale',
  'X-Runway-Version',
  '2024-11-06',
  '/tasks/',
]) {
  if (runwayHelper.includes(forbidden)) {
    failures.push(`supabase/functions/_shared/runway.ts: direct Runway API remains (${forbidden})`);
  }
}

for (const name of ['remove-background', 'colorize', 'generate-variations', 'design-gacha', 'product-shots', 'model-matrix']) {
  const text = readFileSync(`supabase/functions/${name}/index.ts`, 'utf8');
  if (!text.includes('runwayReferenceImage')) {
    failures.push(`${name}: reference image path does not use Runway referenceImages helper`);
  }
}

for (const name of runwayImageFunctions) {
  const text = readFileSync(`supabase/functions/${name}/index.ts`, 'utf8');
  if (!text.includes('runwayImageArtifact')) {
    failures.push(`${name}: Runway result must use centralized mime/dataUrl/contentType/extension helper`);
  }
  if (/data:image\/png;base64/.test(text)) {
    failures.push(`${name}: hard-coded PNG data URL remains in Runway output path`);
  }
  if (/contentType:\s*['"]image\/png['"]/.test(text)) {
    failures.push(`${name}: hard-coded PNG storage contentType remains in Runway output path`);
  }
}

const upscaleText = readFileSync('supabase/functions/upscale/index.ts', 'utf8');
if (!upscaleText.includes('upscaleRunwayImage') || upscaleText.includes('generateRunwayImage')) {
  failures.push('upscale: must call Runway image_upscale helper instead of text_to_image');
}

const checkEnv = readFileSync('scripts/check-env.mjs', 'utf8');
for (const needle of ['RUNWAY_MCP_BRIDGE_URL', 'RUNWAY_MCP_BRIDGE_TOKEN']) {
  if (!checkEnv.includes(needle)) {
    failures.push(`scripts/check-env.mjs: ${needle} is not required`);
  }
}
for (const forbidden of ['RUNWAYML_API_SECRET', 'GEMINI_API_KEY', 'OPENAI_API_KEY', 'OPENAI_CHAT_API_KEY', 'OPENAI_CHAT_BASE_URL', 'OPENAI_CHAT_MODEL']) {
  if (checkEnv.includes(forbidden)) {
    failures.push(`scripts/check-env.mjs: ${forbidden} must not be required or optional`);
  }
}

const quotaGuardSql = readFileSync(quotaGuardMigration, 'utf8');
const authenticatedUsageSummarySql = readFileSync(authenticatedUsageSummaryMigration, 'utf8');
const runwayApiUsageProviderSql = readFileSync(runwayApiUsageProviderMigration, 'utf8');
const runwayMcpPlanFeatureSql = readFileSync(runwayMcpPlanFeatureMigration, 'utf8');
const runwayMcpConnectionApprovalSql = readFileSync(runwayMcpConnectionApprovalMigration, 'utf8');
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

const runwayApiUsageProviderChecks = [
  ['api usage table', 'public.api_usage_logs'],
  ['old provider check drop', 'DROP CONSTRAINT'],
  ['stable provider constraint name', 'api_usage_logs_provider_check'],
  ['Runway provider allowlist', "provider IN ('openai', 'gemini', 'runway')"],
  ['provider column join', 'pg_attribute'],
  ['provider column name guard', "a.attname = 'provider'"],
  ['single-column check guard', 'c.conkey = ARRAY[a.attnum]'],
];

for (const [label, needle] of runwayApiUsageProviderChecks) {
  if (!runwayApiUsageProviderSql.includes(needle)) {
    failures.push(`${runwayApiUsageProviderMigration}: missing ${label}`);
  }
}

const runwayMcpPlanFeatureChecks = [
  ['runway MCP feature key', "runway_mcp_generation"],
  ['free plan disabled', "code = 'free'"],
  ['pro plan enabled', "code = 'pro'"],
  ['current period start guard', 'bs.current_period_start <= v_now'],
  ['current period end guard', 'bs.current_period_end > v_now'],
  ['active plan guard', 'p.is_active'],
  ['active or trialing subscription guard', "bs.status IN ('trialing', 'active')"],
  ['Runway generation function guard', 'v_runway_mcp_generation_functions'],
  ['stale reservation release', "reservation_stale"],
  ['idempotency preservation', 'idempotency_key = p_idempotency_key'],
  ['brand rate cap preservation', 'v_brand_recent_units + p_units > 5'],
  ['user rate cap preservation', 'v_user_recent_units + p_units > 3'],
  ['monthly quota preservation', 'Brand usage quota exceeded'],
];

for (const [label, needle] of runwayMcpPlanFeatureChecks) {
  if (!runwayMcpPlanFeatureSql.includes(needle)) {
    failures.push(`${runwayMcpPlanFeatureMigration}: missing ${label}`);
  }
}

const runwayMcpConnectionApprovalChecks = [
  ['approval table', 'public.runway_mcp_connection_approvals'],
  ['status enum', 'public.runway_mcp_connection_status'],
  ['RLS enabled', 'ENABLE ROW LEVEL SECURITY'],
  ['authenticated select grant', 'GRANT SELECT ON TABLE public.runway_mcp_connection_approvals TO authenticated'],
  ['service role grant', 'GRANT ALL ON TABLE public.runway_mcp_connection_approvals TO service_role'],
  ['brand viewer policy', 'Brand viewers can view Runway MCP connection approvals'],
  ['request RPC', 'public.request_runway_mcp_connection'],
  ['admin update RPC', 'public.admin_update_runway_mcp_connection'],
  ['brand admin gate', "private.has_brand_role(p_brand_id, 'admin')"],
  ['platform admin gate', 'private.is_current_user_admin()'],
  ['approved request idempotency', "IF FOUND AND v_row.status = 'approved' THEN"],
];

for (const [label, needle] of runwayMcpConnectionApprovalChecks) {
  if (!runwayMcpConnectionApprovalSql.includes(needle)) {
    failures.push(`${runwayMcpConnectionApprovalMigration}: missing ${label}`);
  }
}

if (/\b(oauth|api[_-]?key|apikey|connection[_-]?url|bridge[_-]?url|bridge[_-]?token|secret[_-]?url|secret[_-]?token|url|token|secret|credential|metadata)\b\s+(TEXT|VARCHAR|UUID|JSONB|JSON)/i.test(runwayMcpConnectionApprovalSql)) {
  failures.push(`${runwayMcpConnectionApprovalMigration}: must not add credential, URL, token, secret, or metadata columns`);
}
if (/\b(request_note|admin_note)\b/i.test(runwayMcpConnectionApprovalSql)) {
  failures.push(`${runwayMcpConnectionApprovalMigration}: must not store free-text notes`);
}

if (failures.length > 0) {
  console.error('Edge smoke failed:');
  for (const failure of failures) console.error(`- ${failure}`);
  process.exit(1);
}

console.log('Edge smoke passed without external API calls.');
