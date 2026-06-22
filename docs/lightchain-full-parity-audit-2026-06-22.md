# Lightchain Full Parity Audit

作成日: 2026-06-22

対象:
- Lightchain: `https://jp.linkaigc.com/`
- Heavy Chain root: `/Users/nichikatanaka/Desktop/アパレル１`
- Lightchain 実操作証跡: `output/playwright/lightchain-full-audit-20260622/`
- Heavy Chain 実装カタログ: `src/lib/lightchainParityCatalog.ts`
- Heavy Chain local proof: `output/playwright/lightchain-parity-hub-local-20260622/manifest.json`
- Generate request proof: `output/playwright/lightchain-parity-hub-local-20260622/generate-lightchain-request.json`
- Readback verifier proof: `output/playwright/lightchain-readback-fixture-local-20260622/manifest.json`

## 結論

Lightchain の体験は「ホームのタブから業務目的を選び、生成、保存、履歴、Canvas/編集へ戻る」ことが中心です。Heavy Chain 側では課金以外の入口を `Lightchain互換ホーム` として Dashboard に追加し、Lightchain の主要カード、企画タブ、AI フィッティング、グラフィック、画像編集、事例共有を Heavy Chain の既存ワークスペースへ対応付けました。`/generate` へ進む互換リンクは `lcFeature`、`lcTitle`、`lcTaskCodes` を持ち、生成リクエスト、Edge Function の `generation_jobs.input_params`、`generated_images.metadata`、保存メタデータへ `lightchainCompat` と `lightchainTaskSteps` として引き継ぎます。

現時点で本番 DB/Storage readback まで確認済みの領域は、Marketing、Fitting、Model Matrix、基本生成系です。Studio、Patterns、Video、Lab は local/workspace proof と production workspace generation closeout の土台があります。今回の追加分は local proof で、`lightchain_task_steps` による durable server-side step row のschema、Edge書き込み、UI read、collector projection、verifier fixtureまで接続しました。さらに画像編集系の `remove-background`、`upscale`、`colorize`、`generate-variations` も generation job と durable Lightchain step を保存する形へ拡張し、Canvas の直接編集、floating action、`ImageEditModal` からも選択画像の `lightchainCompat` を引き継ぐようにしました。次の深掘りはこのmigrationとEdge/Web bundleをproduction-equivalent環境へ適用し、実生成readbackで証明することです。

production-equivalent 反映前のゲートも強化しました。`lightchain_task_steps` migration は明示的に public/anon/authenticated の既定権限をrevokeし、`authenticated` には `SELECT/INSERT/UPDATE`、`service_role` には `ALL` をgrantします。`scripts/supabase-prod-verify.sh` はこの migration、RLS policy、grant、index を必須チェックに含めます。生成済み `output/` のLightchain監査artifactには第三者bundleが含まれるため、secret scan の対象からは外し、実装ソース、migration、script、docs を検査対象に残しました。

## 実操作で確認した Lightchain ホーム

ログイン後のトップ画面には `LIGHTCHAIN AI`、`アパレル特化のAIデザインワークスペース`、prompt 入力 `指示を入力してください... 例：『モデルの着せ替え』` がありました。上部タブは `おすすめ Hot`、`企画デザインツール`、`AIフィッティング`、`グラフィックツール` です。

`おすすめ` には次のカードが表示されました。

- マーケティングワークスペース
- AIフィッティング
- ウェアデザインラボ
- 動画ワークステーション
- モデル企画ライブラリ
- ファッションスタジオ
- デザインエージェント
- Lightchain Lab

`企画デザインツール` には、インスピレーション、ウェアデザインラボ、デザインエージェント、生地プリントの試着シミュレーション、線画から実写へ変換、色変更、平絵をベクター化、カスタムスタイルが表示されました。

`AIフィッティング` には、AIフィッティング、モデル企画ライブラリ、ファッションスタジオ、動画ワークステーション、画像修正が表示されました。

`グラフィックツール` には、AIグラフィックデザイン、パターンをベクター画像に変換、デザインアレンジ、プリントデザインが表示されました。

## Chunk から抽出した Lightchain task code

Lightchain の読み込み済み chunk から、以下の task code 群を確認しました。表層のカード名だけでなく、内部で使われている機能名を Heavy Chain 側の同等化対象にします。

