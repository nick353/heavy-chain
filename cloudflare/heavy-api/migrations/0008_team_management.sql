PRAGMA foreign_keys = ON;

CREATE TABLE IF NOT EXISTS invitations (
  id TEXT PRIMARY KEY NOT NULL,
  brand_id TEXT NOT NULL REFERENCES brands(id) ON DELETE CASCADE,
  creator_id TEXT NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
  email TEXT,
  code TEXT NOT NULL UNIQUE,
  role TEXT NOT NULL CHECK (role IN ('admin', 'editor', 'viewer')),
  expires_at TEXT NOT NULL,
  used_at TEXT,
  created_at TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS invitations_brand_pending_idx
  ON invitations (brand_id, used_at, expires_at);

CREATE INDEX IF NOT EXISTS invitations_code_idx
  ON invitations (code);
