# Chrome Plugin / Profile 2 capability fresh readback r1

- date: 2026-08-20
- selector: `backend=chrome_plugin`, `chrome_profile.id=profile2`, `surface=signed_chrome_extension_profile2`, `revision=6`
- browser-client: fresh session, browser id `-eca9-4baa-b6b0-75b4bfee3892`
- extension: `hehggadaopoacecdllhhajmbjkdcmajg`, instance `f48b15fe-59a8-4443-8369-44b169a4da68`, Profile 2 ordering `2`
- session name: `heavy-chain-capability-readback-20260820-fresh`
- same-run handshake: `browsers.get()` succeeded, then `user.openTabs()` succeeded with 6 current tabs
- advertised browser capabilities: `viewport`
- advertised tab capabilities: `pageAssets`, `cdp`
- `foreground_activation`: not advertised
- `management`: not advertised
- current owner lineage: session/thread `01a01576-c224-7d81-902f-561719dc45a5`, turn `01a01e40-30a3-7e13-a11c-d6ace18bed1a`; matches the current Node REPL request metadata
- selected/focus/claim/navigation/bridge writer: not called
- old binding/run/artifact: not reused as current proof
- external effect: none

## Result

Transport and same-run `openTabs()` are healthy. The official signed extension still does not advertise the foreground capabilities required for selected/focus/claim operations.

## Exact blocker

`chrome_foreground_activation_capability_unavailable`

Target-scoped read-only remains the permitted lane. Foreground work must remain fail-closed until the official signed distribution advertises `foreground_activation` or `management`.
