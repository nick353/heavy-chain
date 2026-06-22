# Lightchain Parity User Workflows

作成日: 2026-06-21

入力正本:
- `/Users/nichikatanaka/Downloads/heavychain_linkaigc_review_20260621/heavychain_feature_takeaways.md`
- 現在の Heavy Chain 実装
- `output/playwright/workspace-studio-video-lab-20260621/manifest.json`
- `output/playwright/workspace-local-handoff-20260621/manifest.json`
- `output/playwright/workspace-real-intake-local-20260621/manifest.json`
- `output/playwright/fitting-parity-20260621/manifest.json`
- `output/playwright/marketing-parity-20260621/manifest.json`
- `output/playwright/local-artifact-readback-20260621/manifest.json`
- `output/playwright/marketing-best-effort-remote-save-20260621/manifest.json`
- `output/playwright/marketing-edge-function-save-20260621/manifest.json`
- `output/playwright/fitting-durable-persistence-20260621/manifest.json`
- `output/playwright/workspace-generation-seed-local-20260621/manifest.json`
- `output/playwright/workflow-query-prefill-local-20260621/manifest.json`
- `output/playwright/lab-evaluation-local-20260622/manifest.json`
- `output/playwright/workflow-board-local-20260622/manifest.json`
- `output/playwright/pattern-preview-local-20260622/manifest.json`
- `output/playwright/studio-selection-local-20260622/manifest.json`
- `output/playwright/video-storyboard-local-20260622/manifest.json`
- `output/playwright/generation-context-readback-local-20260622/manifest.json`
- `output/playwright/generation-source-provenance-local-20260622/manifest.json`
- `output/playwright/model-library-local-20260622/manifest.json`
- `output/playwright/pattern-structured-context-local-20260622/manifest.json`
- `output/playwright/source-context-summary-local-20260622/manifest.json`
- `output/playwright/production-parity-readback-20260622/summary.json`
- `output/playwright/production-parity-readback-20260622/prod-db-readback.json`
- `output/playwright/production-parity-readback-20260622/prod-cleanup.json`
- `output/playwright/production-parity-readback-20260622/rate-limit-db-proof-2.json`
- `output/playwright/production-parity-readback-20260622/rate-limit-cleanup-2.json`
- `output/release-prep/production-parity-20260622/public-auth-qa/qa-summary.json`
- `output/release-prep/production-parity-20260622/release-doctor.txt`
- `output/release-prep/production-parity-20260622/browser-use-current`

## 結論

Heavy Chain は、単体の画像生成サービスではなく、アパレル業務別の AI ワークスペース群として育てるのが最短です。Lightchain で実際に観察した価値は「商品素材を入れる、業務目的を選ぶ、生成/編集/履歴/再利用まで同じ場所で進める」体験にあります。

AI フィッティングとマーケティングの parity MVP は実装済みで、2026-06-22 に production deploy/readback まで完了しました。commit `977ddb60e88de032c902c10df7622c401e6d77e1` は `origin/main` に push 済みで、`deploy-edge-functions.sh` により `generate-image`、`remove-background`、`upscale`、`colorize`、`generate-variations`、`design-gacha`、`product-shots`、`model-matrix`、`multilingual-banner`、`optimize-prompt`、`marketing-workspace-artifact`、`bulk-download`、`share-link` が production project `ghwjymozrwmcrpjqvbmo` へ deploy 済みです。production readback は `output/playwright/production-parity-readback-20260622/summary.json`、`prod-db-readback.json`、`prod-cleanup.json`、`rate-limit-db-proof-2.json`、`rate-limit-cleanup-2.json` に保存済みで、public auth QA は `output/release-prep/production-parity-20260622/public-auth-qa/qa-summary.json`、doctor proof は `output/release-prep/production-parity-20260622/release-doctor.txt`、browser-use current proof は `output/release-prep/production-parity-20260622/browser-use-current` です。Marketing は `marketing-workspace-artifact` で job/image/storage readback と `image_url: null` を確認済みです。Fitting/Models は `model-matrix` で Street LOOK 30s の `regular / 30s / medium / medium` source metadata と usage/run/storage readback を確認済みです。cleanup remaining users は `0`、`release:doctor` は全項目 OK です。

