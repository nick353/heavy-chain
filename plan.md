# Heavy Chain 社内アパレル統合β版 実行計画

更新日: 2026-08-20

## 目的

現行Lightchain本番を正本として、動画を除く全機能を、社内アパレル担当全員が使える1画面の統合ワークスペースへ揃える。まず生地プリントイメージとAIフィッティングを、ライブラリ選択から生成・結果確認・保存・再利用まで実用化し、その共通契約を残りの非動画機能へ展開する。

## 完成条件

- 現行Lightchainのfresh同一run台帳（機能、画面、入力、生成、結果、保存、再利用、エラー、性能）を確定する。
- 動画を除く現行機能を、Lightchainと同じ情報設計・カテゴリ・操作モデル・見た目の統合UIで提供する。
- 生地・衣服・プリント・モデル・背景・ポーズ等をライブラリから選択できる。
- 生地プリントイメージとAIフィッティングが、`draft → ready → generating → completed / failed → retry` を通り、結果をGallery／Canvas／History／Jobsへ保存・再利用できる。
- 保存後の再読込、失敗、リトライ、二重生成防止、権利・所有者境界を確認する。
- 現行ChromeのMac／Windows、1280〜2560px程度のデスクトップ幅で受入れ可能にする。
- 社内βの権利・安全・復旧・利用ログ・代表ユーザー受入れを完了する。

## 対象と非対象

対象は、現行Lightchainのおすすめ、企画デザインツール、AIフィッティング、グラフィックツールに含まれる非動画機能、共通Library、Gallery、Canvas、History、Jobsである。

非対象は動画生成・動画ワークステーション、公開、課金、決済、購入、OTP／CAPTCHA／本人確認、秘密情報入力である。Lightchainの proprietary brand asset の直接コピーや、非決定的な生成結果のピクセル完全一致も要求しない。

## 実行フェーズ

### 1. 現行基準の確定

1. 公式Chrome Plugin／Profile 2で、Lightchain本番のhomepage、4カテゴリ、全非動画カード、優先routeをfresh readbackする。
2. 入力、操作、生成、結果、保存、再利用、エラー、リトライ、性能を機能単位で記録する。
3. `work/lightchain-parity-matrix-current-20260820-r13.md` を現行証跡として更新する。旧revision 30のカード台帳は参照証跡として分離し、現行revision 6のfresh readbackと混同しない。

### 2. Heavy共通ワークスペース

1. Lightchainの4カテゴリ、Library起点、統合ワークベンチ、共通結果状態を実装する。
2. Gallery／Canvas／History／Jobsを同一の結果系譜へ接続する。
3. Heavy-onlyの余計な表示、導線、ブランド表現をauthenticated parity surfaceから除去する。

### 3. 生地プリントイメージ

1. ライブラリから製品所有の生地・衣服・プリントを選択する。
2. 配置、サイズ、向き、表現を設定し、権利確認後にprovider生成する。
3. 結果、失敗、リトライ、保存、Gallery／Canvas／History／Jobs、再利用、reloadを同一runで確認する。

### 4. AIフィッティング

1. 衣服、モデル、背景、ポーズ、参考画像をライブラリから選択する。
2. 権利確認後にprovider生成し、形状・着用状態・構図を確認する。
3. 結果、失敗、リトライ、保存、Gallery／Canvas／History／Jobs、再利用、reloadを同一runで確認する。

### 5. 残りの非動画機能とβ QA

1. 31機能の入力・結果・保存・再利用契約を共通化する。
2. Mac／Windowsの現行Chrome、広いデスクトップ幅、ライブラリ検索、生成待ち、エラー、リトライ、権利、二重生成を確認する。
3. 代表ユーザー、社内全員、利用ログ、失敗生成、未解決事項を確認し、β受入れを記録する。

## 証跡ルール

- local test／静的検証／スクリーンショット／queued receiptは、production生成や業務完了の証明にしない。
- productionの成功は、fresh同一runの画面、provider結果、保存先、再読込、結果系譜、cleanupを分けて確認する。
- 旧Run、旧binding、旧tab、旧receipt、過去録画はcurrent proofに再利用しない。
- Chromeのbrowser-client、foreground selected、target ownership、provider business completionを別ゲートとして扱う。

## 現在の状態（2026-08-20）

