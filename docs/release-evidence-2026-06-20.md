# Release Evidence 2026-06-20

Status: **local gates passed; external deployment blocked by missing production credentials**.

This file records the 2026-06-20 launch-readiness closeout for the current
`main` commit. It is an evidence ledger, not approval to release.

## Target

```text
git_commit=5174df4f9937ab05ad1a7bfdc7d9c63f6cd8c078
branch=launch-readiness-final
remote=origin/main
captured_at=2026-06-20 13:30:13 CST
```

The commit has been pushed to `origin/main`.

## Changes Closed

- Hardened initial RLS policies in `supabase/migrations/001_initial_schema.sql`
  with `TO authenticated`, `WITH CHECK`, and brand ownership/member role checks.
- Removed the Vite manual vendor chunk split that caused production preview to
  fail before React mounted with `Cannot access 'K' before initialization`.
- Updated E2E Supabase auth mocking to cover the current project ref
  `jprhgmxszvtomrqnolxn` as well as the older ref and any
  `VITE_SUPABASE_URL`-derived ref.

## Local Verification

The PASS results below are from the current Codex session command output; this
file does not store full command logs.

```text
npm run typecheck                 PASS
npm run lint                      PASS
npm run build                     PASS
production preview page check     PASS, no pageerror and non-empty root
npm run e2e                       PASS, 6/6
npm run supabase:verify:static    PASS
npm run security:audit            PASS
npm run smoke:edge                PASS, no external API calls
```

`npm run lint` still prints the existing `baseline-browser-mapping` freshness
warning. It does not fail the command.

## Stopped Checks

`npm run env:check` with the available local env stopped at:

```text
Environment check: 4/8 required keys present.
Missing required keys:
SUPABASE_URL
SUPABASE_ANON_KEY
SUPABASE_SERVICE_ROLE_KEY
PUBLIC_URL
```

`npm run verify:readback` stopped because current production proof files are not
present locally:

```text
output/playwright/prod-db-readback.json
output/playwright/prod-cleanup.json
output/playwright/rate-limit-db-proof-2.json
output/playwright/rate-limit-cleanup-2.json
```

Supabase CLI production access is blocked:

```text
supabase projects list -> Access token not provided.
required: supabase login or SUPABASE_ACCESS_TOKEN
```

Local Supabase stack verification is blocked separately by the local Docker /
Supabase runtime state. Production DB migration and Edge Function deployment
were not attempted because they are external writes and the required production
credentials are not available in this session.

## Remaining External Actions

These are the required resume actions before release approval:

- Provide or load the missing production env names without printing their
  values, then rerun `npm run env:check`.
- Authenticate Supabase CLI with `supabase login` or `SUPABASE_ACCESS_TOKEN`.
- Apply pending Supabase migrations to the intended production/staging project.
- Deploy Edge Functions with `scripts/deploy-edge-functions.sh`.
- Capture fresh production DB/readback and cleanup proof files, then rerun
  `npm run verify:readback`.
- Run production URL browser QA for login/signup, brand creation, generation,
  gallery, canvas, legal pages, and failure states.

Applying migrations and deploying Edge Functions are external writes. Do not
perform them without explicit production-target confirmation in the active
session.

No secret values are recorded in this evidence file.
