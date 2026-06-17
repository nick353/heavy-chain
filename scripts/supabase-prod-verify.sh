#!/usr/bin/env bash
set -euo pipefail

echo "Checking Supabase project files"
test -f supabase/config.toml
test -d supabase/migrations
test -f supabase/migrations/20260617044009_billing_usage_limits.sql
test -f supabase/migrations/20260617054556_public_service_rpc_wrappers.sql
test -f supabase/migrations/20260617080031_harden_usage_quota_guards.sql
test -f supabase/migrations/20260617184720_authenticated_usage_summary_rpc.sql
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

echo "Checking static safety guards"
require_no_repo_file_match "service role key value assignment in repository files" "SUPABASE_SERVICE_ROLE_KEY[[:space:]]*=[[:space:]]*['\"]?(eyJ[A-Za-z0-9_-]{20,}|sb_secret_[A-Za-z0-9_-]{20,}|[A-Za-z0-9_-]{40,})" . ':(exclude)*.md'
require_no_match "OpenAI-style secret literal" "sk-[A-Za-z0-9_-]\\{20,\\}" . --exclude-dir=.git --exclude-dir=node_modules --exclude-dir=dist
require_no_match "storage/data URL image_url fallback" "image_url:[[:space:]]*storageUrl[[:space:]]*||[[:space:]]*imageDataUrl" supabase/functions
require_no_match "data URL image_url persistence" "image_url:[[:space:]]*imageDataUrl" supabase/functions

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