`/studio` `/models` `/patterns` `/video` `/lab` は local artifact、Canvas、Gallery、History に接続済みで、2026-06-21 の `workspace-generation-seed-local-v1` ではモデル、ポーズ、背景、動画構成、評価軸などを構造化して保存し、その保存内容から Gallery の「この内容で生成」または History の「生成へ進む」で `/generate` へ戻れるようになりました。2026-06-22 の `generation-context-readback-local-v1` では、その `/generate` 遷移に `sourceWorkspace`、`workflowVersion`、`sourceLabel`、`sourceResumePath`、`sourceMode` を載せ、生成エディタ側で allowlist hydrate した再開バナーと元ワークスペースへ戻るリンクを表示できるようにしました。続く `generation-source-provenance-local-v1` と `source-context-summary-local-v1` では、その状態で生成ボタンを押した結果を source provenance 付き local artifact として保存し、Gallery detail と History timeline にユーザーが読める `生成条件` を表示します。`/models` は `Street LOOK 30s` と `regular / 30s / medium / medium`、`/patterns` は `Bandana Grid`、`Smoke chain motif`、`参照素材: なし` まで確認済みです。`/patterns` は `pattern-structured-context-local-v1` で、Bandana Grid などの `selectedPatternPreview` と、モチーフ、リピート、対象アイテム、パレット、ベクター化方針、参照素材を `/generate` の `design-gacha` request body と生成後 local artifact の provenance まで保持できるようになりました。参照素材が空欄でも `patternContext` は落ちません。次の残件は deploy/readback ではなく、`/studio` `/patterns` `/video` `/lab` を実生成と server-side workflow/readback へ接続することです。

## Lightchain で観察した機能群

### 1. マーケティングワークスペース

Lightchain は、EC、SNS、ブランド、店舗/オフライン、ライブコマース、プロモーションを同じ販促ワークスペースから選ばせます。ユーザーは商品画像をアップロードし、用途やテンプレートを選び、プロジェクトボードを生成して、AI アシスタント、レイヤー設定、デザイン補助、進捗表示を見ながら編集します。

観察結果では EC 生成がクレジットを消費してプロジェクトを作成しましたが、3分以上 20% の「分析中...」で停滞しました。Heavy Chain で再現する場合、進捗、失敗、再試行、キャンセル、履歴復帰を最初からジョブ UI として扱う必要があります。

### 2. AI フィッティング

Lightchain の AI フィッティングは、1から4枚の衣服画像をアップロードし、必要に応じて平置き画像へ変換し、説明生成、参考画像、モデルセット写真のタブを使って生成条件を整えます。スマートモード、1K 品質、生成履歴があり、テストでは Heavy Chain のネイビー T シャツ画像から白背景のモデル着用画像を作れました。

ユーザーにとっては、EC 商品ページや SNS に使える着用イメージを素早く作る機能です。単純な画像生成より、衣服画像、モデル条件、品質、履歴、再生成がまとまっていることが価値です。

### 3. 企画/デザイン系ツール

Lightchain には、素材や参照画像からのインスピレーション生成、服飾ディテールのカスタム、トレンド企画、提案方向、プリント生地シミュレーション、線画から実写、色変更、平面図ベクトル化、ブランドスタイルなどが並びます。

ユーザーは、完成画像を一発で出すだけでなく、企画初期の方向性、素材検討、バリエーション確認、ブランドらしさの維持に使います。Heavy Chain では `/studio` と `/lab` がこの入口になれます。

### 4. グラフィック/パターン系ツール

Lightchain は、AI グラフィック生成、総柄/パターン生成、パターンのベクトル変換、柄の差し替え、プリントデザイン、服へのシミュレーションを提供します。

