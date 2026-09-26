PRAGMA foreign_keys = ON;
-- statement-breakpoint

-- A preparation is a short-lived, server-owned capability for one exact
-- Heavy generation input. It contains no consent and cannot authorize a
-- request after expiry or without the later acceptance/attestation records.
CREATE TABLE heavy_generation_preparations (
  preparation_id TEXT PRIMARY KEY NOT NULL,
  request_id TEXT NOT NULL,
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  brand_id TEXT NOT NULL REFERENCES brands(id) ON DELETE CASCADE,
  action TEXT NOT NULL CHECK (length(action) BETWEEN 1 AND 80),
  input_digest TEXT NOT NULL CHECK (length(input_digest) = 64),
  normalized_input TEXT NOT NULL,
  source_digests TEXT NOT NULL DEFAULT '[]',
  expires_at TEXT NOT NULL,
  created_at TEXT NOT NULL
);
-- statement-breakpoint

CREATE INDEX heavy_generation_preparations_request_idx
  ON heavy_generation_preparations(request_id, created_at DESC);
-- statement-breakpoint

CREATE INDEX heavy_generation_preparations_owner_idx
  ON heavy_generation_preparations(user_id, brand_id, expires_at);
-- statement-breakpoint

CREATE TRIGGER heavy_generation_preparations_append_only_update
BEFORE UPDATE ON heavy_generation_preparations
BEGIN
  SELECT RAISE(ABORT, 'heavy_generation_preparations_append_only');
END;
-- statement-breakpoint

CREATE TRIGGER heavy_generation_preparations_append_only_delete
BEFORE DELETE ON heavy_generation_preparations
BEGIN
  SELECT RAISE(ABORT, 'heavy_generation_preparations_append_only');
END;
-- statement-breakpoint

-- Persist the proof used by the admitted request. Older rows remain
-- non-authorizing because the Heavy resolver requires this value for new
-- receipt/admission/provider work.
ALTER TABLE heavy_ai_requests ADD COLUMN preparation_id TEXT;
