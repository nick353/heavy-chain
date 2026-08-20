# Chrome Plugin / Profile 2 capability readback r57

- checked_at: 2026-08-20 (fresh same-run delegated readback)
- selector: `backend=chrome_plugin / Profile 2 / signed_chrome_extension_profile2 / revision=4`
- browser-client: `-92f8-481c-aee9-55d6c8c3e702`
- extension instance: `f48b15fe-59a8-4443-8369-44b169a4da68`
- owner session name: `heavy-profile2-fresh-capability-openTabs-20260820`
- source thread: `01a00fe4-9c5e-7d00-8b6a-09811c03df36`
- source turn: `01a01dbd-c8a5-70a3-9ce4-f696fbe54ceb`

## Result

Fresh official Chrome Plugin/Profile 2 verification completed after the Chrome update. The new browser-client advertised only `viewport` for the browser and `pageAssets`/`cdp` for the tab. `openTabs()` succeeded with 6 tabs. Owner session/thread/turn lineage matched the current source-thread call.

No Heavy target operation, selected/focus/claim, foreground lease, authentication, upload, provider generation, save, reuse, reload, recording, AOS change, alternate surface, or external effect was performed. The fresh binding was discarded after readback.

## Exact blocker

`chrome_foreground_activation_capability_unavailable`

The official signed distribution still does not advertise `foreground_activation` or `management`. This is a foreground distribution blocker, not a transport failure. Heavy production generation/save/reuse/reload remains `PENDING_CONFIRMATION`; target-scoped read-only remains the permitted lane.

## Restart point

After an official signed-extension/backend capability change, create a new Profile 2 browser-client and repeat capability advertisement -> `openTabs()` -> owner-lineage verification once. Do not reuse this browser id, binding, tab, run, or artifact as current proof.
