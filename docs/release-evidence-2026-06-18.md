# Release Evidence 2026-06-18

Status: **accepted-risk; release doctor passed on current HEAD**.

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

Current `HEAD` Browser Use smoke proof for release doctor is saved under:

```text
output/release-prep/parent-goal-20260618-current-head/browser-use-current/
```

Detailed parent-process Browser Use operation evidence is saved under:

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
storageReadbackOk=true
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
  `brands` INSERT policy. The brand insert migration has been applied remotely.
- Updated Edge Functions have been deployed.

Final parent-process real operation proof was captured for:

- `optimize-prompt`: succeeded and recorded usage/edge run proof.
- `campaign-image` through `generate-image`: succeeded, rendered a generated
  image, wrote `generation_jobs` and `generated_images`, and produced a valid
  storage readback.
- `remove-background`, `colorize`, `upscale-fixed`, `design-gacha`,
  `product-shots`, `model-matrix`, and `multilingual-banner-fixed2`: PASS in
  image visual QA.
- `multilingual-banner`: initial PNG failed with garbled/duplicated text; the
  first SVG fix failed due to clipped text. Browser Use regenerated the fixed2
  SVGs and visual QA passed for
  `qlthumbs2/multilingual-banner-fixed2-ja.svg.png` and
  `qlthumbs2/multilingual-banner-fixed2-en.svg.png`.
- `scene-coordinate`: PASS in focused authenticated Browser Use proof. The UI
  shows 3 generated images for cafe, street, and office scenes, and DB/storage
  readback distinguishes the rows as `scene_coordinate`.
- `variations`: PASS in focused authenticated Browser Use proof. The UI shows
  1 generated variation, and DB/storage readback distinguishes it as
  `variations`.

Focused diagnosis for the weak `scene-coordinate` and `variations` proof is
saved at:

```text
output/release-prep/focused-generation-20260618-parent/generate-variations-feature-type-diagnosis.json
```

Root cause: `supabase/functions/generate-variations/index.ts` was not saving
`generated_images.feature_type`, so DB readback could not distinguish
`scene-coordinate` rows from `variations` rows. The Edge Function has been fixed
to prefer `body.featureType` when it is `scene-coordinate` or `variations`,
fallback from the presence of `scenes` when omitted, and save both
`generated_images.feature_type` and `generation_params.featureType` for scene
and variation inserts. `GeneratePage` now sends `featureType` explicitly for
both `variations` and `scene-coordinate`. The `generate-variations` Edge
Function has been deployed remotely.

Existing DB `scene-coordinate` rows were generated before the fix and still
have `feature_type=null`. After user approval, the existing QA user was logged
in through Browser Use after a password reset. The focused generation rerun is
saved under:

```text
output/release-prep/focused-generation-20260618-parent/postfix-auth/
```

Focused operation evidence:

```text
12-scene-after.png
12-scene-after-state.txt
23-variations-after.png
23-variations-after-state.txt
focused-feature-type-readback.json
focused-visual-qa-summary.json
```

Readback result:

```text
images=4
scene_coordinate=3
variations=1
runs=2
storage download ok
verdict=pass
```

Focused visual QA result:

```text
verdict=pass
```

Image QA summary evidence:

```text
image-visual-qa-summary.json
latest-feature-image-summary.json
```

Release-risk update from the current-HEAD parent goal and owned Gmail retry:

- Signup and first user journey proof is now resolved for the owned account.
  The user disabled email confirmation and explicitly approved
  admin-confirming the existing owned Auth user. API login succeeded, Browser
  Use login reached the dashboard, the first-brand RLS blocker was repaired
  with the `create_brand` RPC migration, and Browser Use completed
  login -> brand -> generate -> gallery proof.
- Local DB reset/recreate is resolved. The current-HEAD local DB proof reports
  `reset_recreate_ok=true`, `db_verify_ok=true`, and `exact_blocker=null`
  after initial reset/start failures and a successful retry with valid excludes.
- Cleanup/delete is resolved from historical proof, not from the current
  parent-goal run. The current parent-goal run did not run cleanup/delete.

Browser Use smoke metadata verification now passes for current `HEAD` under
`output/release-prep/parent-goal-20260618-current-head/browser-use-current/`.
`release:doctor` has no `STOP` on current `HEAD`; the owned signup/user-journey
blocker is resolved in `docs/release-blockers-2026-06-18.json`.

## Current Browser Use Smoke

Current `HEAD` Browser Use smoke proof is:

```text
output/release-prep/parent-goal-20260618-current-head/browser-use-current/
```

Detailed parent-process Browser Use operation proof is saved under:

```text
output/release-prep/final-browser-use-20260618-parent/
```

Earlier Browser Use recapture failures remain historical context under
`output/release-prep/full-closeout-20260618-parent/browser-use-current/`.
Cleanup/delete remains resolved from historical proof for artifact-listed QA
targets only. It was not run by the current parent-goal run.

## Local Verification

Passed:

