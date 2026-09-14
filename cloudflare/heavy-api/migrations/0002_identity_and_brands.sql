PRAGMA foreign_keys = ON;

-- Canonical identity mapping. A valid token is not enough to access domain
-- rows until its issuer+subject has been explicitly mapped to this principal.
CREATE TABLE IF NOT EXISTS user_identities (
  principal_id TEXT PRIMARY KEY NOT NULL,
  issuer TEXT NOT NULL,
  subject TEXT NOT NULL,
  created_at TEXT NOT NULL,
  UNIQUE (issuer, subject)
);

CREATE TABLE IF NOT EXISTS users (
  id TEXT PRIMARY KEY NOT NULL REFERENCES user_identities(principal_id),
  email TEXT NOT NULL,
  name TEXT,
  avatar_url TEXT,
  language TEXT NOT NULL DEFAULT 'ja',
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS brands (
  id TEXT PRIMARY KEY NOT NULL,
  owner_id TEXT NOT NULL REFERENCES users(id),
  name TEXT NOT NULL,
  logo_url TEXT,
  brand_colors_json TEXT NOT NULL DEFAULT '{}',
  tone_description TEXT,
  target_audience TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS brands_owner_idx ON brands (owner_id, created_at DESC);

CREATE TABLE IF NOT EXISTS brand_members (
  id TEXT PRIMARY KEY NOT NULL,
  brand_id TEXT NOT NULL REFERENCES brands(id) ON DELETE CASCADE,
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  role TEXT NOT NULL CHECK (role IN ('owner', 'admin', 'editor', 'viewer')),
  invited_at TEXT,
  joined_at TEXT,
  UNIQUE (brand_id, user_id)
);

CREATE INDEX IF NOT EXISTS brand_members_user_idx ON brand_members (user_id, joined_at);
