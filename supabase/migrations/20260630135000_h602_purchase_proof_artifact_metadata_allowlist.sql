-- H602 purchase proof artifact/metadata allowlist.
-- Keep this table to status, hashes, short IDs, and local proof artifact paths.

ALTER TABLE public.billing_purchase_proofs
  ADD CONSTRAINT billing_purchase_proofs_metadata_key_allowlist_check
  CHECK (
    metadata
      - 'created_by'
      - 'operator_reported_completed'
      - 'sensitive_payload_stored'
      - 'transaction_or_entitlement_readback'
      - 'proof_note'
    = '{}'::jsonb
  );

ALTER TABLE public.billing_purchase_proofs
  ADD CONSTRAINT billing_purchase_proofs_artifact_uri_safe_locator_check
  CHECK (
    artifact_uri IS NULL
    OR (
      length(artifact_uri) <= 512
      AND artifact_uri ~ '^(output|docs|goals)/[A-Za-z0-9._/@:-]+$'
      AND artifact_uri !~* '(data:|base64|receipt|payload|signed|eyJ[A-Za-z0-9_-]{20,}|[A-Za-z0-9+/]{80,}={0,2})'
    )
  );
