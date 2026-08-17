-- Retire the legacy third-party image-provider integration.
-- This migration removes only provider-specific database state; generation
-- history and existing assets remain available to the OpenAI-backed path.

BEGIN;

-- The legacy connection tables contain only provider OAuth/approval state.
DROP FUNCTION IF EXISTS public.request_runway_mcp_connection(UUID);
DROP FUNCTION IF EXISTS public.request_runway_mcp_connection(UUID, TEXT);
DROP FUNCTION IF EXISTS public.admin_update_runway_mcp_connection(UUID, public.runway_mcp_connection_status);
DROP FUNCTION IF EXISTS public.admin_update_runway_mcp_connection(UUID, public.runway_mcp_connection_status, TEXT);
DROP TABLE IF EXISTS public.runway_mcp_oauth_connections;
DROP TABLE IF EXISTS public.runway_mcp_oauth_states;
DROP TABLE IF EXISTS public.runway_mcp_connection_approvals;
DROP TYPE IF EXISTS public.runway_mcp_connection_status;

-- Remove the retired feature flag from plan JSON without changing plan access.
UPDATE public.plans
SET features = COALESCE(features, '{}'::jsonb) - 'runway_mcp_generation',
    updated_at = NOW()
WHERE features ? 'runway_mcp_generation';

-- Keep usage records constrained to the providers supported by the app.
DO $$
DECLARE
  v_constraint_name TEXT;
BEGIN
  SELECT c.conname
    INTO v_constraint_name
  FROM pg_constraint c
  JOIN pg_attribute a
    ON a.attrelid = c.conrelid
   AND a.attnum = ANY (c.conkey)
  WHERE c.conrelid = 'public.api_usage_logs'::regclass
    AND c.contype = 'c'
    AND c.conkey = ARRAY[a.attnum]
    AND a.attname = 'provider'
  LIMIT 1;

  IF v_constraint_name IS NOT NULL THEN
    EXECUTE format('ALTER TABLE public.api_usage_logs DROP CONSTRAINT %I', v_constraint_name);
  END IF;
END;
$$;

ALTER TABLE public.api_usage_logs
  ADD CONSTRAINT api_usage_logs_provider_check
  CHECK (provider IN ('openai', 'gemini'));

COMMIT;
