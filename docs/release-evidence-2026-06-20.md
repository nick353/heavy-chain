# Release Evidence 2026-06-20

Status: **production Supabase DB and Edge Functions reflected; production URL
binding secret has been set; production URL QA and authenticated production QA
passed**.

This file records the 2026-06-20 launch-readiness closeout for the current
`main` commit. It is an evidence ledger, not approval to release.

## Target

```text
git_commit=ac8596d0621b27c6d60e042f371a8653eddb9afb
branch=launch-readiness-final
remote=origin/main
captured_at=2026-06-20 14:05:00 CST
supabase_project=heavy-chain-production
supabase_project_ref=ghwjymozrwmcrpjqvbmo
```

The current launch-readiness code commit has been pushed to `origin/main`.
This file was updated after the production Supabase reflection step.

## Changes Closed

- Hardened initial RLS policies in `supabase/migrations/001_initial_schema.sql`
  with `TO authenticated`, `WITH CHECK`, and brand ownership/member role checks.
- Removed the Vite manual vendor chunk split that caused production preview to
  fail before React mounted with `Cannot access 'K' before initialization`.
- Updated E2E Supabase auth mocking to cover the current project ref
  `jprhgmxszvtomrqnolxn` as well as the older ref and any
  `VITE_SUPABASE_URL`-derived ref.
- Added a follow-up production migration,
  `20260620054232_harden_remaining_rls_policies.sql`, because edits to already
  applied `001_initial_schema.sql` do not alter existing remote databases.
- Recreated remaining public and storage RLS policies with explicit
  `TO authenticated` roles, required `WITH CHECK` clauses, cross-brand
  `image_tags` / `image_folders` checks, and qualified `storage.objects.name`
  references so storage subqueries do not bind to `brands.name`.

## Production Reflection

The active Supabase production target was confirmed as:

```text
project=heavy-chain-production
ref=ghwjymozrwmcrpjqvbmo
```

Production DB migration flow:

```text
supabase link --project-ref ghwjymozrwmcrpjqvbmo --yes    PASS
supabase migration list --linked                          PASS before apply
supabase db push --linked --dry-run                       PASS, one pending migration
supabase db push --linked                                 PASS
```

Applied migration:

```text
20260620054232_harden_remaining_rls_policies.sql
```

Post-apply policy readback succeeded with `supabase db query --linked`.
Confirmed outcomes:

```text
target public table policies use roles={authenticated}
users UPDATE policy has WITH CHECK
image_tags policies join generated_images and tags with gi.brand_id = t.brand_id
image_folders policies join generated_images and folders with gi.brand_id = f.brand_id
style_presets has viewer SELECT and editor ALL policies
storage.objects policies deparse to objects.name, not brands.name
```

`supabase migration list --linked` was re-run after apply but hit a Supabase
pooler temp-role authentication failure after repeated retries:

```text
FATAL: password authentication failed for user "cli_login_postgres"
Connect to your database by setting the env var correctly: SUPABASE_DB_PASSWORD
```

This did not block the production DB readback query above.

Edge Function deployment:

```text
bash scripts/deploy-edge-functions.sh    PASS
```

Deployed functions:

```text
generate-image
remove-background
upscale
colorize
generate-variations
design-gacha
product-shots
model-matrix
multilingual-banner
optimize-prompt
bulk-download
share-link
```

The CLI printed `WARNING: Docker is not running`, but each function was uploaded
and reported deployed on project `ghwjymozrwmcrpjqvbmo`.

Secret-name readback, without values, confirmed these production Edge Function
secrets exist:

```text
GEMINI_API_KEY
OPENAI_API_KEY
OPENAI_CHAT_API_KEY
OPENAI_CHAT_BASE_URL
OPENAI_CHAT_MODEL
PUBLIC_URL
SUPABASE_ANON_KEY
SUPABASE_DB_URL
SUPABASE_JWKS
SUPABASE_PUBLISHABLE_KEYS
SUPABASE_SECRET_KEYS
SUPABASE_SERVICE_ROLE_KEY
SUPABASE_URL
```

`PUBLIC_URL` is present as a production Edge Function secret name. Its value is
intentionally not recorded here. `share-link` production behavior was verified
in authenticated production QA below.

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

## Production URL QA

Playwright production URL QA captured evidence under:

```text
output/playwright/prod-url-qa-20260620/
```

Closeout artifact:

```text
output/playwright/prod-url-qa-20260620/qa-closeout.json
verdict=pass_with_auth_limited_scope
```

Confirmed unauthenticated production outcomes:

