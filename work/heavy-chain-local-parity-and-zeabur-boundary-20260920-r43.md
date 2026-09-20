# Heavy Chain local parity completion and Zeabur boundary — 2026-09-20 r43

## Result

The local Heavy Chain parity implementation and verifier suite are green. The
canonical `/lightchain` route now opens the Lightchain-shaped launcher inside
the shared workspace shell. The launcher keeps Heavy-owned category artwork,
hydrates saved artifacts through canonical storage paths and signed readback,
and scopes saved cards to the selected case tab. Creator category artwork uses
local product-owned icons; no remote static fixture URL is injected by the
launcher or Creator parity surface.

The Light-missing rights checkbox/modal/badge remains absent. Canvas passes
`rightsConfirmed: false` to provider actions, while source-admitted generation
keeps the request-local rights gate fail-closed. The normal process-group
diagnostic fixture now gives its descendant a reliable scheduling window under
the full verifier load; production process cleanup code was not weakened.

## Verification

- `node --experimental-strip-types --test scripts/verify-*.test.ts scripts/verify-*.test.mjs`
  passed `1165/1165`, `fail=0`.
- `npm run typecheck` passed.
- `git diff --check` passed.
- `npm run verify:release-gate -- --skip-commands --allow-dirty` remained
  `ok:false`; the remaining failures are production monitor/UI, launch,
  current mass-market QA, production Lightchain all-feature previews, G608,
  G618, G633, production H602, and the intentional dirty/commands-skipped
  release blockers.
- Focused launcher, no-static-fixture, material, Canvas, fitting, marketing,
  route, unified-shell, and process-group tests passed.

## Zeabur and token boundary

- `zeabur auth status`: logged in as `nichika2000823` / `nichika2000823@gmail.com`.
- Target project/service/environment were resolved as
  `automation-wiled` / `heavy-chain` / environment
  `69df8155a5ae0a69725e92048`.
- `zeabur variable list` returned server-side `FORBIDDEN permission denied`.
- `zeabur deploy` returned server-side `FORBIDDEN permission denied` for the
  target environment.
- `HEAVY_CHAIN_MONITOR_TOKEN`, `CLOUDFLARE_API_TOKEN`, and
  `SUPABASE_SERVICE_ROLE_KEY` are not present in the current shell.
- No token was extracted, guessed, copied, printed, or replaced with an empty
  or placeholder value. No production deployment was claimed from the local
  green suite.

## Remaining blocker and exact re-entry

The remaining external blocker is Zeabur environment permission plus the real
Heavy monitor/provider credential. An account with environment variable and
deployment access must grant the current CLI account access, or add the actual
secret through the approved secret-management path. Then rerun variable
readback, deploy, authenticated production UI/readback, provider receipt and
reconciliation checks, and the unified release gate. The formal Goal remains
active because the current production and strict release evidence is not yet
complete.

## Follow-up verification after r43

- `npm run build`, `npm run lint`, `npm run typecheck`, and `git diff --check`
  passed after the final local toolbar parity change.
- The focused Lightchain routing, launcher, no-static-fixture, and unified-shell
  checks passed `50/50` after that change.
- Read-only production probes still return HTTP `200` for `/` and `/_health`,
  but the live bundle (`index.D3l-ZRq8.js`, SHA-256
  `1743e474165804adc44f06e0775725fa71b744d81263a443a8daf6ee470bcf25`) still
  contains the pre-change `/lightchain` source-not-found surface and rights
  confirmation copy. The current local build is therefore not deployed.
- No additional deploy or secret mutation was retried after the same
  server-side permission denial; the exact re-entry remains the same.

## Fresh Zeabur Dashboard/API boundary audit — 2026-09-20 r45

- The authenticated Zeabur Dashboard can read the personal project
  `automation-wiled`, service `heavy-chain`, environment
  `69df8155a5ae0a69725e92048`, and domain `heavy-chain.zeabur.app`.
- The current service deployment is `6aafa221342483d22ad87e0b`, status
  running, branch `main`, with no commit shown by the Dashboard. Runtime logs
  only show the existing `heavy-chain-zeabur-server` listening on port 8080.
- Dashboard variable-name readback shows only user variables
  `VITE_CLOUDFLARE_API_BASE_URL` and `VITE_CLOUDFLARE_API_ENABLED`, plus the
  13 platform-generated variables. Neither `HEAVY_CHAIN_MONITOR_TOKEN` nor a
  provider credential exists there.
- The installed CLI `0.21.0` and the fresh `0.22.2` CLI both return
  server-side `FORBIDDEN permission denied` for service listing, service get,
  and service-variable listing, even though the same account can view the
  service in the Dashboard. No Dashboard edit, deploy, restart, variable
  change, or credential transmission was performed.

## Local runtime parity follow-up — 2026-09-20 r46

- The protected `/lightchain` loading surface had a duplicate header because
  the Layout header and the embedded recovery fallback both rendered. The
  fallback now accepts `showHeader` and ProtectedRoute passes `false`, leaving
  the parent Lightchain header as the single source of chrome.
- Browser plugin was not available, so the frontend-testing fallback used
  Playwright against the local Vite preview. Desktop (`1440x900`) and mobile
  (`390x844`) both returned HTTP `200`, rendered one header and one loading
  shell, showed zero checkbox controls, and reported zero console/page errors.
- The local runtime had no authenticated session, so it correctly remained at
  the login recovery shell. No session, cookie, token, provider request, or
  external action was injected.
- After this change the complete verifier suite passed `1165/1165`; focused
  hydration/launcher/routing checks passed `40/40`; build, lint, typecheck, and
  `git diff --check` passed.

## Fresh release-gate audit — 2026-09-20 r47

- `npm run verify:release-gate -- --skip-commands --allow-dirty` remains
  `ok:false`. The fresh failures are the production monitor/UI pair, launch
  operations, current mass-market QA, production Lightchain all-feature order
  previews, G608, G618, G633, production H602, and the explicit dirty/commands
  skipped release blockers.
- The Light source readback artifact records `/video` and `/lightchain` as
  source 404s. Heavy's accepted video scope remains the canonical
  `/flow/GenerateShortVideo` dashboard/detail pair, covered by the four-route
  local video contract; no legacy `/video` fallback was promoted.
- No production receipt, provider generation, credential, or deployment claim
  was inferred from the green local suite.

## Source push and fresh token-permission audit — 2026-09-20 r48

- The reviewed tracked parity slice was committed as `0952aa5` and pushed to
  `origin/main`. The public Zeabur service still serves the pre-change bundle
  `assets/index.D3l-ZRq8.js` after the initial wait, so the push is not a
  deployment receipt.
- The authenticated Cloudflare Heavy session was confirmed after a real
  30-second wait. Its session cookie was handled without printing the value.
- One official `zeabur variable create` attempt targeted
  `heavy-chain` / environment `69df8155a5ae0a69725e92048`; fresh value-free
  variable readback still returns server-side `FORBIDDEN permission denied`.
  No successful token assignment is claimed, no placeholder was used, and no
  secret was sent to a Zeabur Agent chat.
- The Goal remains active. Re-entry requires Zeabur variable/deploy permission,
  deployment receipt/readback, authenticated provider/result/save/reuse proof,
  reconciliation, operations evidence, and the strict release gate.
