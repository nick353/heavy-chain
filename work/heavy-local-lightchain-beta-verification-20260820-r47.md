# Heavy Chain local Lightchain parity / beta verification r47

Date: 2026-08-20

## result

- Local Heavy source verification passed for all 31 non-video feature workflows.
- Unified desktop layout verification passed for all 228 scheduled cells across 1280, 1440, 1920, and 2560px viewports.
- The r46 direct fabric input change is covered by the full local verification run.

## changed

- No new source change in this verification record. The verified source change is r46: the direct `/tools/fabric` model/design input no longer exposes the Heavy-only `ベース画像`／`パターン参考` reference-type toggle, matching the fresh Lightchain direct-route surface while retaining the internal beta workflow contracts.

## verification

- `output/playwright/lightchain-all-feature-workflows-post-r46-20260820/SUMMARY.json`: `ok=true`, `featureCount=31`, `failed=[]`.
- `output/playwright/unified-desktop-layout-post-r46-20260820/SUMMARY.json`: `ok=true`, `scheduled=228`, `completed=228`, `failed=0`, `globalTimedOut=false`, `contextClosed=true`, `previewExited=true`, `cleanupLeftovers=0`.
- `node --experimental-strip-types --test scripts/verify-lightchain-material-contract.test.ts`: 15/15 PASS (r46).
- `npm run typecheck --silent`: PASS (r46).
- `git diff --check`: PASS (r46).
- Fresh Lightchain/Heavy target-scoped readback r45 and fresh Profile 2 capability readback r44 remain the current live evidence. The signed extension advertised `viewport` and tab-level `pageAssets`/`cdp`; `foreground_activation` and `management` were absent.

## remaining blocker

- `chrome_foreground_activation_capability_unavailable`: production provider generation and effectful save/reuse/reload cannot be claimed or started through the official lane until the signed Chrome distribution advertises the required capability.
- Production post-deploy readback for the r46 local UI change is `PENDING_CONFIRMATION` because no deploy was performed in this verification.
- Real Mac/Windows Chrome acceptance and internal beta sessions remain `PENDING_CONFIRMATION`; local preview verification is not a substitute.
- The unowned `about:blank` tab from r45 remains untouched; its cleanup ownership is `PENDING_CONFIRMATION`.

## next action / restart point

- After an official capability advertisement or an explicitly authorized deployment/readback state change, create a fresh Profile 2 browser-client and re-check capability, Heavy `/tools/fabric`, and the production same-run fabric-print flow. Do not reuse r44/r45 binding, tab, run, or the unowned blank tab.
- First effectful proof: one approved library asset through generation → result → save → Gallery/Canvas/History/Jobs → reuse → reload. Then run the same contract for AI fitting.
