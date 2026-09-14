PRAGMA foreign_keys = ON;

CREATE TABLE IF NOT EXISTS tags (
  id TEXT PRIMARY KEY NOT NULL,
  brand_id TEXT NOT NULL REFERENCES brands(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  created_at TEXT NOT NULL,
  UNIQUE (brand_id, name)
);

CREATE INDEX IF NOT EXISTS tags_brand_name_idx
  ON tags (brand_id, name ASC);

CREATE TABLE IF NOT EXISTS image_tags (
  image_id TEXT NOT NULL REFERENCES generated_images(id) ON DELETE CASCADE,
  tag_id TEXT NOT NULL REFERENCES tags(id) ON DELETE CASCADE,
  PRIMARY KEY (image_id, tag_id)
);

CREATE INDEX IF NOT EXISTS image_tags_tag_idx
  ON image_tags (tag_id, image_id);
