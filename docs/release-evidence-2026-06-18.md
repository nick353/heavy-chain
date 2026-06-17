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

It includes screenshot evidence for terms and state/screenshot evidence for
privacy, legal, generate, and gallery surfaces.

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
- `remove-background`: failed and the UI showed the error state. Detailed
  Browser Use state/screenshot evidence is under
  `output/release-prep/full-ui-qa-20260618-parent/102-remove-bg-fixed-after-*`.
  Code now avoids the deprecated Gemini 2.0 image model path, but the updated
  Edge Functions were not deployed or retested remotely in this pass.

Remaining release blockers from this pass:

- Apply `20260618023000_restore_brand_insert_policy.sql` to staging/prod before
  treating first brand creation as fixed remotely.
- Deploy the updated Edge Functions and rerun focused real Browser Use
  generation proof for `remove-background` and the remaining Gemini
  image-editing features.
- Resolve or retry the signup lane after the Supabase Auth HTTP 429 blocker.
- Capture focused real-generation proof for remaining image/text features beyond
  `optimize-prompt`, `campaign-image`, and `remove-background`.
- Cleanup/delete was not run because it was not approved in this pass.

The historical Browser Use proof remains useful as supporting view-only shape
evidence. Current release diagnosis must use the final parent evidence directory
above for summary smoke, the full UI QA directory for detailed operation proof,
and the DB readback directory for data proof.

## Current Browser Use Smoke

Current final Browser Use proof was captured against the parent-process release
QA lane:

```text
output/release-prep/final-browser-use-20260618-parent/
```

Saved final proof evidence includes:

```text
terms screenshot
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
npm run lint --silent
npm run typecheck
npm run build --silent
npm run verify
npm run smoke:edge --silent
SUPABASE_VERIFY_MODE=static bash scripts/supabase-prod-verify.sh
deno check supabase/functions/{colorize,design-gacha,generate-image,generate-variations,model-matrix,multilingual-banner,product-shots,remove-background,upscale}/index.ts
```

`npm run e2e` reported 6 passed. No secret values are recorded here.

The Gemini model update also passed Codex read-only review with no findings
after the smoke guard was widened to include
`supabase/functions/_shared/geminiModels.ts`.

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
need to deploy and retest updated Edge Functions for `remove-background` and the
remaining Gemini image-editing paths, the Supabase Auth HTTP 429 signup blocker,
the lack of focused real-generation proof for the remaining image/text features,
and the fact that cleanup/delete was not approved or run in this pass. The
release is not release-ready.

Rollback path is recorded in `docs/rollback.md`. Use it only after a human owner
chooses rollback; normal release verification does not deploy, delete, auth,
pay, or enter personal information.

## Stop Boundary

Stop before any step that requires sending, submitting, publishing, deleting,
authentication, payment, personal information entry, deploy, or DB mutation.
