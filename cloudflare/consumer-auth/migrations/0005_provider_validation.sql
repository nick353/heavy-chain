-- Private server-owned state. No provider token or public Better Auth field.
CREATE TABLE provider_validation (
  account_id TEXT PRIMARY KEY NOT NULL REFERENCES account(id) ON DELETE CASCADE,
  credential_fingerprint TEXT NOT NULL,
  check_id TEXT,
  state TEXT NOT NULL CHECK (state IN ('ok', 'checking', 'unavailable', 'reauth_required')),
  checked_at INTEGER,
  next_check_at INTEGER NOT NULL
);