| Lightchain task code | Heavy Chain の入口 | 現在の状態 |
| --- | --- | --- |
| `marketingCustom`, `GenerateMarketing` | `/marketing` | production readback 済み |
| `VirtualFittingV2`, `VirtualFittingBigSize`, `ChangeModel` | `/fitting`, `/models` | production readback 済み |
| `FittingModelChangeFace`, `FittingModelChangePosture`, `FittingModelChangeBackground`, `FittingModelChangeBodyShape`, `FittingModelChangePerspective`, `FittingModelCustomize` | `/models`, `/studio` | model-matrix readback 済み |
| `ClothingDesignFlux`, `seriesDesign`, `ClothingOrientationDesign`, `ClothingOrientationRedesign`, `ClothingOrientationDesignReplaceElement` | `/workflows/design-exploration`, `/lab` | workspace proof |
| `ChangePattern`, `FabricBody`, `DesignatedFabric`, `PrintingTiling`, `AddPrinting_Position`, `AddPrinting_Full` | `/patterns` | workspace proof |
| `GeneratePrinting`, `ModifyPrinting`, `OneClickModifyPrinting`, `PatternToVector`, `LineArtVectorConvert`, `SVGConvert` | `/patterns`, `/generate?feature=design-gacha`, `/generate?feature=generate-variations` | workspace + production base functions |
| `ChangeColor`, `OneClickChangeColor` | `/generate?feature=colorize` | production readback 済み |
| `GenerateSketch`, `LineArtToReal`, `GenerateFlatByModel`, `VirtualFittingConvertToFlat` | `/generate?feature=design-gacha`, `/fitting` | workspace proof |
| `GenerateShortVideo`, `GenerateShortVideoV2`, `StoryboardImage`, `StoryboardVideo`, `ActionReplicationVideo`, `EditingVideo`, `VideoBenchSr` | `/video`, `/workflows/sns-campaign` | workspace proof |
| `ClothingDisplayPicture`, `OutfitDisassemble`, `OneClickPrintingDerivative`, `PrintingExtraction`, `MultiPersonVirtualFitting`, `VirtualFittingUnderwear` | `/lab`, `/patterns`, `/fitting` | workspace proof |
| `CutOut`, `RemoveBackground`, `Sr`, `SrV2`, `ExpandImage`, `ExpandImageV2`, `EliminateV2`, `FixPartial`, `FixFace`, `DetailCompensation`, `IntelligentCropping` | `/generate?feature=remove-bg`, `/generate?feature=upscale`, `/canvas` | production base functions plus Canvas editing |

## Heavy Chain 側に追加した互換入口

`src/lib/lightchainParityCatalog.ts` に Lightchain 名、task code、Heavy Chain route、状態、証跡、ユーザーに見せる説明を集約しました。`src/components/LightchainParityHub.tsx` はそのカタログを Dashboard 上部に表示します。

`/generate` へつながるカードでは、Heavy Chain の通常生成画面に `Lightchain互換` バナーを表示します。生成ボタンを押すと、Edge Function へ渡す body に `lightchainCompat.lightchainFeatureId`、`lightchainCompat.lightchainFeatureTitle`、`lightchainCompat.lightchainTaskCodes`、`lightchainCompat.lightchainTaskSteps` が含まれます。`generate-image`、`design-gacha`、`model-matrix`、`remove-background`、`upscale`、`colorize`、`generate-variations` は共通 sanitizer `supabase/functions/_shared/lightchainCompat.ts` で互換情報を検証し、job JSONB には `processing` step、image JSONB には `completed` step を保存します。さらに `supabase/migrations/20260622123000_create_lightchain_task_steps.sql` で追加した `public.lightchain_task_steps` に、job作成時は `processing`、画像保存時は `completed`、失敗時は `retryable` の durable row を保存します。未適用環境では生成本体を止めず、警告だけ残す段階的導入にしています。

`scripts/collect-workspace-live-readback.mjs` は job、image、storage の readback projection に `lightchainCompat.lightchainTaskSteps` を明示し、専用tableから `lightchainTaskSteps` も収集します。`scripts/verify-workspace-generation-readback.mjs` は `--expect-lightchain-task-codes` を指定した時、JSONB内のstepだけでなく durable step row も必須にします。保存後の Gallery、History、Dashboard activity、Jobs page の共通サマリーでも同じ Lightchain 機能名、task code、durable step状態、ジョブ状態を読めるようにしました。

