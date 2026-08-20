# Heavy local current-route parity fix r99

更新日: 2026-08-20

## Changed

- Updated the launcher catalog's `custom-style` route from the legacy
  `/brand/settings` destination to the current Lightchain route
  `/model-base/style` confirmed by the fresh rev6 source ledger.
- Added the same route to the compact parity hub icon map.
- Added a regression asserting that the launcher card does not regress to
  `/brand/settings`.

## Verification

- `npm run test:lightchain-parity-routes`: PASS, 9/9
- `npm run typecheck --silent`: PASS
- `git diff --check`: PASS

## Proof boundary

This fixes and verifies one local launcher-route parity mismatch. It does not
prove provider generation, save/reuse/reload, Gallery/Canvas/History/Jobs
lineage, or production/cross-OS acceptance.
