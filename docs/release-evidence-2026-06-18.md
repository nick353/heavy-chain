# Release Evidence 2026-06-18

Status: **accepted-risk; final doctor pending**.

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

Pre-closeout Browser Use smoke proof for release doctor was saved under:

```text
output/release-prep/browser-use-20260618-current/
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

Accepted release risks from this pass:

- Signup success proof is accepted as missing because no owned test mailbox was
  discoverable in local env files and the user explicitly authorized proceeding.
- Local DB proof is accepted with `supabase migration list --local` and
  `SUPABASE_VERIFY_MODE=db` passing, but without clean `supabase db reset`
  exit-0 proof.
- Cleanup/delete was later approved by the current user request and completed
  for artifact-listed QA targets only.

Browser Use smoke metadata verification passed for the pre-closeout parent
`HEAD`. The final parent run then repaired Browser Use by installing
`profile-use`, confirmed `browser-use doctor` passes all checks, and captured
current `HEAD` env-injected home/login proof. `verify-browser-use-proof` passes
for release date `2026-06-18`, environment `staging`, and the current git
commit. Cleanup/no residual process state still has to be rechecked after this
final run. Final release gate remains stopped by the release blocker manifest:
`docs/release-blockers-2026-06-18.json`.

## Current Browser Use Smoke

Current `HEAD` Browser Use smoke proof is:

```text
output/release-prep/final-closeout-20260618-parent/browser-use-current/
```

Detailed parent-process Browser Use operation proof is saved under:

```text
output/release-prep/final-browser-use-20260618-parent/
```

The earlier full-closeout recapture failed before proof capture and remains
historical failure context under
`output/release-prep/full-closeout-20260618-parent/browser-use-current/`.
Cleanup/delete was later approved by the current user request and completed for
artifact-listed QA targets only.

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

That earlier run completed before the blocker manifest was added. Current
release state is different: `docs/release-blockers-2026-06-18.json` contains
unresolved `blocks_release=true` blockers, so `release:doctor` stops at release
blockers.

Historical result before accepted-risk update:

```text
STOP release blockers
```

## Current Readback and DB Proof

Current parent DB readback is saved at
`output/release-prep/final-db-readback-20260618-parent/readback.json`.

It reported `jobs=1`, `images=1`, `usage=5`, `runs=5`, `storage=1`, and
storage readback passed.

Cleanup/delete was approved by the current user request and was run only for
artifact-listed QA targets. It removed the listed QA storage objects,
`generated_images` rows, brands, and Auth users without deleting usage, audit,
or edge run proof rows. Evidence:

```text
output/release-prep/next-phase-20260618-parent2/cleanup-delete-readback.json
```

## Known Blockers

Release risk remains: signup proof and clean local DB reset proof are accepted
by the user, not fully resolved by success proof.
Earlier signup attempts hit Supabase Auth HTTP 429. The parent closeout retry
used a redacted `example.com` address and returned HTTP 400 invalid email
instead, so the current blocker is an owned test mailbox requirement rather than
a newly reproduced 429. The final parent run found no owned test mailbox key in
the local env files and did not submit signup. Browser Use submit proof for the
earlier 429 remains incomplete because the submit eval hung. Do not use
third-party real email addresses for release proof.

Local DB reset/recreate was approved and attempted. Volume recreate and stale
Supabase temp storage migration cleanup removed the previous
`optimize-existing-functions-again` Storage migration blocker, then Supabase CLI
was upgraded from 2.54.11 to 2.106.0. The final retry started Colima, used the
Colima Docker socket, completed `supabase stop --no-backup`, then ran
`supabase start`. It progressed through image pulls, including `realtime` and
`logflare`, but stalled before local services became available. It did not
reach `supabase db reset` or DB verification. Evidence is saved at:

```text
output/release-prep/final-closeout-20260618-parent/local-db/local-db-reset-recreate-summary.json
```

Final full-scope parent verification reached `verify:browser-use` on the final
`HEAD`. `release:doctor` passed release blockers, git clean, proof target,
env check, saved readback, and current readback metadata. It then stopped at
Browser Use proof because the saved env-injected home/login proof was captured
for the earlier application-code commit, not the final documentation/E2E
closeout commit.

The parent attempted to recapture final-`HEAD` Browser Use proof against the
env-injected preview on port 4178. `browser-use doctor` had passed earlier in
the run, but the recapture failed at browser startup with a
`BrowserStartEvent` timeout before state, screenshot, or eval proof could be
captured. The partial failed recapture artifact is saved at:

```text
output/release-prep/final-head-20260618-parent/browser-use-current/
```

The last passing Browser Use smoke proof remains application-code supporting
evidence, not final-`HEAD` release proof:

```text
output/release-prep/final-closeout-20260618-parent/browser-use-current/
```

Do not call the release ready until Browser Use home/login proof is recaptured
for the final release commit and `release:doctor` passes without a `STOP`.

Rollback path is recorded in `docs/rollback.md`. Use it only after a human owner
chooses rollback; normal release verification does not deploy, delete, auth,
pay, or enter personal information.

## Stop Boundary

Stop before any step that requires sending, submitting, publishing, deleting,
authentication, payment, personal information entry, deploy, or DB mutation.
