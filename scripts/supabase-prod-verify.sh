#!/usr/bin/env bash
set -euo pipefail

echo "Checking Supabase project files"
test -f supabase/config.toml
test -d supabase/migrations
test -f supabase/migrations/20260617044009_billing_usage_limits.sql
test -f supabase/migrations/20260617054556_public_service_rpc_wrappers.sql
grep -q 'schemas = \["public", "storage"\]' supabase/config.toml

if [[ "${SUPABASE_VERIFY_DB:-0}" == "1" ]]; then
  echo "Checking local migration list against local database"
  supabase migration list --local >/dev/null
else
  echo "Skipping local database migration list; set SUPABASE_VERIFY_DB=1 to enable it"
fi

echo "Checking required private RPC definitions"
grep -q "private.reserve_brand_usage" supabase/migrations/20260617044009_billing_usage_limits.sql
grep -q "private.get_brand_usage_summary" supabase/migrations/20260617044009_billing_usage_limits.sql
grep -q "private.record_edge_function_run" supabase/migrations/20260617044009_billing_usage_limits.sql

echo "Checking required public service RPC wrappers"
grep -q "public.service_reserve_brand_usage" supabase/migrations/20260617054556_public_service_rpc_wrappers.sql
grep -q "public.service_complete_usage_event" supabase/migrations/20260617054556_public_service_rpc_wrappers.sql
grep -q "public.service_get_brand_usage_summary" supabase/migrations/20260617054556_public_service_rpc_wrappers.sql
grep -q "public.service_record_edge_function_run" supabase/migrations/20260617054556_public_service_rpc_wrappers.sql
grep -q "GRANT EXECUTE ON FUNCTION public.service_reserve_brand_usage(UUID, UUID, TEXT, INTEGER, TEXT, TEXT, JSONB) TO service_role" supabase/migrations/20260617054556_public_service_rpc_wrappers.sql
grep -q "GRANT EXECUTE ON FUNCTION public.service_record_edge_function_run(UUID, UUID, UUID, TEXT, public.edge_run_status, TEXT, INTEGER, TEXT, JSONB) TO service_role" supabase/migrations/20260617054556_public_service_rpc_wrappers.sql
! grep -q "schema('private').rpc" supabase/functions/_shared/usage.ts
! grep -q "schema('private').rpc" supabase/functions/_shared/observability.ts

echo "Supabase production verification passed. Secret values were not printed."
