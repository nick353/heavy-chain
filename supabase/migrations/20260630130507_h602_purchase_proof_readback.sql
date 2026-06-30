-- H602 purchase proof readback layer.
-- This stores redacted proof status only. It does not configure Apple ID
-- credentials, create checkout sessions, charge payments, or store raw receipts.

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'billing_purchase_proof_status') THEN
    CREATE TYPE public.billing_purchase_proof_status AS ENUM (
      'human_attested',
      'pending_verification',
      'verified',
      'rejected'
    );
  END IF;

  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'billing_purchase_proof_source') THEN
    CREATE TYPE public.billing_purchase_proof_source AS ENUM (
      'human_attestation',
      'app_store_transaction',
      'storekit_receipt_hash',
      'server_notification',
      'app_entitlement_readback',
      'operator_manual'
    );
  END IF;
END $$;

CREATE TABLE IF NOT EXISTS public.billing_purchase_proofs (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  brand_id UUID REFERENCES public.brands(id) ON DELETE SET NULL,
  user_id UUID REFERENCES public.users(id) ON DELETE SET NULL,
  tester_email TEXT,
  provider TEXT NOT NULL DEFAULT 'apple'
    CHECK (provider IN ('apple')),
  environment TEXT NOT NULL DEFAULT 'sandbox'
    CHECK (environment IN ('sandbox', 'production')),
  product_id TEXT,
  proof_source public.billing_purchase_proof_source NOT NULL,
  proof_status public.billing_purchase_proof_status NOT NULL,
  no_real_charge_confirmed BOOLEAN NOT NULL DEFAULT FALSE,
  transaction_id_hash TEXT,
  original_transaction_id_hash TEXT,
  receipt_hash TEXT,
  entitlement_id TEXT,
  artifact_uri TEXT,
  metadata JSONB NOT NULL DEFAULT '{}'::jsonb,
  verified_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT billing_purchase_proofs_target_check
    CHECK (brand_id IS NOT NULL OR user_id IS NOT NULL OR tester_email IS NOT NULL),
  CONSTRAINT billing_purchase_proofs_email_lower_check
    CHECK (tester_email IS NULL OR tester_email = lower(tester_email)),
  CONSTRAINT billing_purchase_proofs_no_raw_receipt_check
    CHECK (metadata ? 'raw_receipt' = FALSE),
  CONSTRAINT billing_purchase_proofs_verified_requires_machine_proof_check
    CHECK (
      proof_status <> 'verified'
      OR (
        no_real_charge_confirmed
        AND proof_source <> 'human_attestation'
        AND (
          transaction_id_hash IS NOT NULL
          OR original_transaction_id_hash IS NOT NULL
          OR receipt_hash IS NOT NULL
          OR entitlement_id IS NOT NULL
        )
      )
    )
);

CREATE INDEX IF NOT EXISTS idx_billing_purchase_proofs_brand_created
  ON public.billing_purchase_proofs(brand_id, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_billing_purchase_proofs_user_created
  ON public.billing_purchase_proofs(user_id, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_billing_purchase_proofs_email_active
  ON public.billing_purchase_proofs(tester_email, created_at DESC)
  WHERE tester_email IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_billing_purchase_proofs_status_source
  ON public.billing_purchase_proofs(proof_status, proof_source, no_real_charge_confirmed);

ALTER TABLE public.billing_purchase_proofs ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Admins can view billing purchase proofs" ON public.billing_purchase_proofs;
CREATE POLICY "Admins can view billing purchase proofs"
  ON public.billing_purchase_proofs FOR SELECT
  TO authenticated
  USING (private.is_current_user_admin());

DROP POLICY IF EXISTS "Admins can manage billing purchase proofs" ON public.billing_purchase_proofs;
CREATE POLICY "Admins can manage billing purchase proofs"
  ON public.billing_purchase_proofs FOR ALL
  TO authenticated
  USING (private.is_current_user_admin())
  WITH CHECK (private.is_current_user_admin());

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
    LEFT JOIN public.users u ON u.id = (SELECT auth.uid())
    WHERE bpp.brand_id = p_brand_id
      OR bpp.user_id = (SELECT auth.uid())
      OR (
        bpp.tester_email IS NOT NULL
        AND u.email IS NOT NULL
        AND bpp.tester_email = lower(u.email)
      )
  ),
  aggregate AS (
    SELECT
      COUNT(*)::INTEGER AS total_proofs,
      COUNT(*) FILTER (WHERE proof_status = 'human_attested')::INTEGER AS human_attested_count,
      COUNT(*) FILTER (WHERE proof_status = 'pending_verification')::INTEGER AS pending_verification_count,
      COUNT(*) FILTER (
        WHERE proof_status = 'verified'
          AND no_real_charge_confirmed
          AND proof_source <> 'human_attestation'
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

REVOKE ALL ON TABLE public.billing_purchase_proofs FROM PUBLIC, anon, authenticated;
GRANT ALL ON TABLE public.billing_purchase_proofs TO service_role;
GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE public.billing_purchase_proofs TO authenticated;

REVOKE ALL ON FUNCTION public.get_billing_purchase_proof_summary(UUID) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.get_billing_purchase_proof_summary(UUID) TO authenticated;
GRANT EXECUTE ON FUNCTION public.get_billing_purchase_proof_summary(UUID) TO service_role;