- 2026-08-20、現行デプロイ後に新規公式Chrome Plugin／Profile 2 browser-client `-3329-4412-b891-1d92268fdfcd`でHeavy `/tools/fabric`をtarget-scoped read-only確認した。新しいremote bundle `index.D8ai0rDz.js`を配信する`RUNNING` serviceに対し、公式provisioningで作成したtask-owned tab `1980903800`のURL/title/DOMを同一runで取得。semantic markerは`lightchain-material-workbench=true`、mode=`fabric`、state=`hydrated`、loading fallback=falseで、素材入力・権利確認・AI生成・生成履歴も可視だった。cleanupは`ok=true`。証跡は `work/heavy-chain-semantic-hydration-readback-20260820-r8.md`。従来の`heavy_target_workspace_authentication_not_ready`はこのsemantic proofで解消したが、provider生成・保存・再利用は未実施である。foreground provider capabilityは別ゲートとして`chrome_foreground_activation_capability_unavailable`を維持する。

- 2026-08-20、現行sourceのlocal acceptance recheckを実施した。非動画31機能`ok=true / failed=[]`、unified desktop `228/228`（1280／1440／1920／2560px、global timeoutなし、cleanup残り0）、material/UI `16/16`、provider coverage `11/11`、provider persistence/readback `12/12`、workspace handoff `2/2`、fitting history/resume `10/10`、Canvas generation `5/5`、Canvas view `3/3`、local upload/resume `6/6`をPASS。証跡は `work/heavy-chain-local-acceptance-r4-20260820.md`。production provider・実Chrome・実β・H601 operator判断は未完了。

- 2026-08-20 06:09 JST、現行Lightchain本番のfresh Profile 2 target-scoped parity readback r4を取得した。同一browser-client `-ba97-43a6-b43c-7a6f738e5036`でhomepage、`/tools/fabric`、`/tools/printing`、`/model`を確認し、4カテゴリ、現行toolbar、生地イメージ、プリントイメージ、AIフィッティングの入力・履歴導線をreadbackした。4 routeともURL/title/DOMと`hydration_ready=true`、task-owned tab cleanupをPASS。動画ワークステーションはLightchain側に表示されるが、Heavyでは明示的な動画除外を維持する。証跡は `work/lightchain-profile2-current-parity-readback-20260820-r4.md`。これはLightchain基準の更新であり、Heavy本番の生成・保存・再利用証明ではない。

- 2026-08-20、Heavy本番認証待ちの間に現行sourceのlocal verification r2を再実行した。material/UI `16/16`、model-matrix `3/3`、provider persistence/readback `12/12`、Canvas generation/readback `5/5`（focused `36/36`）、非動画workflow `featureCount=31 / failed=[]`、build `2606 modules transformed`をPASS。remote asset診断はHeavy HTML `200`、`LightchainMaterialWorkbenchPage` chunk `200`、参照30 assetの欠落なしを確認したが、これはChromeのproduction hydration証跡ではない。G619は`acceptance=not_claimed`・実セッション`0/3`、H601 operator readinessは`missingCount=10`、launch operationsは`auth_state_missing`のまま。証跡は`work/heavy-chain-local-verification-20260820-r2.md`。

- 2026-08-20 05:57 JST、Zeabur deployment `6a8617b42a82f897337778cf`（`nick353/heavy-chain@9b1428a7dce5256411ebb94a1dae0a410466f1b7`）が`RUNNING`になった後、新規公式Chrome Plugin／Profile 2 browser-client `-ba97-43a6-b43c-7a6f738e5036`でHeavy `/tools/fabric`をtarget-scoped read-only確認した。fresh `openTabs()`は3件でHeavy targetなし、公式provisioningで作成したtab `1980903768`のURL/title/DOM/hydration（1106ms）を同一runで確認し、作成tabだけcleanupした。画面は依然`ワークスペースを準備しています`／`認証状態とブランド設定を確認しています。`、`ログイン確認`／`状態を確認`で、textile/fabric asset、`AI生成`、`生成履歴`、Gallery、権利確認は未表示。exact blockerは`heavy_target_workspace_authentication_not_ready`。証跡は`work/heavy-chain-target-scoped-canary-20260820-r7.md`。
- r7はtransport／target-scoped readback／cleanupのPASSであり、クリック、認証入力、生成、保存、再利用、selected／claim／focus／foreground lease、録画、AOS変更、外部効果は行っていない。foreground provider stageは`chrome_foreground_activation_capability_unavailable`（広告は`viewport`とtab-level `pageAssets`／`cdp`のみ）で別ゲートとして維持する。ユーザー所有のHeavy workspace状態が変わるまで同じfingerprintは再発射しない。