ユーザーは T シャツ、布地、総柄、販促画像を横断して「柄を作る、配置する、服に載せる、書き出す」流れで使います。Heavy Chain では既存の画像生成、キャンバス、ギャラリーに接続すると自然です。

### 5. モデル、スタジオ、動画、ラボ

Lightchain には、顔、ポーズ、体型、肌色を選ぶモデルライブラリ、服やシーンや小物を組み合わせる Fashion Studio、販促動画や着せ替え動画の Video Workstation、展示/店舗シミュレーションなどの Lab があります。

ユーザーは、商品単位の画像だけでなく、ブランドの見せ方、モデル統一、短尺動画、店舗展開の仮説検証に使います。Heavy Chain では `/models` `/studio` `/video` `/lab` がこの機能群の足場です。

## Heavy Chain の現在対応状況

### 実装済みの導線

Heavy Chain は React/Vite/TypeScript の protected workspace として、`/dashboard`、`/generate`、`/fitting`、`/marketing`、`/studio`、`/models`、`/patterns`、`/video`、`/lab`、`/history`、`/jobs`、`/credits`、`/canvas`、`/gallery`、`/brand/settings` を持っています。ナビゲーションにも AI フィッティング、マーケティング、スタジオ、モデルライブラリ、柄・グラフィック、動画、ラボが追加済みです。

`/fitting` は、衣服画像アップロード、商品説明、体型/年代/性別の選択、`model-matrix` API 呼び出し、生成結果プレビュー、ローカル生成履歴、失敗表示、再試行、ローカル成果物保存、履歴からの Canvas handoff を持つ実ワークフロー画面です。`output/playwright/fitting-parity-20260621/manifest.json` で desktop success、desktop failure/retry、mobile success、console/page error なしが確認されています。`output/playwright/local-artifact-readback-20260621/manifest.json` で Gallery/History の読み戻しと Fitting 履歴からの Canvas handoff も確認済みです。

`/marketing` は、商品画像アップロード、EC/SNS/ブランド/店舗/ライブ配信/プロモーションのチャネル選択、テンプレート選択、キャンペーンコピー、ローカル生成ジョブ、進捗、停滞、失敗、再試行、キャンバスへの handoff、成果物保存を持つ実ワークフロー画面です。`output/playwright/marketing-parity-20260621/manifest.json` で desktop failure/retry、desktop canvas handoff、mobile marketing、console/page error なしが確認されています。`output/playwright/local-artifact-readback-20260621/manifest.json` で Gallery/History の読み戻しと Marketing 画面からの Canvas handoff も確認済みです。

2026-06-21 の追加スライスで、Marketing の Canvas handoff は best-effort remote save を行うようになりました。Storage upload が RLS などで失敗した場合は DB write を行わず local fallback します。Storage upload 後に `generation_jobs` または `generated_images` insert が失敗した場合は、job delete と Storage remove を独立に試して orphan object を抑えます。remote success 時も local mirror は保持しますが、Gallery/History の通常表示からは除外して重複を避けます。`output/playwright/marketing-best-effort-remote-save-20260621/manifest.json` で fallback readback、remote success readback、Gallery/History の単一表示が確認されています。

同日の次スライスで、この client-side best-effort path は `marketing-workspace-artifact` Edge Function 経由へ移行しました。ブラウザは `supabase.functions.invoke('marketing-workspace-artifact')` だけを呼び、JWT 認証、brand editor 権限確認、service-role Storage upload、`generation_jobs` / `generated_images` insert、partial failure cleanup は Function 側に集約します。2026-06-22 の production readback では、`marketing-workspace-artifact` の job/image/storage readback と `image_url: null` を確認済みです。

