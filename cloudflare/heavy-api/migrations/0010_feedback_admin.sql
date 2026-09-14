PRAGMA foreign_keys = ON;

-- Platform administrators are independent of brand owners/admins. Provision
-- only by an explicitly authorized operator, never by signup/profile/JWT data.
CREATE TABLE platform_admins (
  user_id TEXT PRIMARY KEY NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  granted_at TEXT NOT NULL,
  grant_reason TEXT NOT NULL
);

CREATE TABLE feedback_submissions (
  id TEXT PRIMARY KEY NOT NULL,
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  request_id TEXT NOT NULL,
  payload_hash TEXT NOT NULL,
  brand_id TEXT REFERENCES brands(id) ON DELETE SET NULL,
  type TEXT NOT NULL CHECK (type IN ('lost','cutout','result','save','speed','other')),
  message TEXT NOT NULL,
  email TEXT NOT NULL,
  page_url TEXT NOT NULL,
  pathname TEXT NOT NULL,
  viewport TEXT NOT NULL DEFAULT '{}',
  user_agent TEXT,
  screenshot_path TEXT,
  screenshot_sha256 TEXT,
  screenshot_bytes INTEGER,
  screenshot_capture_status TEXT NOT NULL CHECK (screenshot_capture_status IN
    ('captured','screenshot_capture_failed','screenshot_upload_failed')),
  submission_state TEXT NOT NULL CHECK (submission_state IN ('pending','accepted')),
  status TEXT NOT NULL DEFAULT 'new' CHECK (status IN ('new','in_progress','done')),
  admin_note TEXT,
  revision INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  resolved_at TEXT,
  UNIQUE (user_id, request_id)
);
CREATE INDEX feedback_created_idx ON feedback_submissions(created_at DESC, id DESC);
CREATE INDEX feedback_user_created_idx ON feedback_submissions(user_id, created_at DESC);

CREATE TABLE admin_announcements (
  id TEXT PRIMARY KEY NOT NULL,
  author_id TEXT NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
  request_id TEXT NOT NULL,
  title TEXT NOT NULL,
  content TEXT NOT NULL,
  type TEXT NOT NULL CHECK (type IN ('info','warning','maintenance')),
  created_at TEXT NOT NULL,
  UNIQUE (author_id, request_id)
);
CREATE INDEX announcements_created_idx ON admin_announcements(created_at DESC, id DESC);
