BEGIN;

-- Keep the existing authenticated RPC names stable while moving privileged
-- implementations out of the exposed public schema. The private functions
-- retain their explicit auth.uid()/brand-role checks; the public functions are
-- invoker wrappers and therefore do not expose SECURITY DEFINER directly via
-- the Data API.

ALTER FUNCTION public.create_brand(TEXT, TEXT, TEXT) SET SCHEMA private;
-- A legacy private helper with the same signature already exists for the
-- service-only usage summary. Keep the authenticated public RPC in place and
-- make that public entrypoint invoker-safe instead of attempting a conflicting
-- schema move.
ALTER FUNCTION public.get_brand_usage_summary(UUID) SECURITY INVOKER;
ALTER FUNCTION public.get_brand_usage_summary(UUID) SET search_path = public, pg_temp;
ALTER FUNCTION public.get_billing_purchase_proof_summary(UUID) SET SCHEMA private;
ALTER FUNCTION public.update_canvas_document_snapshot(UUID, UUID, TEXT, JSONB, INTEGER) SET SCHEMA private;

CREATE OR REPLACE FUNCTION public.create_brand(
  p_name TEXT,
  p_tone_description TEXT DEFAULT NULL,
  p_target_audience TEXT DEFAULT NULL
)
RETURNS public.brands
LANGUAGE sql
SECURITY INVOKER
SET search_path = public, pg_temp
AS $$
  SELECT private.create_brand(p_name, p_tone_description, p_target_audience);
$$;

CREATE OR REPLACE FUNCTION public.get_billing_purchase_proof_summary(p_brand_id UUID)
RETURNS TABLE (
  brand_id UUID,
  total_proofs INTEGER,
  human_attested_count INTEGER,
  pending_verification_count INTEGER,
  verified_no_real_charge_count INTEGER,
  latest_status TEXT,
  latest_source TEXT,
  latest_product_id TEXT,
  latest_artifact_uri TEXT,
  transaction_or_entitlement_readback BOOLEAN
)
LANGUAGE sql
STABLE
SECURITY INVOKER
SET search_path = public, pg_temp
AS $$
  SELECT * FROM private.get_billing_purchase_proof_summary(p_brand_id);
$$;

CREATE OR REPLACE FUNCTION public.update_canvas_document_snapshot(
  p_document_id UUID,
  p_brand_id UUID,
  p_title TEXT,
  p_snapshot JSONB,
  p_expected_revision INTEGER
)
RETURNS TABLE (
  id UUID,
  owner_id UUID,
  brand_id UUID,
  title TEXT,
  snapshot JSONB,
  snapshot_version INTEGER,
  revision INTEGER,
  created_at TIMESTAMPTZ,
  updated_at TIMESTAMPTZ
)
LANGUAGE sql
SECURITY INVOKER
SET search_path = public, pg_temp
AS $$
  SELECT *
  FROM private.update_canvas_document_snapshot(
    p_document_id,
    p_brand_id,
    p_title,
    p_snapshot,
    p_expected_revision
  );
$$;

REVOKE ALL ON FUNCTION private.create_brand(TEXT, TEXT, TEXT) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION private.create_brand(TEXT, TEXT, TEXT) TO authenticated;

REVOKE ALL ON FUNCTION private.get_brand_usage_summary(UUID) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION private.get_brand_usage_summary(UUID) TO authenticated, service_role;

REVOKE ALL ON FUNCTION private.get_billing_purchase_proof_summary(UUID) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION private.get_billing_purchase_proof_summary(UUID) TO authenticated, service_role;

REVOKE ALL ON FUNCTION private.update_canvas_document_snapshot(UUID, UUID, TEXT, JSONB, INTEGER) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION private.update_canvas_document_snapshot(UUID, UUID, TEXT, JSONB, INTEGER) TO authenticated;

REVOKE ALL ON FUNCTION public.create_brand(TEXT, TEXT, TEXT) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.create_brand(TEXT, TEXT, TEXT) TO authenticated;

REVOKE ALL ON FUNCTION public.get_brand_usage_summary(UUID) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.get_brand_usage_summary(UUID) TO authenticated, service_role;

REVOKE ALL ON FUNCTION public.get_billing_purchase_proof_summary(UUID) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.get_billing_purchase_proof_summary(UUID) TO authenticated, service_role;

REVOKE ALL ON FUNCTION public.update_canvas_document_snapshot(UUID, UUID, TEXT, JSONB, INTEGER) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.update_canvas_document_snapshot(UUID, UUID, TEXT, JSONB, INTEGER) TO authenticated;

COMMENT ON FUNCTION public.create_brand(TEXT, TEXT, TEXT)
  IS 'Authenticated invoker boundary for the private brand-creation implementation.';
COMMENT ON FUNCTION public.get_brand_usage_summary(UUID)
  IS 'Authenticated invoker boundary for the private usage-summary implementation.';
COMMENT ON FUNCTION public.get_billing_purchase_proof_summary(UUID)
  IS 'Authenticated invoker boundary for the private purchase-proof summary implementation.';
COMMENT ON FUNCTION public.update_canvas_document_snapshot(UUID, UUID, TEXT, JSONB, INTEGER)
  IS 'Authenticated invoker boundary for the private optimistic Canvas snapshot update.';

COMMIT;
