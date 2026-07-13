-- Add brand-level Runway MCP bridge connection approvals.
-- Bridge URL/token values remain in Supabase Edge Function secrets only.

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_type WHERE typnamespace = 'public'::regnamespace AND typname = 'runway_mcp_connection_status'
  ) THEN
    CREATE TYPE public.runway_mcp_connection_status AS ENUM ('pending', 'approved', 'rejected', 'revoked');
  END IF;
END $$;

CREATE TABLE IF NOT EXISTS public.runway_mcp_connection_approvals (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  brand_id UUID NOT NULL REFERENCES public.brands(id) ON DELETE CASCADE,
  status public.runway_mcp_connection_status NOT NULL DEFAULT 'pending',
  requested_by UUID NOT NULL REFERENCES public.users(id) ON DELETE RESTRICT,
  approved_by UUID REFERENCES public.users(id) ON DELETE SET NULL,
  rejected_by UUID REFERENCES public.users(id) ON DELETE SET NULL,
  revoked_by UUID REFERENCES public.users(id) ON DELETE SET NULL,
  requested_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  approved_at TIMESTAMPTZ,
  rejected_at TIMESTAMPTZ,
  revoked_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT runway_mcp_connection_approvals_brand_unique UNIQUE (brand_id)
);

CREATE INDEX IF NOT EXISTS idx_runway_mcp_connection_approvals_status
  ON public.runway_mcp_connection_approvals(status);
CREATE INDEX IF NOT EXISTS idx_runway_mcp_connection_approvals_requested_by
  ON public.runway_mcp_connection_approvals(requested_by);

ALTER TABLE public.runway_mcp_connection_approvals ENABLE ROW LEVEL SECURITY;

REVOKE ALL ON TABLE public.runway_mcp_connection_approvals FROM PUBLIC, anon, authenticated;
GRANT SELECT ON TABLE public.runway_mcp_connection_approvals TO authenticated;
GRANT ALL ON TABLE public.runway_mcp_connection_approvals TO service_role;

DROP POLICY IF EXISTS "Brand viewers can view Runway MCP connection approvals"
  ON public.runway_mcp_connection_approvals;
CREATE POLICY "Brand viewers can view Runway MCP connection approvals"
  ON public.runway_mcp_connection_approvals FOR SELECT
  TO authenticated
  USING (
    private.has_brand_role(brand_id, 'viewer')
    OR private.is_current_user_admin()
  );

DROP FUNCTION IF EXISTS public.request_runway_mcp_connection(UUID, TEXT);
CREATE OR REPLACE FUNCTION public.request_runway_mcp_connection(
  p_brand_id UUID
)
RETURNS public.runway_mcp_connection_approvals
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_user_id UUID := auth.uid();
  v_row public.runway_mcp_connection_approvals;
BEGIN
  IF v_user_id IS NULL THEN
    RAISE EXCEPTION 'Unauthorized';
  END IF;

  IF NOT private.has_brand_role(p_brand_id, 'admin') THEN
    RAISE EXCEPTION 'Insufficient brand permissions';
  END IF;

  IF NOT EXISTS (SELECT 1 FROM public.brands WHERE id = p_brand_id) THEN
    RAISE EXCEPTION 'Brand not found';
  END IF;

  SELECT *
    INTO v_row
    FROM public.runway_mcp_connection_approvals
    WHERE brand_id = p_brand_id;

  IF FOUND AND v_row.status = 'approved' THEN
    RETURN v_row;
  END IF;

  INSERT INTO public.runway_mcp_connection_approvals (
    brand_id,
    status,
    requested_by,
    requested_at,
    approved_by,
    rejected_by,
    revoked_by,
    approved_at,
    rejected_at,
    revoked_at,
    updated_at
  )
  VALUES (
    p_brand_id,
    'pending',
    v_user_id,
    NOW(),
    NULL,
    NULL,
    NULL,
    NULL,
    NULL,
    NULL,
    NOW()
  )
  ON CONFLICT (brand_id) DO UPDATE
    SET status = 'pending',
        requested_by = EXCLUDED.requested_by,
        requested_at = EXCLUDED.requested_at,
        approved_by = NULL,
        rejected_by = NULL,
        revoked_by = NULL,
        approved_at = NULL,
        rejected_at = NULL,
        revoked_at = NULL,
        updated_at = NOW()
  RETURNING * INTO v_row;

  RETURN v_row;
END;
$$;

DROP FUNCTION IF EXISTS public.admin_update_runway_mcp_connection(UUID, public.runway_mcp_connection_status, TEXT);
CREATE OR REPLACE FUNCTION public.admin_update_runway_mcp_connection(
  p_brand_id UUID,
  p_status public.runway_mcp_connection_status
)
RETURNS public.runway_mcp_connection_approvals
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_user_id UUID := auth.uid();
  v_row public.runway_mcp_connection_approvals;
BEGIN
  IF v_user_id IS NULL THEN
    RAISE EXCEPTION 'Unauthorized';
  END IF;

  IF NOT private.is_current_user_admin() THEN
    RAISE EXCEPTION 'Platform admin permissions required';
  END IF;

  IF p_status NOT IN ('approved', 'rejected', 'revoked') THEN
    RAISE EXCEPTION 'Unsupported Runway MCP connection status';
  END IF;

  IF NOT EXISTS (SELECT 1 FROM public.brands WHERE id = p_brand_id) THEN
    RAISE EXCEPTION 'Brand not found';
  END IF;

  INSERT INTO public.runway_mcp_connection_approvals (
    brand_id,
    status,
    requested_by,
    approved_by,
    rejected_by,
    revoked_by,
    requested_at,
    approved_at,
    rejected_at,
    revoked_at,
    updated_at
  )
  VALUES (
    p_brand_id,
    p_status,
    v_user_id,
    CASE WHEN p_status = 'approved' THEN v_user_id ELSE NULL END,
    CASE WHEN p_status = 'rejected' THEN v_user_id ELSE NULL END,
    CASE WHEN p_status = 'revoked' THEN v_user_id ELSE NULL END,
    NOW(),
    CASE WHEN p_status = 'approved' THEN NOW() ELSE NULL END,
    CASE WHEN p_status = 'rejected' THEN NOW() ELSE NULL END,
    CASE WHEN p_status = 'revoked' THEN NOW() ELSE NULL END,
    NOW()
  )
  ON CONFLICT (brand_id) DO UPDATE
    SET status = EXCLUDED.status,
        approved_by = CASE WHEN EXCLUDED.status = 'approved' THEN v_user_id ELSE NULL END,
        rejected_by = CASE WHEN EXCLUDED.status = 'rejected' THEN v_user_id ELSE NULL END,
        revoked_by = CASE WHEN EXCLUDED.status = 'revoked' THEN v_user_id ELSE NULL END,
        approved_at = CASE WHEN EXCLUDED.status = 'approved' THEN NOW() ELSE NULL END,
        rejected_at = CASE WHEN EXCLUDED.status = 'rejected' THEN NOW() ELSE NULL END,
        revoked_at = CASE WHEN EXCLUDED.status = 'revoked' THEN NOW() ELSE NULL END,
        updated_at = NOW()
  RETURNING * INTO v_row;

  RETURN v_row;
END;
$$;

REVOKE ALL ON FUNCTION public.request_runway_mcp_connection(UUID) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.admin_update_runway_mcp_connection(UUID, public.runway_mcp_connection_status) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.request_runway_mcp_connection(UUID) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.admin_update_runway_mcp_connection(UUID, public.runway_mcp_connection_status) TO authenticated, service_role;
