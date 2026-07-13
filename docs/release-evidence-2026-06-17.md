# Release Evidence 2026-06-17

Status: **not release-ready**.

This file records what is known for the 2026-06-17 release gate. It is an
evidence ledger, not approval to release.

## Start State

`git status` was clean at the start of this documentation update.

## Passed Gates

```bash
npm run build
npm run verify:readback
npm run verify:browser-use
npm run supabase:verify:static
npm run supabase:verify
npm run security:audit
npm run smoke:edge
npm run typecheck
npm run lint
npm run e2e
```

`npm run build` and `npm run e2e` were re-run with `.env.production.local`
sourced. `npm run e2e` passed 1 Chromium test.

`npm run supabase:verify` passed in its default static-file mode only. It
skipped the local migration list because `SUPABASE_VERIFY_MODE=db` and
`SUPABASE_VERIFY_DB=1` were not set, so this pass does not prove that
migrations apply cleanly to the local Supabase database.

`npm run verify:readback` passed against exactly the four default saved JSON
readback, cleanup, and rate-limit proof files. This proves those saved files
are machine-readable and internally consistent; it does not make them current
staging proof.

`npm run verify:browser-use` passed against the env-injected Browser Use proof.
It checked non-empty root rendering, login/signup route visibility, Google and
Apple login paths, email/password inputs, and view-only state.

`npm run supabase:verify:static` passed without database access. It checked
project files, RLS/grant text, usage quota guards, service RPC wrappers,
authenticated usage summary boundaries, and static secret guards. Release
evidence JSON is validated separately by `npm run verify:readback`.

### Continuation Recheck

After commit `4f52dad9cb49092c72378162381fcfc9de8304b7`, these checks were
re-run without performing auth, deploy, DB mutation, deletion, publishing,
payment, personal information entry, or adding secret values to evidence:

```bash
npm run build
npm run verify:readback
npm run verify:browser-use
npm run supabase:verify:static
node --check scripts/release-doctor.mjs
npm run lint
```

All listed commands passed. `node --check scripts/release-doctor.mjs` was a
syntax check of the release doctor script, not a full clean-tree doctor run.

`npm run release:doctor` now also runs a current-readback metadata check using
the latest release evidence date, `staging` by default, and the current git
commit. This intentionally turns old saved readback JSON into `STOP` until
fresh staging proof includes `release_date`, `environment`, `git_commit`, and
`captured_at`. In a dirty tree it stops first at git clean. The current-readback
`STOP` was rechecked with explicit `verify:readback` metadata expectations and
in a temporary clean copy; rerun `npm run release:doctor` after this follow-up
commit from a clean tree.

The release doctor redaction path was also rechecked with representative
`PASSWORD`, `TOKEN`, `SECRET`, `API_KEY`, `ACCESS_TOKEN`, `AUTH_TOKEN`,
`OPENAI_API_KEY`, and `DATABASE_URL` output. Values matching known secret
patterns were replaced with `[redacted]`, while the release proof target display
stayed visible.

Final redaction review also exercised `KEY`, `DB_URL`, `JWT_SECRET`,
`*_PASSWORD`, `*_TOKEN`, `*_SECRET`, and `*_KEY` style names with blank-padded
and JSON-like key/value forms. Values were redacted and
`release_date`/`environment`/`git_commit` metadata remained visible.

## Blocked Gate

```bash
npm run verify
```

Result: failed because these environment names were missing, even after sourcing
`.env.production.local`:

```bash
SUPABASE_URL
SUPABASE_ANON_KEY
SUPABASE_SERVICE_ROLE_KEY
PUBLIC_URL
```

The full `scripts/check-env.mjs` required set is:

```bash
VITE_SUPABASE_URL
VITE_SUPABASE_ANON_KEY
SUPABASE_URL
SUPABASE_ANON_KEY
SUPABASE_SERVICE_ROLE_KEY
GEMINI_API_KEY
OPENAI_API_KEY
PUBLIC_URL
```

No secret values are recorded here.