Fitting も同じ server-backed persistence へ揃えました。既存の `model-matrix` Edge Function が `generation_jobs` を作成し、生成画像を `generated-images` Storage に保存し、各 `generated_images` を `job_id` 付きで insert します。失敗時は job failed 更新、insert 済み image row 削除、Storage remove を試み、ブラウザ側には `jobId`、`imageId`、`storagePath`、`persistenceStatus`、`cleanupStatus` を返します。Fitting 画面の local mirror は Canvas handoff 用に残し、remote success artifact は Gallery/History のローカル一覧から除外して重複を避けます。`output/playwright/fitting-durable-persistence-20260621/manifest.json` で Function mock readback、direct Storage/REST write なし、History/Canvas handoff、full smoke が確認されています。

Gallery と History は、Supabase の `generated_images` / `generation_jobs` に加えてローカル成果物をマージして表示します。Marketing と Fitting/Models は production DB/Storage/job readback まで確認済みで、ユーザーは fitting/marketing/studio/patterns/video/lab の出力を検索し、詳細を開いて確認できます。Canvas handoff は、Marketing 画面の「キャンバスへ渡す」、Fitting 画面の履歴「編集」、Studio/Patterns/Video/Lab の「保存してCanvasへ」から行います。

`/studio`、`/video`、`/lab` は、2026-06-21 に追加されたワークスペースです。`output/playwright/workspace-studio-video-lab-20260621/manifest.json` で desktop/mobile の `/studio` `/video` `/lab` 表示、ボタン検出、console/page error なしが確認されています。`output/playwright/workspace-local-handoff-20260621/manifest.json` では、それぞれが local artifact を保存し、Canvas project を作成し、Gallery/History から読み戻せること、かつ direct Supabase Functions/Storage/REST write/delete が発生しないことを確認しています。`output/playwright/workspace-real-intake-local-20260621/manifest.json` では、各 route の `workflowVersion`、`inputs`、`plan`、`status`、`resumePath`、`handoffKind`、`primaryInput`、`nextStep` が local artifact と Canvas image/text object に残り、Gallery detail と History timeline から読み戻せることを確認しました。`output/playwright/workspace-generation-seed-local-20260621/manifest.json` では、保存した local artifact と Canvas object に `generationIntent` が残り、Studio は `model-matrix`、Video は 4:5 を含む `campaign-image`、Lab も `campaign-image` として `/generate` に prefill できることを確認しています。`output/playwright/generation-source-provenance-local-20260622/manifest.json` では、source context を持つ `/generate` から生成した結果が local artifact metadata に出所を保持し、Gallery detail と History timeline から元ワークスペースへ戻れることを確認しています。

2026-06-22 の `model-library-local-v1` slice で、`/models` はモデル候補の生成前インテークとして追加されました。ユーザーは Clean EC 20s、Street LOOK 30s、Premium AD 40s の候補カードを選び、顔、ポーズ、体型、肌色、年齢層、利用目的、商品説明をフォームへ同期できます。保存時は実生成済みとは扱わず、決定的 SVG preview と `selectedModelCandidate`、さらに `modelMatrixBodyTypes` / `modelMatrixAgeGroups` / `modelMatrixSkinTone` / `modelMatrixHairStyle` を local artifact metadata、`workflow.inputs`、`workflow.plan`、top-level metadata、Canvas image object parameters に残します。`generationIntent` は `model-matrix` へ接続し、prompt には選択したモデル条件と商品説明を入れ、href には model-matrix の構造化 query も載せます。親 Playwright proof は `output/playwright/model-library-local-20260622/manifest.json` に保存済みで、Street LOOK 30s 選択、Canvas handoff、Gallery detail、History readback、`/generate` source banner、`regular/30s/medium/medium` の request body、生成ボタン後の `標準 × 30代` 結果、Supabase REST mutation なし、mocked `/functions/v1/model-matrix` 1回、console/page error なしを確認しています。`source-context-summary-local-v1` では、生成後の Gallery detail と History timeline に `生成条件` として `Street LOOK 30s` と `regular / 30s / medium / medium` が表示されるところまで確認しました。production readback でも `model-matrix` が Street LOOK 30s の `regular / 30s / medium / medium` source metadata と usage/run/storage readback を返すことを確認済みです。

