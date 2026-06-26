# GOAL.md

## Loop Metadata

Loop ID: HC-10M-PRODUCT-READINESS-20260626-R2
Parent thread name: Goal: Heavy Chain 10M Product Readiness R2
Parent thread ID: 019ef728-e38a-7d01-988d-451c95668bf5

## Parent Goal

Heavy Chain を Lightchain の上位互換として違和感なく使える状態から、1000万ユーザー規模を狙える商品品質へ引き上げる。UI/UX、実生成品質、衣服認識/切り抜き/レイヤー、Canvas、失敗時UX、オンボーディング、テンプレート、パフォーマンス、スケール、監視、セキュリティ、法務/安全、リテンション、βユーザー相当タスク、競合比較、品質基準、完全回帰、運用ドキュメントを証跡付きで閉じる。

## Strategic Summary

- `PROJECT_DESIGN.md` の最終体験は、自然な依頼または素材アップロードから生成計画、実生成、成果物確認、Canvas/Gallery/Jobs継続、worker失敗復旧までを、ユーザーが backend を知らずに進められる状態。
- Lightchain同等の使い心地が基準で、Heavy Chain独自機能はカテゴリ/Canvas/Jobs/Galleryの中へ自然に追加する。
- 既存の G401-G501 で Lightchain構成、本番monitor、launch-opsは通過済み。ただし1000万ユーザー品質には fresh generation、深いCanvas/レイヤー、失敗時UX、性能、セキュリティ、運用、法務/安全、βシナリオが不足している。
- 生成品質は、readback だけでなく実画像の目視scorecardで判断する。
- 課金、購入、支払い、本人確認、OTP/CAPTCHA、秘密入力、外部公開は停止する。

## Current Milestone

10M readiness R2. 既存のLightchain parity土台の上に、量産品質、運用品質、安全性、スケール品質、実使用品質を追加で検証・改善する。

## Root Done Evidence

- 全10主要生成機能の fresh generation または exact blocker 付き分割再開証跡。
- 生成画像scorecardが全機能で `pass`、または `needs-polish` 修正済み。
- Lightchain比較、desktop/mobile録画、DOM/URL、console/page/network failure確認。
- upload -> recognition -> cut/mask -> layer -> design placement -> Canvas/export の直感操作 proof。
- production monitor / launch-ops / mass-market QA / security audit / performance checks / build/lint/typecheck / Codex review。
- 法務/安全/外部公開/課金系の未決定事項は `goals/HUMAN_NEEDED.md` に分離。
- `STATE.md`, `plan.md`, `GOAL.md` が最新証跡を指し、push済み。

## Quality Bar

「10年Lightchainを使っていた人がHeavy Chainに来ても迷わない」ことをUX基準にする。1000万ユーザー級という表現は、単に機能があることではなく、初回価値体験、失敗時復旧、速度、生成品質、セキュリティ、運用、ドキュメント、回帰テストが揃っている状態を指す。成果物品質は画像を開いて確認するまで完了扱いしない。

## Non-Goals

- Lightchain のロゴ、商標、固有ブランドをそのまま使うこと。
- 課金、購入、checkout、支払い、本人確認、OTP/CAPTCHA、秘密入力、外部公開。
- 旧 `localhost:15554` Runway OAuth 動的クライアント経路の復活。
- 新しい有料外部ベンダーや本番外部公開の自動実行。

## Approval Boundaries

### Codex may do automatically

- write/update allowed files: source, scripts, docs, test/verification artifacts, and assigned child artifacts. Parent-owned `GOAL.md`, `plan.md`, `STATE.md`, and unrelated `goals/*` are updated by the parent during integration unless a child packet explicitly says otherwise.
- launch `queued` child goals from this Goal Map using parent-side subagents or inline execution.
- maximum parallel children: five.
- run validation/review commands: `npm run typecheck`, `npm run lint -- --max-warnings=0`, `npm run build`, `git diff --check`, Playwright verifiers, production read-only monitor, bounded non-billing marker-scoped generation QA, Codex read-only review.
- integrate accepted child results.
- commit and push to `origin main` after gates pass.

### Human approval required

