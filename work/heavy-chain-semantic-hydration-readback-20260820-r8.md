# Heavy Chain semantic hydration readback r8

## result

現行デプロイの Heavy `/tools/fabric` は、認証待ちの汎用ローディングではなく、Lightchain-shaped の実ワークベンチとしてhydrated済みだった。前回の `heavy_target_workspace_authentication_not_ready` は、旧デプロイまたは汎用body判定だけでは実ワークベンチと区別できなかったために出た停止点であり、今回のsemantic marker readbackでは解消した。

## changed

- source commit: `c2e43e9` (`Expose semantic workspace hydration state`)
- Zeaburのtask-owned stagingから現行sourceをデプロイし、serviceが`RUNNING`、remote bundleが新しい`index.D8ai0rDz.js`へ更新されたことを確認した。
- UI見た目は変更せず、汎用loading fallbackと実workbenchを区別するreadback用semantic markerだけを追加した。
- Heavy側の録画、Chrome共通層、AOS UI、外部効果、認証入力、生成、保存は変更・実行していない。

## verification

- selector: `backend=chrome_plugin / Profile 2 / signed_chrome_extension_profile2 / revision=6`
- fresh browser-client: `-3329-4412-b891-1d92268fdfcd`
- fresh `openTabs()`後、Heavy対象が存在しなかったため公式target provisioningでtask-owned tab `1980903800`を1回作成した。
- target URL: `https://heavy-chain.zeabur.app/tools/fabric`
- title: `Heavy Chain | AI制作ワークスペース`
- DOM/body readback: 成功
- `[data-testid="lightchain-material-workbench"]`: `true`
- `data-workbench-mode`: `fabric`
- `data-workbench-state`: `hydrated`
- `[data-testid="workspace-loading-fallback"]`: `false`
- `material_view`: `true`
- fabric input: `true`
- rights control: `true`
- AI生成 control: `true`
- 生成履歴: `true`
- cleanup: `ok=true`, `tabs_closed=[1980903800]`, `close_failures=[]`
- local focused contract: `16/16 PASS`
- local typecheck: `PASS`
- local build: `PASS` (`2606 modules transformed`)
- `git diff --check`: `PASS`

## remaining blocker

- `heavy_target_workspace_authentication_not_ready` は今回のsemantic readbackで解消した。
- provider生成・保存・再利用は未実施で、fresh target-scoped readbackだけでは完了扱いにしない。
- foreground provider stageは、必要な公式foreground capabilityが広告されるまで `chrome_foreground_activation_capability_unavailable` として別ゲートに保持する。
- productionのprovider結果、同一run保存、Gallery／Canvas／History／Jobs再利用、AIフィッティング、Mac／Windows実Chrome、G619/H601社内β受入れは`PENDING_CONFIRMATION`。

## next action

新しいownerとforeground capabilityが成立した後、旧Runを再利用せず、承認済みの内部サンプルで生地プリントのprovider生成を1回だけ行い、結果→保存→Gallery／Canvas／History／Jobs→再利用→reloadを同一runで確認する。その後AIフィッティングへ進む。capabilityが未広告の間は、target-scoped readbackやlocal契約の範囲を越えて生成を発射しない。

## boundary

この証跡はread-onlyの画面hydration proofであり、ログインボタン押下・資格情報入力・アップロード・権利checkbox操作・AI生成・保存・download・公開・録画・AOS変更を含まない。