2026-06-22 の `studio-selection-local-v1` slice で、`/studio` は生成前スタジオ設定としてモデル、ポーズ、背景の静的候補カードを持つようになりました。各カードは `aria-pressed` を持ち、選択すると既存の `modelProfile`、`pose`、`background` 入力へ同期します。保存時は実生成済みとは扱わず、選択内容から決定的 SVG preview を作り、`selectedStudioSetup` と `preview` を local artifact metadata、`workflow.inputs`、`workflow.plan`、top-level metadata、Canvas image object parameters に残します。`workflowVersion` は Studio のみ `studio-selection-local-v1` で、Gallery の「この内容で生成」と History の「生成へ進む」はこれまで通り `model-matrix` の prompt readback へ戻します。`output/playwright/studio-selection-local-20260622/manifest.json` で、Street 30s / 3/4 Walk / Concrete Gallery の選択、Canvas handoff、Gallery/History から `model-matrix` への再開、mobile 表示、SVG metadata marker、Supabase Functions/Storage/REST mutation なし、console/page error なしを確認済みです。残件は、Studio 固有の scene/studio composition を実生成ジョブと server-side readback に接続することです。

`/patterns` は、2026-06-22 に追加された柄・グラフィック用ワークスペースです。ユーザーはグラフィック、総柄、ベクター化のモードを切り替えながら、モチーフ、リピート、対象アイテム、パレット、ベクター化方針、参照素材を構造化して保存できます。保存すると `graphic-pattern-workspace` の local artifact と Canvas project が作られ、Gallery/History から読み戻して `design-gacha` に prefill できます。最初の `pattern-workspace-local-v1` は brief と再利用導線を確認し、次の `pattern-preview-local-v1` では Emblem Lockup、Bandana Grid、Vector Path Caps の決定的 SVG プレビューを画面に表示し、選択中のプレビューを `selectedPatternPreview`、`previewMetadata`、Canvas image object、Gallery/History readback に残すところまで進めました。`output/playwright/pattern-preview-local-20260622/manifest.json` で Bandana Grid 選択、SVG 内の `selected-pattern-preview:bandana-grid` と `repeatSignature:half-drop-bandana-grid`、`/patterns` -> Canvas -> Gallery `この内容で生成` -> History `生成へ進む`、mobile preview 表示、Supabase Functions/Storage/REST mutation なし、console/page error なしを確認しています。

`/video` は、`video-storyboard-local-v1` で生成前 storyboard selector を持つようになりました。ユーザーは Launch Reel、Texture Close-up、Fit Check CTA を選べます。各カードは `aria-pressed` を持ち、選択すると既存の尺、比率、ショット構成、字幕CTA、素材に同期されます。保存時は実レンダー済みとは扱わず、決定的 SVG preview と `selectedVideoStoryboard` を local artifact metadata、`workflow.inputs`、`workflow.plan`、top-level metadata、Canvas image object parameters に残します。`generationIntent` は `campaign-image` のまま維持し、prompt には storyboard label、shot order、motion、framing、CTA、materials、format を入れます。親 Playwright proof は `output/playwright/video-storyboard-local-20260622/manifest.json` に保存済みで、desktop card selection、SVG marker readback、Canvas/Gallery/History readback、mobile render、Supabase Functions/Storage/追跡対象REST mutation なしを確認しています。

`/lab` は、`lab-evaluation-local-v1` で生成前の評価候補 selector を持つようになりました。ユーザーは Material Lighting、Retail Readiness、Campaign Transfer を選べます。各カードは `aria-pressed` を持ち、選択すると仮説、プロンプト案、評価軸、採用候補に同期されます。保存時は実生成済みとは扱わず、決定的スコア、SVG preview、`selectedLabExperiment` を local artifact metadata、`workflow.inputs`、`workflow.plan`、top-level metadata、Canvas image object parameters に残します。`generationIntent` は `campaign-image` のまま維持し、prompt には experiment label、deterministic score、decision、hypothesis、axis、candidate を入れます。親 Playwright proof は `output/playwright/lab-evaluation-local-20260622/manifest.json` に保存済みで、Retail Readiness selection、SVG marker readback、Canvas/Gallery/History readback、mobile render、Supabase Functions/Storage/追跡対象REST mutation なしを確認しています。

