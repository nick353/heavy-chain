PRAGMA foreign_keys = ON;

-- Durable metadata for the generation/result lifecycle. Provider execution is
-- intentionally outside this Worker; these tables hold the owner-scoped
-- state needed to resume, inspect, save, and reuse results.
CREATE TABLE IF NOT EXISTS generation_jobs (
  id TEXT PRIMARY KEY NOT NULL,
  brand_id TEXT NOT NULL REFERENCES brands(id) ON DELETE CASCADE,
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  feature_type TEXT NOT NULL,
  input_params TEXT NOT NULL DEFAULT '{}',
  optimized_prompt TEXT,
  status TEXT NOT NULL DEFAULT 'pending'
    CHECK (status IN ('pending', 'processing', 'completed', 'failed')),
  error_message TEXT,
  created_at TEXT NOT NULL,
  completed_at TEXT
);

CREATE INDEX IF NOT EXISTS generation_jobs_brand_created_idx
  ON generation_jobs (brand_id, created_at DESC);
CREATE INDEX IF NOT EXISTS generation_jobs_user_created_idx
  ON generation_jobs (user_id, created_at DESC);

CREATE TABLE IF NOT EXISTS generated_images (
  id TEXT PRIMARY KEY NOT NULL,
  job_id TEXT REFERENCES generation_jobs(id) ON DELETE SET NULL,
  brand_id TEXT NOT NULL REFERENCES brands(id) ON DELETE CASCADE,
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  storage_path TEXT NOT NULL,
  thumbnail_path TEXT,
  version INTEGER NOT NULL DEFAULT 1 CHECK (version > 0),
  parent_image_id TEXT REFERENCES generated_images(id) ON DELETE SET NULL,
  is_favorite INTEGER NOT NULL DEFAULT 0 CHECK (is_favorite IN (0, 1)),
  prompt TEXT,
  negative_prompt TEXT,
  feature_type TEXT,
  style_preset TEXT,
  model_used TEXT,
  generation_params TEXT NOT NULL DEFAULT '{}',
  metadata TEXT NOT NULL DEFAULT '{}',
  image_url TEXT,
  created_at TEXT NOT NULL,
  expires_at TEXT
);

CREATE INDEX IF NOT EXISTS generated_images_brand_created_idx
  ON generated_images (brand_id, created_at DESC);
CREATE INDEX IF NOT EXISTS generated_images_user_created_idx
  ON generated_images (user_id, created_at DESC);
CREATE INDEX IF NOT EXISTS generated_images_favorite_idx
  ON generated_images (user_id, brand_id, is_favorite, created_at DESC);

CREATE TABLE IF NOT EXISTS canvas_documents (
  id TEXT PRIMARY KEY NOT NULL,
  owner_id TEXT NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
  brand_id TEXT NOT NULL REFERENCES brands(id) ON DELETE RESTRICT,
  title TEXT NOT NULL DEFAULT '無題のプロジェクト',
  snapshot TEXT NOT NULL DEFAULT '{}',
  snapshot_version INTEGER NOT NULL DEFAULT 1 CHECK (snapshot_version > 0),
  revision INTEGER NOT NULL DEFAULT 0 CHECK (revision >= 0),
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS canvas_documents_brand_updated_idx
  ON canvas_documents (brand_id, updated_at DESC);
