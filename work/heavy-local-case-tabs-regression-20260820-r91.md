# Heavy local case-tabs regression r91

更新日: 2026-08-20

## Verification

- `npm run test:lightchain-parity-routes`: 8/8 PASS
- Route regression repair: the test now checks the current catalog/App route
  contract instead of a removed entry-local icon map.
- `npm run verify:unified-desktop-layout`: scheduled `228`, completed `228`,
  failed `0`, `globalTimedOut=false`
- Summary: `output/playwright/unified-desktop-layout-current/SUMMARY.json`
- Covered widths: `1280`, `1440`, `1920`, `2560px`
- Cleanup: preview/context closed with no reported layout-run failures

## Proof boundary

This is local route/layout regression evidence. It does not prove production
provider generation, persistence/reuse/reload, real Mac/Windows acceptance, or
internal beta acceptance.
