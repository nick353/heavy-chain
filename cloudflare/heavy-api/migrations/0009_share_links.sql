PRAGMA foreign_keys = ON;

-- Short-lived public capability links. The token is the only public lookup
-- key; image metadata remains in D1 and the bytes remain in private R2.
CREATE TABLE IF NOT EXISTS share_links (
  id TEXT PRIMARY KEY NOT NULL,
  image_id TEXT NOT NULL REFERENCES generated_images(id) ON DELETE CASCADE,
  created_by TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  token TEXT NOT NULL UNIQUE,
  expires_at TEXT NOT NULL,
  created_at TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS share_links_token_idx
  ON share_links (token);
CREATE INDEX IF NOT EXISTS share_links_image_created_idx
  ON share_links (image_id, created_at DESC);
