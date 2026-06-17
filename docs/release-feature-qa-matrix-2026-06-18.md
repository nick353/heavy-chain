# Release Feature QA Matrix 2026-06-18

Status: **not release-ready**.

This file records parent-only Browser Use QA for the Heavy Chain release. It is
not release approval. Browser proof is under
`output/release-prep/final-browser-use-20260618-parent/`.

## Verified Browser Flows

| Area | Result | Evidence |
| --- | --- | --- |
| Landing page | PASS: first viewport and long page rendered. | `00-home-full.png`, `00-home-state.txt` |
| Terms / privacy / legal links | PASS: dedicated terms, privacy, and legal pages render. | `terms-*`, `privacy-*`, `legal-*` |
| Protected route redirect | PASS: dashboard/generate/gallery/brand/canvas/admin redirect to login when signed out. | `route-*.json` |
| Signup validation | PASS: password mismatch is visible. | `11-signup-password-mismatch-state.txt` |
| Signup submit | BLOCKED: Supabase Auth returned HTTP 429; no auth user was created. | `22-signup-fetch-after-submit.json` |
| Login | PASS: service-created QA user logged in through the UI. | `31-login-after-state.txt` |
| First brand creation | FIXED IN MIGRATION, BLOCKED ON REMOTE: current remote DB rejects brand insert with RLS 403 until the new migration is applied. | `35-brand-keyboard-after.json` |
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
supporting evidence only until a focused variations run is captured.

## Real Generation Proof

| Feature | Result | Proof |
| --- | --- | --- |
| optimize-prompt | PASS: Edge Function succeeded and usage was recorded. | final Browser Use evidence plus DB readback |
| campaign-image / generate-image | PASS: generated 1 image, rendered it, saved DB job/image rows, and storage signed URL readback passed. | final Browser Use evidence plus `output/release-prep/final-db-readback-20260618-parent/readback.json` |
| gallery readback | PASS: generated image appears in gallery state/screenshot and DB readback confirms 1 generated image. | `gallery-*`, readback JSON |
| remove-background | CODE FIXED, REMOTE RETEST BLOCKED: upload/function path reached a failed result and the UI showed the error state. Code now uses current configurable Gemini model IDs instead of the removed 2.0 image model, but the fix still needs Edge Function deploy and real Browser Use retest. | `output/release-prep/full-ui-qa-20260618-parent/102-remove-bg-fixed-after-*`, DB readback, and code guard in `npm run smoke:edge` |

DB readback for this pass is saved at
`output/release-prep/final-db-readback-20260618-parent/readback.json` and
reported `jobs=1`, `images=1`, `usage=5`, `runs=5`, `storage=1`, and
`signedUrlAllOk=true`.

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

## Remaining Blockers

- Apply the new brand insert policy migration to staging/prod; current remote DB
  still returns RLS 403 for first brand creation.
- Deploy updated Edge Functions to staging, then rerun focused Browser Use
  generation proof for `remove-background` and the other Gemini image-editing
  features. Deployment was not run in this pass.
- Signup is blocked by Supabase Auth HTTP 429 in this test lane.
- Focused real-generation runs are still needed for the remaining image/text
  features beyond optimize-prompt, campaign-image, and remove-background.
- Cleanup/delete was not run because it was not approved in this pass.