- 2026-08-20 05:19 JST、Lightchain `/tools/fabric` のfresh direct-route readbackで確認した現行toolbar（`ツールバー`、デザインツール、フィッティングツール、グラフィックデザインツール、衣類生産ツール）に合わせ、Heavyのfabric／printing画面から旧4カテゴリ帯を除去し、同じtoolbar構成へ更新した。Library／Gallery、権利確認、`AI生成`、`生成履歴`、統合βの結果系譜は保持している。material contract 64/64、typecheck、全非動画31機能、desktop 228/228（1280／1440／1920／2560px）、diff checkをPASS。証跡は `output/playwright/lightchain-all-feature-workflows-20260819T201515Z/SUMMARY.json` と `output/playwright/unified-desktop-layout-current-rerun-after-toolbar/SUMMARY.json`。local UI parityの証明であり、未デプロイ・provider生成／保存／再利用は未実施。
- 2026-08-20 05:27 JST、toolbar各ボタンのroute契約を既存Lightchainカテゴリroute（planning／fitting／graphics／designProduction）へ固定し、各ボタンのreadback用test-idを追加した。material/UI control contract 16/16、typecheck、diff check、全非動画31機能、desktop 228/228をPASS。fresh Chrome Plugin readbackはProfile 2拡張の広告が空で`chrome_plugin_profile2_inventory_empty`となったため、Lightchainリンク実体の再取得はPENDING_CONFIRMATION。証跡は `work/chrome-plugin-profile2-inventory-empty-20260820-r1.md`。

- 2026-08-20 latest fresh Chrome/Profile 2 canary r5では、ユーザー申告後の新規browser-client `-7ca4-4eb1-a676-fcaff203e639`で`openTabs()` handshakeに成功し、Heavy `/tools/fabric`を公式target-scoped provisioningで同一run readbackした。URL/title/DOMとhydration（1006ms）はPASS、task-owned tab `1980903766`のcleanupもPASS。ただし画面は引き続き`ワークスペースを準備しています`／`認証状態とブランド設定を確認しています。`で、textile/fabric assetは未表示。最新の実用フロー停止点は`heavy_target_workspace_authentication_not_ready`。証跡は `work/heavy-chain-target-scoped-canary-20260820-r5.md`。クリック、資格情報入力、生成、保存、再利用、外部効果は行っていない。

- 2026-08-20 local completion-contract recheckでは、fabric／printing／AI fitting／保存再利用／Canvas／History／Jobs／統合shellのfocused suite `110/110`、typecheck、diff checkをPASS。全非動画ワークフローは`featureCount=31 / failed=[]`、unified desktopは`228/228`（1280／1440／1920／2560px、cleanupLeftovers 0）をPASSした。証跡は `work/heavy-chain-local-verification-20260820-r1.md`。production provider生成・同一run保存再利用・実Chrome Mac/Windows・β受入れは未確認。

- 2026-08-20 completion audit r1でGoalの各受入れ条件を現行証跡へ照合した。local実装／契約は進捗済みだが、production provider生成・同一run保存再利用、Mac/Windows実Chrome、G619実β、H601 operator decisionが未完了。監査表は `work/heavy-chain-completion-audit-20260820-r1.md`。Goalは完了扱いにしない。

- 2026-08-20、現行の全員利用β仕様に合わせ、Lightchain直ルート（`/creator`、`/model`、`/tools/fabric`、`/designProduction`、`/asset-center`、`/flow/orientedDesign`）をLightchain shell判定へ明示接続した。旧プランロックを要求していたParityテストを現行の全員利用仕様へ更新し、Parity alias/entry routing `8/8`、typecheck、diff checkをPASS。production UI・provider生成・保存再利用は未確認。

- 2026-08-20 parity cleanupでは、現行Lightchain direct routeに存在しない内部見出し`LIGHTCHAIN MATERIAL WORKBENCH`をfabric／printing共通画面から除去した。focused material/UI control contract 16/16、typecheck、diff checkをPASS。Library、権利、生成、履歴などβ要件の表示は維持している。production readbackは認証状態変化後に再確認する。

- 2026-08-20 parity cleanup後の品質確認で、`npm run lint -- --max-warnings=0`と`npm run build`（2606 modules）がPASSした。これはlocal build proofであり、production反映・provider生成・保存再利用の証明ではない。

- 2026-08-20、共通Lightchain Workbenchのprovider再試行を改善した。再試行中または失敗時は直前の成功結果を保持し、素材入力が変わった場合だけ入力境界で結果を無効化する。provider coverage 11/11、material 16/16、provider persistence/readback 12/12、workspace handoff 2/2、unified shell 4/4、非動画31機能、typecheck、diff checkをPASSした。これはlocal復旧契約の証明であり、production provider生成・保存再利用の証明ではない。commit `cb46fa5`。

