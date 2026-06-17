CREATE OR REPLACE FUNCTION public.get_brand_usage_summary(p_brand_id UUID)
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
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = ''
AS $$
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
  )
  SELECT s.brand_id,
         s.plan_code,
         s.monthly_quota,
         u.used_units,
         u.reserved_units,
         GREATEST(s.monthly_quota - u.used_units - u.reserved_units, 0),
         s.current_period_start,
         s.current_period_end
  FROM subscription s
  CROSS JOIN usage u;
END;
$$;

REVOKE ALL ON FUNCTION public.get_brand_usage_summary(UUID) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.get_brand_usage_summary(UUID) TO authenticated;
GRANT EXECUTE ON FUNCTION public.get_brand_usage_summary(UUID) TO service_role;
