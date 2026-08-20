# Chrome Plugin / Profile 2 capability readback r44

## result

Fresh official Chrome Plugin/Profile 2 capability readback completed in one current node-repl browser-client run.

## selector

- backend: `chrome_plugin`
- profile: `profile2` / Profile 2
- surface: `signed_chrome_extension_profile2`
- revision: `30`
- browser-client: `/Users/nichikatanaka/.codex/plugins/cache/openai-bundled/chrome/26.814.41407/scripts/browser-client.mjs`

## fresh browser and owner lineage

- browser id: `-f449-4864-b61d-50882c3d6742`
- browser type/family: `extension` / `chrome`
- extension id: `hehggadaopoacecdllhhajmbjkdcmajg`
- extension instance id: `f48b15fe-59a8-4443-8369-44b169a4da68`
- profile ordering: `2`
- current Codex session/thread: `01a01576-c224-7d81-902f-561719dc45a5`
- current turn: `01a01d75-f4d9-7743-8f49-2347a623ab84`
- owner lineage: `same current node-repl session/thread/turn`

## verification

- fresh `browsers.list()` selected the exact Chrome extension/Profile 2 advertisement.
- fresh `browsers.get(id)` succeeded.
- documentation read and named-session setup succeeded.
- same-run `openTabs()` handshake succeeded with 6 tabs.
- same-run capability readback: browser `viewport` only; tab `pageAssets` and `cdp` only.
- `foreground_activation`: not advertised.
- `management`: not advertised.
- Heavy target was not present in this inventory; no target provisioning or Heavy operation was performed.
- No selected/focus/claim/foreground lease, navigation, authentication, generation, save/reuse, recording, AOS, alternate surface, or external effect was performed.

## remaining blocker

`chrome_foreground_activation_capability_unavailable`

Foreground-only Heavy production work remains fail-closed. This fresh proof does not clear the capability gate.

## next action / restart point

After the official signed extension/backend advertises `foreground_activation` or `management`, create a new Profile 2 browser-client owner and repeat advertisement → `openTabs()` → owner-lineage verification once. If the capability remains absent, continue only with target-scoped read-only; do not repeat this fingerprint or switch surfaces.