- credentials, secret entry, billing, purchase, checkout, payment, identity verification, OTP/CAPTCHA/security prompt.
- external public publishing.
- destructive cleanup outside marker-scoped QA artifacts.
- new paid external observability/cron/vendor setup.
- legal/commercial-use policy decisions that require the user as operator.

## Gap-Closing Goal Map

| ID | Status | Owner | Acceptance | Depends On | Child thread name | Outcome | Acceptance Evidence | Child Packet |
|---|---|---|---|---|---|---|---|---|
| G401-G501 | accepted | parent | codex-verifiable | none | Historical accepted slices | Lightchain clone, all-feature generation baseline, production monitor/launch-ops closeout. | Existing proof paths in `STATE.md` and previous commits through `ef151d9`. | historical |
| G601 | accepted | parent | codex-verifiable | none | Parent inline: G601 Fresh all-feature generation QA | 既存の全10機能fresh proofを再監査し、不足分だけ bounded fresh generation で補う判断を行った。 | `output/playwright/10m-product-readiness-g601/proof-reaudit.json` shows 10/10 accepted, `needsFresh=[]`; visual contact sheet inspected; no additional credit use needed. | goals/G601.md |
| G602 | accepted | child | codex-verifiable | none | Child: G602 Lightchain UX final parity | Lightchainとの残差分を、生成フロー、カテゴリ、素材投入、履歴、Canvas、mobileで再比較し、Canvas modal assertions まで修正した。 | `output/playwright/lightchain-workbench-parity-apparel-prod-20260626-r5-g602-final/SUMMARY.json` plus integrated local/prod verifier reruns; `ok=true`, `failed=[]`. | goals/G602.md |
| G603 | accepted | parent | codex-verifiable | G602 | Parent inline: G603 Garment cut layer Canvas | 衣服参考ライブラリから upload -> 手動マスク -> プリントレイヤー -> 背面大判配置 -> Canvas保存 -> PNG export まで実操作で通し、Canvas metadata とプロパティ表示を補強した。 | `output/playwright/g603-garment-layer-canvas-20260626T130426Z/SUMMARY.json` `ok=true failed=[]`; screenshots/video/export PNG/storage/body proof; `npm run verify:g603-garment-canvas`; Codex review no重大不備. | goals/G603.md |
| G604 | accepted | child | codex-verifiable | none | Child: G604 Failure recovery UX | Runway制限、worker待ち、参照画像失敗、生成失敗をユーザー向けに復旧可能な表示へ改善し、履歴/Jobs/FailureRetryCardへ展開した。 | `npm run verify:error-messages` passed 10/10 mappings and 7/7 recovery matrix; typecheck/lint/build passed. | goals/G604.md |
| G605 | accepted | parent | codex-verifiable | G602 | Parent inline: G605 Onboarding templates | 初回Dashboardオンボーディング、Canvas空状態、サイズテンプレート、デザインテンプレートの実レイヤー展開を録画つきで確認し、Canvasのデザインテンプレート導線を接続した。 | `output/playwright/g605-onboarding-templates-20260626T133449Z/SUMMARY.json` `ok=true failed=[]`; desktop/mobile screenshots/videos; storage readback shows EC size template and product-card design layers after EC category -> design mode switch. | goals/G605.md |
| G606 | accepted | child | codex-verifiable | none | Child: G606 Performance scale baseline | route/bundle/Gallery/Canvas負荷を測定し、Gallery仮想化/Canvas chunk gate/preview cleanup proof/release doctor gateを追加した。 | `output/playwright/10m-product-readiness-g606/summary.json` latest `ok=true`, routes under 1.2s, Gallery initial tiles 60, Canvas objects 180, `runs[]` retains failure/success history, `previewProcessCleanup.groupAliveAfter=false`; `lsof` no 4173 listener; Codex review no high risk. | goals/G606.md |
| G607 | accepted | parent | codex-verifiable | none | Parent inline: G607 Release gate unification | production monitor、launch-ops、mass-market QA、G603/G605/G606/G608、security、scorecard、typecheck、build、lintを `verify:release-gate` に統合した。 | Clean proof `output/playwright/10m-product-readiness-g607/release-gate-summary.json` has `ok=true`, `failed=[]`, `allowDirty=false`, blockers `[]`, all readbacks fresh/passing, and all command gates passing. | goals/G607.md |
| G608 | accepted | child | codex-verifiable | none | Child: G608 Security permissions audit | RLS/storage/signed URL/service role/secret redaction をread-only auditし、Runway task id false positiveを避ける境界付きsecret検出へ修正した。 | `output/playwright/10m-product-readiness-g608-security-audit/audit-readiness.json`; `npm run security:audit`; `bash scripts/supabase-prod-verify.sh`; no secret leakage. | goals/G608.md |
| G609 | accepted | parent | human-decision | none | Parent inline: G609 Legal safety policy packet | 商用利用、著作権、ブランド模倣、ユーザー素材保存、規約/Privacyの decision packet を作り、実装前のoperator decisionsをH601へ残した。 | `docs/legal-safety-decision-packet-2026-06-26.md`; `goals/HUMAN_NEEDED.md` keeps H601 open for final Terms/Privacy, retention, brand/likeness, and copyright/marketing decisions. | goals/G609.md |
| G610 | accepted | parent | codex-verifiable | G605 | Parent inline: G610 Retention workspace features | Dashboardの保存済みCanvas projectを全件検索可能にし、名前、ブランド、日付、英日素材種別で再発見できるようにした。 | `output/playwright/g610-retention-project-search-20260626T144718Z/SUMMARY.json` `ok=true failed=[]`; 11 assertions include recent count, name search, English/Japanese object-type search, empty/clear, filtered delete, Canvas route/open, storage readback, video and cleanup. | goals/G610.md |
| G611 | accepted | parent | codex-verifiable | G601-G605 | Parent inline: G611 Beta user scenario QA | βユーザー相当6シナリオをproduction録画QAで流し、Credits文言、upload反映判定、Canvas反映、Brand Settings外部Storage回避、upload input欠落ゲートを修正した。 | `output/playwright/10m-product-readiness-g611-beta-scenarios-20260626-rerun4/SUMMARY.json` `ok=true failed=[]`; 17 desktop routes, 8 mobile routes, 25 videos, 0 console/page/request failures, cleanup closed, no irreversible actions; `docs/g611-beta-scenario-qa-2026-06-26.md`. | goals/G611.md |
| G612 | accepted | parent | human-decision | none | Parent inline: G612 Competitor positioning | Lightchain/Canva/Kittl/Photoroom/Adobe Express/Runway/Shopify系との現在比較を更新し、Heavy Chainの勝ち筋をアパレル専用production workspaceとして整理した。 | `docs/g612-competitor-positioning-2026-06-26.md`; current web research from official competitor pages; no billing/purchase/external publish/generation submit. | goals/G612.md |
| G613 | accepted | child | codex-verifiable | G601 | Child: G613 Quality rubric prompts | 画像品質基準、NG例、prompt preset、機能別rubricをdocs/verifierへ落とした。 | `docs/generation-quality-rubric-2026-06-26.md`; `npm run verify:generation-scorecard` primary 9 pass / 1 needsPolish / 0 fail and polish 4 pass / 0 fail. | goals/G613.md |
| G614 | accepted | parent | codex-verifiable | G607 | Parent inline: G614 Operations docs | worker起動、reference-image handoff、monitor、release gate、rollback、障害復旧を統合Runbook化し、機械検証可能にした。 | `docs/g614-operations-runbook-2026-06-26.md`; `npm run verify:g614-ops`; typecheck/lint/build/diff check; Codex review no high/medium. | goals/G614.md |
| G615 | queued | child | codex-verifiable | G601-G614 | Child: G615 Complete regression closeout | 最後に本番完全回帰、static checks、Codex review、STATE/plan/GOAL closeoutを行う。 | all gates pass, production proof, docs updated, push. | goals/G615.md |

