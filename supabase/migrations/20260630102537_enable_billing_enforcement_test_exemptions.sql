-- Re-enable generation quota enforcement for production billing readiness while
-- keeping Apple sandbox/tester accounts exempt from real-charge-gated limits.
-- This migration does not configure Apple ID credentials, checkout, or payment.

CREATE TABLE IF NOT EXISTS public.billing_settings (
  id BOOLEAN PRIMARY KEY DEFAULT TRUE CHECK (id),
  generation_quota_enforced BOOLEAN NOT NULL DEFAULT TRUE,
  apple_billing_mode TEXT NOT NULL DEFAULT 'operator_managed'
    CHECK (apple_billing_mode IN ('operator_managed', 'disabled')),
  sandbox_testers_no_real_charge BOOLEAN NOT NULL DEFAULT TRUE,
  production_checkout_enabled BOOLEAN NOT NULL DEFAULT FALSE,
  metadata JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

INSERT INTO public.billing_settings (
  id,
  generation_quota_enforced,
  apple_billing_mode,
  sandbox_testers_no_real_charge,
  production_checkout_enabled,
  metadata
)
VALUES (
  TRUE,
  TRUE,
  'operator_managed',
  TRUE,
  FALSE,
  jsonb_build_object(
    'h602_scope',
    'quota_enforcement_and_sandbox_tester_exemptions_only',
    'apple_id_or_checkout_credentials_configured_by_migration',
    FALSE
  )
)
ON CONFLICT (id) DO UPDATE
SET generation_quota_enforced = EXCLUDED.generation_quota_enforced,
    apple_billing_mode = EXCLUDED.apple_billing_mode,
    sandbox_testers_no_real_charge = EXCLUDED.sandbox_testers_no_real_charge,
    production_checkout_enabled = EXCLUDED.production_checkout_enabled,
    metadata = public.billing_settings.metadata || EXCLUDED.metadata,
    updated_at = NOW();

CREATE TABLE IF NOT EXISTS public.billing_test_accounts (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID REFERENCES public.users(id) ON DELETE CASCADE,
  brand_id UUID REFERENCES public.brands(id) ON DELETE CASCADE,
  email TEXT,
  provider TEXT NOT NULL DEFAULT 'apple_sandbox'
    CHECK (provider IN ('apple_sandbox', 'internal_qa', 'operator_manual')),
  reason TEXT NOT NULL DEFAULT 'Apple sandbox tester: purchase flow is test-only and should not create real charges',
  is_active BOOLEAN NOT NULL DEFAULT TRUE,
  starts_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  ends_at TIMESTAMPTZ,
  metadata JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT billing_test_accounts_target_check
    CHECK (user_id IS NOT NULL OR email IS NOT NULL),
  CONSTRAINT billing_test_accounts_email_lower_check
    CHECK (email IS NULL OR email = lower(email))
);

CREATE UNIQUE INDEX IF NOT EXISTS idx_billing_test_accounts_user_active
  ON public.billing_test_accounts(user_id)
  WHERE user_id IS NOT NULL AND is_active;

CREATE UNIQUE INDEX IF NOT EXISTS idx_billing_test_accounts_brand_active
  ON public.billing_test_accounts(brand_id)
  WHERE brand_id IS NOT NULL AND is_active;

CREATE UNIQUE INDEX IF NOT EXISTS idx_billing_test_accounts_email_active
  ON public.billing_test_accounts(email)
  WHERE email IS NOT NULL AND is_active;

ALTER TABLE public.billing_settings ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.billing_test_accounts ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Admins can view billing settings" ON public.billing_settings;
CREATE POLICY "Admins can view billing settings"
  ON public.billing_settings FOR SELECT
  TO authenticated
  USING (private.is_current_user_admin());

DROP POLICY IF EXISTS "Admins can manage billing settings" ON public.billing_settings;
CREATE POLICY "Admins can manage billing settings"
  ON public.billing_settings FOR ALL
  TO authenticated
  USING (private.is_current_user_admin())
  WITH CHECK (private.is_current_user_admin());

DROP POLICY IF EXISTS "Admins can view billing test accounts" ON public.billing_test_accounts;
CREATE POLICY "Admins can view billing test accounts"
  ON public.billing_test_accounts FOR SELECT
  TO authenticated
  USING (private.is_current_user_admin());

DROP POLICY IF EXISTS "Admins can manage billing test accounts" ON public.billing_test_accounts;
CREATE POLICY "Admins can manage billing test accounts"
  ON public.billing_test_accounts FOR ALL
  TO authenticated
  USING (private.is_current_user_admin())
  WITH CHECK (private.is_current_user_admin());

CREATE OR REPLACE FUNCTION private.is_billing_test_account(
  p_user_id UUID,
  p_brand_id UUID
)
RETURNS BOOLEAN
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = ''
AS $$
  SELECT COALESCE(EXISTS (
    SELECT 1
    FROM public.billing_test_accounts bta
    LEFT JOIN public.users u ON u.id = p_user_id
    WHERE bta.is_active
      AND bta.starts_at <= NOW()
      AND (bta.ends_at IS NULL OR bta.ends_at > NOW())
      AND (
        (bta.user_id IS NOT NULL AND bta.user_id = p_user_id)
        OR (
          bta.email IS NOT NULL
          AND u.email IS NOT NULL
          AND bta.email = lower(u.email)
        )
      )
  ), FALSE)
$$;

CREATE OR REPLACE FUNCTION private.is_apple_sandbox_billing_test_account(
  p_user_id UUID,
  p_brand_id UUID
)
RETURNS BOOLEAN
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = ''
AS $$
  SELECT COALESCE(EXISTS (
    SELECT 1
    FROM public.billing_test_accounts bta
    LEFT JOIN public.users u ON u.id = p_user_id
    WHERE bta.is_active
      AND bta.provider = 'apple_sandbox'
      AND bta.starts_at <= NOW()
      AND (bta.ends_at IS NULL OR bta.ends_at > NOW())
      AND (
        (bta.user_id IS NOT NULL AND bta.user_id = p_user_id)
        OR (
          bta.email IS NOT NULL
          AND u.email IS NOT NULL
          AND bta.email = lower(u.email)
        )
      )
  ), FALSE)
$$;

CREATE OR REPLACE FUNCTION private.is_generation_quota_enforced()
RETURNS BOOLEAN
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = ''
AS $$
  SELECT COALESCE(
    (SELECT bs.generation_quota_enforced FROM public.billing_settings bs WHERE bs.id = TRUE),
    TRUE
  )
$$;

CREATE OR REPLACE FUNCTION private.reserve_brand_usage(
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
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_plan_quota INTEGER;
  v_used INTEGER;
  v_event_id UUID;
  v_period_start TIMESTAMPTZ;
  v_period_end TIMESTAMPTZ;
  v_brand_recent_units INTEGER;
  v_user_recent_units INTEGER;
  v_now TIMESTAMPTZ := NOW();
  v_quota_enforced BOOLEAN := private.is_generation_quota_enforced();
  v_is_billing_test_account BOOLEAN;
  v_is_apple_sandbox_billing_test_account BOOLEAN;
BEGIN
  IF p_units IS NULL OR p_units <= 0 THEN
    RAISE EXCEPTION 'Usage units must be positive';
  END IF;

  IF NOT EXISTS (
    SELECT 1
    FROM public.brands b
    WHERE b.id = p_brand_id
    FOR UPDATE
  ) THEN
    RAISE EXCEPTION 'Brand not found';
  END IF;

  IF NOT EXISTS (
    SELECT 1
    FROM public.users u
    WHERE u.id = p_user_id
    FOR UPDATE
  ) THEN
    RAISE EXCEPTION 'User not found';
  END IF;

  v_is_billing_test_account := private.is_billing_test_account(p_user_id, p_brand_id);
  v_is_apple_sandbox_billing_test_account := private.is_apple_sandbox_billing_test_account(p_user_id, p_brand_id);

  UPDATE public.usage_events
  SET status = 'released',
      completed_at = COALESCE(completed_at, v_now),
      metadata = metadata || jsonb_build_object(
        'reservation_stale',
        true,
        'stale_released_at',
        v_now
      )
  WHERE status = 'reserved'
    AND reserved_at < v_now - INTERVAL '15 minutes';

  INSERT INTO public.brand_subscriptions (brand_id, plan_id)
  SELECT p_brand_id, p.id
  FROM public.plans p
  WHERE p.code = 'free'
  ON CONFLICT (brand_id) DO NOTHING;

  SELECT COALESCE(bs.quota_override, p.monthly_quota),
         bs.current_period_start,
         bs.current_period_end
    INTO v_plan_quota, v_period_start, v_period_end
  FROM public.brand_subscriptions bs
  JOIN public.plans p ON p.id = bs.plan_id
  WHERE bs.brand_id = p_brand_id
    AND bs.status IN ('trialing', 'active')
    AND bs.current_period_start <= v_now
    AND bs.current_period_end > v_now
    AND p.is_active
  LIMIT 1;

  IF v_plan_quota IS NULL THEN
    RAISE EXCEPTION 'No active subscription for brand';
  END IF;

  IF p_idempotency_key IS NOT NULL THEN
    SELECT id
      INTO v_event_id
    FROM public.usage_events
    WHERE brand_id = p_brand_id
      AND function_name = p_function_name
      AND idempotency_key = p_idempotency_key
    FOR UPDATE;

    IF v_event_id IS NOT NULL THEN
      UPDATE public.usage_events
      SET request_id = COALESCE(p_request_id, request_id),
          metadata = metadata || COALESCE(p_metadata, '{}'::jsonb)
      WHERE id = v_event_id;

      SELECT COALESCE(SUM(units), 0)
        INTO v_used
      FROM public.usage_events
      WHERE brand_id = p_brand_id
        AND status IN ('reserved', 'succeeded')
        AND created_at >= v_period_start
        AND created_at < v_period_end;

      RETURN QUERY SELECT v_event_id, v_plan_quota, v_used, GREATEST(v_plan_quota - v_used, 0);
      RETURN;
    END IF;
  END IF;

  SELECT COALESCE(SUM(units), 0)
    INTO v_brand_recent_units
  FROM public.usage_events
  WHERE brand_id = p_brand_id
    AND status IN ('reserved', 'succeeded')
    AND reserved_at >= v_now - INTERVAL '1 minute';

  IF v_brand_recent_units + p_units > 5 THEN
    RAISE EXCEPTION 'Brand usage rate limit exceeded';
  END IF;

  SELECT COALESCE(SUM(units), 0)
    INTO v_user_recent_units
  FROM public.usage_events
  WHERE user_id = p_user_id
    AND status IN ('reserved', 'succeeded')
    AND reserved_at >= v_now - INTERVAL '1 minute';

  IF v_user_recent_units + p_units > 3 THEN
    RAISE EXCEPTION 'User usage rate limit exceeded';
  END IF;

  SELECT COALESCE(SUM(units), 0)
    INTO v_used
  FROM public.usage_events
  WHERE brand_id = p_brand_id
    AND status IN ('reserved', 'succeeded')
    AND created_at >= v_period_start
    AND created_at < v_period_end;

  IF v_quota_enforced
     AND NOT v_is_billing_test_account
     AND v_used + p_units > v_plan_quota THEN
    RAISE EXCEPTION 'Brand usage quota exceeded';
  END IF;

  INSERT INTO public.usage_events (
    brand_id,
    user_id,
    function_name,
    units,
    status,
    idempotency_key,
    request_id,
    metadata
  )
  VALUES (
    p_brand_id,
    p_user_id,
    p_function_name,
    p_units,
    'reserved',
    p_idempotency_key,
    p_request_id,
    COALESCE(p_metadata, '{}'::jsonb) || jsonb_build_object(
      'generation_quota_enforced',
      v_quota_enforced,
      'billing_test_account_quota_bypass',
      v_is_billing_test_account,
      'apple_sandbox_tester_no_real_charge',
      v_is_apple_sandbox_billing_test_account
    )
  )
  ON CONFLICT (brand_id, function_name, idempotency_key)
    WHERE idempotency_key IS NOT NULL
  DO UPDATE
    SET request_id = COALESCE(EXCLUDED.request_id, public.usage_events.request_id),
        metadata = public.usage_events.metadata || COALESCE(EXCLUDED.metadata, '{}'::jsonb)
  RETURNING id INTO v_event_id;

  RETURN QUERY
  SELECT v_event_id,
         v_plan_quota,
         v_used + p_units,
         GREATEST(v_plan_quota - v_used - p_units, 0);
END;
$$;

DROP FUNCTION IF EXISTS public.get_brand_usage_summary(UUID);
CREATE FUNCTION public.get_brand_usage_summary(p_brand_id UUID)
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

REVOKE ALL ON TABLE public.billing_settings FROM PUBLIC, anon, authenticated;
REVOKE ALL ON TABLE public.billing_test_accounts FROM PUBLIC, anon, authenticated;
GRANT SELECT ON TABLE public.billing_settings TO authenticated;
GRANT SELECT ON TABLE public.billing_test_accounts TO authenticated;
GRANT ALL ON TABLE public.billing_settings TO service_role;
GRANT ALL ON TABLE public.billing_test_accounts TO service_role;

REVOKE ALL ON FUNCTION private.is_billing_test_account(UUID, UUID) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION private.is_apple_sandbox_billing_test_account(UUID, UUID) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION private.is_generation_quota_enforced() FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION private.reserve_brand_usage(UUID, UUID, TEXT, INTEGER, TEXT, TEXT, JSONB) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.get_brand_usage_summary(UUID) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION private.is_billing_test_account(UUID, UUID) TO service_role;
GRANT EXECUTE ON FUNCTION private.is_apple_sandbox_billing_test_account(UUID, UUID) TO service_role;
GRANT EXECUTE ON FUNCTION private.is_generation_quota_enforced() TO service_role;
GRANT EXECUTE ON FUNCTION private.reserve_brand_usage(UUID, UUID, TEXT, INTEGER, TEXT, TEXT, JSONB) TO service_role;
GRANT EXECUTE ON FUNCTION public.get_brand_usage_summary(UUID) TO authenticated;
GRANT EXECUTE ON FUNCTION public.get_brand_usage_summary(UUID) TO service_role;
