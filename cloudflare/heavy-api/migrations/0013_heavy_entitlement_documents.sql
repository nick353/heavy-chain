PRAGMA foreign_keys = ON;
-- statement-breakpoint

-- 0012 is immutable. These nullable columns preserve old rows as
-- non-authorizing history; the resolver requires all values for new access.
ALTER TABLE heavy_terms_acceptances ADD COLUMN document_version TEXT;
-- statement-breakpoint
ALTER TABLE heavy_terms_acceptances ADD COLUMN document_digest TEXT;
-- statement-breakpoint
ALTER TABLE heavy_request_rights_attestations ADD COLUMN document_version TEXT;
-- statement-breakpoint
ALTER TABLE heavy_request_rights_attestations ADD COLUMN document_digest TEXT;
-- statement-breakpoint
ALTER TABLE heavy_request_rights_attestations ADD COLUMN input_digest TEXT;
-- The canonical server-normalized generation inputs are retained with the
-- immutable attestation so a request receipt can recompute the binding even
-- when the retry does not resend the original JSON body.
ALTER TABLE heavy_request_rights_attestations ADD COLUMN normalized_input TEXT;
