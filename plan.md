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
3. `work/lightchain-profile2-non-video-card-ledger-20260819T082439.json` と parity matrix を現行証跡として更新する。

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

- 2026-08-20 03:39 JST、現行Lightchain本番をfresh official Chrome Plugin／Profile 2のtarget-scoped read-only laneで再確認した。homepageのURL/title/DOM readbackに成功し、4カテゴリ（おすすめ／企画デザインツール／AIフィッティング／グラフィックツール）と非動画ラベル（デザイン修正／柄・プリント）を確認した。task-owned tabは公式cleanup済み。証跡は `work/lightchain-profile2-fresh-readback-20260820-r2.md`。これは現行基準のreadbackであり、Heavyのprovider生成・保存・再利用の証明ではない。
- 同じ継続作業でHeavyのローカル検証を完了した。31機能台帳は`featureCount=31`／`failed=[]`でPASS。デスクトップ幅検証は再実行で`228/228`セル、`failed=0`、`1280/1440/1920/2560px`、preview cleanup完了を確認した。初回の4件は並列負荷による一時的な`operation_timeout`で、再実行では再現しなかった。証跡は `output/playwright/unified-desktop-layout-current-rerun/SUMMARY.json`。
- 2026-08-20 03:31 JST、社内βの全員利用要件と矛盾するハードコード済み旧プランロック表示を統合ワークスペースから除去し、commit `633ddf79faedf81fb304ca194a2f4a623bac1c29` をZeabur deployment `6a85f5bcf1ea67ebf4ea683b` として`RUNNING`反映した。fresh Profile 2 target-scoped readbackで新bundleの `/tools/fabric` を確認し、`権限がありません`／`permission-locked` は0件、Lightchain-shaped入力・権利確認・AI生成・生成履歴は表示された。証跡は `work/heavy-production-beta-unlock-readback-20260820-r1.md`。これはUI反映のPASSであり、provider生成・保存再利用の完了証明ではない。
- localのLightchain parity／material／provider／persistence契約と31機能・desktop QAは検証済み。Zeabur deployment `6a85ecc3f1ea67ebf4ea67bc` は `RUNNING` となり、fresh Profile 2 target-scoped readbackで `/tools/fabric` のLightchain-shaped direct material frameを確認した。ただしprovider生成・保存再利用のproduction完了ではない。
- 2026-08-20 03:08 JSTのfresh Profile 2 target-scoped readbackでは、Heavy `/tools/fabric` がログイン／準備中シェルではなく、hydratedなLightchain-shaped `生地イメージ`ワークスペースを表示した。認証ゲートと画面hydrationはPASS。ただし `権限がありません`、入力未選択、foreground操作未実施のため、provider生成・権利確認・保存再利用の完了証明ではない。証跡は `work/heavy-chain-authenticated-target-readback-20260820-r5.md`。
- 2026-08-20 03:20 JST、source-associated deployment `6a85f3012a82f89733777475` が commit `6831f365b489ec35a8bafce11e96cfc4c88cd0b7` で `RUNNING`。HTTP `200`、container localhost `200`、fresh Profile 2 `/tools/fabric` readbackでLightchain markersとHeavy-only chromeなしを確認した。証跡は `work/heavy-production-deployment-readback-20260820-r2.md`。provider生成・保存再利用は未実施。
- Goalの正本はこの `Plan.md`、Goal stateは `work/codex-goal-run-context-20260819.json`、詳細な履歴は `plan.md` に保持する。
- 現行Chrome Plugin／Profile 2はfresh `openTabs()`後も`selected()=null`で、署名済み拡張は`viewport`のみを広告している。foreground activation capabilityは未広告である。

## Exact blocker / next action / restart point

