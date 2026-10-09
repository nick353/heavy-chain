-- Self-service account deletion. The append-only evidence tables stay
-- protected, except for rows of a user (or a brand owned by a user) whose
-- deletion is in progress. The marker row is inserted and removed inside the
-- same D1 batch, so nothing personal is left behind.
CREATE TABLE account_erasures (
  user_id TEXT PRIMARY KEY NOT NULL,
  started_at TEXT NOT NULL
);
-- statement-breakpoint

DROP TRIGGER heavy_terms_acceptances_append_only_delete;
-- statement-breakpoint

CREATE TRIGGER heavy_terms_acceptances_append_only_delete
BEFORE DELETE ON heavy_terms_acceptances
WHEN NOT EXISTS (SELECT 1 FROM account_erasures WHERE user_id = OLD.user_id)
BEGIN
  SELECT RAISE(ABORT, 'heavy_terms_acceptances_append_only');
END;
-- statement-breakpoint

DROP TRIGGER heavy_request_rights_append_only_delete;
-- statement-breakpoint

CREATE TRIGGER heavy_request_rights_append_only_delete
BEFORE DELETE ON heavy_request_rights_attestations
WHEN NOT EXISTS (SELECT 1 FROM account_erasures WHERE user_id = OLD.user_id)
  AND NOT EXISTS (SELECT 1 FROM account_erasures e JOIN brands b ON b.owner_id = e.user_id WHERE b.id = OLD.brand_id)
BEGIN
  SELECT RAISE(ABORT, 'heavy_request_rights_attestations_append_only');
END;
-- statement-breakpoint

DROP TRIGGER heavy_generation_preparations_append_only_delete;
-- statement-breakpoint

CREATE TRIGGER heavy_generation_preparations_append_only_delete
BEFORE DELETE ON heavy_generation_preparations
WHEN NOT EXISTS (SELECT 1 FROM account_erasures WHERE user_id = OLD.user_id)
  AND NOT EXISTS (SELECT 1 FROM account_erasures e JOIN brands b ON b.owner_id = e.user_id WHERE b.id = OLD.brand_id)
BEGIN
  SELECT RAISE(ABORT, 'heavy_generation_preparations_append_only');
END;