## Active Child Window

| ID | Window status | Reason for active window | Workspace / worktree | Notes |
|---|---|---|---|---|
| G602 | accepted | UX parity drives all downstream user perception | integrated in parent workspace | Accepted with production final proof. |
| G603 | accepted | garment cut/layer Canvas is the core intuitive workflow gap | integrated in parent workspace | Accepted with local preview proof; production rerun remains part of final regression. |
| G604 | accepted | failure recovery can be tested independently | integrated in parent workspace | Accepted with mapping/recovery verifier. |
| G605 | accepted | first-run value and templates unlock retention/beta scenario work | integrated in parent workspace | Accepted with local preview proof; production rerun remains part of final regression. |
| G606 | accepted | performance baseline can run independently | integrated in parent workspace | Accepted with success/failure summary history and no residual preview listener. |
| G607 | accepted | unified release gate clean proof passed | integrated in parent workspace | Accepted with `verify:release-gate` clean proof. |
| G608 | accepted | security audit can run read-only in parallel | integrated in parent workspace | Accepted with static security/Supabase proof. |
| G609 | accepted | legal/safety decision surface is now explicit | integrated in parent workspace | Packet complete; H601 remains open for operator decisions. |
| G610 | accepted | retention workspace project search is now usable | integrated in parent workspace | Accepted with local preview proof, video, Japanese object-type search, and Canvas storage readback. |
| G611 | accepted | beta scenario QA now covers production user journeys | integrated in parent workspace | Accepted with production recorded proof, 25 videos, upload input/reflection gates, and no irreversible actions. |
| G612 | accepted | competitor positioning is now current enough for product direction | integrated in parent workspace | Accepted as research packet; public claims still wait for H601 legal/operator decisions. |
| G613 | accepted | quality rubric now unlocked by accepted G601 | integrated in parent workspace | Accepted with scorecard verifier. |
| G614 | accepted | operations handoff/rollback docs are now current | integrated in parent workspace | Accepted with `verify:g614-ops` and rollback safety updates. |

