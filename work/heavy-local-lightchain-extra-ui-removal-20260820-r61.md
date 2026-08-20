# Heavy local Lightchain extra UI removal r61 — 2026-08-20

## Change

- Removed the Heavy-only `printing-readiness-summary`, readiness count, and next-action panel from `LightchainMaterialWorkbenchPage` entirely.
- Kept `printingReadinessSteps` and `printingReadinessCompleteCount` as internal state used by the shared flow state and `data-ready` contract.
- Generation guards, garment mask confirmation, placement confirmation, rights confirmation, persistence, result history, and reuse logic were not removed.

## Verification

- Printing composition interaction contract: `51/51 PASS`
- Lightchain material contract: `17/17 PASS`
- Typecheck: PASS
- Zero-warning lint: PASS
- Production build: PASS, `2607 modules transformed`
- Unified desktop layout: `228/228`, failed `0`, global timeout `false`, cleanup leftovers `0`
- `git diff --check`: PASS

## Deployment boundary

This source change is local until its new source-associated deployment reaches `RUNNING` and a fresh official Profile 2 target-scoped DOM readback confirms the rendered `/tools/printing` surface. The prior target readback timed out at `Runtime.evaluate`; it is not reused as current visual proof.

## Remaining blockers

- `chrome_extension_target_readback_timeout`: fresh DOM visual confirmation remains `PENDING_CONFIRMATION`.
- `chrome_foreground_capability_unavailable`: provider generation/save/reuse/reload remains fail-closed.