- Target-scoped canary transport: PASS。rev6のfresh browser-clientでHeavy `/tools/fabric`を公式provisionし、同一runのURL/title/DOM readbackとtask-owned cleanupを確認した。
- Source-associated deployment/runtime/UI gate: PASS。deployment `6a85f3012a82f89733777475` は `nick353/heavy-chain@6831f36`、`docker`、`RUNNING`。HTTP/container/fresh Profile 2 UI readbackを同一の反映後状態で確認した。
- Beta unlock UI gate: PASS。deployment `6a85f5bcf1ea67ebf4ea683b` は `nick353/heavy-chain@633ddf7`、`docker`、`RUNNING`。fresh target-scoped readbackで旧プランロック表示0件を確認した。実際のブランド・権利・provider・保存の安全ゲートは維持している。
- Lightchain current parity readback: PASS。rev6のfresh Profile 2でhomepage、4カテゴリタブ、非動画おすすめ7件／動画除外1件、事例23件／動画除外2件、`/tools/fabric`、`/tools/printing`、`/model`の入力・権限・終了導線を確認した。カテゴリ内全カードはLoadingのためPENDING_CONFIRMATION。
- Lightchain current homepage refresh: PASS。2026-08-20 03:39 JSTのfresh readbackで4カテゴリと非動画ラベル（デザイン修正／柄・プリント）を同一runで確認した。完全なカテゴリ内カード台帳は引き続きPENDING_CONFIRMATION。
- Authentication gate: PASS。fresh `/login` readbackはhydration後に`/lightchain`へ自動遷移し、`アカウント`、4カテゴリ、31非動画Libraryを確認した。最新のsource-associated beta-unlock readbackでも、ログイン／準備中シェルではなく、`生地イメージ`、素材入力、権利文言、`AI生成`、`生成履歴`を含むhydrated workspaceを確認した。最新証跡は `work/heavy-production-beta-unlock-readback-20260820-r1.md`。
- Common route readback: PASS。fresh同一runで`/lightchain`、`/gallery`、`/canvas/new`、`/history`、`/jobs`を15秒hydration後に確認した。Galleryは961枚、Historyは保存済み12件・失敗4件、Jobsは完了20件・失敗4件を表示した。新規provider生成からの同一run保存・再利用は未証明。
- Exact blocker: `chrome_selected_tab_readback_invalid` / `chrome_foreground_activation_capability_unavailable`（foreground操作）。target-scoped readback自体は成功している。製品所有のgarment/textile platform assetは実装・focused testで確認済みだが、同一runのUI選択・権利確認・生成・保存・再利用はforeground ownerが揃うまでPENDING_CONFIRMATION。Lightchainカテゴリ内全カードも現行readbackではPENDING_CONFIRMATION。
- Local desktop verification: PASS。31機能台帳と`1280/1440/1920/2560px`の228セルを再実行で全件確認した。これはlocal previewのUI契約証跡であり、Mac／Windowsの実Chrome実機受入れやproduction provider完了の代用ではない。
- Foreground operation blocker（read-only target admissionとは分離）: `chrome_selected_tab_readback_invalid` / `chrome_foreground_activation_capability_unavailable`。
- Next action: current Profile 2のforeground capability／selected-tab gateが解消したfresh ownerで、承認済みの製品所有Gallery素材を1件ずつ選び、権利確認→fabric生成→結果→保存→Gallery/Canvas/History/Jobs→再利用を同一runで確認する。今回のsource-associated deployment/UI readbackをforeground proofやprovider完了の代用にはしない。
- Restart point: fresh foreground owner/selected proof。そこでLightchainカテゴリ内カードを補完し、Heavyのapproved Gallery素材選択→権利確認→fabric生成→保存・再利用へ進む。provider生成・保存・再利用はowner／承認／同一run gateが揃うまで開始しない。
- provider生成、録画、AOS、effectfulなUI操作はselected/owner proofが揃うまで開始しない。deployは別のsource・runtime・fresh target readback gateで扱い、今回のdeployment `6a85ecc3f1ea67ebf4ea67bc` はそのreadbackまで確認済み。
