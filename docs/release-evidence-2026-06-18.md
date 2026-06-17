# Release Evidence 2026-06-18

Status: **not release-ready**.

This file records what is known for the 2026-06-18 release gate. It is an
evidence ledger, not approval to release.

Parent-only feature QA and real Browser Use operation evidence is recorded in
[`docs/release-feature-qa-matrix-2026-06-18.md`](./release-feature-qa-matrix-2026-06-18.md).

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

## Current Proof Summary

Current parent-process Browser Use evidence is saved under:

```text
output/release-prep/final-browser-use-20260618-parent/
```

It includes state and screenshot evidence for terms, privacy, legal, generate,
and gallery surfaces.

Current DB readback is saved at:

```text
output/release-prep/final-db-readback-20260618-parent/readback.json
```

Readback result:

```text
jobs=1
images=1
usage=5
runs=5
storage=1
signedUrlAllOk=true
```

This is current proof for the parent-process run, but it is not release
approval. Known blockers remain below.

## Parent Feature QA Update

The parent-only Browser Use QA pass found and fixed several user-visible release
issues:

- `/terms`, `/privacy`, and `/legal` now render dedicated pages instead of
  redirecting to the landing page.
- Prompt optimization now shows the optimized result in the result panel, not
  only in the left input field.
- Generation failures now leave a persistent error card in the result panel.
- A new migration restores first-run brand creation with an explicit
  `brands` INSERT policy.

Final parent-process real operation proof was captured for:

- `optimize-prompt`: succeeded and recorded usage/edge run proof.
- `campaign-image` through `generate-image`: succeeded, rendered a generated
  image, wrote `generation_jobs` and `generated_images`, and produced a valid
  Storage signed URL.
- `remove-background`: failed and the UI showed the error state. This remains a
  blocker.

Remaining release blockers from this pass:

- Apply `20260618023000_restore_brand_insert_policy.sql` to staging/prod before
  treating first brand creation as fixed remotely.
- Investigate the `remove-background` Edge Function failure.
- Cleanup/delete was not run because it was not approved in this pass.

The historical Browser Use proof remains useful as supporting view-only shape
evidence, but current release diagnosis must use the final parent evidence
directory above.

## Current Browser Use Smoke

Current final Browser Use proof was captured against the parent-process release
QA lane:

```text
output/release-prep/final-browser-use-20260618-parent/
```

Saved state/screenshot evidence includes:

```text
terms
privacy
legal
generate
gallery
```

The capture saved Browser Use state and screenshots. Cleanup/delete was not run
because it was not approved.

## Local Verification

Passed:

```bash
npm run e2e
npm run typecheck
npm run build --silent
npm run verify
SUPABASE_VERIFY_MODE=static bash scripts/supabase-prod-verify.sh
```

`npm run e2e` reported 6 passed. No secret values are recorded here.

## Current Release Doctor

The parent-process verification pass included the aggregate verify command:

```bash
npm run verify
```

Result:

```text
pass
```

## Current Readback and DB Proof

Current parent DB readback is saved at
`output/release-prep/final-db-readback-20260618-parent/readback.json`.

It reported `jobs=1`, `images=1`, `usage=5`, `runs=5`, `storage=1`, and
`signedUrlAllOk=true`.

Cleanup/delete was not approved and was not run.

## Known Blockers

Release remains blocked by the unapplied remote brand insert RLS migration, the
`remove-background` Edge Function failure shown in the UI, and the fact that
cleanup/delete was not approved or run in this pass. The release is not
release-ready.

Rollback path is recorded in `docs/rollback.md`. Use it only after a human owner
chooses rollback; normal release verification does not deploy, delete, auth,
pay, or enter personal information.

## Stop Boundary

Stop before any step that requires sending, submitting, publishing, deleting,
authentication, payment, personal information entry, deploy, or DB mutation.
