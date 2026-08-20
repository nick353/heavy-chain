# Chrome Plugin / Profile 2 capability and Heavy target-scoped readback r38

- checked_at: `2026-08-20T13:26:14+09:00`
- backend: `chrome_plugin`
- profile: `Profile 2`
- surface: `signed_chrome_extension_profile2`
- selector revision: `30`
- browser_id: `-ea09-4a6a-8511-f17d9b09a499`
- extension_instance_id: `f48b15fe-59a8-4443-8369-44b169a4da68`
- browser-client session/thread: `01a01576-c224-7d81-902f-561719dc45a5`
- turn: `01a01d68-506f-71a1-8cb2-3de90231c76e`

## Fresh advertisement and transport

- Fresh official `browsers.list()` → exact Chrome extension/Profile 2 `get()` → documentation → named session → `openTabs()` handshake succeeded.
- Advertised browser capability: `viewport` only.
- Advertised tab capabilities: `pageAssets`, `cdp`.
- `foreground_activation`: not advertised.
- `management`: not advertised.
- Initial `openTabs()` inventory: 6 unrelated tabs; Heavy `/tools/fabric` was absent.
- Owner lineage matched the current session/thread/turn.

## Heavy target-scoped readback

- Official allowlisted provisioning created task-owned Heavy `/tools/fabric` tab `1980904126`.
- Same-run URL: `https://heavy-chain.zeabur.app/tools/fabric`.
- Same-run title: `Heavy Chain | AI制作ワークスペース`.
- Same-run DOM readback: PASS; the current page exposed the Lightchain shell and `ログイン状態を確認しています` / `ログイン後にLightchainの制作ワークスペースへ進めます。` with a `ログイン` link. Fabric workbench assets were not yet visible in this readback.
- Task-owned tab cleanup: PASS; only `1980904126` was closed, with no writer lease or finalize call.
- Post-cleanup `openTabs()` returned 6 tabs and confirmed `1980904126` was absent; the six pre-existing unrelated tabs remained.

## Boundary and blocker

- No `selected()`, focus, claim, foreground lease, authentication click/input, upload, provider generation, rights confirmation, save/reuse, recording, AOS change, alternate surface, or external effect was performed.
- Primary exact blocker for production/foreground work: `chrome_foreground_activation_capability_unavailable`.
- Current target-scoped Heavy state is also `PENDING_CONFIRMATION` for authenticated workspace hydration because the fresh DOM remained at the login-state shell.
- Historical browser IDs, bindings, tabs, artifacts, and runs were not reused.
