# Video provider / durable media restart packet

Captured from the current Video Workstation and provider contract at HEAD `2ab3355`. No credential, provider key, or external identifier is included.

## Current fail-closed contract

`resolveVideoProviderGate` admits the video route only when all three are true in the same run:

1. `sourcePermissionConfirmed`
2. `serverCredentialConfigured`
3. `sameRunReceiptReadbackConfirmed`

Until then, the route remains `unsupported` with `video_provider_not_admitted`; it must not fall back to image generation or display the Light plan-lock message.

## Provider admission input

- Provider: one of `runway`, `veo`, `luma`, `kling`.
- Source: explicit `sourceAssetRef` plus source permission confirmation.
- Server: provider credential configured server-side; no browser secret.
- Input: non-empty prompt, duration `5秒|10秒|15秒`, resolution `720P|1080P`, and a stable idempotency key.
- Provider receipt: same-run request/job/media receipt and durable readback must be captured before route promotion.

## Durable workspace boundary

Video source-editor saves go through `saveWorkspaceArtifactBestEffort` / `persistVideoEditorBestEffort`. When Cloudflare is enabled, local persistence alone is not success; a remote request-id/readback receipt is required. Canvas handoff is allowed only after that persistence result is successful. Existing local fallback remains explicitly local and `providerRoute: unsupported`.

## Acceptance for future implementation

- Add a provider adapter only after server credential admission and source rights are independently proven.
- Preserve the current source-editor and storyboard data (`videoProjectCode`, duration, resolution, storyboard, material reference, generation intent).
- Use one request id/idempotency key; no replay after uncertain effect.
- Verify provider job, final media object, signed access, checksum/bytes, owner/brand scope, and remote reconciliation in the same run.
- Persist the result into the existing video workspace/Canvas lineage without converting local-only drafts into remote-verified artifacts.
- Keep UI/provider gate fail-closed until the complete receipt chain is read back.

## Hard boundaries

No provider call, credential extraction, billing, publication, deletion, cleanup outside marker scope, or deploy is authorized by this packet.
