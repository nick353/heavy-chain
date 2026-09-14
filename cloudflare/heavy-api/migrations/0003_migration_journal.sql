CREATE TABLE IF NOT EXISTS migration_journal (
  run_id TEXT NOT NULL,
  source_table TEXT NOT NULL,
  source_id TEXT NOT NULL,
  source_hash TEXT NOT NULL,
  status TEXT NOT NULL CHECK (status IN ('pending', 'ready', 'skipped', 'failed')),
  destination_key TEXT,
  error TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  PRIMARY KEY (run_id, source_table, source_id)
);

CREATE INDEX IF NOT EXISTS migration_journal_status_idx
  ON migration_journal (run_id, status, updated_at);
