# Heavy Chain 10M Product Readiness Plan

Updated: 2026-06-27

## Goal

Heavy Chain を、Lightchain の上位互換として違和感なく使えるだけでなく、1000万ユーザー規模を狙える商品品質へ近づける。対象は UI/UX、実生成品質、衣服認識/切り抜き/レイヤー、Canvas、失敗時UX、オンボーディング、テンプレート、パフォーマンス、スケール、監視、セキュリティ、法務/安全、リテンション、βユーザー相当タスク、競合比較、品質基準、release-gate回帰、運用ドキュメント。

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

1. [done] 全10主要生成機能の既存fresh proofを再監査し、不足分だけ bounded fresh generation で再検証し、画像品質scorecardを更新する。
2. [done] Lightchain同等UXの最終差分を、生成フローとCanvas連携を中心に再比較する。
3. [done] 衣服認識、切り抜き、レイヤー、素材メタデータ、Canvas編集導線を深掘り検証し、足りないUIを実装する。
4. [done] 生成失敗時UX、worker待ち、Runway制限、参照画像失敗のユーザー向け表示を検証・改善する。
5. [done] 初回オンボーディングとテンプレート体験を、10分以内に価値体験できる形へ磨く。
6. [done] パフォーマンス、画像一覧負荷、Canvas負荷、bundleを測定し、明確な改善を入れる。
7. [done] production monitor、launch-ops、mass-market QA、release-gate回帰を統合した gate を作る。
8. [done] セキュリティ/権限/RLS/storage/signed URL/service role の read-only audit を実行する。
9. [done] 法務/安全/商用利用/素材保持/ブランド模倣ガードの decision packet を作る。
10. [done] リテンション機能、ブランドキット、履歴検索、テンプレ再利用、チーム共有の現状差分を整理し、実装できる低リスク項目を入れる。
11. [done] βユーザー相当の実使用タスクを5シナリオ以上録画で流し、詰まりを修正する。
12. [done] 競合比較を Lightchain / Canva / Kittl / Photoroom / Adobe Express / Runway / Shopify系AI画像ツールで更新する。
13. [done] 画像品質基準、NG例、prompt preset、機能別rubricを docs と verifier に落とす。
14. [done] 運用ドキュメント、障害復旧、worker起動、handoff、rollback、monitor対応を最新化する。
15. [done] 最後にrelease gate範囲のreadback回帰、ドキュメント更新、Codex reviewを通す。
16. [done] 2026-06-27 continuation auditで、G603/G605/G610の深い操作をZeabur本番で再実行する。
17. [blocked-exact] 全10主要機能を「既存proof再監査」ではなく、過去資産流用なしの同一run fresh generationとして再実行する。2026-06-27のG617試行では10件のmarker-scoped pending jobを作成したが、最初のRunway MCP fresh生成で `workspace_limit` が返ったため停止し、readback/cleanup/blocker証跡を残した。
18. [done] 10M級と呼ぶためのローカル合成負荷 + production read-only ops baselineを追加する。G618で1200画像/600 Canvas object、Canvas PNG export実ファイル検査、96h production DB/Storage/usage/worker readback、release-gate接続を証跡化した。本番同時実行負荷試験や外部alerting導入は行っていない。
19. [queued] 実βユーザーまたは外部協力者による本番利用証跡を、個人情報と公開操作を避けて収集する。
20. [queued] security auditをread-only/staticから、権限悪用ケース、監査ログ、事故対応runbook、運用監視の証跡へ拡張する。
21. [human-needed] H601/H602の法務、素材保持、ブランド/人物ポリシー、課金/外部公開判断をユーザー/operatorが決める。

## Completion Criteria

