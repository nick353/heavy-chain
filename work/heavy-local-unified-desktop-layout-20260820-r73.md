# Heavy Chain local unified desktop layout QA r73

## result

The local desktop verifier now treats only classified harness noise as expected and fails closed on unexpected browser diagnostics. The full current non-video desktop matrix passed.

## changed

- `scripts/verify-unified-desktop-layout.mjs`
  - Added local-proof Supabase REST/auth route mocks, matching the all-feature verifier.
  - Added raw-versus-expected/unexpected diagnostic counters.
  - Layout cells and the run summary now require zero unexpected console, page, and request failures.
  - Classified the local preview network boundary's `ERR_BLOCKED_BY_CLIENT`, Google Fonts, 401, and documented local fallback messages as expected harness diagnostics.

## verification

- `npm run verify:unified-desktop-layout`: `ok=true`
- 31 features, 57 targets, 4 viewports, 228/228 cells, `failed=0`
- Diagnostics: console errors `228` raw / `228` expected / `0` unexpected; request failures `242` raw / `242` expected / `0` unexpected; page errors `0`
- Cleanup: browser/context/preview closed, leftovers `0`
- Local preview Chromium timing: navigation p50 `221ms`, p95 `604ms`; settle p50 `967ms`, p95 `1960ms`
- `node --check scripts/verify-unified-desktop-layout.mjs`: pass
- `git diff --check`: pass

## boundary

This is local preview Chromium evidence only. It does not prove production provider generation, output quality, persistence/reuse, current Lightchain production card parity, or paired Mac/Windows acceptance.

## next action

Keep production provider work fail-closed until the official Chrome Plugin/Profile 2 advertises `foreground_activation` or `management`; continue the remaining local parity and beta-gate work independently.