Dashboard の QuickWorkflows は `output/playwright/workflow-query-prefill-local-20260621/manifest.json` のスライスで `/generate` と同じ workflow metadata を参照するようになり、`output/playwright/workflow-board-local-20260622/manifest.json` のスライスで `/workflows/:workflowId` のローカルワークフローボードへ接続されました。ユーザーが「EC商品画像セット」「SNSキャンペーンセット」「デザイン探索」「グローバル展開セット」を押すと、まず進捗、業務手順、成果物候補、関連ワークスペース、Canvas 導線を確認できます。`デザイン探索` の関連ワークスペースは `/patterns` に接続され、総柄プリント案やベクター化メモを詰められます。そこから「生成へ進む」を押すと、`/generate?workflow=...` が既存の `product-shots`、`campaign-image`、`design-gacha`、`multilingual-banner` エディタを開き、商品説明、キャンペーンコピー、比率、言語、ショット、生成数を業務別に初期化します。この board 表示と query hydration だけでは Supabase Functions、Storage upload/remove、REST mutation は発生しません。

### 既存基盤として使えるもの

Heavy Chain には、認証、ブランド設定、クレジット、ジョブ、履歴、ギャラリー、キャンバス、生成系 Edge Functions、Supabase storage/DB まわりの release 証跡があります。production app は 2026-06-22 時点で commit `977ddb60e88de032c902c10df7622c401e6d77e1` の push、Edge Functions deploy、production readback、public auth QA、release doctor all OK まで完了しています。次の Goal は deploy/readback ではなく、既存ワークスペース体験を実生成と server-side workflow/readback に接続する単位で切るべきです。

## 未実装差分

1. AI フィッティングは、parity MVP としてファイル選択、画像 data URL の API 引き渡し、生成 API 接続、結果プレビュー、ローカル履歴、失敗時の再試行、Gallery/History 保存、Canvas 編集 handoff まで実装済みです。さらに `model-matrix` Edge Function 経由でサーバー側 `generation_jobs`、Storage、`generated_images` への永続化と production readback まで確認済みです。後続差分は、複数端末/再ログイン後の通常 UI readback、削除/再生成、progress/timeout/retry/failed state、credit readback を server state に接続することです。

2. マーケティングは、parity MVP として商品画像アップロード、ローカルジョブ、停滞/失敗/再試行、キャンバスプロジェクト生成、Gallery/History 保存まで実装済みです。best-effort remote save は `marketing-workspace-artifact` Edge Function/service-role 経路へ移行し、production readback で job/image/storage と `image_url: null` を確認済みです。サーバー側進捗 readback、AI アシスタントの実処理、永続プロジェクト保存、クレジット readback は後続差分です。

3. `/studio` `/models` `/patterns` `/video` `/lab` は local artifact、Canvas、Gallery、History への handoff に加えて、生成前インテークの構造化保存と `/generate` への再利用導線まで実装済みです。Studio はモデル、ポーズ、背景、小物、商品ライン、参照画像を保存し、`model-matrix` の商品説明へ戻せます。Models は顔、ポーズ、体型、肌色、年齢層、利用目的、商品説明を保存し、`model-matrix` のモデル条件へ戻せます。`model-library-local-v1` の親 proof は `output/playwright/model-library-local-20260622/manifest.json` です。Patterns はモチーフ、リピート、対象アイテム、パレット、ベクター化方針、参照素材を保存し、さらに決定的 SVG プレビュー候補を選んで Canvas/Gallery/History に残し、`design-gacha` のプロンプトへ戻せます。Video は尺、比率、ショット構成、字幕CTA、素材に加えて storyboard 候補、motion、framing、CTA、format を保存し、`campaign-image` へ戻せます。`video-storyboard-local-v1` の親 proof は `output/playwright/video-storyboard-local-20260622/manifest.json` です。Lab は仮説、プロンプト案、評価軸、採用候補に加えて、評価候補、決定的スコア、decision/risk、`selectedLabExperiment`、SVG preview を保存し、`campaign-image` のベースコンセプトへ戻せます。Lab の `lab-evaluation-local-v1` の親 proof は `output/playwright/lab-evaluation-local-20260622/manifest.json` です。AI による実際の総柄生成、ベクター変換、衣服シミュレーション、シーン/小物合成、動画生成、店舗/展示シミュレーション、実験結果の server-side 保存、既存アセットとの深い接続は未実装です。