- 2026-08-20、Lightchain本番のfreshカード台帳に合わせ、統合ランチャーの表示契約を修正した。カテゴリ別の非動画カードはおすすめ7／企画デザインツール9／AIフィッティング5／グラフィックツール5（合計26出現）とし、カテゴリ間で重複するデザインワークスペース・AIフィッティング系カードもLightchainと同じ構成にした。動画カードは除外し、`生成対応`／`作業台`／`検証済み`などHeavy内部状態の表示バッジはランチャーから除去した。31機能の内部契約は別カタログとして保持している。これはlocal UI parityの反映であり、production provider生成・保存再利用の証明ではない。
- この変更の検証は `scripts/verify-lightchain-launcher-parity.test.ts` 3/3、entry routing 5/5、internal UX consistency `ok=true`、全非動画ワークフロー `featureCount=31 / failed=[]`、typecheck、build 2606 modules、diff checkをPASSした。全機能検証の最新サマリーは `output/playwright/lightchain-all-feature-workflows-20260819T192220Z/SUMMARY.json`。未デプロイで、Chrome／録画／AOS／provider／外部効果は行っていない。

- 【履歴】Chrome Plugin/Profile 2の共有スレッドでは、transport／target-scoped readback／cleanup復旧後の停止点として`heavy_target_workspace_authentication_not_ready`が報告されていた。r6 fresh readbackで認証済みworkspaceが確認できたため、現在の停止点はforeground capabilityへ更新している。selected／about:blank／claim／focus／foreground leaseの復旧やclose/reopenは再実行しない。

- 2026-08-20、β readiness static checksを再実行した。H601 legal-safety guardは`ok=true`、internal UXは`ok=true`。しかしG619実β受入れは`acceptance=not_claimed`、実セッション`0/3`、必要workflow証跡なしで未完了。H601 operator readinessも`operator_final_h601_decision_missing`とTerms／Privacy／保持削除／upload rights／brand・likeness／claims／commercial wording／reviewの未添付で未完了。launch-opsは`auth_state_missing`で未完了。これらは人手承認・実セッション・認証artifactが必要で、Codexは偽の証跡を作成しない。

- 2026-08-20、現行Lightchain shellに合わせてprinting parity回帰テストの古い112px Heavy-onlyレール期待値を修正した。現行2列の`lg:grid-cols-[minmax(0,1.08fr)_minmax(360px,0.92fr)]`と旧レール不在を検証し、printing foundation `244/244`、provider persistence `12/12`、AI fitting input contract `16/16`、非動画31機能 `featureCount=31 / failed=[]`、typecheck、diff checkをPASSした。commit `67d5df8`。これはlocal implementation proofであり、production provider生成・保存再利用のproofではない。

- 2026-08-20、provider入力に残っていたユーザー／履歴表示へ流れ得る`Heavy Chain Lab transformation`を`Lightchain Lab transformation`へ修正し、Lightchainの命名契約へ統一した。Lab/provider coverage `12/12`、typecheck、diff check、および別preview portでの全非動画検証 `featureCount=31 / failed=[]` をPASSした。証跡は `output/playwright/lightchain-all-feature-workflows-current-provider-label/SUMMARY.json`。これはlocal UI/provider契約の証明であり、production provider生成・保存再利用・β受入れの証明ではない。

- 2026-08-20、fresh official Profile 2 target-scoped readback r6でHeavy `/tools/fabric`の認証済みworkspaceを確認した。ログイン／無料で始める表示はなく、Lightchain型の生地入力、Gallery、素材バリエーション、権利確認、`AI生成`、`生成履歴`が同一runで表示され、task-owned cleanupもPASSした。証跡は `work/heavy-chain-authenticated-target-readback-20260820-r6.md`。認証／workspace hydrationはPASSへ更新するが、provider生成・保存・再利用は未実施。fresh広告に`foreground_activation`／`management`がなく、実用フローのexact blockerは`chrome_foreground_activation_capability_unavailable`。

- 2026-08-20、同じfresh Profile 2 browser-clientでLightchain homepageをhydration後に再確認した。`Lightchain AI`、4カテゴリ、7件のおすすめ、事例タブを確認し、現行Lightchainには`動画ワークステーション`カードが1件表示された。動画除外はHeavy側の明示non-goalとして維持する。証跡は `work/lightchain-profile2-fresh-readback-20260820-r3.md`。Heavyの非動画UIに動画カードを戻す根拠にはしない。