Canvas 側では、Lightchain 由来の画像を編集対象にした時に、選択オブジェクトの `metadata.lightchainCompat` を direct edit、floating action、`ImageEditModal` の `remove-background`、`colorize`、`upscale`、`generate-variations` 呼び出しへ渡します。編集後に追加される派生画像オブジェクトにも同じ互換 metadata を持たせるため、Lightchain で慣れた「生成 -> Canvasで編集 -> さらに背景削除/色変更/高解像度化/派生生成」の流れでも task code と step 状態を追跡できます。

Gallery 側では、保存済み画像の詳細から `共有リンクを作成` を実行できます。remote保存済み画像では既存の `share-link` Edge Function を呼び、7日間有効なURLを作成してコピーし、モーダル内にURLと有効期限を表示します。local workspace artifact では外部公開リンクを作らず、ローカル画像URLをコピーする導線にして、未保存成果物と本番保存済み成果物の違いを画面上で自然に扱います。

ユーザーは Lightchain と同じ感覚で、次のように使います。

- `おすすめ` から Marketing、AIフィッティング、Studio、Models、Patterns、Video、Lab を選ぶ。
- `企画デザインツール` からインスピレーション、線画、色変更、ベクター化、ブランドスタイルへ進む。
- `グラフィックツール` から柄作成、総柄、ベクター化、デザインアレンジ、プリント配置へ進む。
- `画像編集` から背景削除、アップスケール、バリエーション、部分修正、Canvas 編集へ進み、Canvas上の派生編集でもLightchain task contextを維持する。
- `事例共有` から EC 商品画像セット、SNSキャンペーン、シリーズデザインなどの業務テンプレートへ入り、保存後はGallery詳細から共有リンク、ダウンロード、再生成、元ワークスペース復帰へ進む。

## 未完了の深掘り

今回の Dashboard 互換入口で「Lightchain の機能を見つけて始める」体験と、複数 task code の step 状態をdurable rowとして保存・表示・readback検証する土台は揃いました。ただし、完全同一化には次が残ります。

- `lightchain_task_steps` migration、Edge Functions、Web bundleをproduction-equivalent環境へ適用し、Supabase本番相当readbackでdurable step row、job、image、Storage、usage、edge runの対応を確認する。
- Lightchain の各 task code をさらに深い workflow stage として個別ステージ化し、partial success、per-task retry、stage artifacts を task 単位で保存する。
- `/patterns` の総柄生成、ベクター変換、服へのプリント反映を実生成 job と readback に接続する。
- `/video` の storyboard を実動画生成、または少なくとも画像列/動画計画成果物の server readback に接続する。
- `/lab` の展示、店舗、素材、キャンペーン転用を実験結果 row として保存し、Gallery/History から評価条件まで読めるようにする。
- Canvas 側で Lightchain の部分修正、切り抜き、拡張、複数ステップ編集をより深く編集状態として保存する。
- 共有リンク、公開ページ、bulk download の本番readbackを取り、`share_links`、Storage exports、Edge run、usage の対応を確認する。

## 今回の検証

`npm run typecheck`、`npm run lint`、`VITE_SUPABASE_URL=https://example.supabase.co VITE_SUPABASE_ANON_KEY=e2e-anon-key npm run build` は通過しました。`deno check` は `supabase/functions/_shared/lightchainCompat.ts`、`generate-image`、`design-gacha`、`model-matrix`、`remove-background`、`upscale`、`colorize`、`generate-variations` で通過しました。Playwright では Dashboard の互換タブ、画像編集カテゴリ、生成画面の `Lightchain互換` 表示、生成リクエスト body の `lightchainCompat.lightchainTaskSteps`、画像編集系 `remove-background` body の `lightchainCompat.lightchainTaskSteps`、Canvas/image API が画像編集 metadata を受け取ること、source context 付き生成後の Gallery 詳細に `Lightchain機能` と `Lightchain task` が表示されることを確認しました。Dashboard の Job Queue と Jobs page では、mocked `lightchain_task_steps` の durable rows から、進行中、完了、失敗・再試行可の Lightchain task と step 状態表示も確認しました。

production gate 強化後は、次を追加で確認しました。

