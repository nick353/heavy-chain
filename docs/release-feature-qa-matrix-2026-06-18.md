# Release Feature QA Matrix 2026-06-18

Status: **blocked**.

This file records parent-only Browser Use QA for the Heavy Chain release. It is
not release approval. Current Browser Use smoke proof for release doctor is
under `output/release-prep/browser-use-20260618-current/`; detailed operation
proof is under `output/release-prep/final-browser-use-20260618-parent/`.

## Verified Browser Flows

| Area | Result | Evidence |
| --- | --- | --- |
| Landing page | PASS: first viewport and long page rendered. | `00-home-full.png`, `00-home-state.txt` |
| Terms / privacy / legal links | PASS: dedicated terms, privacy, and legal pages render. | `terms-*`, `privacy-*`, `legal-*` |
| Protected route redirect | PASS: dashboard/generate/gallery/brand/canvas/admin redirect to login when signed out. | `route-*.json` |
| Signup validation | PASS: password mismatch is visible. | `11-signup-password-mismatch-state.txt` |
| Signup submit | BLOCKED: earlier Supabase Auth attempt returned HTTP 429; parent closeout retry returned HTTP 400 invalid email for a redacted `example.com` address. Resume with an owned test mailbox. | `22-signup-fetch-after-submit.json`, `output/release-prep/closeout-20260618-parent/signup-api-readback.json` |
| Login | PASS: service-created QA user logged in through the UI. | `31-login-after-state.txt` |
| First brand creation | PASS: brand insert migration has been applied remotely. | `35-brand-keyboard-after.json` |
| Generate / gallery | PASS: authenticated generate and gallery states/screenshots saved in the final Browser Use evidence set. | `generate-*`, `gallery-*` |
| Brand settings | PASS: brand information and owner member render. | `auth-brand-settings-eval.json` |
| Canvas `/canvas/new` | PASS: editor shell, toolbar, disabled object actions, onboarding render. | `auth-canvas-new-eval.json` |
| Gallery empty state | PASS before generation. | `auth-gallery-eval.json` |
| Admin route | PASS for non-admin boundary: redirects to dashboard. | `auth-admin-eval.json` |

## Feature Entry Matrix

All feature cards were opened by Browser Use using visible card text. Detail
screens rendered for:

- campaign image, design gacha, optimize prompt, colorize, product shots,
  remove background, model matrix, chat edit, scene coordinate, multilingual
  banner, upscale, and variations.
- Evidence files: `feature2-*-state.txt`, `feature2-*-eval.json`,
  `feature2-*.png`.

Known observation: the automated label extraction for `variations` collided with
the colorize text in one summary pass, so keep `feature2-variations-*` as
supporting navigation evidence only. Focused variations proof is now recorded
under `output/release-prep/focused-generation-20260618-parent/postfix-auth/`.

## Real Generation Proof

| Feature | Result | Proof |
| --- | --- | --- |
| optimize-prompt | PASS: Edge Function succeeded and usage was recorded. | final Browser Use evidence plus DB readback |
| campaign-image / generate-image | PASS: generated 1 image, rendered it, saved DB job/image rows, and storage readback passed. | final Browser Use evidence plus `output/release-prep/final-db-readback-20260618-parent/readback.json` |
| gallery readback | PASS: generated image appears in gallery state/screenshot and DB readback confirms 1 generated image. | `gallery-*`, readback JSON |
| remove-background | PASS: deployed Edge Function path passed image visual QA. | `image-visual-qa-summary.json`, `latest-feature-image-summary.json` |
| colorize | PASS: deployed Edge Function path passed image visual QA. | `image-visual-qa-summary.json`, `latest-feature-image-summary.json` |
| upscale-fixed | PASS: deployed Edge Function path passed image visual QA. | `image-visual-qa-summary.json`, `latest-feature-image-summary.json` |
| design-gacha | PASS: deployed Edge Function path passed image visual QA. | `image-visual-qa-summary.json`, `latest-feature-image-summary.json` |
| product-shots | PASS: deployed Edge Function path passed image visual QA. | `image-visual-qa-summary.json`, `latest-feature-image-summary.json` |
| model-matrix | PASS: deployed Edge Function path passed image visual QA. | `image-visual-qa-summary.json`, `latest-feature-image-summary.json` |
| multilingual-banner | FAIL: initial PNG had garbled/duplicated text; first SVG fix clipped text. | `image-visual-qa-summary.json`, `latest-feature-image-summary.json` |
| multilingual-banner-fixed2 | PASS: Browser Use regenerated fixed2 SVGs; visual QA passed for `qlthumbs2/multilingual-banner-fixed2-ja.svg.png` and `qlthumbs2/multilingual-banner-fixed2-en.svg.png`. | `image-visual-qa-summary.json`, `latest-feature-image-summary.json` |
| scene-coordinate | PASS: after user-approved Browser Use login with the existing QA user, `/generate` produced 3 scene-coordinate images for cafe, street, and office scenes; DB/storage readback reports `scene_coordinate=3`, `images=4`, `runs=2`, storage download ok, and `verdict=pass`. | `output/release-prep/focused-generation-20260618-parent/postfix-auth/12-scene-after.png`, `12-scene-after-state.txt`, `focused-feature-type-readback.json`, `focused-visual-qa-summary.json` |
| variations | PASS: after the same authenticated Browser Use run, `/generate` produced 1 variation; DB/storage readback reports `variations=1`, `images=4`, `runs=2`, storage download ok, and `verdict=pass`. | `output/release-prep/focused-generation-20260618-parent/postfix-auth/23-variations-after.png`, `23-variations-after-state.txt`, `focused-feature-type-readback.json`, `focused-visual-qa-summary.json` |