```bash
git diff --check
npm run e2e
npm run lint --silent
npm run typecheck
npm run build --silent
npm run verify
npm run smoke:edge --silent
npm run verify:readback
SUPABASE_VERIFY_MODE=static bash scripts/supabase-prod-verify.sh
deno check supabase/functions/generate-variations/index.ts
deno check supabase/functions/{colorize,design-gacha,generate-image,generate-variations,model-matrix,multilingual-banner,product-shots,remove-background,upscale}/index.ts
```

`npm run e2e` reported 6 passed. No secret values are recorded here.

The Gemini model update also passed Codex read-only review with no findings
after the smoke guard was widened to include
`supabase/functions/_shared/geminiModels.ts`.

## Current Release Doctor

Before the release blocker manifest was added, parent-process verification
included the aggregate release doctor command:

```bash
RELEASE_BROWSER_USE_PROOF_DIR=output/release-prep/browser-use-20260618-current npm run release:doctor --silent
```

The current-HEAD parent goal then reran Browser Use proof under
`output/release-prep/parent-goal-20260618-current-head/browser-use-current/`,
resolved local DB reset/recreate after initial reset/start failures and a
valid-excludes retry, and reran the aggregate release doctor.

```text
release:doctor passed on current HEAD with no STOP
```

After this docs commit, save the final doctor transcript at:

```text
output/release-prep/parent-goal-20260618-current-head/release-doctor-after-docs-commit.txt
```

## Current Readback and DB Proof

Current parent DB readback is saved at
`output/release-prep/final-db-readback-20260618-parent/readback.json`.

It reported `jobs=1`, `images=1`, `usage=5`, `runs=5`, `storage=1`, and
storage readback passed.

Cleanup/delete was run only in historical proof for artifact-listed QA targets.
It removed the listed QA storage objects, `generated_images` rows, brands, and
Auth users without deleting usage, audit, or edge run proof rows. The current
parent-goal run did not run cleanup/delete; it only references the historical
resolved proof. Evidence:

```text
output/release-prep/next-phase-20260618-parent2/cleanup-delete-readback.json
```

## Known Blockers

Signup proof is resolved for the owned account after the user-approved bypass
path. Earlier signup attempts hit Supabase Auth HTTP 429, and the parent
closeout retry used a redacted `example.com` address and returned HTTP 400
invalid email. The owned Gmail retry first stopped at `email_not_confirmed`;
after email confirmation was disabled and the existing Auth user was
admin-confirmed, API login succeeded. The first-brand flow then exposed a
separate `brands` RLS 42501 blocker, fixed by applying
`supabase/migrations/20260618090000_create_brand_rpc.sql` remotely and updating
`DashboardPage` to call `public.create_brand`. Browser Use then completed
login -> brand -> generate -> gallery proof. Evidence is saved under:

```text
output/release-prep/signup-owned-20260618-parent/admin-confirm-existing-user-summary.json
output/release-prep/signup-owned-20260618-parent/api-login-after-admin-confirm-summary.json
output/release-prep/signup-owned-20260618-parent/api-create-brand-rpc-after-migration-summary.json
output/release-prep/signup-owned-20260618-parent/ui-login-dashboard-after-rpc-fix.png
output/release-prep/signup-owned-20260618-parent/ui-generate-after-submit-rpc-fix.png
output/release-prep/signup-owned-20260618-parent/ui-gallery-after-generate-rpc-fix.png
output/release-prep/signup-owned-20260618-parent/owned-user-generate-gallery-readback-after-rpc-fix.json
```

Local DB reset/recreate is resolved. After initial reset/start failures, the
current-HEAD retry started Colima, used the Colima Docker socket, started the
local DB with valid excludes, passed `supabase migration list --local`, completed
`supabase db reset --local --no-seed`, passed `SUPABASE_VERIFY_MODE=db bash
scripts/supabase-prod-verify.sh`, and recorded `exact_blocker=null`.
Evidence is saved at:

```text
output/release-prep/parent-goal-20260618-current-head/local-db/local-db-reset-recreate-summary.json
```

Current `HEAD` Browser Use proof is now recaptured and validates:

```text
output/release-prep/parent-goal-20260618-current-head/browser-use-current/
```

The proof includes nonblank home/login pages, visible auth controls, view-only
metadata, release date `2026-06-18`, environment `staging`, and git commit
`c80e209f1483dd42dafc43e15bab06346a0b46a0`. `verify:browser-use` passes, and
`release:doctor` passes on current `HEAD` without a `STOP`. The after-docs
transcript should be saved after this docs commit at
`output/release-prep/parent-goal-20260618-current-head/release-doctor-after-docs-commit.txt`.

Rollback path is recorded in `docs/rollback.md`. Use it only after a human owner
chooses rollback; normal release verification does not deploy, delete, auth,
pay, or enter personal information.

## Stop Boundary

Stop before any step that requires sending, submitting, publishing, deleting,
authentication, payment, personal information entry, deploy, or DB mutation.