## Human-Needed Queue / Checkpoints

Checklist: [goals/HUMAN_NEEDED.md](goals/HUMAN_NEEDED.md)

| Item | Blocks | Summary | Status |
|---|---|---|---|
| H601 | legal/policy implementation before public launch | G609 packet is ready; final Terms/Privacy wording, retention period, brand-reference policy, identifiable-person policy, and copyright/marketing claims remain user/operator decisions. | open |
| H602 | billing/external publish | Billing, payment, checkout, and external publishing remain out of scope until explicitly approved. | open |

## Child Wait / Automation State

Thread automation:
- status: not-created
- status rule: parent is executing inline and with subagents in this session; create wake-up automation only if active children remain non-terminal after this run.
- cadence: n/a
- automation id: n/a

## Review / Integration / Push Policy

- Child validation: required unless docs/research-only and marked `not_required`.
- Internal quality pass: required for UX, visual, content, prompt, generation-quality, strategy, or legal packet goals.
- Child Codex review: required before terminal result when code/config/runtime artifacts changed.
- Parent verifies evidence before accepting.
- Parent runs integration checks after merging accepted work.
- Push is allowed after acceptance, required checks, Codex review, and repo policy pass.

## Integration Ledger

| Child | Result | Child Gates | Manager Decision | Integration / Push | Goal Map Status Update | Notes |
|---|---|---|---|---|---|---|
| G401-G501 | accepted | Existing proof through `ef151d9`. | Use as baseline. | Already pushed. | accepted | R2 starts from this baseline. |
| G601 | accepted | `proof-reaudit.json`, visual contact sheet inspection, existing readback/scorecards. | Accept existing fresh proof; no extra Runway credit use needed now. | Parent inline artifact only; no code integration. | accepted | 10/10 accepted; `variations` polish proof resolves prior needs-polish. |
| G602 | accepted | Production final Lightchain workbench parity proof `ok=true failed=[]`; integrated verifier modal assertions. | Accept. | Integrated into parent workspace; pending commit/push. | accepted | Covers landing/login, desktop/mobile generate home, 4 categories, detail screens, upload, assistant planning, History, Canvas modals. |
| G604 | accepted | `npm run verify:error-messages`, typecheck, lint, build. | Accept. | Integrated into parent workspace; pending commit/push. | accepted | User-facing recovery copy and retry/next-action mapping now durable. |
| G606 | accepted | `npm run verify:g606-performance`; intentional port collision fail run; final success run; `lsof` no listener; Codex review no high risk. | Accept. | Integrated into parent workspace; pending commit/push. | accepted | Release doctor now gates G606; summary retains `runs[]` and cleanup proof. |
| G608 | accepted | `npm run security:audit`; `bash scripts/supabase-prod-verify.sh`; child audit readiness JSON. | Accept. | Integrated into parent workspace; pending commit/push. | accepted | No secret output; static gates strengthened. |
| G613 | accepted | `npm run verify:generation-scorecard` for primary and polish scorecards; Codex review. | Accept. | Integrated into parent workspace; pending commit/push. | accepted | Quality rubric and verifier now codified. |
| G603 | accepted | `npm run verify:g603-garment-canvas`; `node --check scripts/verify-g603-garment-layer-canvas.mjs`; `npm run lint -- --max-warnings=0`; `git diff --check`; Codex reviews. | Accept. | Integrated into parent workspace; pending commit/push. | accepted | Local proof covers upload, manual mask, non-default back placement, Canvas metadata/properties, PNG export, video, cleanup. |
| G605 | accepted | `npm run verify:g605-onboarding-templates`; `node --check scripts/verify-g605-onboarding-templates.mjs`; `npm run typecheck`; `npm run lint -- --max-warnings=0`. | Accept. | Integrated into parent workspace; pending commit/push. | accepted | Local proof covers first-run onboarding, Dashboard first actions, Canvas empty state, EC size template, product-card design layer expansion, desktop/mobile videos, cleanup. |
| G607 | accepted | Clean `npm run verify:release-gate -- --out output/playwright/10m-product-readiness-g607/release-gate-summary.json`; negative checks for `--allow-dirty` and `--skip-commands`; Codex reviews. | Accept. | Integrated into parent workspace; pending commit/push. | accepted | Read-only release gate binds fresh production monitor, launch ops, mass-market QA, G603/G605/G606/G608, security audit, scorecard, typecheck, build, lint, syntax checks, and diff check. |
| G609 | accepted | `docs/legal-safety-decision-packet-2026-06-26.md`; `goals/HUMAN_NEEDED.md` H601 updated. | Accept packet; keep H601 open. | Integrated into parent workspace; pending commit/push. | accepted | Operator decision surface is explicit; no legal decision was auto-finalized. |
| G610 | accepted | `npm run verify:g610-retention`; `node --check scripts/verify-g610-retention-project-search.mjs`; typecheck/lint/diff check; Codex review. | Accept. | Integrated and pushed in commit `d1fefcd`. | accepted | Dashboard saved-project search now covers all saved Canvas projects with English/Japanese object-type terms and Canvas route proof. |
| G611 | accepted | `npm run verify:mass-market-qa -- --out output/playwright/10m-product-readiness-g611-beta-scenarios-20260626-rerun4`; `node --check scripts/verify-mass-market-qa.mjs`; typecheck/lint/build/diff check; Codex reviews. | Accept. | Integrated into parent workspace; pending commit/push. | accepted | Production beta QA covers six user scenarios, 17 desktop routes, 8 mobile routes, 25 videos, upload input/reflection gates, Canvas localStorage reflection, and no irreversible actions. |
| G612 | accepted | Current web research and comparison packet. | Accept as strategy/human-decision packet. | Integrated into parent workspace; pending commit/push. | accepted | Heavy Chain should position as apparel-first AI production workspace; public/legal claims remain H601-gated. |
| G614 | accepted | `npm run verify:g614-ops`; `node --check scripts/verify-g614-operations-docs.mjs`; typecheck/lint/build/diff check; Codex reviews. | Accept. | Integrated into parent workspace; pending commit/push. | accepted | Operations runbook now binds approved-client Runway handoff, daily monitor, release gate, failure triage, and human-approved rollback; rollback Edge deploy instructions no longer imply current-tree deploy safety. |

## Achievement Review

Active child window status: G602/G603/G604/G605/G606/G607/G608/G609/G610/G611/G612/G613/G614 accepted
Goal map status: G401-G501 accepted, G601/G602/G603/G604/G605/G606/G607/G608/G609/G610/G611/G612/G613/G614 accepted, G615 queued
Parent goal status: active
Human-needed checkpoint status: H601/H602 open but not blocking non-dependent goals
Gap review / refreshed Gap-Closing Goal Map needed: final window should run G615 production regression/closeout
