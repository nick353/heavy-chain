-- Keep free-plan generation usable across month boundaries without enabling
-- checkout, paid upgrades, credential entry, or brand-wide test bypasses.
-- Expired non-free subscriptions still fail closed for H602 readiness.

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

  UPDATE public.brand_subscriptions bs
  SET status = 'active',
      current_period_start = date_trunc('month', v_now),
      current_period_end = date_trunc('month', v_now) + INTERVAL '1 month',
      updated_at = v_now,
      metadata = COALESCE(bs.metadata, '{}'::jsonb) || jsonb_build_object(
        'free_period_rolled_at',
        v_now,
        'free_period_roll_reason',
        'usage_reservation_month_boundary'
      )
  FROM public.plans p
  WHERE bs.brand_id = p_brand_id
    AND bs.plan_id = p.id
    AND p.code = 'free'
    AND p.is_active
    AND (
      bs.status NOT IN ('trialing', 'active')
      OR bs.current_period_start > v_now
      OR bs.current_period_end <= v_now
    );

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

REVOKE ALL ON FUNCTION private.reserve_brand_usage(UUID, UUID, TEXT, INTEGER, TEXT, TEXT, JSONB) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION private.reserve_brand_usage(UUID, UUID, TEXT, INTEGER, TEXT, TEXT, JSONB) TO service_role;
