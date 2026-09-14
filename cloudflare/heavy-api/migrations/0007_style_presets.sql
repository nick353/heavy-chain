PRAGMA foreign_keys = ON;

CREATE TABLE IF NOT EXISTS style_presets (
  id TEXT PRIMARY KEY NOT NULL,
  brand_id TEXT NOT NULL REFERENCES brands(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  prompt_template TEXT NOT NULL DEFAULT '{prompt}',
  settings TEXT NOT NULL DEFAULT '{}',
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS style_presets_brand_created_idx
  ON style_presets (brand_id, created_at DESC);
