# Chrome Plugin / Profile 2 capability readback r53

- checked_at: 2026-08-20T05:34:17.346Z
- browser_client_boundary: `66068f56-873e-4712-932c-bfec5e14de95`
- browser_id: `-b306-4ee4-83be-1222537f2bf1`
- backend: `chrome_plugin`
- profile: `Profile 2`
- surface: `signed_chrome_extension_profile2`
- selector_revision: `4`
- extension_id: `hehggadaopoacecdllhhajmbjkdcmajg`
- extension_instance_id: `f48b15fe-59a8-4443-8369-44b169a4da68`
- profile_ordering: `2`
- session_id: `01a01576-c224-7d81-902f-561719dc45a5`
- thread_id: `01a01576-c224-7d81-902f-561719dc45a5`
- turn_id: `01a01da7-cbd5-7f60-8879-fcde3cd48d74`

## Result

- Fresh official browser-client initialization, exact Profile 2 advertisement selection, `browsers.get(id)`, and same-run `openTabs()` handshake succeeded.
- `openTabs()` returned 3 existing tabs. No Heavy target tab was created or operated.
- Current browser capability advertisement: `viewport` only.
- `foreground_activation`: not advertised.
- `management`: not advertised.
- No `tabs.selected()`, focus, claim, navigation, provisioning, Heavy operation, authentication click/input, provider generation, save/reuse, recording, AOS operation, alternate surface, or external effect was performed.
- `external_action_executed=false`.
- No task-owned tab was created; cleanup is `not_applicable_no_task_tab_created`.

## Exact blocker

`chrome_foreground_activation_capability_unavailable`

Chrome transport is healthy for this read-only handshake. The missing
foreground capability remains an official signed-extension/backend distribution
blocker. Target-scoped read-only work remains eligible; foreground-only Heavy
generation/save/reuse/reload work remains fail-closed.

## Restart point

After the official signed extension/backend advertises `foreground_activation`
or `management`, create another fresh Profile 2 browser-client and repeat
advertisement -> `openTabs()` -> owner-lineage verification once. Do not reuse
this browser binding, old tab IDs, or this run.
