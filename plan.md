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
7. [pending] production deploy 後に Zeabur で同じ `assistantFound/dynamicPlanFound` assertion を取り直す。

## Completion Criteria

- Lightchain と Heavy Chain の操作差分が証跡付きで説明できる。
- 「全く同じ」と言えない箇所は、具体的な UI/UX 差分、再現手順、期待動作、実際の動作、重要度、証跡を持つ。
- 直せる差分は修正され、Heavy Chain production または local preview で再確認されている。
- 残る差分がある場合は、外部制約または次回実装単位として明確化されている。

## Current Result

- Lightchain は 1 リクエストから生成計画を出し、確認後に 3 枚生成する会話主導フローだった。
- Heavy Chain production は修正前、素材ワークベンチと詳細フォームが先に出る構造で、同じプロンプトを入れても Lightchain と同じ使い心地ではなかった。
- Heavy Chain local preview では、キャンペーン画像に AI アシスタント計画 UI を追加し、計画作成とフォーム反映を分離した。最終証跡は `27-heavychain-local-separated-plan-summary.json`。
