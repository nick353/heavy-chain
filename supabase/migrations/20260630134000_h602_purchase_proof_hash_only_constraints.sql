-- H602 purchase proof hash-only constraints.
-- Machine proof fields store hashes or short entitlement identifiers only.
-- Raw App Store receipts, signed payloads, and arbitrary provider payloads are
-- intentionally excluded from this table.

ALTER TABLE public.billing_purchase_proofs
  ADD CONSTRAINT billing_purchase_proofs_hash_fields_sha256_hex_check
  CHECK (
    (transaction_id_hash IS NULL OR transaction_id_hash ~ '^[a-f0-9]{64}$')
    AND (original_transaction_id_hash IS NULL OR original_transaction_id_hash ~ '^[a-f0-9]{64}$')
    AND (receipt_hash IS NULL OR receipt_hash ~ '^[a-f0-9]{64}$')
  );

ALTER TABLE public.billing_purchase_proofs
  ADD CONSTRAINT billing_purchase_proofs_entitlement_id_short_identifier_check
  CHECK (
    entitlement_id IS NULL
    OR (
      entitlement_id ~ '^[A-Za-z0-9._:-]{1,160}$'
      AND entitlement_id !~* '(receipt|payload|base64|signed)'
    )
  );

ALTER TABLE public.billing_purchase_proofs
  DROP CONSTRAINT IF EXISTS billing_purchase_proofs_no_raw_receipt_like_metadata_check;

ALTER TABLE public.billing_purchase_proofs
  ADD CONSTRAINT billing_purchase_proofs_no_raw_receipt_like_metadata_check
  CHECK (
    metadata::text !~* '"(receipt|payload|raw[_-]?receipt|latest[_-]?receipt|receipt[_-]?data|app[_-]?store[_-]?receipt|transaction[_-]?receipt|signed[_-]?payload)"[[:space:]]*:'
    AND metadata::text !~* 'base64'
  );