- 全10主要機能の fresh generation は既存proof再監査ではなく、同一runの過去資産流用なし proof で完了、または exact blocker 付きで分割再開可能になっている。
- 生成画像の scorecard が全機能で `pass`、または `needs-polish` の具体的修正が反映済み。
- Lightchain を10年使った人が自然に使える導線として、主要生成画面、ホーム、カテゴリ、履歴、Canvas、mobile が証跡付きで確認されている。
- 衣服/素材の upload -> 認識 -> cut/mask -> layer -> design placement -> Canvas/export の流れが直感操作として成立している。
- 失敗時UXが、技術者向けではなくユーザー向けの再試行/原因/次アクションを返す。
- production monitor / launch-ops / mass-market QA / security audit / performance checks / build/lint/typecheck が通る。10M級の最終呼称には、実負荷/同時実行/DB/Storage/SLO/alertingの追加証跡も必要。
- 法務・課金・外部公開など人間判断が必要なものは `goals/HUMAN_NEEDED.md` に分離され、実装完了と混同されない。
- `GOAL.md`、`STATE.md`、`plan.md` が最新証跡を指し、push済みと作業ツリーcleanはrelease gate summaryではなくgit status/remote readbackで別途確認する。

## Current Result

- Active window G601/G602/G603/G604/G605/G606/G607/G608/G609/G610/G611/G612/G613/G614/G615 is accepted in `GOAL.md`; G616 production deep rerun and G618 scale/ops baseline are accepted in this continuation.
- Key proof: `output/playwright/10m-product-readiness-g601/proof-reaudit.json`; `output/playwright/lightchain-workbench-parity-apparel-prod-20260626-r5-g602-final/SUMMARY.json`; `output/playwright/10m-product-readiness-g606/summary.json`; `output/playwright/10m-product-readiness-g608-security-audit/audit-readiness.json`; `docs/generation-quality-rubric-2026-06-26.md`.
- G603 proof: `output/playwright/g603-garment-layer-canvas-20260626T130426Z/SUMMARY.json` (`ok=true`, `failed=[]`) with screenshots, video, storage/body readback, masked PNG Canvas object, back-placement overlay coordinates, properties panel metadata, and exported PNG.
- G605 proof: `output/playwright/g605-onboarding-templates-20260626T133449Z/SUMMARY.json` (`ok=true`, `failed=[]`) with first-run Dashboard onboarding, Dashboard CTA href readback, Canvas empty-state proof, EC category -> design mode switching, EC size template persistence, product-card design template layer expansion, desktop/mobile videos, screenshots, storage readback, stale-preview guard, and process-exit/port-free cleanup proof.
- G607 proof: `output/playwright/10m-product-readiness-g607/release-gate-summary.json` has `ok=true`, `failed=[]`, `allowDirty=false`, blockers `[]`, all readbacks fresh/passing, and passing security audit, generation scorecard, syntax checks, typecheck, production build, lint, and `git diff --check`. `--allow-dirty` and `--skip-commands` were also verified as non-acceptance blockers.
- G609 packet: `docs/legal-safety-decision-packet-2026-06-26.md` defines upload-rights, commercial-use wording, copyright caveats, brand/likeness guardrails, retention policy questions, and exact H601 operator decisions. It does not auto-finalize legal policy.
- G610 proof: `output/playwright/g610-retention-project-search-20260626T144718Z/SUMMARY.json` has `ok=true`, `failed=[]`, 11 assertions, Dashboard project search by name, English/Japanese object type, empty/clear state, filtered delete, Canvas open route, storage readback, screenshot/video proof, and cleanup.
- G611 proof: `output/playwright/10m-product-readiness-g611-beta-scenarios-20260626-rerun4/SUMMARY.json` has `ok=true`, `failed=[]`, 17 desktop routes, 8 mobile routes, 25 videos, 15 upload routes with `upload_input_visible` and `upload_reflected_in_ui`, zero console/page/request failures, browser/context cleanup, and no submit/purchase/payment/checkout/external-publish/destructive actions. Scenario report: `docs/g611-beta-scenario-qa-2026-06-26.md`.
- G612 packet: `docs/g612-competitor-positioning-2026-06-26.md` compares Lightchain, Canva, Kittl, Photoroom, Adobe Firefly/Express, Runway, and Shopify Magic from current official pages, and recommends positioning Heavy Chain as an apparel-first AI production workspace rather than a generic image generator.
- G614 proof: `docs/g614-operations-runbook-2026-06-26.md` and `docs/rollback.md` now bind the approved-client Runway handoff path, daily monitor, release gate, failure triage, and human-approved rollback. `npm run verify:g614-ops` passed with required script/doc boundary checks, and Codex review found no remaining high/medium issues after fixes.
- G615 proof: `output/playwright/10m-product-readiness-g615/release-gate-summary.json` has `ok=true`, `failed=[]`, `allowDirty=false`, blockers `[]`, warnings `[]`, latest matching G611/G610 readbacks, production monitor, launch-ops, G603/G605/G606/G608 readbacks, and all command gates passing.
- G616 production deep proof: `output/playwright/g616-prod-deep-g603-garment-canvas-20260627/SUMMARY.json`, `output/playwright/g616-prod-deep-g605-onboarding-templates-20260627/SUMMARY.json`, and `output/playwright/g616-prod-deep-g610-retention-search-20260627/SUMMARY.json` all have `ok=true`, `failed=[]`, screenshots/videos, cleanup closed, and `baseUrl=https://heavy-chain.zeabur.app`.
- G617 exact blocker: `output/playwright/g617-same-run-fresh-generation-20260627/blocker.json` records Runway MCP `account_limitation` / `workspace_limit` on the first fresh image request. Manifest created 10 marker-scoped jobs; `readback.json` showed `jobs=10`, `completedJobs=0`, `images=0`, `storage=0`; `cleanup.json` showed `remaining.jobs=0`, `remaining.images=0`.
- G618 proof: `output/playwright/10m-product-readiness-g618/summary.json` has `ok=true`, 16 checks, blockers `0`, performance fixture `imageCount=1200`, `canvasObjectCount=600`, Gallery initial tiles `60`, Canvas persisted objects `600`, nonblank/colored Canvas pixels, export PNG `3348x8848`, `validPng=true`, edge color samples top `35140` / bottom `37609`, preview cleanup `groupAliveAfter=false`, production monitor 96h `ok=true`, failed jobs `0`, stale active `0`, storage signed URL `4/4`, edge failed/stale `0`, and no irreversible actions. Release-gate dry-run `output/playwright/10m-product-readiness-g618/release-gate-dry-run.json` read G618 as passed and failed only on expected `--allow-dirty` non-acceptance blocker. G618 is intentionally scoped to local synthetic scale plus read-only production ops readback, not real concurrent production load or new external alerting setup.
- Verification passed in this window: `npm run verify:error-messages`, `npm run verify:g603-garment-canvas`, `npm run verify:g605-onboarding-templates`, `npm run verify:g606-performance`, default and explicit `npm run verify:generation-scorecard` runs, remote false-pass negative scorecard, `npm run verify:g614-ops`, `npm run verify:release-gate -- --out output/playwright/10m-product-readiness-g615/release-gate-summary.json`, `npm run security:audit`, `SECURITY_AUDIT_INCLUDE_LOCAL_ENV=1 npm run security:audit` negative detection, `bash scripts/supabase-prod-verify.sh`, `npm run typecheck`, `npm run lint -- --max-warnings=0`, `npm run build`, `node --check scripts/verify-g603-garment-layer-canvas.mjs`, `node --check scripts/verify-g605-onboarding-templates.mjs`, `node --check scripts/verify-g614-operations-docs.mjs`, `git diff --check`, and Codex read-only reviews with no remaining high/medium findings after fixes. G607/G615 release-gate checks verified that `--allow-dirty` and `--skip-commands` fail as non-acceptance blockers and that broken latest SUMMARY candidates fail instead of being ignored.
- Current honest status: non-billing/non-public product-readiness QA gate is passing. Do not call the whole 10M public-launch objective complete until G617 is rerun successfully in a Runway workspace with available capacity, G619-G620 evidence is closed, and H601/H602 human decisions are closed.
