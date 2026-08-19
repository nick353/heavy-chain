# Heavy `/tools/fabric` authenticated target-scoped readback r6

- Date: 2026-08-20
- Selector: `backend=chrome_plugin`, `Profile 2`, `signed_chrome_extension_profile2`, `revision=6`
- Fresh browser-client: `-f847-469f-930f-f0182d3f3024`
- Extension: `hehggadaopoacecdllhhajmbjkdcmajg`
- Fresh `openTabs()`: PASS; target was absent and was provisioned once through the official task-owned tab path
- Created target: id `1980903747`, title `Heavy Chain | AI制作ワークスペース`, URL `https://heavy-chain.zeabur.app/tools/fabric`
- Same-run target-scoped URL/title/DOM readback: PASS
- Cleanup: `cleanup_verified=true`; only created tab `1980903747` was closed; remaining foreign tabs were unchanged

## Authenticated workspace readback

The DOM no longer showed `ログイン` or `無料で始める`. It showed the Lightchain-shaped fabric workspace with:

- `Lightchain AI` header and the four category tabs
- `生地イメージ` and the material-tool navigation
- model/design image and fabric image inputs
- upload and Gallery selection controls
- keyword and image-ratio controls
- cotton, denim, satin, and linen material variants
- input-material rights confirmation
- `AI生成` and `生成履歴`

This clears the current target-scoped authentication/workspace hydration gate for this fresh run. No upload, rights acknowledgment, provider generation, save, reuse, recording, selected/focus/claim operation, or other external effect was performed.

## Remaining gate

The fresh Profile 2 advertisement exposed `viewport` and tab-level `cdp` only; it did not expose the official `foreground_activation` or `management` capability. The fabric provider flow therefore remains blocked at the foreground operation gate with `chrome_foreground_activation_capability_unavailable` (and the separate selected-tab blocker remains untested in this target-scoped run).
