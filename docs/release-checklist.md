# Release Checklist

Status: **not release-ready**.

Use this checklist from top to bottom. If any line says `STOP`, stop there and
write down the blocker. Do not skip ahead.

## 1. Start Clean

For the safe one-command readiness diagnosis, run:

```bash
RELEASE_BROWSER_USE_PROOF_DIR=<current-browser-use-proof-dir> npm run release:doctor
```

It runs read-only/local checks in order and stops at the first `STOP`: git clean
status, proof target, `env:check`, `verify:readback`, current readback metadata
matching, current `verify:browser-use`, `supabase:verify:static`,
`security:audit`, `smoke:edge`, `typecheck`, and `lint`. It never runs
`supabase:verify:db` or `verify:full`, and it shows the first `STOP` with a next
action.
Doctor requires `RELEASE_BROWSER_USE_PROOF_DIR` and passes it to
`verify:browser-use -- --dir`. This closes the historical default proof path for
current release diagnosis.

- Confirm `git status --short` is empty.
- Confirm the release evidence file for the day exists.
- Do not include secret values in the evidence.

Historical note: the 2026-06-17 start state was clean. For the current release,
`npm run release:doctor` is the source of truth after
`RELEASE_BROWSER_USE_PROOF_DIR` points at the recaptured current proof directory.

## 2. Load Environment

Load every environment name required by `scripts/check-env.mjs` before final
verification:

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

Do not continue if any value is missing.

Historical note: on 2026-06-17, `npm run verify` stopped because these names
were missing, even after `.env.production.local` was sourced: `SUPABASE_URL`,
`SUPABASE_ANON_KEY`, `SUPABASE_SERVICE_ROLE_KEY`, and `PUBLIC_URL`.

Current 2026-06-18 proof is recorded in
[`docs/release-evidence-2026-06-18.md`](./release-evidence-2026-06-18.md).

## 3. Automated Gates

Historical passed gates from 2026-06-17; not 2026-06-18 release approval:

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
sourced. This matters because a dev server without env injection produced a
blank root, while the env-injected Browser Use smoke rendered normally.

`npm run supabase:verify` passed only with its default static checks. For final
local database proof, rerun it with `SUPABASE_VERIFY_MODE=db` or
`SUPABASE_VERIFY_DB=1`. Historical note: the 2026-06-17 result was `STOP`
because the local database at `127.0.0.1:54322` was not reachable.

New safe validators:

```bash
npm run verify:readback
npm run verify:browser-use # historical supporting Browser Use proof by default
npm run supabase:verify:static
```

These commands do not connect to the database. If surfaced through
`npm run release:doctor`, the doctor's displayed failure tail redacts known
secret patterns. If any one fails, read the file path in the failure line, fix
that proof, and stop before release. Do not paste secrets into the proof file to
make it pass.
For current Browser Use proof outside doctor, use the Section 4 `--dir` command
instead of the default historical proof path.
`npm run supabase:verify:static` is only the Supabase project static guard;
`npm run verify:readback` is the separate release evidence validator.

Use this only when the local Supabase stack is intentionally running:

```bash
npm run supabase:verify:db
```

Historical blocker from 2026-06-17:

```bash
npm run verify
```

Do not mark the release ready until `npm run verify` passes with the required
environment loaded.

## 4. Browser Smoke

Historical env-injected Browser Use proof from 2026-06-17; supporting only, not
current release proof:

```text
output/release-prep/browser-use-20260617/home-env-full.png
output/release-prep/browser-use-20260617/home-env-state.txt
output/release-prep/browser-use-20260617/home-env-eval.json
output/release-prep/browser-use-20260617/login-full.png
output/release-prep/browser-use-20260617/login-state.txt
output/release-prep/browser-use-20260617/login-eval.json
```

The first dev server without env injection showed a blank root and a Vite error.
Do not use that first capture as release proof.

For the current release, Browser Use smoke must be captured after environment
injection and recorded as current release evidence. The historical proof listed
above only shows the expected view-only shape.

For the historical supporting proof above, run:

```bash
npm run verify:browser-use
```

This validates `output/release-prep/browser-use-20260617` only. A pass here does
not create or approve current 2026-06-18 Browser Use proof.

After current Browser Use proof is recaptured, validate that directory
explicitly:

```bash
npm run verify:browser-use -- --dir <current-browser-use-proof-dir>
```

The check confirms that the env-injected home page is not blank, the login route
exists, Google/Apple/email login paths are visible, email and password inputs
are present, and the proof stayed view-only.

## 5. Staging Readback

Run read-only DB readback after staging is deployed. Save the output and confirm:

- usage events show expected reserved and final states
- edge function run records exist for the smoke path
- generated image rows use durable storage state and keep canonical `image_url`
  null, missing, or empty

Current 2026-06-18 result: `STOP`. Staging readback and `image_url`
null/missing/empty readback are not complete.

For existing JSON proof, run:

```bash
npm run verify:readback
```

It checks usage events, edge function runs, generated image storage paths,
cleanup proof, stale reservation release, and rate-limit denial. Passing this
does not replace current staging readback; it only proves the saved JSON shape is
machine-readable and internally consistent.

For current release evidence, add explicit metadata expectations:

```bash
npm run verify:readback -- --expect-release-date 2026-06-18 --expect-environment staging --expect-git-commit <commit>
```

With those flags, each proof JSON must include matching `release_date`,
`environment`, `git_commit`, and a valid `captured_at`.
Current readback metadata proof for 2026-06-18 is incomplete. Without
`RELEASE_BROWSER_USE_PROOF_DIR`, `npm run release:doctor` stops at
`proof target`; after that directory is set, the current environment still stops
at `env:check`, so this current metadata gate is not reached.
`npm run release:doctor` now runs this current-readback check automatically
using the latest `docs/release-evidence-YYYY-MM-DD.md`, `staging` by default,
and the current git commit. Use `RELEASE_DATE`, `RELEASE_ENVIRONMENT`, or
`RELEASE_GIT_COMMIT` only when a human owner intentionally verifies a different
target.
The automatic git commit target is `HEAD`; treat it as release-candidate-current
only after `git clean` passes.

## 6. Gates Not To Run

Do not run any gate that requires sending, submitting, publishing, deleting,
authentication, payment, or personal information entry. Stop and hand that step
to a human owner.

During release verification, do not run these without explicit human ownership:

```bash
npm run verify:full
npm run supabase:deploy:functions
supabase functions deploy ...
```

Also stop before any staging or production mutation, including migration apply,
real generation smoke, auth-provider login, or cleanup deletion.

## 7. Release Decision

Current decision: **do not release**.

Resume only after the missing env names are available, `npm run verify` passes,
staging DB readback has current proof, and the safe validators still pass.
