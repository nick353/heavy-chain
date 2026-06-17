# Production Readiness

Status: **not release-ready**.

This document is the final release gate ledger for Heavy Chain. If a check says
`BLOCKED` or `DO NOT RUN`, stop. Do not guess, do not fill secrets into docs, and
do not continue into production.

Current evidence is recorded in
[`docs/release-evidence-2026-06-17.md`](./release-evidence-2026-06-17.md).

Safe local validators now exist for proof files:

```bash
npm run release:doctor
npm run verify:readback
npm run verify:browser-use
npm run supabase:verify:static
```

`npm run release:doctor` is the recommended first command for a safe readiness
diagnosis. It prints `OK` or `STOP` for git clean status, `env:check`,
`verify:readback`, `verify:browser-use`, `supabase:verify:static`,
`security:audit`, `smoke:edge`, `typecheck`, and `lint`, then names the first
`STOP` and next action. It does not run `supabase:verify:db`, `verify:full`,
deploys, auth flows, payment, deletion, personal information entry, or DB
mutation. These validators do not print secret values. A pass here is still not
release approval.

## Final Gate

Heavy Chain can only be released after all of these are true:

1. All automated gates pass with production-like environment variables loaded.
2. Staging DB readback proves usage, cleanup, and generated image storage state.
3. Browser smoke proof is current and captured after env injection.

As of 2026-06-17, item 1 is incomplete because `npm run verify` fails even when
`.env.production.local` is sourced.

## Known Blockers

- `npm run verify` is blocked by missing environment variable names:
  `SUPABASE_URL`, `SUPABASE_ANON_KEY`, `SUPABASE_SERVICE_ROLE_KEY`, and
  `PUBLIC_URL`.
- Staging readback is not complete.
- Generated image `image_url` null/missing/empty readback is not complete.
- Local Supabase DB verification is incomplete: `SUPABASE_VERIFY_MODE=db npm
  run supabase:verify` cannot reach the local database at `127.0.0.1:54322`,
  so `supabase migration list --local` has no current proof. The legacy
  `SUPABASE_VERIFY_DB=1` switch is still accepted.
- Some ignored proof files are useful, but were not re-captured after the latest
  commit. Treat them as supporting notes, not final release proof.
- `npm run verify:readback` can validate saved JSON proof, but it does not make
  old ignored proof current.

## Required Environment Names

`npm run verify` runs `scripts/check-env.mjs`, which requires all names below.
Do not write secret values in docs, logs, screenshots, or commits.

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

On 2026-06-17, `.env.production.local` plus the current shell still missed:
`SUPABASE_URL`, `SUPABASE_ANON_KEY`, `SUPABASE_SERVICE_ROLE_KEY`, and
`PUBLIC_URL`.

## Passed Gates

These checks are recorded as passed for 2026-06-17:

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

`npm run build` and `npm run e2e` were also re-run with
`.env.production.local` sourced so Vite received the required `VITE_*` values.

`git status` was clean at the start of the release-doc update.

`npm run supabase:verify:static` checks project files, RLS/grants, usage quota
guards, public service RPC wrappers, authenticated usage summary boundaries,
and static secret guards. It does not validate release evidence JSON and skips
database access by default.

## Blocked Gate

```bash
npm run verify
```

Result: failed because required env names were missing, even after sourcing
`.env.production.local`.

## Human Stop Rule

Stop immediately before any action that asks for or performs:

- sending, submitting, publishing, deleting, authentication, payment, or personal
  information entry
- production traffic changes without current staging proof
- database deletion of usage, audit, edge run, cleanup, or generated image proof

If one of those appears, record the blocker and ask a human owner to continue.

## Proof Validators

Use these before a human reads the evidence:

```bash
npm run verify:readback
npm run verify:browser-use
```

If a validator fails, stop. The failure line names the file and missing proof
without printing secret values. Fix the evidence source, recapture if needed,
and rerun the validator.

For current release evidence, run the readback validator with explicit metadata
expectations:

```bash
npm run verify:readback -- --expect-release-date 2026-06-17 --expect-environment staging --expect-git-commit <commit>
```

With those flags, every proof JSON must include matching `release_date`,
`environment`, `git_commit`, and a valid `captured_at`.

## DB Readback SQL

Use read-only SQL for staging proof. Save the output as release evidence.

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

For generated images, release proof must show that durable state is
`storage_path`, and that canonical `image_url` is null, missing, or empty.
