# Heavy Chain current fabric target-scoped readback r119

## result

Fresh current Heavy production read-only readback completed under the official
Chrome Plugin/Profile 2 target-scoped lane.

- Selector: `chrome_plugin` / Profile 2 / `signed_chrome_extension_profile2`
- Revision: `30`
- Preflight: `status=ready`, `exact_blocker=null`
- Browser-client boundary: `2352e2cb-9a95-4189-96cb-8cf9593a7538`
- Browser id: `-9cb2-499b-b4f6-315c7a18ffc1`
- Same-run handshake: `list -> get -> openTabs`, `openTabs=2`
- Target: tab `1980904694`
- URL/title: `https://heavy-chain.zeabur.app/tools/fabric` /
  `Lightchain AI`
- Readback state: `readyState=complete`, hydrated fabric workbench visible
- Cleanup: `cleanup_verified=true`; task-owned tab `1980904694` closed

## visible fabric workbench

The current target displayed the following production controls and states:

- `生地イメージ`
- `プリントイメージ`
- `線画の実写化`
- `平絵生成`
- model/design reference input with upload and Gallery entry
- fabric reference input with upload and Gallery entry
- optional keyword input
- automatic, square `1:1`, vertical `4:5`, and landscape `16:9` ratios
- `AI生成` and `生成履歴`
- empty result state `入力待ち`

The readback body length was `512` and visible controls were `36`. The target
was authenticated and interactive at the UI-contract level; the readback did
not execute upload, rights confirmation, generation, save, or reuse.

## boundary and blocker

The official extension advertised browser `viewport` and tab `pageAssets`/`cdp`
only. `foreground_activation` and `management` were not advertised. Therefore
the target-scoped readback is transport/UI evidence only and the provider lane
remains fail-closed at:

`chrome_foreground_activation_capability_unavailable`

No selected-tab, focus, claim, foreground lease, provider generation, save,
Gallery/Canvas/History/Jobs mutation, download, recording, or external effect
was performed. Only the explicitly task-owned target provisioning and cleanup
mutated the temporary tab set.

## next action

After the official foreground capability is advertised, start a new Profile 2
owner and prove this fabric/printing flow from library inputs through provider
result, durable save, Gallery/Canvas/History/Jobs lineage, reuse, and reload;
then run the equivalent AI-fitting proof. Do not reuse this read-only binding,
tab, run, or artifact for foreground work.
