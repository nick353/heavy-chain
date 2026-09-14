-- Anonymous, persistent allocation: never reset on cleanup or account erasure.
CREATE TABLE auth_mail_budget (
  id INTEGER PRIMARY KEY CHECK (id = 1),
  utc_day INTEGER NOT NULL DEFAULT 0 CHECK (utc_day >= 0),
  day_attempts INTEGER NOT NULL DEFAULT 0 CHECK (day_attempts >= 0),
  total_attempts INTEGER NOT NULL DEFAULT 0 CHECK (total_attempts >= day_attempts)
);
INSERT INTO auth_mail_budget (id) VALUES (1);