- 2026-08-20、source commit `797afd54f133068cdd1c4b19845116dfd8633952` のZeabur deployment `6a85fb012a82f8973377761f`が`RUNNING`になった。デプロイ後のfresh official Chrome Plugin／Profile 2 target-scoped readbackでHeavy `/lightchain`を確認し、7件の非動画ランチャー、4カテゴリ、`video_text_present=false`、`video_route_present=false`、`login_text_present=false`を同一runで確認した。作成タブは`cleanup ok=true`で閉じた。証跡は `work/heavy-production-video-hidden-readback-20260820-r1.md`。これは非動画UI反映と認証済み画面の証明であり、provider生成・保存・再利用・β受入れの完了証明ではない。

- 【履歴】2026-08-20、fresh target-scoped readbackでHeavy `/tools/fabric`を確認した際には、ログイン／準備中シェルではなく、`生地イメージ`、モデル／生地入力、Gallery選択、画像比率、生地バリエーション、権利確認、`AI生成`、生成履歴が表示された。これは当時のhydrated workspace証跡であり、最新r3の状態を上書きしない。クリック・アップロード・生成は行っていない。

- foreground capabilityは引き続き`viewport`のみで、`foreground_activation`／`management`は未広告。target-scoped read-onlyは成功しているが、provider生成を伴うforeground操作は開始していない。

- 2026-08-20 03:47 JSTおよびr6同一runの公式capability広告を確認した。`viewport`とtab-level `cdp`のみで、`foreground_activation`／`management`は未広告。selected／claim／focusは呼ばず、foreground blockerを`chrome_foreground_activation_capability_unavailable`として維持した。証跡は `work/chrome-plugin-foreground-capability-readback-20260820-r1.md` と `work/heavy-chain-authenticated-target-readback-20260820-r6.md`。
- 2026-08-20 03:46 JST、同一fresh Profile 2 target-scoped runでHeavy／Lightchainの`/tools/printing`と`/model`を比較した。Heavy printingは入力、スポット／全体、権利確認、AI生成、生成履歴、Canvas保存導線を表示し、Heavy modelはAIフィッティング、衣服入力、参考画像、権利確認、AI生成、生成履歴を表示した。Lightchain両routeは権限ロックを表示するため、Heavyのロック除去は社内全員利用要件に沿う意図的差分。Heavyに見えた既存provider resultは新規生成証拠に昇格しない。証跡は `work/lightchain-heavy-priority-route-ledger-20260820-r1.md`。
- 2026-08-20 03:43 JST、同一fresh Profile 2 browser-clientでHeavy `/tools/fabric`とLightchain `/tools/fabric`をtarget-scoped read-only比較した。両方のURL/title/DOM readbackとtask-owned cleanupはPASS。Lightchain direct routeにも旧終了案内が存在するため、Heavy側の同文言はHeavy-only余計表示ではない。一方、Heavyの統合workspaceはGallery／権利確認／AI生成を追加した内部β仕様で、タイトル・toolbar文言・詳細入力構成は直接routeと差が残る。完全parityはPENDING_CONFIRMATION。証跡は `work/heavy-lightchain-target-parity-readback-20260820-r1.md`。
- 2026-08-20 03:39 JST、現行Lightchain本番をfresh official Chrome Plugin／Profile 2のtarget-scoped read-only laneで再確認した。homepageのURL/title/DOM readbackに成功し、4カテゴリ（おすすめ／企画デザインツール／AIフィッティング／グラフィックツール）と非動画ラベル（デザイン修正／柄・プリント）を確認した。task-owned tabは公式cleanup済み。証跡は `work/lightchain-profile2-fresh-readback-20260820-r2.md`。これは現行基準のreadbackであり、Heavyのprovider生成・保存・再利用の証明ではない。
- 同じ継続作業でHeavyのローカル検証を完了した。31機能台帳は`featureCount=31`／`failed=[]`でPASS。デスクトップ幅検証は再実行で`228/228`セル、`failed=0`、`1280/1440/1920/2560px`、preview cleanup完了を確認した。初回の4件は並列負荷による一時的な`operation_timeout`で、再実行では再現しなかった。証跡は `output/playwright/unified-desktop-layout-current-rerun/SUMMARY.json`。
- 2026-08-20 03:31 JST、社内βの全員利用要件と矛盾するハードコード済み旧プランロック表示を統合ワークスペースから除去し、commit `633ddf79faedf81fb304ca194a2f4a623bac1c29` をZeabur deployment `6a85f5bcf1ea67ebf4ea683b` として`RUNNING`反映した。fresh Profile 2 target-scoped readbackで新bundleの `/tools/fabric` を確認し、`権限がありません`／`permission-locked` は0件、Lightchain-shaped入力・権利確認・AI生成・生成履歴は表示された。証跡は `work/heavy-production-beta-unlock-readback-20260820-r1.md`。これはUI反映のPASSであり、provider生成・保存再利用の完了証明ではない。
- localのLightchain parity／material／provider／persistence契約と31機能・desktop QAは検証済み。Zeabur deployment `6a85ecc3f1ea67ebf4ea67bc` は `RUNNING` となり、fresh Profile 2 target-scoped readbackで `/tools/fabric` のLightchain-shaped direct material frameを確認した。ただしprovider生成・保存再利用のproduction完了ではない。
- 【履歴】2026-08-20 03:08 JSTのfresh Profile 2 target-scoped readbackでは、Heavy `/tools/fabric` がログイン／準備中シェルではなく、hydratedなLightchain-shaped `生地イメージ`ワークスペースを表示した。これは当時の認証ゲート・画面hydrationのPASS証跡であり、最新r3の再確認結果を上書きしない。`権限がありません`、入力未選択、foreground操作未実施のため、provider生成・権利確認・保存再利用の完了証明ではない。証跡は `work/heavy-chain-authenticated-target-readback-20260820-r5.md`。
- 2026-08-20 03:20 JST、source-associated deployment `6a85f3012a82f89733777475` が commit `6831f365b489ec35a8bafce11e96cfc4c88cd0b7` で `RUNNING`。HTTP `200`、container localhost `200`、fresh Profile 2 `/tools/fabric` readbackでLightchain markersとHeavy-only chromeなしを確認した。証跡は `work/heavy-production-deployment-readback-20260820-r2.md`。provider生成・保存再利用は未実施。
- Goalの正本はこの `Plan.md`、Goal stateは `work/codex-goal-run-context-20260819.json`、詳細な履歴は `plan.md` に保持する。
- 現行Chrome Plugin／Profile 2はfresh `openTabs()`後も`selected()=null`で、署名済み拡張は`viewport`のみを広告している。foreground activation capabilityは未広告である。

