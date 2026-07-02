#!/usr/bin/env bash
set -euo pipefail

echo "Checking Supabase project files"
test -f supabase/config.toml
test -d supabase/migrations
test -f supabase/migrations/20260617044009_billing_usage_limits.sql
test -f supabase/migrations/20260617054556_public_service_rpc_wrappers.sql
test -f supabase/migrations/20260617080031_harden_usage_quota_guards.sql
test -f supabase/migrations/20260617184720_authenticated_usage_summary_rpc.sql
test -f supabase/migrations/20260622123000_create_lightchain_task_steps.sql
test -f supabase/migrations/20260622230000_allow_runway_api_usage_provider.sql
test -f supabase/migrations/20260622141350_require_runway_mcp_generation_plan_feature.sql
test -f supabase/migrations/20260623090000_runway_mcp_connection_approvals.sql
test -f supabase/migrations/20260625092000_disable_generation_quota_while_billing_inactive.sql
test -f supabase/migrations/20260702100000_beta_feedback_submissions.sql
test -f supabase/migrations/20260702112251_revoke_direct_feedback_insert.sql
grep -q 'schemas = \["public", "storage"\]' supabase/config.toml

verify_mode="${SUPABASE_VERIFY_MODE:-static}"
if [[ "${SUPABASE_VERIFY_DB:-0}" == "1" ]]; then
  verify_mode="db"
fi

if [[ "$verify_mode" != "static" && "$verify_mode" != "db" ]]; then
  echo "SUPABASE_VERIFY_MODE must be static or db" >&2
  exit 1
fi

if [[ "$verify_mode" == "db" ]]; then
  echo "Checking local migration list against local database"
  supabase migration list --local >/dev/null
else
  echo "Skipping local database migration list; set SUPABASE_VERIFY_MODE=db or SUPABASE_VERIFY_DB=1 to enable it"
fi

require_no_match() {
  local description="$1"
  local pattern="$2"
  local path="$3"
  shift 3

  if grep -R "$@" -- "$pattern" "$path" >/dev/null; then
    echo "Static guard failed: $description" >&2
    return 1
  else
    local status=$?
    if [[ "$status" == "1" ]]; then
      return 0
    fi

    echo "Static guard grep error: $description" >&2
    return 1
  fi
}

require_no_repo_file_match() {
  local description="$1"
  local pattern="$2"
  shift 2
  local found=0
  local grep_error=0
  local file

  while IFS= read -r -d '' file; do
    if grep -I -H -n -E -- "$pattern" "$file" >&2; then
      found=1
    else
      local status=$?
      if [[ "$status" != "1" ]]; then
        grep_error=1
      fi
    fi
  done < <(git ls-files -z -c -o --exclude-standard -- "$@")

  if [[ "$found" == "1" ]]; then
    echo "Static guard failed: $description" >&2
    return 1
  fi

  if [[ "$grep_error" == "1" ]]; then
    echo "Static guard grep error: $description" >&2
    return 1
  fi

  return 0
}

require_runway_approval_before_reserve() {
  local function_name="$1"
  local path="supabase/functions/${function_name}/index.ts"

  node - "$path" "$function_name" <<'NODE'
const fs = require('node:fs');
const [path, functionName] = process.argv.slice(2);
const text = fs.readFileSync(path, 'utf8');
const serveStart = text.indexOf('serve(async');
const runtimeText = serveStart >= 0 ? text.slice(serveStart) : text;
const approvalIndex = runtimeText.indexOf('requireRunwayMcpConnectionApproval');
const reserveIndex = runtimeText.indexOf('reserveBrandUsage');

if (approvalIndex < 0) {
  console.error(`Static guard failed: ${functionName} missing Runway MCP connection approval gate`);
  process.exit(1);
}
if (reserveIndex < 0) {
  console.error(`Static guard failed: ${functionName} missing quota reserve`);
  process.exit(1);
}
if (approvalIndex > reserveIndex) {
  console.error(`Static guard failed: ${functionName} approval gate must run before usage reservation`);
  process.exit(1);
}
NODE
}

