# Heavy Chain `/tools/fabric` target-scoped canary r7

日時: 2026-08-20 05:57 JST

## result

Fresh official Chrome Plugin / Profile 2 target-scoped readback was completed
after Zeabur deployment `6a8617b42a82f897337778cf` reached `RUNNING` for
`nick353/heavy-chain@9b1428a7dce5256411ebb94a1dae0a410466f1b7`.

- selector: `backend=chrome_plugin`, `revision=6`
- surface: `signed_chrome_extension_profile2`
- browser-client: `-ba97-43a6-b43c-7a6f738e5036`
- extension id: `hehggadaopoacecdllhhajmbjkdcmajg`
- profile ordering: `2`
- fresh `openTabs()`: PASS; 3 unrelated tabs; Heavy target absent
- official provisioning created task-owned tab `1980903768`
- target URL: `https://heavy-chain.zeabur.app/tools/fabric`
- target title: `Heavy Chain | AI制作ワークスペース`
- hydration: `true` (`1106ms`)

## readback

The same-run DOM still showed:

- `ワークスペースを準備しています`
- `認証状態とブランド設定を確認しています。`
- `ログイン確認`
- `状態を確認`

The fabric/material workspace controls and textile assets were not visible.
`AI生成`、`生成履歴`、`Gallery`、`権利確認`も未表示だった。

## changed

No Heavy business action was performed. No click, credential entry, upload,
rights confirmation, provider generation, save, reuse, selected/focus/claim,
recording, AOS change, or other external effect occurred.

Only task-owned tab `1980903768` was closed through the official cleanup path.
`cleanup_verified=true`; the writer lease was not touched. The user-owned
Automation OS and unrelated job tabs were kept unchanged.

## verification

- transport handshake: PASS
- exact target URL/title/DOM readback: PASS
- target-scoped readback: PASS without `selected()` / focus / claim / lease
- task-owned cleanup: PASS
- advertised capabilities: browser `viewport`; tab `pageAssets`, `cdp`
- `foreground_activation` / `management`: not advertised
- external action executed: `false`

## remaining blocker

`heavy_target_workspace_authentication_not_ready`

The new deployment and fresh Profile 2 readback did not leave the workspace
preparation/authentication state. Provider generation remains separately
blocked by `chrome_foreground_activation_capability_unavailable`.

## next action

Do not repeat this fingerprint or perform Chrome close/reopen, `selected()`,
focus, claim, recording, or alternate-surface fallback. The next safe step is
for the user-owned Heavy Profile 2 state to visibly complete authentication and
workspace/brand preparation. After that state change, create one new official
Profile 2 browser-client and repeat only the target-scoped readback once.
