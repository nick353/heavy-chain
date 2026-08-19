BEGIN;

-- The public usage-summary RPC is intentionally SECURITY INVOKER.  Its
-- implementation must therefore live behind an authenticated SECURITY
-- DEFINER boundary; otherwise RLS on plans/subscriptions/usage_events makes
-- History and Jobs fail before they can read their independent data sources.
CREATE OR REPLACE FUNCTION private.get_brand_usage_summary_for_authenticated_user(p_brand_id UUID)
RETURNS TABLE (
  brand_id UUID,
  plan_code TEXT,
  monthly_quota INTEGER,
  used_units INTEGER,
  reserved_units INTEGER,
  remaining_units INTEGER,
  period_start TIMESTAMPTZ,
  period_end TIMESTAMPTZ,
  billing_test_account_quota_bypass BOOLEAN,
  apple_sandbox_tester_no_real_charge BOOLEAN
)
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_user_id UUID := auth.uid();
BEGIN
  IF NOT (
    private.has_brand_role(p_brand_id, 'viewer')
    OR private.is_current_user_admin()
  ) THEN
    RAISE EXCEPTION 'Brand not found or access denied';
  END IF;

  RETURN QUERY
  WITH active_subscription AS (
    SELECT bs.brand_id,
           p.code AS plan_code,
           COALESCE(bs.quota_override, p.monthly_quota) AS monthly_quota,
           bs.current_period_start,
           bs.current_period_end
    FROM public.brand_subscriptions bs
    JOIN public.plans p ON p.id = bs.plan_id
    WHERE bs.brand_id = p_brand_id
      AND bs.status IN ('trialing', 'active')
      AND bs.current_period_start <= NOW()
      AND bs.current_period_end > NOW()
      AND p.is_active
    LIMIT 1
  ),
  fallback_plan AS (
    SELECT p_brand_id AS brand_id,
           p.code AS plan_code,
           p.monthly_quota,
           date_trunc('month', NOW()) AS current_period_start,
           date_trunc('month', NOW()) + INTERVAL '1 month' AS current_period_end
    FROM public.plans p
    WHERE p.code = 'free'
      AND p.is_active
    LIMIT 1
  ),
  subscription AS (
    SELECT * FROM active_subscription
    UNION ALL
    SELECT * FROM fallback_plan
    WHERE NOT EXISTS (SELECT 1 FROM active_subscription)
    LIMIT 1
  ),
  usage AS (
    SELECT COALESCE(SUM(ue.units) FILTER (WHERE ue.status = 'succeeded'), 0)::INTEGER AS used_units,
           COALESCE(SUM(ue.units) FILTER (WHERE ue.status = 'reserved'), 0)::INTEGER AS reserved_units
    FROM public.usage_events ue
    JOIN subscription s ON s.brand_id = ue.brand_id
    WHERE ue.created_at >= s.current_period_start
      AND ue.created_at < s.current_period_end
  ),
  test_account AS (
    SELECT private.is_billing_test_account(v_user_id, p_brand_id) AS billing_test_account_quota_bypass,
           private.is_apple_sandbox_billing_test_account(v_user_id, p_brand_id) AS apple_sandbox_tester_no_real_charge
  )
  SELECT s.brand_id,
         s.plan_code,
         s.monthly_quota,
         u.used_units,
         u.reserved_units,
         GREATEST(s.monthly_quota - u.used_units - u.reserved_units, 0),
         s.current_period_start,
         s.current_period_end,
         ta.billing_test_account_quota_bypass,
         ta.apple_sandbox_tester_no_real_charge
  FROM subscription s
  CROSS JOIN usage u
  CROSS JOIN test_account ta;
END;
$$;

CREATE OR REPLACE FUNCTION public.get_brand_usage_summary(p_brand_id UUID)
RETURNS TABLE (
  brand_id UUID,
  plan_code TEXT,
  monthly_quota INTEGER,
  used_units INTEGER,
  reserved_units INTEGER,
  remaining_units INTEGER,
  period_start TIMESTAMPTZ,
  period_end TIMESTAMPTZ,
  billing_test_account_quota_bypass BOOLEAN,
  apple_sandbox_tester_no_real_charge BOOLEAN
)
LANGUAGE sql
STABLE
SECURITY INVOKER
SET search_path = public, pg_temp
AS $$
  SELECT *
  FROM private.get_brand_usage_summary_for_authenticated_user(p_brand_id);
$$;

REVOKE ALL ON FUNCTION private.get_brand_usage_summary_for_authenticated_user(UUID) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION private.get_brand_usage_summary_for_authenticated_user(UUID) TO authenticated, service_role;

REVOKE ALL ON FUNCTION public.get_brand_usage_summary(UUID) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.get_brand_usage_summary(UUID) TO authenticated, service_role;

COMMENT ON FUNCTION public.get_brand_usage_summary(UUID)
  IS 'Authenticated invoker boundary for the private usage-summary implementation.';

COMMIT;