4. QuickWorkflows は各業務をローカルワークフローボードと既存生成エディタの初期入力へ接続済みです。Lightchain のように実ジョブ進捗、複数成果物セット、再開可能な server-side workflow として保存する部分は未実装です。

## ユーザーが各機能をどう使うか

AI フィッティングでは、ユーザーは衣服画像を入れ、モデルや品質を選び、EC に使える着用画像を生成します。成功後は生成結果をその場で確認し、Gallery/History で探し直し、履歴の編集ボタンから Canvas に渡して商品画像として整えます。

マーケティングでは、ユーザーは商品画像と販促目的を選び、EC/SNS/店舗などのテンプレートを使ってプロジェクトを作ります。生成が長くなる前提で、進捗、停滞、失敗、再試行を確認し、Canvas に渡したあとも Gallery/History からコピーや素材を読み戻せます。

Dashboard のクイックワークフローでは、ユーザーは「EC商品画像セット」「SNSキャンペーンセット」「デザイン探索」「グローバル展開セット」を選び、まずワークフローボードで進捗、作業手順、作るべき成果物、関連ワークスペース、Canvas への移動先を確認します。そこから「生成へ進む」を押すと、対応する `/generate` の生成画面へ入れます。ECなら標準カット、SNSなら縦長キャンペーン画像、デザイン探索なら複数案、グローバル展開なら4言語バナーが最初から入力された状態になり、ユーザーは内容を直して生成ボタンへ進めます。

スタジオでは、ユーザーは商品ライン、モデル、ポーズ、背景、小物、参照画像を入力し、さらにモデル候補、ポーズ候補、背景候補のカードから生成前スタジオ設定を選べます。選択はフォーム入力に同期され、保存すると決定的 SVG preview と `selectedStudioSetup` が Canvas/Gallery/History に残ります。あとで Gallery の「この内容で生成」または History の「生成へ進む」を押すと、保存した内容が `/generate` のモデルマトリクスに入った状態で再開できます。現時点では実画像生成ではなく、モデルライブラリやシーン合成へ進むための注文票を残し、次の生成画面へ渡す機能です。

モデルライブラリでは、ユーザーは EC標準、LOOK確認、広告検証の目的に合わせて Clean EC 20s、Street LOOK 30s、Premium AD 40s の候補を選びます。選ぶと顔、ポーズ、体型、肌色、年齢層、利用目的、商品説明がフォームに同期され、画面右側の SVG preview で候補条件を確認できます。保存すると `selectedModelCandidate` と model-matrix 用の正規化条件が Canvas/Gallery/History に残り、Gallery の「この内容で生成」から `/generate` のモデルマトリクスへ戻れます。生成後は Gallery detail と History timeline の `生成条件` で、どの候補と条件から作った画像かを読み戻せます。今回の proof では、Street LOOK 30s を選び、Canvas 保存、Gallery detail、History、`/generate` source banner、`bodyTypes=regular` / `ageGroups=30s` / `skinTone=medium` / `hairStyle=medium` の生成条件、生成ボタン後の `標準 × 30代` 結果、remote mock の Gallery/History readback、production `model-matrix` の usage/run/storage readback まで確認しました。

