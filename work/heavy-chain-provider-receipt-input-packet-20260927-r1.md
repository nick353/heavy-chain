# Heavy provider receipt / durable readback restart packet

Captured from `scripts/hc-10m-real-generation-qa.mjs` and `scripts/collect-workspace-live-readback.mjs` at HEAD `0f6e074`. Names and acceptance conditions only; no credential or identifier value is included.

## Readback-first contract

- Required: HTTPS `apiBaseUrl`, valid `brandId`, live `HEAVY_CHAIN_MONITOR_TOKEN`, UUID `requestId`.
- Default mode is `readback`; `submit` is an explicit external effect and is not run automatically.
- Before any submit, the same request endpoint must be read and confirmed `404 image_request_not_found`.
- A durable exclusive attempt journal must be created and read back before the POST. If it already exists, do not replay.
- Submit action must be one of `generate-image`, `edit-image`, `model-matrix`; payload brand must match and `rightsConfirmed:true` is required.

## Receipt acceptance

The same run must read back:

1. `/v1/profile` with a valid authenticated user.
2. `/v1/image-ai/requests/<requestId>` with matching request ID, `jobId=ai-<requestId>`, provider `workers_ai`, backend `cloudflare-workers-ai`, and a known state.
3. `/v1/generation-jobs/<jobId>` with matching user and brand scope.
4. Completed receipt with requested/persisted candidate counts equal, 1–4 candidates, unique image IDs and candidate indices.
5. Workspace execution steps for every candidate and required phase.
6. Canonical generated-image rows with matching user/brand/job scope, final storage path, checksum, byte count, and readable signed media.

`persistedResultVerified=true` requires complete execution steps, matching final links/images, and every storage item `readable=true` plus `checksumVerified=true`. Visual quality remains a separate human-reviewed scorecard; receipt success is not business completion.

## Read-only collector

`collect-workspace-live-readback.mjs` requires the same HTTPS origin, brand, comma-separated job IDs, `since` timestamp, and live token. It never infers jobs from old metadata, never repairs or deletes, and fails closed on scope/checksum mismatch.

## Hard boundaries

- No credential extraction or token logging.
- No automatic polling, replay, retry after uncertain effect, billing, publication, cleanup, or deploy.
- If an existing request is found, switch to readback-only and reconcile the same request/job/image IDs.
