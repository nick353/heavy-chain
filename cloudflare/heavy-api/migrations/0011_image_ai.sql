PRAGMA foreign_keys = ON;
-- statement-breakpoint

-- New Cloudflare attempts only. No old provider usage or test data is imported.
CREATE TABLE heavy_ai_requests (
  request_id TEXT PRIMARY KEY NOT NULL,
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  brand_id TEXT NOT NULL REFERENCES brands(id) ON DELETE CASCADE,
  action TEXT NOT NULL,
  fingerprint TEXT NOT NULL,
  execution_id TEXT NOT NULL,
  model TEXT NOT NULL,
  job_id TEXT NOT NULL UNIQUE,
  input_metadata TEXT NOT NULL,
  quota_units INTEGER NOT NULL CHECK (quota_units >= 0),
  candidate_count INTEGER NOT NULL CHECK (candidate_count BETWEEN 1 AND 4),
  reserved_centi_neurons INTEGER NOT NULL CHECK (reserved_centi_neurons >= 0),
  utc_month TEXT NOT NULL,
  utc_day TEXT NOT NULL,
  state TEXT NOT NULL CHECK (state IN ('running','completed','failed','unknown')),
  error_code TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);
-- statement-breakpoint
CREATE INDEX heavy_ai_brand_month ON heavy_ai_requests(brand_id,utc_month);
-- statement-breakpoint
CREATE INDEX heavy_ai_running ON heavy_ai_requests(state,created_at);
-- statement-breakpoint
CREATE TABLE heavy_ai_candidates (
  request_id TEXT NOT NULL REFERENCES heavy_ai_requests(request_id) ON DELETE CASCADE,
  candidate_index INTEGER NOT NULL,
  image_id TEXT NOT NULL UNIQUE,
  state TEXT NOT NULL CHECK (state IN ('planned','running','storing','completed','failed','unknown')),
  descriptor TEXT NOT NULL,
  seed INTEGER NOT NULL,
  content_type TEXT,
  content_bytes INTEGER,
  sha256 TEXT,
  width INTEGER,
  height INTEGER,
  estimated_micro_usd INTEGER,
  estimated_neurons REAL,
  latency_ms INTEGER,
  attempted_at TEXT,
  error_code TEXT,
  PRIMARY KEY(request_id,candidate_index)
);
-- statement-breakpoint
-- This anonymous counter survives deletion of a brand/user; deleting content
-- must not reset the shared Worker admission limit. It is not an invoice.
CREATE TABLE heavy_ai_daily (
  utc_day TEXT PRIMARY KEY NOT NULL,
  admitted_units INTEGER NOT NULL DEFAULT 0,
  admitted_centi_neurons INTEGER NOT NULL DEFAULT 0
);
-- statement-breakpoint
CREATE TRIGGER heavy_ai_admitted AFTER INSERT ON heavy_ai_requests BEGIN
  INSERT INTO heavy_ai_daily(utc_day,admitted_units,admitted_centi_neurons) VALUES(NEW.utc_day,NEW.candidate_count,NEW.reserved_centi_neurons)
  ON CONFLICT(utc_day) DO UPDATE SET admitted_units=admitted_units+NEW.candidate_count,
    admitted_centi_neurons=admitted_centi_neurons+NEW.reserved_centi_neurons;
END;