DB readback for this pass is saved at
`output/release-prep/final-db-readback-20260618-parent/readback.json` and
reported `jobs=1`, `images=1`, `usage=5`, `runs=5`, `storage=1`, and storage
readback passed.

Focused authenticated feature-type readback is saved at
`output/release-prep/focused-generation-20260618-parent/postfix-auth/focused-feature-type-readback.json`
and reported `images=4`, `scene_coordinate=3`, `variations=1`, `runs=2`,
storage download ok, and `verdict=pass`. Focused visual QA is saved at
`output/release-prep/focused-generation-20260618-parent/postfix-auth/focused-visual-qa-summary.json`
and reported `verdict=pass`.

## Parent Verification Commands

Passed in the parent process:

```bash
npm run e2e
npm run typecheck
npm run build
npm run verify
SUPABASE_VERIFY_MODE=static bash scripts/supabase-prod-verify.sh
```

`npm run e2e` reported 6 passed.

## Fixed In This Pass

- Added static routes for `/terms`, `/privacy`, and `/legal`.
- Added `supabase/migrations/20260618023000_restore_brand_insert_policy.sql`
  so new users can create their first brand with `owner_id = auth.uid()`.
- Applied the brand insert migration remotely.
- Deployed updated Edge Functions.
- Added a static verification guard for the brand insert policy.
- Updated the secret static guard so local `.env*` files are not treated as
  committed leakage.
- Added visible result-panel output for prompt optimization.
- Added a persistent result-panel error state for generation failures.
- Replaced deprecated Gemini 2.0 Edge Function model IDs with shared
  configurable defaults: `GEMINI_IMAGE_MODEL` defaults to
  `gemini-2.5-flash-image`, `GEMINI_ANALYSIS_MODEL` defaults to
  `gemini-2.5-flash`, and `generate-image` fallback uses `gemini-3-pro-image`.
- Added static guards so `npm run smoke:edge` and
  `SUPABASE_VERIFY_MODE=static bash scripts/supabase-prod-verify.sh` fail if
  the removed Gemini 2.0 model IDs reappear.
- Fixed `generate-variations` metadata writes: the Edge Function now prefers
  `body.featureType` for `scene-coordinate` and `variations`, falls back from
  `scenes` when omitted, and saves both `generated_images.feature_type` and
  `generation_params.featureType` for scene and variation inserts.
- Updated `GeneratePage` to pass `featureType` explicitly for `variations` and
  `scene-coordinate`.
- Deployed the fixed `generate-variations` Edge Function remotely.
- Captured focused authenticated Browser Use proof for `scene-coordinate` and
  `variations` after user-approved login with the existing QA user.

## Remaining Blockers

- Signup proof is blocked until an owned test mailbox is available. Earlier
  attempts hit Supabase Auth HTTP 429; the parent closeout retry returned HTTP
  400 invalid email for a redacted `example.com` address.
- Cleanup/delete was later approved by the current user request and completed
  for artifact-listed QA targets only.
- Local DB reset/recreate was approved and attempted. Volume recreate and stale
  Supabase temp storage migration cleanup removed the previous
  `optimize-existing-functions-again` blocker, then Supabase CLI was upgraded
  from 2.54.11 to 2.106.0. The final retry did not reach `supabase db reset` or
  DB verification because image pull/extract exited 143 before completion.

Browser Use smoke metadata verification passed for the pre-closeout parent
`HEAD`. After this docs-only closeout update, `release:doctor` stops at release
blockers before Browser Use proof is evaluated. Cleanup/no residual process
state was confirmed after the parent run. `release:doctor` now stops at the
release blocker manifest.

Historical note: existing DB scene rows predate the feature-type fix and still
have `feature_type=null`.
