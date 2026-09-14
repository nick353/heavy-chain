CREATE TABLE IF NOT EXISTS media_assets (
  id TEXT PRIMARY KEY NOT NULL,
  owner_issuer TEXT NOT NULL,
  owner_subject TEXT NOT NULL,
  client_request_id TEXT NOT NULL,
  object_key TEXT NOT NULL UNIQUE,
  content_type TEXT NOT NULL,
  declared_size_bytes INTEGER NOT NULL CHECK (declared_size_bytes > 0),
  stored_size_bytes INTEGER,
  checksum_sha256 TEXT,
  state TEXT NOT NULL CHECK (state IN ('pending', 'ready', 'failed')),
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  UNIQUE (owner_issuer, owner_subject, client_request_id)
);

CREATE INDEX IF NOT EXISTS media_assets_owner_idx
  ON media_assets (owner_issuer, owner_subject, updated_at DESC);
