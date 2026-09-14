-- A receipt can be either accepted for deletion or cancelled, never both.
-- The retained SHA-256 request key fences delayed begin calls without storing
-- a user identifier or disabling that user's sessions/account.
CREATE TABLE auth_erasure_cancellations (
  request_id TEXT PRIMARY KEY NOT NULL CHECK (length(request_id) = 64),
  cancelled_at TEXT NOT NULL
);
-- statement-breakpoint
CREATE TRIGGER auth_erasure_cancelled_begin BEFORE INSERT ON auth_erasure
WHEN EXISTS (SELECT 1 FROM auth_erasure_cancellations WHERE request_id = NEW.request_id)
BEGIN SELECT RAISE(ABORT, 'erasure_cancelled'); END;
-- statement-breakpoint
CREATE TRIGGER auth_erasure_accepted_cancel BEFORE INSERT ON auth_erasure_cancellations
WHEN EXISTS (SELECT 1 FROM auth_erasure WHERE request_id = NEW.request_id)
BEGIN SELECT RAISE(ABORT, 'erasure_already_accepted'); END;