## Exact blocker / next action / restart point

- Target-scoped canary transport: PASS。rev6のfresh browser-clientでHeavy `/tools/fabric`を公式provisionし、同一runのURL/title/DOM readbackとtask-owned cleanupを確認した。
- Source-associated deployment/runtime/UI gate: PASS。deployment `6a85f3012a82f89733777475` は `nick353/heavy-chain@6831f36`、`docker`、`RUNNING`。HTTP/container/fresh Profile 2 UI readbackを同一の反映後状態で確認した。
- Beta unlock UI gate: PASS。deployment `6a85f5bcf1ea67ebf4ea683b` は `nick353/heavy-chain@633ddf7`、`docker`、`RUNNING`。fresh target-scoped readbackで旧プランロック表示0件を確認した。実際のブランド・権利・provider・保存の安全ゲートは維持している。
- Lightchain current parity readback: PASS。rev6のfresh Profile 2でhomepage、4カテゴリタブ、非動画おすすめ7件／動画除外1件、事例23件／動画除外2件、`/tools/fabric`、`/tools/printing`、`/model`の入力・権限・終了導線を確認した。カテゴリ内全カードはLoadingのためPENDING_CONFIRMATION。
- Lightchain current homepage refresh: PASS。2026-08-20 03:39 JSTのfresh readbackで4カテゴリと非動画ラベル（デザイン修正／柄・プリント）を同一runで確認した。完全なカテゴリ内カード台帳は引き続きPENDING_CONFIRMATION。
- Same-run Heavy/Lightchain direct-route comparison: PASS。両targetのURL/title/DOM readbackと公式cleanupを確認した。Heavyの統合β入力・権利・生成ゲートは意図した内部β差分だが、タイトル・toolbar文言・詳細入力構成の完全一致はPENDING_CONFIRMATION。
- Priority route ledger: PASS。`/tools/printing`と`/model`のHeavy／Lightchain readbackを同一fresh runで取得し、入力・権利・生成・履歴差分を記録した。既存provider結果は履歴データであり、新規生成proofではない。
- Foreground capability readback: BLOCKED。fresh browser-clientの公式広告は`viewport`のみで、`foreground_activation`／`management`は未提供。target-scoped read-onlyは継続可能。
- Fresh Profile 2 inventory readback: PASS。広告復旧後の新規browser-client `-68be-4a7c-998c-491938908661`でProfile 2 signed extensionを取得し、`openTabs()` handshakeに成功した。Heavy targetはinventoryに無かったため、allowlist済み`/tools/fabric`をtask-owned provisioningし、同一run readback後にtab `1980903758`だけをcleanupした。
- Production non-video launcher readback: PASS。deployment `6a85fb012a82f8973377761f`が`797afd5`で`RUNNING`。fresh Profile 2 target-scoped `/lightchain` readbackで7件の非動画ランチャーと動画導線0件を確認。証跡は`work/heavy-production-video-hidden-readback-20260820-r1.md`。
- Authentication gate: PENDING_CONFIRMATION。r6のhydrated proofは履歴証跡として保持するが、最新r4 fresh target-scoped readbackでは`ワークスペースを準備しています`／`認証状態とブランド設定を確認しています。`に戻り、textile assetが未表示だった。現在の画面には`ログイン確認`／`状態を確認`導線が見えるが、クリック・認証入力は未実施。provider生成・保存・再利用は未実施。
- Common route readback: PASS。fresh同一runで`/lightchain`、`/gallery`、`/canvas/new`、`/history`、`/jobs`を15秒hydration後に確認した。Galleryは961枚、Historyは保存済み12件・失敗4件、Jobsは完了20件・失敗4件を表示した。新規provider生成からの同一run保存・再利用は未証明。
- Exact blocker: `heavy_target_workspace_authentication_not_ready`。最新r4ではChrome transport、URL/title/DOM、hydration、cleanupは成功したが、Heavyのworkspace準備・認証／ブランド設定確認が完了せず、textile assetが未表示だった。`ログイン確認`導線は見えているが、foreground activation／management capabilityは未広告のため、Codexはクリックや認証入力を行わない。provider操作には別途`chrome_foreground_activation_capability_unavailable`が残る。
- Local desktop verification: PASS。31機能台帳と`1280/1440/1920/2560px`の228セルを再実行で全件確認した。これはlocal previewのUI契約証跡であり、Mac／Windowsの実Chrome実機受入れやproduction provider完了の代用ではない。
- Foreground operation blocker（read-only target admissionとは分離）: `chrome_selected_tab_readback_invalid` / `chrome_foreground_activation_capability_unavailable`。
- Next action: ユーザーがProfile 2のHeavy画面でログイン／workspace・brand準備を完了した後、新規browser-clientの`openTabs()`→正確なHeavy descriptor→target-scoped readbackを1回行う。hydratedなら、foreground capability広告を別ゲートとして確認し、承認済みGallery素材1件の権利確認→fabric生成→結果→保存→Gallery/Canvas/History/Jobs→再利用へ進む。
- Restart point: ユーザーによるHeavy認証・workspace／brand準備の状態変化後のfresh Profile 2 owner。同一runで`/tools/fabric`の認証済みworkspaceとtextile assetを確認してから次へ進む。selected／claim／focus／foreground lease復旧、旧binding再利用、別surface fallbackは行わない。
- provider生成、録画、AOS、effectfulなUI操作はselected/owner proofが揃うまで開始しない。deployは別のsource・runtime・fresh target readback gateで扱い、今回のdeployment `6a85ecc3f1ea67ebf4ea67bc` はそのreadbackまで確認済み。

