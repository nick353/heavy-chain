-- Application deletion must not be blocked by unavailable provider grants.
-- Retain only provider names for recovery guidance, never identity or tokens.
ALTER TABLE auth_erasure ADD COLUMN manual_revocation TEXT NOT NULL DEFAULT '[]'
  CHECK (json_valid(manual_revocation) AND json_type(manual_revocation) = 'array');
