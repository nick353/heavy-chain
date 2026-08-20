# Heavy Chain current target-scoped readback r51

日時: 2026-08-20 JST  
対象: Heavy Chain production / current Lightchain parity follow-up

## result

Fresh official Chrome Plugin / Profile 2 target-scoped readbackを実施した。

- selector: `backend=chrome_plugin`, `profile2`, `signed_chrome_extension_profile2`, revision `4`
- browser-client: `-04ed-4e13-ada5-ebf6113b30ff`
- extension instance: `f48b15fe-59a8-4443-8369-44b169a4da68`
- same-run owner lineage: session/thread `01a01576-c224-7d81-902f-561719dc45a5`, turn `01a01d9e-fb3d-7a40-8da0-42af3377d2fd`
- capabilities: browser `viewport`; tab `pageAssets`, `cdp`; foreground capabilityは未広告
- `openTabs()` handshake: PASS
- `external_action_executed`: `false`

## Heavy `/tools/printing`

- task-owned tab `1980904201`を公式provisioningし、同一runでURL/title/DOMをreadbackした。
- URL/titleは`https://heavy-chain.zeabur.app/tools/printing` / `Heavy Chain | AI制作ワークスペース`で一致。
- Lightchain toolbar、`プリントイメージ`、`参考画像をアップロード`、プリント範囲（スポット／全体）、画像入力、`AI生成`、生成履歴、Gallery/History/Jobs導線を確認。
- `ベース画像`／`パターン参考`の余計な可視トグルは確認されなかった。

## Heavy `/model`

- task-owned tab `1980904202`を公式provisioningし、同一runでURL/title/DOMをreadbackした。
- URL/titleは`https://heavy-chain.zeabur.app/model` / `Heavy Chain | AI制作ワークスペース`で一致。
- 502/SERVICE_UNAVAILABLEはなく、`AIフィッティング`、シングル／マルチタスク、衣服入力、説明生成／参考画像／モデルのセット写真、`AI生成`、生成履歴を確認。

## verification

- 両task-owned tabのみcloseし、`cleanup_verified=true`。
- Zeabur service `heavy-chain`は`RUNNING`、source-associated deployment `6a868dd20f08f89df0cd0e15`はcommit `2a6889cdbb72a8afdbd659579dd27afc19a92269` / `RUNNING`。
- HTTP readback: `/`、`/tools/fabric`、`/tools/printing`、`/model` はすべて `200`。
- provider生成、保存、再利用、reload、録画、別surface、foreground操作、外部効果は未実施。

## remaining blocker / next action

- foreground依存のproduction provider flowは`chrome_foreground_activation_capability_unavailable`でfail-closed。
- target-scoped read-onlyとlocal parity改善は継続可能。
- 次は公式capability広告後のfresh ownerで、生地プリント実用フロー、続いてAIフィッティングの生成→保存→再利用→reloadを同一runで確認する。
