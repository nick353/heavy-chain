# Heavy Chain target-scoped canary r5

日時: 2026-08-20 JST

## result

Fresh official Chrome Plugin / Profile 2 target-scoped readback and
task-owned provisioning completed for Heavy `/tools/fabric`.

- selector: `backend=chrome_plugin`, `revision=6`
- surface: `signed_chrome_extension_profile2`
- browser-client: `-7ca4-4eb1-a676-fcaff203e639`
- extension id: `hehggadaopoacecdllhhajmbjkdcmajg`
- profile ordering: `2`
- owner lineage:
  - session: `01a01576-c224-7d81-902f-561719dc45a5`
  - thread: `01a01576-c224-7d81-902f-561719dc45a5`
  - turn: `01a01bc4-cc66-77a0-9a26-e0c39c88a677`

The fresh inventory contained three unrelated tabs and no Heavy target. The
official allowlisted provisioning contract created task-owned tab `1980903766`,
navigated to `https://heavy-chain.zeabur.app/tools/fabric`, and read the target
in the same run.

## readback

- title: `Heavy Chain | AI制作ワークスペース`
- URL: `https://heavy-chain.zeabur.app/tools/fabric`
- hydration: `true` (`1006ms`)
- visible state: `ワークスペースを準備しています`
- visible state: `認証状態とブランド設定を確認しています。`
- visible controls: `キーボードショートカットを表示`, `アカウント`
- textile/fabric assets: not visible

## changed

No Heavy business action was performed. No click, credential entry, upload,
rights confirmation, provider generation, save, reuse, selected/focus/claim,
recording, AOS change, or other external effect occurred.

## cleanup

Only task-owned tab `1980903766` was closed through the official cleanup path.
`cleanup_verified=true`; writer lease was not touched.

## blocker

`heavy_target_workspace_authentication_not_ready`

The user-reported login state was not reflected in this fresh target-scoped
readback: the Heavy workspace remained in authentication/brand preparation and
did not expose textile or fabric assets. The browser advertised only
`viewport`; tab capabilities were `pageAssets` and `cdp`. No foreground
capability was advertised, so Codex did not simulate a login click or switch
browser surfaces.

## next action

After the Heavy Profile 2 page visibly leaves the preparation state and shows
the workspace assets, create one new official browser-client and perform one
fresh `openTabs()` → exact Heavy descriptor → target-scoped URL/title/DOM
readback. Do not repeat this fingerprint before that user-owned state change.
Provider generation remains separately gated by the missing foreground
capability.