柄・グラフィックでは、ユーザーはグラフィック、総柄、ベクター化のどれを進めるか選び、柄のモチーフ、リピート方式、載せる服、色、刺繍やシルクスクリーン向けのベクター整理方針を入力します。画面上では Emblem Lockup、Bandana Grid、Vector Path Caps のプレビュー候補を見比べ、選んだ候補を保存できます。保存すると Canvas に選択プレビュー画像付きで渡って企画ボード化でき、Gallery/History から再開すると `design-gacha` に同じ条件が入った状態になります。生成ボタン後も、`selectedPatternPreview` と motif/repeat/garment/palette/vector/reference の構造化値は request body と生成済み local artifact の `generationIntent` に残ります。生成後は Gallery/History の `生成条件` で、`Bandana Grid`、`Smoke chain motif`、`参照素材: なし` のように元条件を読めます。参照素材を空欄にした場合も、その空欄は `referenceAssets: ''` として保持され、他の pattern context が消えません。現時点では外部 AI 生成や本物のベクター変換ではなく、生成前の brief、選択プレビュー、再利用導線を固めた段階です。

動画では、ユーザーは尺、比率、ショット構成、字幕CTA、素材を入力し、さらに Launch Reel、Texture Close-up、Fit Check CTA の storyboard 候補を選べます。選択は入力欄へ同期され、保存すると決定的 SVG preview と `selectedVideoStoryboard` が Canvas/Gallery/History に残ります。あとで Gallery/History から生成へ進むと、保存した storyboard label、shot order、motion、framing、CTA、materials、format が `/generate` のキャンペーン画像 prompt に入ります。現時点では実レンダーではなく、`video-shot-plan` として後続の生成ジョブに渡す設計メモです。親 proof artifact は `output/playwright/video-storyboard-local-20260622/manifest.json` です。

ラボでは、ユーザーは仮説、プロンプト案、評価軸、採用候補を入力し、さらに Material Lighting、Retail Readiness、Campaign Transfer の評価候補を選べます。選択は入力欄へ同期され、決定的スコアと SVG preview が表示されます。保存すると `selectedLabExperiment` と preview metadata が Canvas/Gallery/History に残ります。あとで Gallery/History から生成へ進むと、保存した実験プロンプト、評価候補、スコア、decision が `/generate` のキャンペーン画像に入ります。すぐ本番生成に流さず、`lab-evaluation` として比較、採点、採用判断の根拠を軽く残す場所として使います。

## 次の実装順

推奨順は、次に `/studio` `/patterns` `/video` `/lab` を実生成と server-side workflow/readback へ接続することです。Marketing と Fitting/Models の production deploy/readback は完了しているため、次は未接続ワークスペースの生成ジョブ、Storage/DB readback、進捗、失敗復帰、途中編集、履歴復帰をサーバー状態に接続する価値があります。

1. `/studio` は scene/studio composition の実生成ジョブを作り、モデル、ポーズ、背景、小物、参照画像を server-side workflow と DB/Storage readback に残す。

2. `/patterns` は `design-gacha` を越えて、総柄生成、ベクター変換、衣服シミュレーションを durable job と readback に接続する。

3. `/video` と `/lab` は storyboard/video rendering と lab simulation を server-side workflow にし、成果物、評価条件、進捗、失敗復帰を Gallery/History から読めるようにする。

## Goal 用の完了条件

現在の Goal の次スライスは「未接続ワークスペースの実生成と server-side workflow/readback」です。完了条件は、認証済みユーザーが `/studio` `/patterns` `/video` `/lab` から作った実生成ジョブを Supabase DB/Storage の履歴、ギャラリー、キャンバスで読み戻せ、再ログインまたは別ブラウザ相当でも確認でき、進捗、成功、停滞/失敗、再試行、編集画面への handoff を Playwright で証跡化できることです。

停止条件は、外部 API キー、DB/RLS、支払い、クレジット課金仕様、新しい production deploy が必要になった時点です。その場合は実装を止め、必要な変更と proof path を明示して human approval を待ちます。
