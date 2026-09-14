PRAGMA foreign_keys = ON;

CREATE TABLE IF NOT EXISTS folders (
  id TEXT PRIMARY KEY NOT NULL,
  brand_id TEXT NOT NULL REFERENCES brands(id) ON DELETE CASCADE,
  parent_folder_id TEXT REFERENCES folders(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  created_at TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS folders_brand_name_idx
  ON folders (brand_id, name ASC);
CREATE INDEX IF NOT EXISTS folders_parent_idx
  ON folders (parent_folder_id);

CREATE TABLE IF NOT EXISTS image_folders (
  image_id TEXT NOT NULL REFERENCES generated_images(id) ON DELETE CASCADE,
  folder_id TEXT NOT NULL REFERENCES folders(id) ON DELETE CASCADE,
  PRIMARY KEY (image_id, folder_id)
);

CREATE INDEX IF NOT EXISTS image_folders_folder_idx
  ON image_folders (folder_id, image_id);
