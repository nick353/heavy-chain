-- MyPro's trusted data Worker coordinates application/R2 cleanup. These rows
-- prevent new auth writes after acceptance; they are not user-visible deletion.
CREATE TABLE auth_erasure (
  request_id TEXT PRIMARY KEY NOT NULL,
  user_id TEXT UNIQUE,
  state TEXT NOT NULL CHECK (state IN ('frozen', 'deleted')),
  created_at TEXT NOT NULL,
  completed_at TEXT,
  CHECK ((state = 'frozen' AND user_id IS NOT NULL AND completed_at IS NULL)
    OR (state = 'deleted' AND user_id IS NULL AND completed_at IS NOT NULL))
);
-- statement-breakpoint
CREATE TRIGGER erasure_blocks_session_insert BEFORE INSERT ON session
WHEN EXISTS (SELECT 1 FROM auth_erasure WHERE user_id = NEW.userId)
BEGIN SELECT RAISE(ABORT, 'account_erasing'); END;
-- statement-breakpoint
CREATE TRIGGER erasure_blocks_session_update BEFORE UPDATE ON session
WHEN EXISTS (SELECT 1 FROM auth_erasure WHERE user_id IN (OLD.userId, NEW.userId))
BEGIN SELECT RAISE(ABORT, 'account_erasing'); END;
-- statement-breakpoint
CREATE TRIGGER erasure_blocks_account_insert BEFORE INSERT ON account
WHEN EXISTS (SELECT 1 FROM auth_erasure WHERE user_id = NEW.userId)
BEGIN SELECT RAISE(ABORT, 'account_erasing'); END;
-- statement-breakpoint
CREATE TRIGGER erasure_blocks_account_update BEFORE UPDATE ON account
WHEN EXISTS (SELECT 1 FROM auth_erasure WHERE user_id IN (OLD.userId, NEW.userId))
BEGIN SELECT RAISE(ABORT, 'account_erasing'); END;
-- statement-breakpoint
CREATE TRIGGER erasure_blocks_user_update BEFORE UPDATE ON user
WHEN EXISTS (SELECT 1 FROM auth_erasure WHERE user_id IN (OLD.id, NEW.id))
BEGIN SELECT RAISE(ABORT, 'account_erasing'); END;