```bash
npm run supabase:verify:static
npm run security:audit
npm run smoke:edge
deno check supabase/functions/_shared/lightchainCompat.ts supabase/functions/remove-background/index.ts supabase/functions/upscale/index.ts supabase/functions/colorize/index.ts supabase/functions/generate-variations/index.ts supabase/functions/generate-image/index.ts supabase/functions/design-gacha/index.ts supabase/functions/model-matrix/index.ts
```

`npm run env:check` は現在のshellで `2/8 required keys present` のため、本番相当 deploy/readback は未実行です。足りないキーは `VITE_SUPABASE_URL`、`VITE_SUPABASE_ANON_KEY`、`SUPABASE_URL`、`SUPABASE_ANON_KEY`、`SUPABASE_SERVICE_ROLE_KEY`、`PUBLIC_URL` です。secret値は表示していません。

Gallery共有導線の追加後は、次を確認しました。

```bash
npm run typecheck
VITE_SUPABASE_URL=https://example.supabase.co VITE_SUPABASE_ANON_KEY=e2e-anon-key npm run build
VITE_SUPABASE_URL=https://example.supabase.co VITE_SUPABASE_ANON_KEY=e2e-anon-key CI=1 npx playwright test e2e/smoke.spec.ts --grep "gallery detail creates share links"
npx eslint src/pages/GalleryPage.tsx e2e/smoke.spec.ts scripts/security-audit.mjs
npm run security:audit
git diff --check
```

今回の Canvas 追加後は、fresh preview で次の代表6本を再実行し、`6 passed (55.2s)` を確認しました。

```bash
VITE_SUPABASE_URL=https://example.supabase.co VITE_SUPABASE_ANON_KEY=e2e-anon-key CI=1 npx playwright test e2e/smoke.spec.ts --grep "dashboard renders activity panels|jobs page renders queue readback|dashboard Lightchain parity hub|generate page sends Lightchain compatibility metadata|image editing functions receive Lightchain compatibility metadata|marketing page runs local job states and hands off to canvas"
```

長い統合 smoke `studio, models, patterns, video, and lab save local artifacts and hand off to canvas without Supabase writes` は、今回の同期的URL feature復元修正で `ワークスペース再開` の初期表示は改善しましたが、5ワークスペースを1本で回すため90秒タイムアウトに残りやすく、今回のCanvas更新の完了証跡には使っていません。

readback fixture では次を通過しました。

```bash
npm run verify:workspace-readback -- --readback output/playwright/lightchain-readback-fixture-local-20260622/workspace-db-readback.json --cleanup output/playwright/lightchain-readback-fixture-local-20260622/workspace-cleanup-readback.json --expect-release-date 2026-06-22 --expect-environment production --expect-git-commit lightchain-local-fixture --expect-lightchain-task-codes "PatternToVector,LineArtVectorConvert,OneClickIntegration,DirectionalIntegration,FashionStudio,Video Workstation,ChangeDetail,ClothingOrientationDesign"
```

Goal 5 final parent audit では、現在の worktree に対して次を再実行し、すべて通過しました。

```bash
npm run typecheck
VITE_SUPABASE_URL=https://example.supabase.co VITE_SUPABASE_ANON_KEY=e2e-anon-key npm run build
npm run lint
npm run security:audit
npm run supabase:verify:static
npm run smoke:edge
git diff --check
deno check supabase/functions/*/index.ts
```

ただし、Goal 3 の production-equivalent readback と Goal 4 の real browser UI proof は未完了です。Goal 3 は env が `2/8` で、missing keys は `VITE_SUPABASE_URL`、`VITE_SUPABASE_ANON_KEY`、`SUPABASE_URL`、`SUPABASE_ANON_KEY`、`SUPABASE_SERVICE_ROLE_KEY`、`PUBLIC_URL` です。既存 production readback は `lightchainTaskSteps=0` のため、新しい durable Lightchain step slice の証明には使えません。Goal 4 は Playwright Chromium launch が `SIGABRT`、local listen が `EPERM` で止まっており、証跡は `output/playwright/lightchain-goal4-real-browser-ui-20260622/error.json` にあります。Goal 5 の最終 summary は `output/playwright/lightchain-goal5-final-parent-audit-20260622/PARENT-SUMMARY.md` です。

## 停止条件

課金、購入、支払い、checkout が必要になった場合だけ停止します。CAPTCHA、OTP、security code、本人確認は突破せず、URL、screenshot、DOM、attempt JSON、exact blocker を残して human-input required として扱います。
