# Heavy Chain Cloudflare readback and Zeabur boundary — 2026-09-20 r50

## Result

The current Cloudflare Web deployment remains live at
`https://heavy-chain-web.nichika2000823.workers.dev` with version
`603551a8-c9b6-4df8-92b9-d299ed33463f`. Fresh public readback returned HTTP
200 for `/_health` with `hosting=cloudflare` and `authProvider=cloudflare`.
The Heavy API returned HTTP 200 for `/v1/health` with
`service=heavy-api` and `media=private-r2`.

The authenticated Cloudflare browser tab remained logged in while opening
the Heavy routes. The `/marketing` route, after a real 30-second wait, showed
the Lightchain workspace shell with one header, zero checkbox controls, and
no rights-related text. The video detail flow was also checked with a
Heavy-owned `fitting-v1.png` input: the upload succeeded, while the visible
generation control remained disabled as
`動画生成（provider未接続）`; the page explicitly stated that video
provider admission was not confirmed. No provider request was submitted.

## API boundary readback

Unauthenticated requests to the deployed API were not treated as business
completion. The following fresh readbacks were fail-closed as expected:

- `GET /v1/image-ai/requests/unknown` → HTTP 401 `unauthorized`.
- `GET /v1/image-ai/usage` without a brand → HTTP 400 `invalid_brand_id`.
- `GET /v1/generated-images` without a brand → HTTP 400 `invalid_brand_id`.
- `GET /v1/workspace-execution-steps` without an execution scope → HTTP 400
  `invalid_execution_scope`.

The local goal-readiness audit passed its five static Cloudflare checks, but
explicitly cannot prove authenticated production generation, AI quality,
private R2 persistence, or browser business completion.

## Zeabur permission boundary

The official CLI resolved the personal workspace, project
`automation-wiled`, and service `heavy-chain`. A fresh environment-variable
read/write path is still unavailable: the prior official variable creation
attempt and value-free readback returned server-side `FORBIDDEN permission
denied`, and the target deploy path returned the same error. The shell has no
`HEAVY_CHAIN_MONITOR_TOKEN` or provider credential. No secret was guessed,
printed, or sent to a chat/agent, and the denied mutation was not replayed.

## Remaining exact blockers

1. Grant the authenticated Zeabur account environment-variable and deploy
   permission, then add the real approved monitor/provider credential through
   the approved secret path and read it back without exposing its value.
2. Obtain same-run authenticated production monitor/UI evidence and complete
   the provider receipt → private-storage readback → reuse/reload → source
   sync/reconciliation chain.
3. Refresh production mass-market QA, all Lightchain feature order previews,
   launch operations, G608/G618/G633, and production H602 evidence.
4. Rerun the unified release gate without `--allow-dirty` or
   `--skip-commands`; only then can the Goal be closed.

The Goal remains active. The Cloudflare deployment/readback is current, but
these external production and release proofs are not yet complete.
