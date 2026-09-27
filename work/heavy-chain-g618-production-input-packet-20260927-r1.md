# G618 / production monitor restart packet

Captured from `scripts/verify-g618-scale-ops-baseline.mjs` and the current release-gate summary at HEAD `6c90c0d`. This packet contains names and acceptance conditions only; it intentionally contains no token, cookie, brand ID, or secret value.

## Required non-secret inputs

- `HEAVY_CHAIN_MONITOR_API_URL` or `--apiBaseUrl`: explicit HTTPS Cloudflare API origin.
- `HEAVY_CHAIN_MONITOR_BRAND_ID` or `--brandId`: valid brand UUID matching the selected operator scope.
- `HEAVY_CHAIN_MONITOR_TOKEN`: live read-only session token; never write it to repository artifacts or logs.
- Baseline defaults unless an approved change is recorded: `windowHours >= 96`, `maxFailureRate = 0`, `minStorageImages >= 4`, `imageCount >= 1200`, `canvasObjectCount >= 600`, `maxReadyMs <= 5000`.

## G618 command contract

`npm run verify:g618-scale-ops -- --apiBaseUrl <HTTPS_ORIGIN> --brandId <UUID> --windowHours 96 --maxFailureRate 0 --minStorageImages 4 --imageCount 1200 --canvasObjectCount 600`

The verifier must produce `output/playwright/10m-product-readiness-g618/summary.json` with schema `heavy-chain.g618.scale-ops-baseline.v2`, explicit monitor expectations, successful build/performance/monitor steps, no blockers or unresolved warnings, and nested `heavy-chain.production-monitor.v2` evidence.

## Production monitor/UI pair

The strict gate separately requires:

- `output/playwright/g835-production-monitor-current-r1/summary.json`
- `output/playwright/g835-production-ui-current-r1/summary.json`

Both must share a nonempty `runId`, match the exact origin and brand scope, have zero failures/warnings, and include cleanup. The monitor must be API-only authenticated readback; the UI artifact must be a fresh authenticated production UI v2 readback. Existing Companion evidence is not a substitute for this pair.

## Hard boundaries

- Read-only monitor and scale verification only.
- No provider submit, purchase, checkout, publication, deploy, destructive cleanup, or secret display.
- If any response or effect is uncertain, reconcile the same run/target before considering a retry.