```text
production app URL returned HTTP 200 and rendered non-empty desktop/mobile pages
public pages loaded without console errors, failed requests, or framework overlays
login empty-submit validation appeared
signup React validation appeared for short password and mismatched confirmation
protected routes /dashboard, /generate, /gallery, /canvas redirected to /login
```

Public pages covered:

```text
/
/login
/signup
/forgot-password
/terms
/privacy
```

The first signup invalid-email check was intercepted by browser-native HTML5
email validation before React validation rendered. A follow-up check using a
syntactically valid email and invalid passwords confirmed the React Japanese
validation path. This is recorded as a UX note, not a release blocker for the
unauthenticated QA scope.

## Authenticated Production QA

Playwright authenticated production QA captured evidence under:

```text
output/playwright/prod-auth-qa-20260620/
```

Closeout artifact:

```text
output/playwright/prod-auth-qa-20260620/qa-auth-summary.json
verdict=pass
```

Confirmed authenticated production outcomes:

```text
signup/login created an authenticated session
profile readback returned 1 row
brand creation passed through create_brand RPC
generate-image Edge Function returned 200 and 1 generated image
generated image DB readback returned completed job, image row, usage row, and run row
generated image persisted storage_path and did not persist image_url
generated image storage signed URL creation passed
share-link Edge Function returned 200, success=true, and production PUBLIC_URL prefix
authenticated /gallery rendered after generation
authenticated /canvas/new rendered
```

Readback and cleanup artifacts:

```text
output/playwright/prod-auth-qa-20260620/prod-db-readback.json
output/playwright/prod-auth-qa-20260620/prod-cleanup.json
output/playwright/prod-auth-qa-20260620/rate-limit-db-proof.json
output/playwright/prod-auth-qa-20260620/rate-limit-cleanup.json
output/playwright/prod-auth-qa-20260620/env-check-summary.json
```

The production QA account, profile, brand, generated image row, storage object,
and rate-limit proof rows were cleaned up. Fresh DB cleanup readback reported
zero remaining QA users, profiles, storage rows, rate-limit brands, and
rate-limit usage rows.

Release readback verification passed with the current proof files:

```text
npm run verify:readback --silent -- \
  --readback output/playwright/prod-auth-qa-20260620/prod-db-readback.json \
  --cleanup output/playwright/prod-auth-qa-20260620/prod-cleanup.json \
  --rate-limit output/playwright/prod-auth-qa-20260620/rate-limit-db-proof.json \
  --rate-limit-cleanup output/playwright/prod-auth-qa-20260620/rate-limit-cleanup.json \
  --expect-release-date 2026-06-20 \
  --expect-environment production
```

The rate-limit proof confirmed stale reservation release and five successful
brand attempts followed by an explicit `Brand usage rate limit exceeded`
denial on the sixth attempt.

## Stopped Checks / Remaining Notes

`npm run env:check` with the plain available local env still stops at:

```text
Environment check: 2/8 required keys present.
Missing required keys:
VITE_SUPABASE_URL
VITE_SUPABASE_ANON_KEY
SUPABASE_URL
SUPABASE_ANON_KEY
SUPABASE_SERVICE_ROLE_KEY
PUBLIC_URL
```

When public production values from the deployed bundle are supplied for the
frontend/Supabase URL/key and `PUBLIC_URL`, `env:check` reaches:

```text
Environment check: 7/8 required keys present.
Missing required keys:
SUPABASE_SERVICE_ROLE_KEY
```

Supabase secret values cannot be read back from the CLI, so local
`SUPABASE_SERVICE_ROLE_KEY` placement remains the only env-name blocker.

Supabase CLI production access was sufficient for DB migration apply, policy
readback query, secret-name readback, and Edge Function deployment. The
post-apply migration-list readback still hit the temp-role authentication
failure recorded above.

Local Supabase stack verification is blocked separately by the local Docker /
Supabase runtime state. This is recorded as a local non-release blocker because
production DB, Edge Functions, production URL QA, authenticated QA, readback,
and cleanup proof are recorded above.

## Remaining External Actions

These are the remaining external actions before a fully clean local release
verification shell:

- Place the production `SUPABASE_SERVICE_ROLE_KEY` in the local verification
  environment, then rerun `npm run env:check` without recording the value.
- Optionally copy or regenerate the current readback proof files to the default
  `output/playwright/` paths if the bare `npm run verify:readback` command must
  pass without explicit artifact arguments.

Applying migrations and deploying Edge Functions are external writes. Do not
perform them without explicit production-target confirmation in the active
session.

No secret values are recorded in this evidence file.
