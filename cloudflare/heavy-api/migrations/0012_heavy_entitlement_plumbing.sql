PRAGMA foreign_keys = ON;
-- statement-breakpoint

-- Heavy-only terms acceptance is an append-only audit record.  The terms
-- document itself is owned outside this migration; this table stores only its
-- server-selected version and the user's explicit acceptance timestamp.
CREATE TABLE heavy_terms_acceptances (
  id TEXT PRIMARY KEY NOT NULL,
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
  terms_version TEXT NOT NULL CHECK (length(terms_version) BETWEEN 1 AND 160),
  accepted_at TEXT NOT NULL,
  recorded_at TEXT NOT NULL,
  acceptance_source TEXT NOT NULL CHECK (length(acceptance_source) BETWEEN 1 AND 80)
);
-- statement-breakpoint

CREATE INDEX heavy_terms_acceptances_current
  ON heavy_terms_acceptances(user_id, terms_version, accepted_at DESC);
-- statement-breakpoint

CREATE TRIGGER heavy_terms_acceptances_append_only_update
BEFORE UPDATE ON heavy_terms_acceptances
BEGIN
  SELECT RAISE(ABORT, 'heavy_terms_acceptances_append_only');
END;
-- statement-breakpoint

CREATE TRIGGER heavy_terms_acceptances_append_only_delete
BEFORE DELETE ON heavy_terms_acceptances
BEGIN
  SELECT RAISE(ABORT, 'heavy_terms_acceptances_append_only');
END;
-- statement-breakpoint

-- Rights are scoped to one exact provider request.  A client supplied
-- legalSafety.rightsConfirmed value is never stored as this record and cannot
-- satisfy the resolver by itself.
CREATE TABLE heavy_request_rights_attestations (
  id TEXT PRIMARY KEY NOT NULL,
  request_id TEXT NOT NULL UNIQUE,
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
  brand_id TEXT NOT NULL REFERENCES brands(id) ON DELETE RESTRICT,
  action TEXT NOT NULL CHECK (length(action) BETWEEN 1 AND 80),
  terms_acceptance_id TEXT NOT NULL REFERENCES heavy_terms_acceptances(id) ON DELETE RESTRICT,
  terms_version TEXT NOT NULL CHECK (length(terms_version) BETWEEN 1 AND 160),
  rights_version TEXT NOT NULL CHECK (length(rights_version) BETWEEN 1 AND 80),
  request_binding TEXT NOT NULL CHECK (length(request_binding) = 64),
  attested_at TEXT NOT NULL,
  recorded_at TEXT NOT NULL
);
-- statement-breakpoint

CREATE INDEX heavy_request_rights_scope
  ON heavy_request_rights_attestations(user_id, brand_id, request_id, action);
-- statement-breakpoint

CREATE TRIGGER heavy_request_rights_append_only_update
BEFORE UPDATE ON heavy_request_rights_attestations
BEGIN
  SELECT RAISE(ABORT, 'heavy_request_rights_attestations_append_only');
END;
-- statement-breakpoint

CREATE TRIGGER heavy_request_rights_append_only_delete
BEFORE DELETE ON heavy_request_rights_attestations
BEGIN
  SELECT RAISE(ABORT, 'heavy_request_rights_attestations_append_only');
END;
-- statement-breakpoint

ALTER TABLE heavy_ai_requests ADD COLUMN terms_acceptance_id TEXT;
-- statement-breakpoint
ALTER TABLE heavy_ai_requests ADD COLUMN rights_attestation_id TEXT;
-- statement-breakpoint
ALTER TABLE heavy_ai_requests ADD COLUMN request_binding TEXT;
