# Chrome Plugin / Profile 2 capability fresh readback r96

- date: 2026-08-20
- trigger: Chrome本体更新後の現行配布状態確認
- selector: `backend=chrome_plugin`, `chrome_profile.id=profile2`, `surface=signed_chrome_extension_profile2`, `revision=6`
- browser-client: fresh session, browser id `-ab93-4c4f-9060-5a671317f48a`
- extension: `hehggadaopoacecdllhhajmbjkdcmajg`, instance `f48b15fe-59a8-4443-8369-44b169a4da68`, Profile 2 ordering `2`
- session name: `🔎 Heavy Chrome capability check`
- same-run handshake: `browsers.get()` succeeded, then `user.openTabs()` succeeded with 4 current tabs
- fresh browser capabilities: `viewport`
- inventory-advertised tab capabilities: `pageAssets`, `cdp`
- `foreground_activation`: not advertised
- `management`: not advertised
- current browser owner lineage: thread/session `01a01576-c224-7d81-902f-561719dc45a5`, turn `01a01e56-5f42-7c93-b35d-0992ffb0c719`; matches the current request metadata
- official bridge readback: v2 path is `status=blocked`, `exact_blocker=chrome_selected_tab_readback_invalid`, owner/session/thread/turn fields are null; no writer refresh was attempted
- selected/focus/claim/navigation/bridge writer: not called
- old binding/run/artifact: not reused as current proof
- external effect: none

## Result

Fresh Chrome/Profile 2 transport and same-run `openTabs()` are healthy after the Chrome update. The official signed extension still advertises no foreground activation or management capability.

## Exact blocker

`chrome_foreground_activation_capability_unavailable`

The bridge remains separately blocked on `chrome_selected_tab_readback_invalid`; it was not promoted to ready because there is no current owner lineage and no official writer refresh in this read-only canary.

## Next action

Continue eligible Heavy read-only checks through the target-scoped lane. Wait for an official signed extension/backend distribution that advertises `foreground_activation` or `management`; then create a new Profile 2 browser-client and recheck capability, `openTabs()`, and owner lineage before any foreground work.
