-- Billing, usage limits, edge observability, and admin audit logs.

CREATE SCHEMA IF NOT EXISTS extensions;
CREATE EXTENSION IF NOT EXISTS "uuid-ossp" WITH SCHEMA extensions;

CREATE SCHEMA IF NOT EXISTS private;

REVOKE ALL ON SCHEMA private FROM PUBLIC;
REVOKE ALL ON SCHEMA private FROM anon;
REVOKE ALL ON SCHEMA private FROM authenticated;
GRANT USAGE ON SCHEMA private TO anon;
GRANT USAGE ON SCHEMA private TO authenticated;
GRANT USAGE ON SCHEMA private TO service_role;

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'plan_interval') THEN
    CREATE TYPE public.plan_interval AS ENUM ('month', 'year');
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'subscription_status') THEN
    CREATE TYPE public.subscription_status AS ENUM ('trialing', 'active', 'past_due', 'canceled', 'paused');
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'usage_event_status') THEN
    CREATE TYPE public.usage_event_status AS ENUM ('reserved', 'succeeded', 'failed', 'released');
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'edge_run_status') THEN
    CREATE TYPE public.edge_run_status AS ENUM ('started', 'succeeded', 'failed');
  END IF;
END $$;

CREATE TABLE IF NOT EXISTS public.plans (
  id UUID PRIMARY KEY DEFAULT extensions.uuid_generate_v4(),
  code TEXT NOT NULL UNIQUE,
  name TEXT NOT NULL,
  description TEXT,
  interval public.plan_interval NOT NULL DEFAULT 'month',
  monthly_quota INTEGER NOT NULL CHECK (monthly_quota >= 0),
  max_brands INTEGER NOT NULL DEFAULT 1 CHECK (max_brands > 0),
  max_members INTEGER NOT NULL DEFAULT 1 CHECK (max_members > 0),
  features JSONB NOT NULL DEFAULT '{}',
  is_active BOOLEAN NOT NULL DEFAULT TRUE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS public.brand_subscriptions (
  id UUID PRIMARY KEY DEFAULT extensions.uuid_generate_v4(),
  brand_id UUID NOT NULL UNIQUE REFERENCES public.brands(id) ON DELETE CASCADE,
  plan_id UUID NOT NULL REFERENCES public.plans(id),
  status public.subscription_status NOT NULL DEFAULT 'active',
  current_period_start TIMESTAMPTZ NOT NULL DEFAULT date_trunc('month', NOW()),
  current_period_end TIMESTAMPTZ NOT NULL DEFAULT (date_trunc('month', NOW()) + INTERVAL '1 month'),
  quota_override INTEGER CHECK (quota_override IS NULL OR quota_override >= 0),
  external_customer_id TEXT,
  external_subscription_id TEXT,
  metadata JSONB NOT NULL DEFAULT '{}',
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS public.usage_events (
  id UUID PRIMARY KEY DEFAULT extensions.uuid_generate_v4(),
  brand_id UUID NOT NULL REFERENCES public.brands(id) ON DELETE CASCADE,
  user_id UUID NOT NULL REFERENCES public.users(id) ON DELETE CASCADE,
  function_name TEXT NOT NULL,
  units INTEGER NOT NULL CHECK (units > 0),
  status public.usage_event_status NOT NULL DEFAULT 'reserved',
  request_id TEXT,
  idempotency_key TEXT,
  metadata JSONB NOT NULL DEFAULT '{}',
  reserved_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  completed_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS public.edge_function_runs (
  id UUID PRIMARY KEY DEFAULT extensions.uuid_generate_v4(),
  usage_event_id UUID REFERENCES public.usage_events(id) ON DELETE SET NULL,
  brand_id UUID REFERENCES public.brands(id) ON DELETE SET NULL,
  user_id UUID REFERENCES public.users(id) ON DELETE SET NULL,
  function_name TEXT NOT NULL,
  status public.edge_run_status NOT NULL DEFAULT 'started',
  request_id TEXT,
  duration_ms INTEGER CHECK (duration_ms IS NULL OR duration_ms >= 0),
  error_message TEXT,
  metadata JSONB NOT NULL DEFAULT '{}',
  started_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  completed_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS public.admin_audit_logs (
  id UUID PRIMARY KEY DEFAULT extensions.uuid_generate_v4(),
  actor_user_id UUID REFERENCES public.users(id) ON DELETE SET NULL,
  brand_id UUID REFERENCES public.brands(id) ON DELETE SET NULL,
  action TEXT NOT NULL,
  target_table TEXT,
  target_id UUID,
  metadata JSONB NOT NULL DEFAULT '{}',
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

ALTER TABLE public.plans ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.brand_subscriptions ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.usage_events ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.edge_function_runs ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.admin_audit_logs ENABLE ROW LEVEL SECURITY;

CREATE INDEX IF NOT EXISTS idx_brand_subscriptions_brand ON public.brand_subscriptions(brand_id);
CREATE INDEX IF NOT EXISTS idx_usage_events_brand_created ON public.usage_events(brand_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_usage_events_status ON public.usage_events(status);
ALTER TABLE public.usage_events DROP CONSTRAINT IF EXISTS usage_events_idempotency_key_key;
CREATE UNIQUE INDEX IF NOT EXISTS idx_usage_events_brand_function_idempotency
  ON public.usage_events(brand_id, function_name, idempotency_key)
  WHERE idempotency_key IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_edge_function_runs_brand_created ON public.edge_function_runs(brand_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_edge_function_runs_request_function
  ON public.edge_function_runs(request_id, function_name, started_at DESC);
CREATE INDEX IF NOT EXISTS idx_admin_audit_logs_created ON public.admin_audit_logs(created_at DESC);

INSERT INTO public.plans (code, name, description, monthly_quota, max_brands, max_members, features)
VALUES
  ('free', 'Free', 'Starter quota for evaluation', 25, 1, 2, '{"watermark": true}'::jsonb),
  ('pro', 'Pro', 'Production quota for active brands', 1000, 5, 10, '{"watermark": false, "priority": true}'::jsonb),
  ('business', 'Business', 'Higher limits for teams', 5000, 20, 50, '{"watermark": false, "priority": true, "audit": true}'::jsonb)
ON CONFLICT (code) DO UPDATE
SET name = EXCLUDED.name,
    description = EXCLUDED.description,
    monthly_quota = EXCLUDED.monthly_quota,
    max_brands = EXCLUDED.max_brands,
    max_members = EXCLUDED.max_members,
    features = EXCLUDED.features,
    is_active = TRUE,
    updated_at = NOW();

DROP POLICY IF EXISTS "Plans are readable" ON public.plans;
CREATE POLICY "Plans are readable"
  ON public.plans FOR SELECT
  TO anon, authenticated
  USING (is_active);

DROP POLICY IF EXISTS "Brand viewers can view subscriptions" ON public.brand_subscriptions;
CREATE POLICY "Brand viewers can view subscriptions"
  ON public.brand_subscriptions FOR SELECT
  TO authenticated
  USING (private.has_brand_role(brand_id, 'viewer'));

DROP POLICY IF EXISTS "Admins can view subscriptions" ON public.brand_subscriptions;
CREATE POLICY "Admins can view subscriptions"
  ON public.brand_subscriptions FOR SELECT
  TO authenticated
  USING (private.is_current_user_admin());

DROP POLICY IF EXISTS "Brand viewers can view usage events" ON public.usage_events;
CREATE POLICY "Brand viewers can view usage events"
  ON public.usage_events FOR SELECT
  TO authenticated
  USING (private.has_brand_role(brand_id, 'viewer'));

DROP POLICY IF EXISTS "Admins can view usage events" ON public.usage_events;
CREATE POLICY "Admins can view usage events"
  ON public.usage_events FOR SELECT
  TO authenticated
  USING (private.is_current_user_admin());

DROP POLICY IF EXISTS "Brand admins can view edge runs" ON public.edge_function_runs;
CREATE POLICY "Brand admins can view edge runs"
  ON public.edge_function_runs FOR SELECT
  TO authenticated
  USING (brand_id IS NOT NULL AND private.has_brand_role(brand_id, 'admin'));

DROP POLICY IF EXISTS "Admins can view edge runs" ON public.edge_function_runs;
CREATE POLICY "Admins can view edge runs"
  ON public.edge_function_runs FOR SELECT
  TO authenticated
  USING (private.is_current_user_admin());

DROP POLICY IF EXISTS "Admins can view audit logs" ON public.admin_audit_logs;
CREATE POLICY "Admins can view audit logs"
  ON public.admin_audit_logs FOR SELECT
  TO authenticated
  USING (private.is_current_user_admin());

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
    INTO v_used
  FROM public.usage_events
  WHERE brand_id = p_brand_id
    AND status IN ('reserved', 'succeeded')
    AND created_at >= v_period_start
    AND created_at < v_period_end;

  IF v_used + p_units > v_plan_quota THEN
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
    p_metadata
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

CREATE OR REPLACE FUNCTION private.complete_usage_event(
  p_usage_event_id UUID,
  p_status public.usage_event_status,
  p_metadata JSONB DEFAULT '{}'::jsonb
)
RETURNS VOID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
BEGIN
  IF p_status NOT IN ('succeeded', 'failed', 'released') THEN
    RAISE EXCEPTION 'Invalid completion status';
  END IF;

  UPDATE public.usage_events
  SET status = p_status,
      completed_at = NOW(),
      metadata = metadata || COALESCE(p_metadata, '{}'::jsonb)
  WHERE id = p_usage_event_id;
END;
$$;

CREATE OR REPLACE FUNCTION private.get_brand_usage_summary(p_brand_id UUID)
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
SECURITY DEFINER
SET search_path = ''
AS $$
  WITH subscription AS (
    SELECT bs.brand_id,
           p.code AS plan_code,
           COALESCE(bs.quota_override, p.monthly_quota) AS monthly_quota,
           bs.current_period_start,
           bs.current_period_end
    FROM public.brand_subscriptions bs
    JOIN public.plans p ON p.id = bs.plan_id
    WHERE bs.brand_id = p_brand_id
    LIMIT 1
  ),
  usage AS (
    SELECT COALESCE(SUM(units) FILTER (WHERE status = 'succeeded'), 0)::INTEGER AS used_units,
           COALESCE(SUM(units) FILTER (WHERE status = 'reserved'), 0)::INTEGER AS reserved_units
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
$$;

CREATE OR REPLACE FUNCTION private.record_edge_function_run(
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
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_id UUID;
BEGIN
  IF p_status <> 'started' THEN
    UPDATE public.edge_function_runs
    SET usage_event_id = COALESCE(p_usage_event_id, public.edge_function_runs.usage_event_id),
        brand_id = COALESCE(p_brand_id, public.edge_function_runs.brand_id),
        user_id = COALESCE(p_user_id, public.edge_function_runs.user_id),
        status = p_status,
        duration_ms = p_duration_ms,
        error_message = p_error_message,
        metadata = public.edge_function_runs.metadata || COALESCE(p_metadata, '{}'::jsonb),
        completed_at = NOW()
    WHERE id = (
      SELECT efr.id
      FROM public.edge_function_runs efr
      WHERE efr.request_id = p_request_id
        AND efr.function_name = COALESCE(p_function_name, 'unknown')
        AND (
          p_usage_event_id IS NULL
          OR efr.usage_event_id = p_usage_event_id
        )
        AND (
          p_brand_id IS NULL
          OR efr.brand_id = p_brand_id
        )
      ORDER BY efr.started_at DESC
      LIMIT 1
    )
    RETURNING id INTO v_id;

    IF v_id IS NOT NULL THEN
      RETURN v_id;
    END IF;
  END IF;

  INSERT INTO public.edge_function_runs (
    usage_event_id,
    brand_id,
    user_id,
    function_name,
    status,
    request_id,
    duration_ms,
    error_message,
    metadata,
    completed_at
  )
  VALUES (
    p_usage_event_id,
    p_brand_id,
    p_user_id,
    COALESCE(p_function_name, 'unknown'),
    p_status,
    p_request_id,
    p_duration_ms,
    p_error_message,
    COALESCE(p_metadata, '{}'::jsonb),
    CASE WHEN p_status = 'started' THEN NULL ELSE NOW() END
  )
  RETURNING id INTO v_id;

  RETURN v_id;
END;
$$;

REVOKE ALL ON TABLE public.plans FROM PUBLIC, anon, authenticated;
REVOKE ALL ON TABLE public.brand_subscriptions FROM PUBLIC, anon, authenticated;
REVOKE ALL ON TABLE public.usage_events FROM PUBLIC, anon, authenticated;
REVOKE ALL ON TABLE public.edge_function_runs FROM PUBLIC, anon, authenticated;
REVOKE ALL ON TABLE public.admin_audit_logs FROM PUBLIC, anon, authenticated;

GRANT SELECT ON TABLE public.plans TO anon, authenticated;
GRANT SELECT ON TABLE public.brand_subscriptions TO authenticated;
GRANT SELECT ON TABLE public.usage_events TO authenticated;
GRANT SELECT ON TABLE public.edge_function_runs TO authenticated;
GRANT SELECT ON TABLE public.admin_audit_logs TO authenticated;
GRANT ALL ON TABLE public.plans TO service_role;
GRANT ALL ON TABLE public.brand_subscriptions TO service_role;
GRANT ALL ON TABLE public.usage_events TO service_role;
GRANT ALL ON TABLE public.edge_function_runs TO service_role;
GRANT ALL ON TABLE public.admin_audit_logs TO service_role;

REVOKE ALL ON FUNCTION private.reserve_brand_usage(UUID, UUID, TEXT, INTEGER, TEXT, TEXT, JSONB) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION private.complete_usage_event(UUID, public.usage_event_status, JSONB) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION private.get_brand_usage_summary(UUID) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION private.record_edge_function_run(UUID, UUID, UUID, TEXT, public.edge_run_status, TEXT, INTEGER, TEXT, JSONB) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION private.reserve_brand_usage(UUID, UUID, TEXT, INTEGER, TEXT, TEXT, JSONB) TO service_role;
GRANT EXECUTE ON FUNCTION private.complete_usage_event(UUID, public.usage_event_status, JSONB) TO service_role;
GRANT EXECUTE ON FUNCTION private.get_brand_usage_summary(UUID) TO service_role;
GRANT EXECUTE ON FUNCTION private.record_edge_function_run(UUID, UUID, UUID, TEXT, public.edge_run_status, TEXT, INTEGER, TEXT, JSONB) TO service_role;

DROP FUNCTION IF EXISTS public.has_brand_role(UUID, TEXT);
DROP FUNCTION IF EXISTS public.brand_role_for_user(UUID, UUID);
DROP FUNCTION IF EXISTS public.is_current_user_admin();
