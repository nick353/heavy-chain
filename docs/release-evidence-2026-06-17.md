# Release Evidence 2026-06-17

Status: **not release-ready**.

This file records what is known for the 2026-06-17 release gate. It is an
evidence ledger, not approval to release.

## Start State

`git status` was clean at the start of this documentation update.

## Passed Gates

```bash
npm run build
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
skipped the local migration list because `SUPABASE_VERIFY_DB` was not set, so
this pass does not prove that migrations apply cleanly to the local Supabase
database.

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

### Local Supabase DB Verification

```bash
SUPABASE_VERIFY_DB=1 npm run supabase:verify
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
SUPABASE_VERIFY_DB=1 npm run supabase:verify
```

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

## Missing Proof

- Staging readback is incomplete.
- Generated image `image_url` non-persistence readback is incomplete.

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
