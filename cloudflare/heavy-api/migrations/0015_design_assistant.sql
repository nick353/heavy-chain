-- Text inference receipts are separate from image generation jobs.
CREATE TABLE IF NOT EXISTS design_assistant_requests (
  request_id TEXT PRIMARY KEY NOT NULL,
  owner_id TEXT NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
  brand_id TEXT NOT NULL REFERENCES brands(id) ON DELETE RESTRICT,
  project_id TEXT NOT NULL REFERENCES canvas_documents(id) ON DELETE RESTRICT,
  conversation_id TEXT NOT NULL,
  input_digest TEXT NOT NULL,
  state TEXT NOT NULL CHECK (state IN ('running', 'completed', 'failed', 'unknown')),
  content TEXT,
  usage_json TEXT,
  error_code TEXT,
  provider TEXT NOT NULL CHECK (provider = 'workers-ai'),
  model TEXT NOT NULL,
  admission_day TEXT NOT NULL,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  completed_at TEXT,
  CHECK (state != 'completed' OR (content IS NOT NULL AND length(content) > 0))
);

CREATE INDEX IF NOT EXISTS design_assistant_owner_day_idx
  ON design_assistant_requests(owner_id, admission_day);