When `.env.production.local` was sourced during the continuation recheck,
`npm run verify` still stopped at `env:check` with these missing names:

```bash
SUPABASE_URL
SUPABASE_ANON_KEY
SUPABASE_SERVICE_ROLE_KEY
PUBLIC_URL
```

### Local Supabase DB Verification

```bash
SUPABASE_VERIFY_MODE=db npm run supabase:verify
```

Result: blocked. The script reached `supabase migration list --local`, which
targets the local Supabase database at `127.0.0.1:54322` from
`supabase/config.toml`, but the local database was not reachable.

This is not evidence of a schema mismatch. The static migration checks still
pass, and the release readback SQL targets columns defined by the current
migrations: `usage_events.status/request_id/reserved_at/completed_at`,
`edge_function_runs.status`, and `generated_images.storage_path/image_url`.

Treat this as missing local DB apply/list proof. Resume by starting the local
Supabase stack and rerunning:

```bash
SUPABASE_VERIFY_MODE=db npm run supabase:verify
```

`SUPABASE_VERIFY_DB=1` remains accepted as a legacy equivalent.

## Current Browser Use Smoke Proof

Use only the env-injected captures below as current browser proof:

```text
output/release-prep/browser-use-20260617/home-env-full.png
output/release-prep/browser-use-20260617/home-env-state.txt
output/release-prep/browser-use-20260617/home-env-eval.json
output/release-prep/browser-use-20260617/login-full.png
output/release-prep/browser-use-20260617/login-state.txt
output/release-prep/browser-use-20260617/login-eval.json
```

This was a view-only smoke. No credentials were entered, no auth provider was
clicked, and no authenticated action was attempted.

Machine check:

```bash
npm run verify:browser-use
```

The first dev server run without env injection showed a blank root and a Vite
error. That first capture is not release proof.

## Useful Ignored Proof

These ignored files may help investigation, but they are not final release proof
because they were not re-captured after the latest commit:

```text
output/playwright/prod-db-readback.json
output/playwright/prod-cleanup.json
output/playwright/edge-deny-proof.json
output/playwright/edge-deny-cleanup.json
output/playwright/rate-limit-db-proof-2.json
output/playwright/rate-limit-cleanup-2.json
```

Machine check:

```bash
npm run verify:readback
```

The check passed for exactly these four default readback files:
`output/playwright/prod-db-readback.json`, `output/playwright/prod-cleanup.json`,
`output/playwright/rate-limit-db-proof-2.json`, and
`output/playwright/rate-limit-cleanup-2.json`. Keep treating all ignored proof
files above as supporting evidence until current staging readback is captured.

When new staging proof is captured, use explicit metadata expectations:

```bash
npm run verify:readback -- --expect-release-date 2026-06-17 --expect-environment staging --expect-git-commit <commit>
```

With those flags, every proof JSON must include matching `release_date`,
`environment`, `git_commit`, and a valid `captured_at`. Generated image rows
must keep canonical `image_url` null, missing, or empty.

## Missing Proof

- Staging readback is incomplete.
- Generated image `image_url` null/missing/empty readback is incomplete.
- Current readback metadata proof is incomplete: `npm run verify:readback -- --expect-release-date 2026-06-17 --expect-environment staging --expect-git-commit <commit>`
  fails against the saved JSON proof because those files do not include matching
  `release_date`, `environment`, `git_commit`, or valid `captured_at`.

## Stop Boundary

Stop before any step that requires sending, submitting, publishing, deleting,
authentication, payment, or personal information entry.

## Required DB Readback SQL

Run these as read-only staging checks and save the output as new evidence:

```sql
select id, function_name, status, units, request_id, reserved_at, completed_at, created_at
from public.usage_events
order by created_at desc
limit 50;

select id, function_name, status, created_at
from public.edge_function_runs
order by created_at desc
limit 50;

select id, storage_path, image_url, created_at
from public.generated_images
order by created_at desc
limit 50;
```

Release remains blocked until the readback is current and `npm run verify`
passes with the required environment names loaded.
