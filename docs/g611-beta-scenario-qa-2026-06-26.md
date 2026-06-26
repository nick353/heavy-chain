# G611 Beta User Scenario QA

Date: 2026-06-26

## Result

Accepted locally/prod-read. The rerun proof passed:

- Summary: `output/playwright/10m-product-readiness-g611-beta-scenarios-20260626-rerun4/SUMMARY.json`
- Status: `ok=true`, `failed=[]`
- Coverage: 17 desktop routes, 8 mobile routes, 25 videos, 70 proof files
- Safety: generation submit, purchase/payment/checkout, external publish, and destructive delete were not performed
- Cleanup: `contextClosed=true`, `browserClosed=true`, `serverRowsCreated=false`

## Beta Scenarios

1. Apparel EC operator: Dashboard -> Generate campaign -> upload product/reference image -> confirm Runway worker button is ready without submitting.
2. SNS/marketing operator: Marketing workspace -> upload image -> confirm marketing workspace remains usable and upload is reflected.
3. Designer / apparel planner: Lightchain-style hub, Studio, Patterns, Lab, and design-oriented workspaces render with upload handling and no layout/runtime blockers.
4. AI fitting user: Fitting, Models, and mobile fitting routes load and accept reference image upload without submitting generation.
5. Re-edit/export user: Gallery detail -> Canvas -> Gallery selector -> Canvas upload path, with screenshots and videos.
6. Operations/recovery user: Jobs failed-toggle, History, Credits/Usage, Brand Settings, Dashboard and mobile core routes.

## Initial Issues Found

- `credits:expected_text_visible`: verifier expected old text `クレジット`, while current product UI is `利用状況`.
- `mobile-lightchain`, `mobile-marketing`, `mobile-fitting`: production asset 404 during the first run, likely while Zeabur was serving stale asset references immediately after deploy.
- `cleanup:browser_close_timeout`: first failed run left browser close as failed due the same route/load interruption.
- `upload_reflected_in_ui`: the upload proof was too weak because generic page text such as `画像` or `商品` could pass without proving upload reflection. A stricter rerun then correctly found Canvas reflection is stored in Konva/localStorage, not DOM `<img>`, and Brand Settings logo upload would write external Storage.

## Fixes / Actions

- Updated `scripts/verify-mass-market-qa.mjs` credits route expectation from `クレジット` to `利用状況`.
- Strengthened upload reflection to require selected file plus upload-specific text, preview image increase, or Canvas object-count increase.
- Added `upload_input_visible` as a hard assertion so upload-capable routes fail if the image input disappears.
- Kept Brand Settings in the scenario as a safe read/navigation check, but removed logo upload from this gate to avoid changing external brand assets.
- Reran the full production recorded QA after the asset state settled.

## Rerun Evidence

The rerun verified:

- Desktop: `dashboard`, `lightchain`, `generate-home`, `generate-campaign`, `marketing`, `fitting`, `studio`, `models`, `patterns`, `video`, `lab`, `jobs`, `history`, `gallery`, `canvas`, `brand-settings`, `credits`
- Mobile: `dashboard`, `generate-campaign`, `lightchain`, `marketing`, `fitting`, `jobs`, `gallery`, `canvas`
- Console/page/request failures: `0`
- Videos: `output/playwright/10m-product-readiness-g611-beta-scenarios-20260626-rerun4/videos/`

## Open Risks

- This is production UI/readiness QA, not fresh paid/billing QA.
- Generation submit remains intentionally stopped before irreversible/credit-consuming actions in this scenario gate; real generated-output quality is covered by G601/G613 and final G615 regression.
