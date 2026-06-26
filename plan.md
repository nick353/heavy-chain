# Heavy Chain 10M Product Readiness Plan

Updated: 2026-06-26

## Goal

Heavy Chain を、Lightchain の上位互換として違和感なく使えるだけでなく、1000万ユーザー規模を狙える商品品質へ近づける。対象は UI/UX、実生成品質、衣服認識/切り抜き/レイヤー、Canvas、失敗時UX、オンボーディング、テンプレート、パフォーマンス、スケール、監視、セキュリティ、法務/安全、リテンション、βユーザー相当タスク、競合比較、品質基準、完全回帰、運用ドキュメント。

## Current Baseline

- Lightchain 4カテゴリ構成、生成ホーム、機能クリック後の詳細画面、素材アップロード反映、旧重複サイドバー排除は実装・本番確認済み。
- 全10主要生成機能は過去 proof で readback と目視確認済み。`STATE.md` には 2026-06-26 の全10機能fresh proof と後続prompt polish proofもあるため、G601 は無条件にcreditを消費する再実行ではなく、既存proofのfreshness/readback/画像品質を再監査し、欠けている機能または古い/弱い証跡だけを bounded fresh generation で補う。
- Runway は `localhost:15554` 動的クライアント経路ではなく、Codex承認済み Runway MCP と local worker handoff を正とする。
- 本番 launch-ops / production monitor は `goal-loop-10m-20260626` で Lightchain式UIへ追従済み。直近 proof は `output/playwright/goal-loop-10m-20260626/launch-ops-after-deploy/summary.json`、`production-monitor-after-deploy/summary.json`、`lightchain-clone-prod-after-deploy/SUMMARY.json`。

## Stop Conditions

- 課金、購入、支払い、checkout、本人確認、OTP/CAPTCHA、秘密情報入力、外部公開では停止する。
- 外部サービスの設定変更、新しい有料ベンダー、公開投稿、不可逆削除、RLS/storage/authの破壊的変更は停止し、必要な決定・証跡・リスクを残す。
- Runway workspace limit、認証切れ、生成失敗、Playwright/Chrome権限ブロック、Supabase権限ブロックが起きた場合は、exact blocker、URL/DOM/log、再開条件を残す。

## Evidence Requirements

- UI/UX: URL、DOM/body text、スクリーンショット、録画、desktop/mobile、console/page/network failures。
- 生成品質: prompt、feature、job/task ID、worker/readback、Storage/DB証跡、画像ファイル、目視scorecard。
- Canvas/レイヤー: 画像配置、選択状態、layer/mask/material metadata、export/readback。
- 性能/スケール: bundle/route timing、画像数負荷、DB/Storage readback、monitor summary。
- セキュリティ: RLS/storage/signed URL/service-role露出/secret redaction の read-only audit。
- 法務/安全: 利用規約/商用利用/著作権/ブランド模倣/ユーザー素材保存の decision packet。現時点で未決定なら `human-needed` とする。

## Execution Steps

1. [queued] 全10主要生成機能の既存fresh proofを再監査し、不足分だけ bounded fresh generation で再検証し、画像品質scorecardを更新する。
2. [queued] Lightchain同等UXの最終差分を、生成フローとCanvas連携を中心に再比較する。
3. [queued] 衣服認識、切り抜き、レイヤー、素材メタデータ、Canvas編集導線を深掘り検証し、足りないUIを実装する。
4. [queued] 生成失敗時UX、worker待ち、Runway制限、参照画像失敗のユーザー向け表示を検証・改善する。
5. [queued] 初回オンボーディングとテンプレート体験を、10分以内に価値体験できる形へ磨く。
6. [queued] パフォーマンス、画像一覧負荷、Canvas負荷、bundleを測定し、明確な改善を入れる。
7. [queued] production monitor、launch-ops、mass-market QA、完全回帰を統合した release gate を作る。
8. [queued] セキュリティ/権限/RLS/storage/signed URL/service role の read-only audit を実行する。
9. [queued] 法務/安全/商用利用/素材保持/ブランド模倣ガードの decision packet を作る。
10. [queued] リテンション機能、ブランドキット、履歴検索、テンプレ再利用、チーム共有の現状差分を整理し、実装できる低リスク項目を入れる。
11. [queued] βユーザー相当の実使用タスクを5シナリオ以上録画で流し、詰まりを修正する。
12. [queued] 競合比較を Lightchain / Canva / Kittl / Photoroom / Adobe Express / Runway / Shopify系AI画像ツールで更新する。
13. [queued] 画像品質基準、NG例、prompt preset、機能別rubricを docs と verifier に落とす。
14. [queued] 運用ドキュメント、障害復旧、worker起動、handoff、rollback、monitor対応を最新化する。
15. [queued] 最後に本番で完全回帰、ドキュメント更新、Codex review、commit/pushまで閉じる。

## Completion Criteria

- 全10主要機能の fresh generation が、過去資産流用なしで完了または exact blocker 付きで分割再開可能になっている。
- 生成画像の scorecard が全機能で `pass`、または `needs-polish` の具体的修正が反映済み。
- Lightchain を10年使った人が自然に使える導線として、主要生成画面、ホーム、カテゴリ、履歴、Canvas、mobile が証跡付きで確認されている。
- 衣服/素材の upload -> 認識 -> cut/mask -> layer -> design placement -> Canvas/export の流れが直感操作として成立している。
- 失敗時UXが、技術者向けではなくユーザー向けの再試行/原因/次アクションを返す。
- production monitor / launch-ops / mass-market QA / security audit / performance checks / build/lint/typecheck が通る。
- 法務・課金・外部公開など人間判断が必要なものは `goals/HUMAN_NEEDED.md` に分離され、実装完了と混同されない。
- `GOAL.md`、`STATE.md`、`plan.md` が最新証跡を指し、push済みで、作業ツリーが不要な差分を残していない。

## Current Result

- This plan starts the next 10M-readiness Goal Loop. Previous Lightchain parity and production monitor slices are accepted through G501.
- Active execution now moves to G601-G615 in `GOAL.md`.
