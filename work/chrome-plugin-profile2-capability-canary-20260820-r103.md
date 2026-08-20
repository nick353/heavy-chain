# Chrome Plugin/Profile 2 capability canary r103

Updated: 2026-08-20

## result

The official Chrome/Profile 2 distribution changed since the previous
readback. Current diagnostics report Chrome `151.0.7922.170` and the signed
Profile 2 extension `1.2.27267.15375_0`; the extension is installed/enabled,
and the native host manifest is correct.

A fresh official Chrome Plugin/Profile 2 browser-client completed the required
same-run list → get → `openTabs()` handshake after the mandatory preflight.

## fresh connection proof

- selector: `chrome_plugin` / Profile 2 / `signed_chrome_extension_profile2`
- revision: `30`
- preflight: `status=ready`, `exact_blocker=null`
- browser-client: `-30b9-4094-9522-7723e870f423`
- extension instance: `64b91b0b-80a7-4bc8-8d1a-da222c416685`
- session boundary: `8a28c7c2-d486-4c89-ab51-f2cf92280327`
- `openTabs()`: success, 2 tabs
- owner session/thread: `01a01576-c224-7d81-902f-561719dc45a5` /
  `01a01576-c224-7d81-902f-561719dc45a5`
- owner turn: `01a01e7e-fca6-71f1-9e9a-7ac06002d4e8`

The advertisement still contains browser `viewport` and tab-level
`pageAssets`/`cdp`, but neither `foreground_activation` nor `management`.

## bounded target attempt and cleanup

The Heavy `/tools/fabric` target was absent from the fresh inventory. One
allowlisted task-owned provisioning attempt created tab `1980904554`. The
inline DOM extraction callback failed with the local evaluator error
`TypeError: Right-hand side of 'instanceof' is not an object`; this is not a
Heavy transport or application readback result. The task-owned tab was then
closed through the official tab handle and a fresh `openTabs()` confirmed
`cleanup_verified=true`.

The current Heavy target DOM for this canary is therefore
`PENDING_CONFIRMATION`; the previous successful hydrated Heavy readback remains
separate in `work/heavy-production-target-scoped-readback-20260820-r101.md`.

## remaining blocker

`chrome_foreground_activation_capability_unavailable`

No foreground action, selected-tab operation, provider generation, save,
reuse, reload, recording, AOS change, or external effect was executed.