## 最新確認（2026-08-20、authenticated target-scoped readback r9）

- ユーザー申告どおり、Heavyのログインボタンを押す必要はなかった。新規公式Profile 2 browser-client `-ada4-4997-8241-a6447bcb922e`で`/tools/fabric`を公式provisionし、同一run内で準備中表示からhydratedなワークスペースへ遷移した。
- `生地イメージ`、`生成履歴`、モデル／生地入力、Gallery選択、素材バリエーション、権利確認、`AI生成`が表示された。これにより`heavy_target_workspace_authentication_not_ready`は今回のfresh runについて解消した。
- 作成したtask-owned tab `1980903820`だけを公式cleanupし、`cleanup_verified=true`。クリック、認証情報入力、アップロード、権利承認、provider生成、保存、再利用、録画、AOS変更、外部効果は行っていない。
- 証跡: `work/heavy-chain-target-scoped-authenticated-readback-20260820-r9.md`。
- 現在の停止点は`chrome_foreground_activation_capability_unavailable`。foreground capabilityが広告されるまでprovider生成・保存・再利用へ進めない。

## 最新の再開点

fresh official Profile 2 ownerでforeground capabilityが広告された後、承認済みのfabric-print 1件を、生成→結果→保存→Gallery／Canvas／History／Jobs→再利用→reloadの同一runで確認する。その後にAIフィッティングを同じ契約で確認する。旧binding、旧tab、旧Runは再利用しない。

