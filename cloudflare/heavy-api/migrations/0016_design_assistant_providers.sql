-- The design consultation chat now answers with Claude (provider 'anthropic'); Workers AI stays as a fallback.
-- SQLite cannot alter a CHECK constraint, so the table is rebuilt and every existing row is copied.
CREATE TABLE design_assistant_requests_v2 (
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
  provider TEXT NOT NULL CHECK (provider IN ('workers-ai', 'anthropic')),
  model TEXT NOT NULL,
  admission_day TEXT NOT NULL,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  completed_at TEXT,
  CHECK (state != 'completed' OR (content IS NOT NULL AND length(content) > 0))
);
-- statement-breakpoint
INSERT INTO design_assistant_requests_v2 SELECT request_id, owner_id, brand_id, project_id, conversation_id, input_digest, state,
  content, usage_json, error_code, provider, model, admission_day, created_at, updated_at, completed_at FROM design_assistant_requests;
-- statement-breakpoint
DROP TABLE design_assistant_requests;
-- statement-breakpoint
ALTER TABLE design_assistant_requests_v2 RENAME TO design_assistant_requests;
-- statement-breakpoint
CREATE INDEX IF NOT EXISTS design_assistant_owner_day_idx ON design_assistant_requests(owner_id, admission_day);
