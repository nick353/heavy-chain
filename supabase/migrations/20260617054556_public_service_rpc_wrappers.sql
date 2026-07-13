CREATE OR REPLACE FUNCTION public.service_reserve_brand_usage(
  p_brand_id UUID,
  p_user_id UUID,
  p_function_name TEXT,
  p_units INTEGER DEFAULT 1,
  p_idempotency_key TEXT DEFAULT NULL,
  p_request_id TEXT DEFAULT NULL,
  p_metadata JSONB DEFAULT '{}'::jsonb
)
RETURNS TABLE (
  usage_event_id UUID,
  monthly_quota INTEGER,
  used_units INTEGER,
  remaining_units INTEGER
)
LANGUAGE sql
SET search_path = ''
AS $$
  SELECT *
  FROM private.reserve_brand_usage(
    p_brand_id,
    p_user_id,
    p_function_name,
    p_units,
    p_idempotency_key,
    p_request_id,
    p_metadata
  );
$$;

CREATE OR REPLACE FUNCTION public.service_complete_usage_event(
  p_usage_event_id UUID,
  p_status public.usage_event_status,
  p_metadata JSONB DEFAULT '{}'::jsonb
)
RETURNS VOID
LANGUAGE sql
SET search_path = ''
AS $$
  SELECT private.complete_usage_event(
    p_usage_event_id,
    p_status,
    p_metadata
  );
$$;

CREATE OR REPLACE FUNCTION public.service_get_brand_usage_summary(p_brand_id UUID)
RETURNS TABLE (
  brand_id UUID,
  plan_code TEXT,
  monthly_quota INTEGER,
  used_units INTEGER,
  reserved_units INTEGER,
  remaining_units INTEGER,
  period_start TIMESTAMPTZ,
  period_end TIMESTAMPTZ
)
LANGUAGE sql
STABLE
SET search_path = ''
AS $$
  SELECT *
  FROM private.get_brand_usage_summary(p_brand_id);
$$;

CREATE OR REPLACE FUNCTION public.service_record_edge_function_run(
  p_usage_event_id UUID DEFAULT NULL,
  p_brand_id UUID DEFAULT NULL,
  p_user_id UUID DEFAULT NULL,
  p_function_name TEXT DEFAULT NULL,
  p_status public.edge_run_status DEFAULT 'started',
  p_request_id TEXT DEFAULT NULL,
  p_duration_ms INTEGER DEFAULT NULL,
  p_error_message TEXT DEFAULT NULL,
  p_metadata JSONB DEFAULT '{}'::jsonb
)
RETURNS UUID
LANGUAGE sql
SET search_path = ''
AS $$
  SELECT private.record_edge_function_run(
    p_usage_event_id,
    p_brand_id,
    p_user_id,
    p_function_name,
    p_status,
    p_request_id,
    p_duration_ms,
    p_error_message,
    p_metadata
  );
$$;

REVOKE ALL ON FUNCTION public.service_reserve_brand_usage(UUID, UUID, TEXT, INTEGER, TEXT, TEXT, JSONB) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.service_complete_usage_event(UUID, public.usage_event_status, JSONB) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.service_get_brand_usage_summary(UUID) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.service_record_edge_function_run(UUID, UUID, UUID, TEXT, public.edge_run_status, TEXT, INTEGER, TEXT, JSONB) FROM PUBLIC, anon, authenticated;

GRANT EXECUTE ON FUNCTION public.service_reserve_brand_usage(UUID, UUID, TEXT, INTEGER, TEXT, TEXT, JSONB) TO service_role;
GRANT EXECUTE ON FUNCTION public.service_complete_usage_event(UUID, public.usage_event_status, JSONB) TO service_role;
GRANT EXECUTE ON FUNCTION public.service_get_brand_usage_summary(UUID) TO service_role;
GRANT EXECUTE ON FUNCTION public.service_record_edge_function_run(UUID, UUID, UUID, TEXT, public.edge_run_status, TEXT, INTEGER, TEXT, JSONB) TO service_role;