## Lightchain現行homepage baseline（2026-08-20 r14）

- Fresh official Profile 2 target-scoped readbackで、現行homepageの4カテゴリ、8件のおすすめカード（非動画7件・動画1件）、事例共有6タブを確認した。
- 現行おすすめカードは、デザインワークスペース、マーケティングワークスペース、AIフィッティング、ウェアデザインラボ、動画ワークステーション、モデル企画ライブラリ、ファッションスタジオ、デザインエージェント。
- カテゴリ切替後の全カード、正確なroute/href、機能別の生成・結果・保存・再利用・エラー・性能は未確認。`PENDING_CONFIRMATION`のまま扱う。
- 証跡: `work/lightchain-parity-baseline-20260820-r14.md`。Heavyでは動画カード・動画導線を引き続き除外する。

## Lightchainカテゴリ台帳確定（2026-08-20 r15）

- Fresh target-scoped readbackでカテゴリパネルを順番に確認した。おすすめ8（非動画7）、企画デザイン9、AIフィッティング6（非動画5）、グラフィック5で、非動画のカテゴリ出現は合計26、動画は2。
- 重複カードはカテゴリごとの出現としてLightchainに合わせる。Heavyのlauncher/workbenchはこの26非動画出現を維持し、動画2出現を除外する。
- 証跡: `work/lightchain-category-ledger-20260820-r15.md`。正確なhref/routeと、カードごとの生成・結果・保存・再利用・エラー・性能は引き続き`PENDING_CONFIRMATION`。
- Heavy local launcherとの照合はfocused test `3/3` PASS（カテゴリ7/9/5/5、重複カード、動画除外、内部状態ラベル非表示）。これはlocal UI契約であり、production業務挙動の証明ではない。

## 2026-08-20 再読み込み後の入力復帰修正

- JobsからWorkBenchへ戻る際、provider結果artifactの`materialSlotFiles`形式もresume入力として読めるようにした。
- 印刷画像と全非動画providerルートの結果artifactへ、同じ入力を再現できる正規化`materialSlots`を保存する。
- `data:`／`blob:`／`local:`／相対URLだけを復元し、署名付きremote URLは復元しない。期限切れURLの再利用を防ぎ、Libraryからの再選択へ戻す。
- resume input 4/4、provider coverage 11/11、Canvas handoff 2/2、typecheck、全非動画31機能（`featureCount=31 / failed=[]`）、diff checkをPASS。commit `ace5c4c`。
- これはlocal実装証跡。Heavy本番の認証／workspace準備、provider生成、保存・再利用、録画、β受入れは未確認。

## 2026-08-20 AIフィッティング再開契約の確認

- Fitting resilience 4/4、resume input 9/9、history readback 10/10、material contract 13/13をPASS。
- 失敗時の直前結果保持、全件永続化後の結果／履歴昇格、canonical source path復元、署名付きremote URLの再利用拒否を確認した。
- local契約はfabric／printingと同じ共通結果系譜へ接続済み。Heavy本番の認証、provider生成、Gallery／Canvas／History／Jobs保存再利用は認証gate解除後に同一runで確認する。

## 2026-08-20 β静的ゲート監査

- H601 legal-safety `ok=true`、internal UX `ok=true`。
- G619は`acceptance=not_claimed`、実セッション0件、manifest未作成。実参加者の同意・観察・赤字確認なしに受入れ扱いへ進めない。
- H601 operator readinessは、最終Terms／Privacy、保持削除・upload rights・brand/reference・person likeness・claims・commercial wording、operator decision JSONの添付待ち。
- 現時点の本番再開条件は、Heavy Profile 2の認証／workspace準備完了後のfresh target-scoped readback。録画・外部効果・課金・公開・OTP/CAPTCHAは対象外のまま維持する。

## 2026-08-20 共通結果系譜・デスクトップ回帰

- Workspace Activity／Jobs・History routing 12/12、provider persistence/readback 12/12、Library→Canvas 1/1、Canvas generation/readback 5/5をPASS。
- desktop layout 228/228を1280／1440／1920／2560pxで再確認し、global timeoutなし。local previewの確認であり、Mac／Windows実Chrome受入れの証明ではない。
