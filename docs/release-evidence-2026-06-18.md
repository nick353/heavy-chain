# Release Evidence 2026-06-18

Status: **not release-ready**.

This file records what is known for the 2026-06-18 release gate. It is an
evidence ledger, not approval to release.

## Start State

Release verification targets the current clean `HEAD`. The latest checked
commit before this evidence update was:

```text
8052a8c853ff6075e60e0901e2c94ffe4e095618
```

`git status --short --branch` reported a clean worktree at that point:

```text
## main...origin/main [ahead 10]
```

`npm run release:doctor --silent` in the clean worktree stopped at
`proof target` until `RELEASE_BROWSER_USE_PROOF_DIR` was set.

## Doctor Target Check

Before this file was added, the latest release evidence file was
`docs/release-evidence-2026-06-17.md`, so the default doctor target remained
`release_date=2026-06-17`.

Before the release doctor was hardened to require
`RELEASE_BROWSER_USE_PROOF_DIR`, the 2026-06-18 target was checked with an
explicit override:

```bash
RELEASE_DATE=2026-06-18 npm run release:doctor --silent
```

Result: stopped at `env:check`.

Passed before the stop:

```text
OK git clean
OK proof target
```

Stopped check:

```text
STOP env:check
```

Safe output tail reported 2/8 required keys present and these missing required
environment names:

```text
VITE_SUPABASE_URL
VITE_SUPABASE_ANON_KEY
SUPABASE_URL
SUPABASE_ANON_KEY
SUPABASE_SERVICE_ROLE_KEY
PUBLIC_URL
```

No secret values are recorded here.

## Missing Proof

- Current staging readback is incomplete.
- Generated image `image_url` null/missing/empty readback is incomplete.
- Current readback metadata proof for 2026-06-18 is incomplete. Without
  `RELEASE_BROWSER_USE_PROOF_DIR`, doctor stops at `proof target`; after that
  directory is set, the current environment still stops at `env:check`, so
  `verify:readback:current` is not reached.

After the release doctor was hardened to require a current Browser Use proof
directory, running it in a clean worktree without
`RELEASE_BROWSER_USE_PROOF_DIR` stops at `proof target` before `env:check`.
The historical Browser Use proof remains useful as supporting view-only shape
evidence, but current release diagnosis must use the proof directory below.

## Current Browser Use Smoke

Current view-only Browser Use proof was captured against local preview:

```text
output/release-prep/browser-use-20260618-current
```

Saved files:

```text
home-env-full.png
home-env-state.txt
home-env-eval.json
login-full.png
login-state.txt
login-eval.json
```

The capture opened `/` and `/login`, took screenshots, saved Browser Use state,
and evaluated page structure. It did not type credentials, click auth buttons,
submit forms, publish, delete, deploy, or mutate the database.

Validator command:

```bash
npm run verify:browser-use --silent -- --dir output/release-prep/browser-use-20260618-current --expect-release-date 2026-06-18 --expect-environment staging --expect-git-commit <current-git-commit>
```

Result:

```text
Browser Use proof verification passed. Secret values were not printed.
```

The validator confirmed rendered product copy, `/login` and `/signup` paths,
Google/Apple/email login surfaces, email/password inputs, PNG proof, view-only
state, and matching Browser Use metadata.

## Local Verification

Passed:

```bash
npm run build --silent
npm run supabase:verify --silent
npm run security:audit --silent
npm run smoke:edge --silent
npm run typecheck --silent
npm run verify:browser-use:regression --silent
npm run verify:readback --silent
```

`npm run verify --silent` is still blocked by missing environment names in the
current shell. With `.env.production.local` sourced, the missing names are:

```text
SUPABASE_URL
SUPABASE_ANON_KEY
SUPABASE_SERVICE_ROLE_KEY
PUBLIC_URL
```

No secret values are recorded here. `security:audit`, `smoke:edge`, and
`typecheck` passed individually, so the remaining `verify` blocker is the env
gate.

`npm run supabase:verify:db --silent` is blocked by local Supabase DB startup.
After starting Colima, `supabase start` first failed because the local
`supabase_config_heavy-chain` volume missed `/etc/postgresql-custom/conf.d`.
An empty `conf.d` directory was added to that local Docker volume. Restarting
then failed because the existing local DB volume was initialized by PostgreSQL
15, while `supabase/config.toml` requires `major_version = 17`.

No local DB volume was deleted or reset. `supabase stop` and `colima stop` were
run after this check.

## Current Release Doctor

Before this evidence update, with current Browser Use proof supplied and
`.env.production.local` sourced:

```bash
RELEASE_BROWSER_USE_PROOF_DIR=output/release-prep/browser-use-20260618-current npm run release:doctor --silent
```

Result:

```text
OK   git clean
OK   proof target
STOP env:check
```

The safe output tail reported 4/8 required keys present and the same four
missing names listed above. The doctor did not reach `verify:readback:current`
or the current Browser Use check because it stops at the first blocker.

## Current Readback and DB Proof

Historical saved readback proof still validates with:

```bash
npm run verify:readback --silent
```

The same files fail current metadata expectations for 2026-06-18 and the current
clean `HEAD`, so current staging/prod readback is not complete. Current
read-only DB readback still needs new proof for:

- generated image `storage_path` present and canonical `image_url` null/missing/empty
- usage and edge function run rows tied by request id
- cleanup proof with zero remaining smoke users

Do not create that proof by deleting rows or mutating DB state in this release
prep turn.

## Known Blockers

Release remains blocked by missing service/env values, missing current
staging/prod DB readback, missing current RLS/quota/cleanup DB readback proof,
and `supabase:verify:db` needing either an approved local DB reset/recreate path
or another approved DB verification lane.

Rollback path is recorded in `docs/rollback.md`. Use it only after a human owner
chooses rollback; normal release verification does not deploy, delete, auth,
pay, or enter personal information.

## Stop Boundary

Stop before any step that requires sending, submitting, publishing, deleting,
authentication, payment, personal information entry, deploy, or DB mutation.
