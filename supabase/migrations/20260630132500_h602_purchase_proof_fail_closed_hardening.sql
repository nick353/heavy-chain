-- H602 purchase proof hardening.
-- Keep purchase proof brand-scoped for release readback and reject raw receipt-like
-- payloads even when they are nested or named differently from raw_receipt.

ALTER TABLE public.billing_purchase_proofs
  DROP CONSTRAINT IF EXISTS billing_purchase_proofs_no_raw_receipt_check;

UPDATE public.billing_purchase_proofs
SET metadata = (metadata - 'raw_receipt_stored') || jsonb_build_object(
  'sensitive_payload_stored',
  COALESCE((metadata ->> 'raw_receipt_stored')::BOOLEAN, FALSE)
)
WHERE metadata ? 'raw_receipt_stored';

ALTER TABLE public.billing_purchase_proofs
  ADD CONSTRAINT billing_purchase_proofs_no_raw_receipt_like_metadata_check
  CHECK (
    metadata::text !~* '(raw[_-]?receipt|latest[_-]?receipt|receipt[_-]?data|app[_-]?store[_-]?receipt|transaction[_-]?receipt|signed[_-]?payload|base64)'
  );

ALTER TABLE public.billing_purchase_proofs
  DROP CONSTRAINT IF EXISTS billing_purchase_proofs_verified_requires_machine_proof_check;

ALTER TABLE public.billing_purchase_proofs
  ADD CONSTRAINT billing_purchase_proofs_verified_requires_machine_proof_check
  CHECK (
    proof_status <> 'verified'
    OR (
      no_real_charge_confirmed
      AND proof_source IN (
        'app_store_transaction',
        'storekit_receipt_hash',
        'server_notification',
        'app_entitlement_readback'
      )
      AND (
        transaction_id_hash IS NOT NULL
        OR original_transaction_id_hash IS NOT NULL
        OR receipt_hash IS NOT NULL
        OR entitlement_id IS NOT NULL
      )
    )
  );

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
  WITH proof_scope AS (
    SELECT bpp.*
    FROM public.billing_purchase_proofs bpp
    WHERE bpp.brand_id = p_brand_id
  ),
  aggregate AS (
    SELECT
      COUNT(*)::INTEGER AS total_proofs,
      COUNT(*) FILTER (WHERE proof_status = 'human_attested')::INTEGER AS human_attested_count,
      COUNT(*) FILTER (WHERE proof_status = 'pending_verification')::INTEGER AS pending_verification_count,
      COUNT(*) FILTER (
        WHERE proof_status = 'verified'
          AND no_real_charge_confirmed
          AND proof_source IN (
            'app_store_transaction',
            'storekit_receipt_hash',
            'server_notification',
            'app_entitlement_readback'
          )
      )::INTEGER AS verified_no_real_charge_count
    FROM proof_scope
  ),
  latest AS (
    SELECT proof_status::TEXT AS latest_status,
           proof_source::TEXT AS latest_source,
           product_id AS latest_product_id,
           artifact_uri AS latest_artifact_uri
    FROM proof_scope
    ORDER BY created_at DESC
    LIMIT 1
  )
  SELECT p_brand_id,
         a.total_proofs,
         a.human_attested_count,
         a.pending_verification_count,
         a.verified_no_real_charge_count,
         l.latest_status,
         l.latest_source,
         l.latest_product_id,
         l.latest_artifact_uri,
         a.verified_no_real_charge_count > 0
  FROM aggregate a
  LEFT JOIN latest l ON TRUE;
END;
$$;

REVOKE ALL ON FUNCTION public.get_billing_purchase_proof_summary(UUID) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.get_billing_purchase_proof_summary(UUID) TO authenticated;
GRANT EXECUTE ON FUNCTION public.get_billing_purchase_proof_summary(UUID) TO service_role;