echo "Checking static safety guards"
require_no_repo_file_match "service role key value assignment in repository files" "SUPABASE_SERVICE_ROLE_KEY[[:space:]]*=[[:space:]]*['\"]?(eyJ[A-Za-z0-9_-]{20,}|sb_secret_[A-Za-z0-9_-]{20,}|[A-Za-z0-9_-]{40,})" . ':(exclude)*.md'
require_no_match "OpenAI-style secret literal" "(^|[^A-Za-z0-9_-])sk-[A-Za-z0-9_-]{20,}" . --exclude-dir=.git --exclude-dir=node_modules --exclude-dir=dist --exclude-dir=output -E
require_no_match "storage/data URL image_url fallback" "image_url:[[:space:]]*(storageUrl[[:space:]]*\\|\\|[[:space:]]*imageDataUrl|imageDataUrl)" supabase/functions -E
require_no_match "data URL image_url persistence" "image_url:[[:space:]]*imageDataUrl" supabase/functions
require_no_match "deprecated Gemini 2.0 model reference in Supabase functions" "gemini-2\\.0-flash-exp(-image-generation)?" supabase/functions -E
require_no_repo_file_match "OpenAI image env requirement in generation functions" "Deno\\.env\\.get\\(['\"](OPENAI_API_KEY|OPENAI_CHAT_[A-Z_]+)['\"]\\)" supabase/functions/generate-image supabase/functions/remove-background supabase/functions/upscale supabase/functions/colorize supabase/functions/generate-variations supabase/functions/design-gacha supabase/functions/product-shots supabase/functions/model-matrix supabase/functions/multilingual-banner
require_no_repo_file_match "Gemini env requirement outside standard generate-image helper" "Deno\\.env\\.get\\(['\"]GEMINI_API_KEY['\"]\\)" supabase/functions/remove-background supabase/functions/upscale supabase/functions/colorize supabase/functions/generate-variations supabase/functions/design-gacha supabase/functions/product-shots supabase/functions/model-matrix supabase/functions/multilingual-banner
grep -q "GEMINI_API_KEY" scripts/check-env.mjs
grep -q "RUNWAY_MCP_BRIDGE_URL" scripts/check-env.mjs
grep -q "RUNWAY_MCP_BRIDGE_TOKEN" scripts/check-env.mjs
grep -q "RUNWAY_MCP_TOKEN_ENCRYPTION_KEY" scripts/check-env.mjs
grep -q "GEMINI_API_KEY" supabase/functions/_shared/geminiImage.ts
grep -q "gemini_api_key_missing" supabase/functions/_shared/geminiImage.ts
grep -q "generateGeminiImage" supabase/functions/generate-image/index.ts
grep -q "RUNWAY_MCP_BRIDGE_URL" supabase/functions/_shared/runway.ts
grep -q "RUNWAY_MCP_BRIDGE_TOKEN" supabase/functions/_shared/runway.ts
grep -q "RUNWAY_MCP_TOKEN_ENCRYPTION_KEY" supabase/functions/_shared/runwayMcpConnection.ts
grep -q "AES-GCM" supabase/functions/_shared/runwayMcpConnection.ts
grep -q "registerRunwayOAuthClient" supabase/functions/_shared/runwayMcpConnection.ts
grep -q "exchangeRunwayCode" supabase/functions/_shared/runwayMcpConnection.ts
grep -q "runwayMcpListTools" supabase/functions/_shared/runwayMcpConnection.ts
grep -q "runwayMcpCallTool" supabase/functions/_shared/runwayMcpConnection.ts
test -f supabase/functions/runway-mcp-connect-start/index.ts
test -f supabase/functions/runway-mcp-connect-callback/index.ts
test -f supabase/functions/runway-mcp-connection-status/index.ts
test -f supabase/functions/runway-mcp-bridge/index.ts
node <<'NODE'
const fs = require('node:fs');
const configText = fs.readFileSync('supabase/config.toml', 'utf8');
const deployText = fs.readFileSync('scripts/deploy-edge-functions.sh', 'utf8');
const disabled = [];
let currentFunction = null;
for (const rawLine of configText.split(/\r?\n/)) {
  const line = rawLine.replace(/#.*/, '').trim();
  const section = line.match(/^\[functions\.([^\]]+)\]$/);
  if (section) {
    currentFunction = section[1];
    continue;
  }
  if (/^\[/.test(line)) {
    currentFunction = null;
    continue;
  }
  if (currentFunction && /^verify_jwt\s*=\s*false\b/.test(line)) {
    disabled.push(currentFunction);
  }
}
const allowed = new Set(['runway-mcp-connect-callback']);
if (!disabled.includes('runway-mcp-connect-callback')) {
  console.error('Static guard failed: runway-mcp-connect-callback must set verify_jwt = false');
  process.exit(1);
}
const unexpected = disabled.filter((name) => !allowed.has(name));
if (unexpected.length > 0) {
  console.error(`Static guard failed: unexpected verify_jwt=false functions: ${unexpected.join(', ')}`);
  process.exit(1);
}
const deployMatch = deployText.match(/jwt_disabled_functions=\(\s*([\s\S]*?)\n\)/);
const deployDisabled = deployMatch
  ? deployMatch[1].split(/\s+/).map((value) => value.trim()).filter(Boolean)
  : [];
const sortedConfig = [...disabled].sort();
const sortedDeploy = [...deployDisabled].sort();
if (JSON.stringify(sortedConfig) !== JSON.stringify(sortedDeploy)) {
  console.error(`Static guard failed: config verify_jwt=false functions must match deploy --no-verify-jwt functions. config=${sortedConfig.join(',') || 'none'} deploy=${sortedDeploy.join(',') || 'none'}`);
  process.exit(1);
}
NODE
grep -q -- "--no-verify-jwt" scripts/deploy-edge-functions.sh
grep -q "/text-to-image" supabase/functions/_shared/runway.ts
grep -q "referenceImages" supabase/functions/_shared/runway.ts
grep -q "/image-upscale" supabase/functions/_shared/runway.ts
grep -q "magnific_precision_upscaler_v2" supabase/functions/_shared/runway.ts
grep -q "runway_mcp_bridge_not_configured" supabase/functions/_shared/runway.ts
grep -q "runway_mcp_auth_required" supabase/functions/_shared/runway.ts
grep -q "runway_mcp_subscription_inactive" supabase/functions/_shared/runway.ts
grep -q "runwayImageDataUri" supabase/functions/_shared/runway.ts
grep -q "runwayReferenceImage" supabase/functions/_shared/runway.ts
grep -q "runwayImageArtifact" supabase/functions/_shared/runway.ts
grep -q "contentType" supabase/functions/_shared/runway.ts
grep -q "extension" supabase/functions/_shared/runway.ts
grep -q "dataUrl" supabase/functions/_shared/runway.ts
grep -q "runway_mcp_connection_approvals" supabase/functions/_shared/runwayApproval.ts
grep -q "approved_at" supabase/functions/_shared/runwayApproval.ts
grep -q "runway_mcp_connection_status_unavailable" supabase/functions/_shared/runwayApproval.ts
grep -q "runway_mcp_connection_not_approved" supabase/functions/_shared/runwayApproval.ts
require_no_match "Runway direct API base URL in helper" "https://api\\.dev\\.runwayml\\.com/v1" supabase/functions/_shared/runway.ts -E
require_no_match "Runway direct API secret in helper" "RUNWAYML_API_SECRET" supabase/functions/_shared/runway.ts
require_no_match "Runway direct text_to_image endpoint in helper" "/text_to_image" supabase/functions/_shared/runway.ts
require_no_match "Runway direct image_upscale endpoint in helper" "/image_upscale" supabase/functions/_shared/runway.ts
require_no_match "Runway direct API version header in helper" "X-Runway-Version|2024-11-06" supabase/functions/_shared/runway.ts -E
grep -q "provider IN ('openai', 'gemini', 'runway')" supabase/migrations/20260622230000_allow_runway_api_usage_provider.sql
grep -q "api_usage_logs_provider_check" supabase/migrations/20260622230000_allow_runway_api_usage_provider.sql
grep -q "pg_attribute" supabase/migrations/20260622230000_allow_runway_api_usage_provider.sql
grep -q "a.attname = 'provider'" supabase/migrations/20260622230000_allow_runway_api_usage_provider.sql
grep -Fq "c.conkey = ARRAY[a.attnum]" supabase/migrations/20260622230000_allow_runway_api_usage_provider.sql
grep -q "upscaleRunwayImage" supabase/functions/upscale/index.ts
if grep -q "generateRunwayImage" supabase/functions/upscale/index.ts; then
  echo "Static guard failed: upscale must use image_upscale helper, not text_to_image" >&2
  exit 1
fi
for function_name in remove-background colorize generate-variations design-gacha product-shots model-matrix; do
  grep -q "runwayReferenceImage" "supabase/functions/${function_name}/index.ts"
done
for function_name in generate-image remove-background upscale colorize generate-variations design-gacha product-shots model-matrix multilingual-banner; do
  grep -q "runwayImageArtifact" "supabase/functions/${function_name}/index.ts"
  grep -q "requireRunwayMcpConnectionApproval" "supabase/functions/${function_name}/index.ts"
  require_runway_approval_before_reserve "$function_name"
  require_no_match "hard-coded PNG data URL in ${function_name}" "data:image/png;base64" "supabase/functions/${function_name}/index.ts"
  require_no_match "hard-coded PNG contentType in ${function_name}" "contentType:[[:space:]]*['\"]image/png['\"]" "supabase/functions/${function_name}/index.ts" -E
done
require_no_match "Runway direct API/OpenAI env in check-env" "RUNWAYML_API_SECRET|OPENAI_API_KEY|OPENAI_CHAT_API_KEY|OPENAI_CHAT_BASE_URL|OPENAI_CHAT_MODEL" scripts/check-env.mjs -E

echo "Checking required private RPC definitions"
grep -q "private.reserve_brand_usage" supabase/migrations/20260617044009_billing_usage_limits.sql
grep -q "private.get_brand_usage_summary" supabase/migrations/20260617044009_billing_usage_limits.sql
grep -q "private.record_edge_function_run" supabase/migrations/20260617044009_billing_usage_limits.sql
grep -q "CREATE OR REPLACE FUNCTION private.reserve_brand_usage" supabase/migrations/20260617080031_harden_usage_quota_guards.sql
grep -q "reservation_stale" supabase/migrations/20260617080031_harden_usage_quota_guards.sql
grep -q "INTERVAL '15 minutes'" supabase/migrations/20260617080031_harden_usage_quota_guards.sql
grep -q "v_brand_recent_units + p_units > 5" supabase/migrations/20260617080031_harden_usage_quota_guards.sql
grep -q "v_user_recent_units + p_units > 3" supabase/migrations/20260617080031_harden_usage_quota_guards.sql
grep -q "idempotency_key = p_idempotency_key" supabase/migrations/20260617080031_harden_usage_quota_guards.sql
grep -q "Brand usage quota exceeded" supabase/migrations/20260617080031_harden_usage_quota_guards.sql
grep -q "RAISE EXCEPTION 'User usage rate limit exceeded'" supabase/migrations/20260617080031_harden_usage_quota_guards.sql
quota_bypass_migration="supabase/migrations/20260625092000_disable_generation_quota_while_billing_inactive.sql"
grep -q "Heavy Chain billing is not active yet" "$quota_bypass_migration"
grep -q "code = 'free'" "$quota_bypass_migration"
grep -q "bs.current_period_start <= v_now" "$quota_bypass_migration"
grep -q "bs.current_period_end > v_now" "$quota_bypass_migration"
grep -q "p.is_active" "$quota_bypass_migration"
grep -q "bs.status IN ('trialing', 'active')" "$quota_bypass_migration"
grep -q "reservation_stale" "$quota_bypass_migration"
grep -q "idempotency_key = p_idempotency_key" "$quota_bypass_migration"
grep -q "v_brand_recent_units + p_units > 5" "$quota_bypass_migration"
grep -q "v_user_recent_units + p_units > 3" "$quota_bypass_migration"
grep -q "billing_inactive_quota_bypass" "$quota_bypass_migration"
grep -q "'generation_quota_enforced'," "$quota_bypass_migration"
grep -q "false" "$quota_bypass_migration"
require_no_match "Runway paid subscription gate" "Runway MCP generation requires an active eligible subscription" "$quota_bypass_migration"
require_no_match "Runway monthly quota hard stop while billing inactive" "Brand usage quota exceeded" "$quota_bypass_migration"
grep -q "public.runway_mcp_connection_approvals" supabase/migrations/20260623090000_runway_mcp_connection_approvals.sql
grep -q "public.runway_mcp_connection_status" supabase/migrations/20260623090000_runway_mcp_connection_approvals.sql
grep -q "ENABLE ROW LEVEL SECURITY" supabase/migrations/20260623090000_runway_mcp_connection_approvals.sql
grep -q "GRANT SELECT ON TABLE public.runway_mcp_connection_approvals TO authenticated" supabase/migrations/20260623090000_runway_mcp_connection_approvals.sql
grep -q "GRANT ALL ON TABLE public.runway_mcp_connection_approvals TO service_role" supabase/migrations/20260623090000_runway_mcp_connection_approvals.sql
grep -q "Brand viewers can view Runway MCP connection approvals" supabase/migrations/20260623090000_runway_mcp_connection_approvals.sql
grep -q "public.request_runway_mcp_connection" supabase/migrations/20260623090000_runway_mcp_connection_approvals.sql
grep -q "public.admin_update_runway_mcp_connection" supabase/migrations/20260623090000_runway_mcp_connection_approvals.sql
grep -q "private.has_brand_role(p_brand_id, 'admin')" supabase/migrations/20260623090000_runway_mcp_connection_approvals.sql
grep -q "private.is_current_user_admin()" supabase/migrations/20260623090000_runway_mcp_connection_approvals.sql
grep -q "IF FOUND AND v_row.status = 'approved' THEN" supabase/migrations/20260623090000_runway_mcp_connection_approvals.sql
require_no_match "credential/URL/token/secret/metadata columns in Runway MCP approval migration" "\\b(oauth|api[_-]?key|apikey|connection[_-]?url|bridge[_-]?url|bridge[_-]?token|secret[_-]?url|secret[_-]?token|url|token|secret|credential|metadata)\\b[[:space:]]+(TEXT|VARCHAR|UUID|JSONB|JSON)" supabase/migrations/20260623090000_runway_mcp_connection_approvals.sql -E
require_no_match "free-text notes in Runway MCP approval migration" "\\b(request_note|admin_note)\\b" supabase/migrations/20260623090000_runway_mcp_connection_approvals.sql -E
grep -q "public.runway_mcp_oauth_states" supabase/migrations/20260623102000_runway_mcp_oauth_connections.sql
grep -q "public.runway_mcp_oauth_connections" supabase/migrations/20260623102000_runway_mcp_oauth_connections.sql
grep -q "encrypted_access_token" supabase/migrations/20260623102000_runway_mcp_oauth_connections.sql
grep -q "encrypted_refresh_token" supabase/migrations/20260623102000_runway_mcp_oauth_connections.sql
grep -q "GRANT ALL ON TABLE public.runway_mcp_oauth_connections TO service_role" supabase/migrations/20260623102000_runway_mcp_oauth_connections.sql

echo "Checking RLS and table grants"
grep -q "CREATE POLICY \"Users can create brands\"" supabase/migrations/20260618023000_restore_brand_insert_policy.sql
grep -q "WITH CHECK (owner_id = auth.uid())" supabase/migrations/20260618023000_restore_brand_insert_policy.sql
grep -q "ALTER TABLE public.usage_events ENABLE ROW LEVEL SECURITY" supabase/migrations/20260617044009_billing_usage_limits.sql
grep -q "ALTER TABLE public.edge_function_runs ENABLE ROW LEVEL SECURITY" supabase/migrations/20260617044009_billing_usage_limits.sql
grep -q "ALTER TABLE public.generated_images ENABLE ROW LEVEL SECURITY" supabase/migrations/001_initial_schema.sql
grep -q "REVOKE ALL ON TABLE public.usage_events FROM PUBLIC, anon, authenticated" supabase/migrations/20260617044009_billing_usage_limits.sql
grep -q "REVOKE ALL ON TABLE public.edge_function_runs FROM PUBLIC, anon, authenticated" supabase/migrations/20260617044009_billing_usage_limits.sql
grep -q "GRANT SELECT ON TABLE public.usage_events TO authenticated" supabase/migrations/20260617044009_billing_usage_limits.sql
grep -q "GRANT SELECT ON TABLE public.edge_function_runs TO authenticated" supabase/migrations/20260617044009_billing_usage_limits.sql
grep -q "GRANT ALL ON TABLE public.usage_events TO service_role" supabase/migrations/20260617044009_billing_usage_limits.sql
grep -q "GRANT ALL ON TABLE public.edge_function_runs TO service_role" supabase/migrations/20260617044009_billing_usage_limits.sql
grep -q "CREATE TABLE IF NOT EXISTS public.lightchain_task_steps" supabase/migrations/20260622123000_create_lightchain_task_steps.sql
grep -q "ALTER TABLE public.lightchain_task_steps ENABLE ROW LEVEL SECURITY" supabase/migrations/20260622123000_create_lightchain_task_steps.sql
grep -q "REVOKE ALL ON TABLE public.lightchain_task_steps FROM PUBLIC, anon, authenticated" supabase/migrations/20260622123000_create_lightchain_task_steps.sql
grep -q "GRANT SELECT, INSERT, UPDATE ON TABLE public.lightchain_task_steps TO authenticated" supabase/migrations/20260622123000_create_lightchain_task_steps.sql
grep -q "GRANT ALL ON TABLE public.lightchain_task_steps TO service_role" supabase/migrations/20260622123000_create_lightchain_task_steps.sql
grep -q "Brand viewers can view Lightchain task steps" supabase/migrations/20260622123000_create_lightchain_task_steps.sql
grep -q "Brand editors can create Lightchain task steps" supabase/migrations/20260622123000_create_lightchain_task_steps.sql
grep -q "Brand editors can update Lightchain task steps" supabase/migrations/20260622123000_create_lightchain_task_steps.sql
grep -q "idx_lightchain_task_steps_job" supabase/migrations/20260622123000_create_lightchain_task_steps.sql
grep -q "idx_lightchain_task_steps_task_code" supabase/migrations/20260622123000_create_lightchain_task_steps.sql
grep -q "idx_lightchain_task_steps_status" supabase/migrations/20260622123000_create_lightchain_task_steps.sql
feedback_migration="supabase/migrations/20260702100000_beta_feedback_submissions.sql"
grep -q "CREATE TABLE IF NOT EXISTS public.feedback_submissions" "$feedback_migration"
grep -q "ALTER TABLE public.feedback_submissions ENABLE ROW LEVEL SECURITY" "$feedback_migration"
grep -q "Users can insert own beta feedback" "$feedback_migration"
grep -q "Users can view own beta feedback" "$feedback_migration"
grep -q "Admins can update beta feedback" "$feedback_migration"
grep -q "private.is_current_user_admin()" "$feedback_migration"
grep -q "feedback-screenshots" "$feedback_migration"
grep -q "screenshot_capture_failed" "$feedback_migration"
grep -q "screenshot_upload_failed" "$feedback_migration"
grep -q "GRANT ALL ON TABLE public.feedback_submissions TO service_role" "$feedback_migration"
feedback_revoke_migration="supabase/migrations/20260702112251_revoke_direct_feedback_insert.sql"
grep -q "DROP POLICY IF EXISTS \"Users can insert own beta feedback\"" "$feedback_revoke_migration"
grep -q "REVOKE INSERT ON TABLE public.feedback_submissions FROM authenticated" "$feedback_revoke_migration"
grep -q "GRANT SELECT ON TABLE public.feedback_submissions TO authenticated" "$feedback_revoke_migration"
grep -q "submit-feedback" scripts/deploy-edge-functions.sh
grep -q "MAX_REQUEST_BYTES" supabase/functions/submit-feedback/index.ts
grep -q "content-length" supabase/functions/submit-feedback/index.ts
grep -q "readJsonWithLimit" supabase/functions/submit-feedback/index.ts
grep -q "normalizePageUrl" supabase/functions/submit-feedback/index.ts
grep -q "getSafeFeedbackUrl" src/pages/AdminDashboard.tsx

echo "Checking required public service RPC wrappers"
grep -q "public.service_reserve_brand_usage" supabase/migrations/20260617054556_public_service_rpc_wrappers.sql
grep -q "public.service_complete_usage_event" supabase/migrations/20260617054556_public_service_rpc_wrappers.sql
grep -q "public.service_get_brand_usage_summary" supabase/migrations/20260617054556_public_service_rpc_wrappers.sql
grep -q "public.service_record_edge_function_run" supabase/migrations/20260617054556_public_service_rpc_wrappers.sql
grep -q "GRANT EXECUTE ON FUNCTION public.service_reserve_brand_usage(UUID, UUID, TEXT, INTEGER, TEXT, TEXT, JSONB) TO service_role" supabase/migrations/20260617054556_public_service_rpc_wrappers.sql
grep -q "GRANT EXECUTE ON FUNCTION public.service_record_edge_function_run(UUID, UUID, UUID, TEXT, public.edge_run_status, TEXT, INTEGER, TEXT, JSONB) TO service_role" supabase/migrations/20260617054556_public_service_rpc_wrappers.sql
require_no_match "private schema RPC call in usage helper" "schema('private').rpc" supabase/functions/_shared/usage.ts
require_no_match "private schema RPC call in observability helper" "schema('private').rpc" supabase/functions/_shared/observability.ts

echo "Checking authenticated usage summary boundary"
grep -q "CREATE OR REPLACE FUNCTION public.get_brand_usage_summary" supabase/migrations/20260617184720_authenticated_usage_summary_rpc.sql
grep -q "private.has_brand_role(p_brand_id, 'viewer')" supabase/migrations/20260617184720_authenticated_usage_summary_rpc.sql
grep -q "private.is_current_user_admin()" supabase/migrations/20260617184720_authenticated_usage_summary_rpc.sql
grep -q "REVOKE ALL ON FUNCTION public.get_brand_usage_summary(UUID) FROM PUBLIC, anon, authenticated" supabase/migrations/20260617184720_authenticated_usage_summary_rpc.sql
grep -q "GRANT EXECUTE ON FUNCTION public.get_brand_usage_summary(UUID) TO authenticated" supabase/migrations/20260617184720_authenticated_usage_summary_rpc.sql
grep -q "GRANT EXECUTE ON FUNCTION public.get_brand_usage_summary(UUID) TO service_role" supabase/migrations/20260617184720_authenticated_usage_summary_rpc.sql

echo "Supabase production verification passed. Secret values were not printed."
