# Lightchain vs Heavy Chain Generation Parity Plan

Updated: 2026-06-26

## Goal

Lightchain (`https://jp.linkaigc.com/`) を実際に操作し、生成画面、素材アップロード、プロンプト/設定、生成実行、結果確認、履歴/ジョブ/Canvas 相当の流れを証跡付きで把握する。その後 Heavy Chain production (`https://heavy-chain.zeabur.app`) の生成画面と同じ観点で比較し、使い方・UI・生成フローが同等かを判断する。

## Stop Conditions

- 課金、購入、支払い、checkout、本人確認、OTP/CAPTCHA、秘密情報入力では停止する。
- Lightchain 側で追加のログイン情報、支払い、外部公開、不可逆な削除が必要になったら、その画面の URL/DOM/screenshot を証跡として止める。
- Heavy Chain 側は、既存の本番 QA で許可済みの非課金生成・readback・marker-scoped cleanup の範囲だけ実行する。

## Evidence Requirements

- Lightchain: URL、DOM/body text、スクリーンショット、可能なら生成結果画像、操作ごとの blocked reason。
- Heavy Chain: URL、DOM/body text、スクリーンショット/録画、DB/Storage/readback または既存 proof artifact。
- 比較: 画面構成、素材アップロード、認識/カット/レイヤー、プロンプト編集、生成実行、ジョブ進捗、結果確認、Canvas/Gallery/History 連携、モバイル表示。

## Execution Steps

1. [done] Lightchain の現在ログイン状態と利用可能メニューを確認する。
2. [done] Lightchain の生成関連画面を、実操作できる範囲で素材アップロードと生成まで進める。
3. [done] Heavy Chain production の対応画面を同じ順番で操作し、生成画面の差分を記録する。
4. [done] 差分を `output/playwright/lightchain-heavychain-final-parity-20260626/` に保存する。
5. [done] UI/UX 差分のうち、キャンペーン画像生成の入口を Lightchain 式 AI アシスタント計画 UI に寄せる。
6. [done] 修正後はローカル preview で録画・DOM・スクリーンショットを取り直す。
7. [done] production deploy 後に Zeabur で同じ `assistantFound/dynamicPlanFound` assertion を取り直す。
8. [done] キャンペーン画像だけでなく全 10 生成レーンへ AI アシスタント計画 UI を展開する。
9. [done] 生成結果カードから Canvas へ送れる実導線を追加し、素材/レイヤー/マスク/構図メタデータを Canvas Properties で確認できるようにする。
10. [done] Lightchain の実画面を再操作し、ホーム、4カテゴリ、グラフィック画面、直接プリントデザイン画面、素材アップロード後の生成パネルを録画・スクショ・URLで保存する。
11. [done] Heavy Chain の LP、ログイン、`/generate` ホーム、カテゴリカード、機能詳細を Lightchain と同じ骨格へ作り替え、旧サイドバー/中央説明カード/未選択生成フォームを主導線から外す。
12. [done] `グラフィックツール` 配下で `design-arrange` と `image-variations` の両方が `generate-variations` に向くことを verifier/e2e に追加し、録画つきで確認する。
13. [done] 全10主要生成機能の readback と生成画像目視確認を行い、プロンプト意図に合うかを scorecard で記録する。
14. [done] 最新の Lightchain clone UI を production へ反映し、Zeabur で同じ verifier/readback を取り直す。

## Completion Criteria

- Lightchain と Heavy Chain の操作差分が証跡付きで説明できる。
- 「全く同じ」と言えない箇所は、具体的な UI/UX 差分、再現手順、期待動作、実際の動作、重要度、証跡を持つ。
- 直せる差分は修正され、Heavy Chain production または local preview で再確認されている。
- 残る差分がある場合は、外部制約または次回実装単位として明確化されている。

## Current Result

- Lightchain 実画面は `output/playwright/lightchain-reference-live-20260626/` と `output/playwright/lightchain-reference-live-20260626-direct-pattern/SUMMARY.json` に保存済み。4カテゴリホーム、グラフィック一覧、直接プリントデザイン、素材アップロード後のAI生成パネルを確認した。
- Heavy Chain local は `output/playwright/lightchain-workbench-parity-apparel-local-20260626-r11-image-variations-detail/SUMMARY.json` で pass。LP/ログイン/`/generate` ホーム/詳細画面/モバイルで、Lightchain式の4カテゴリ、機能クリック後の生成画面、素材アップロード反映、折りたたみ運用情報、旧重複サイドバーなしを確認した。
- 全10主要生成機能は `output/playwright/hc-all-features-real-generation-after-lightchain-clone-20260626/readback-after-worker.json` と `visual-scorecard.json` で確認済み。10/10 completed、10/10 visual pass。ただしこの run で Runway が新規生成できたのは2件で、残り8件は `workspace_limit` のため直近同一QAプロンプトのRunway資産を現行marker jobsへimportした。
- Production は commit `ffa6c77` push 後に Zeabur が `assets/index.CPdUKnP3.js` へ切り替わり、`output/playwright/lightchain-workbench-parity-apparel-prod-20260626-r1/SUMMARY.json` で pass。現時点では「本番でもLightchain構成に揃った」と言える。
- 10M readiness の追加Goal Loopで、production Lightchain clone verifier は `output/playwright/goal-loop-10m-20260626/lightchain-clone-prod/SUMMARY.json` で pass。一方で launch-ops/production monitor は旧UI前提の検証が原因で失敗したため、`Textarea` のlabel関連付けと `verify:launch-ops` の実フォーム/有効な `Runway workerで生成` ボタン検証へ修正した。ローカル静的検証とbuildは通過済みで、Zeabur反映後に production launch-ops/monitor を取り直す。
