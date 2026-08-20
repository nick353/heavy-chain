# Heavy Chain production target-scoped readback r100

## result

The exact Zeabur deployment `6a86c236c87cdf6b9c27dc3e` reached `RUNNING`.
A fresh official Chrome Plugin/Profile 2 browser-client then performed one
same-run `openTabs()` handshake and target-scoped readback for
`/tools/fabric`.

## selector and owner proof

- backend: `chrome_plugin`
- selector revision: `30`
- profile: `Profile 2` / `profile2`
- surface: `signed_chrome_extension_profile2`
- browser-client: `-5232-4100-a603-f93486760f5c`
- owner session/thread: `01a01576-c224-7d81-902f-561719dc45a5`
- owner turn: `01a01e59-d8e0-7263-9764-e83c5ce6c658`
- `openTabs()`: success, 2 tabs

The official advertisement contained browser `viewport` and tab
`pageAssets`/`cdp`. `foreground_activation` and `management` were not
advertised. `selected()` was not called.

## target readback

The target was absent from the fresh inventory, so the allowlisted
target-scoped provisioning contract created task-owned tab `1980904536` and
read it in the same run.

- URL: `https://heavy-chain.zeabur.app/tools/fabric`
- title: `Heavy Chain | AI制作ワークスペース`
- body: `ログイン状態を確認しています` / `ログイン後にLightchainの制作ワークスペースへ進めます。`
- accessibility readback: `ワークスペースを準備しています` / `認証状態とブランド設定を確認しています。`
- textile/fabric platform assets: not visible
- foreground state: `not_required`
- selected tab: `null` (not used as a gate)

## cleanup and boundary

- `cleanup_verified=true`
- only task-owned tab `1980904536` was closed
- existing tabs were untouched
- provider generation, upload, login click, rights confirmation, save, reuse,
  download, recording, AOS UI, and other external effects were not executed

## blockers

- `heavy_target_workspace_authentication_not_ready`
- foreground-only work remains blocked by
  `chrome_foreground_activation_capability_unavailable`
