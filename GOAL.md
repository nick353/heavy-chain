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
| G601 | queued | child | codex-verifiable | none | Child: G601 Fresh all-feature generation QA | 既存の全10機能fresh proofを再監査し、不足分だけ bounded fresh generation で補い、画像品質scorecardを更新する。 | existing proof acceptance/rejection ledger, job/task/readback/storage/image files/visual scorecard; exact blocker if Runway workspace limit prevents needed fresh run. | goals/G601.md |
| G602 | queued | child | codex-verifiable | none | Child: G602 Lightchain UX final parity | Lightchainとの残差分を、生成フロー、カテゴリ、素材投入、履歴、Canvas、mobileで再比較し、直せる差分を潰す。 | comparison ledger, screenshots/videos, DOM/URL, fixes or explicit remaining mismatch. | goals/G602.md |
| G603 | queued | child | codex-verifiable | G602 | Child: G603 Garment cut layer Canvas | 衣服認識/切り抜き/レイヤー/デザイン重ね/Canvas export の直感操作を商品品質にする。 | upload/cut/layer/Canvas/export proof, metadata readback, UI fixes, screenshots/videos. | goals/G603.md |
| G604 | queued | child | codex-verifiable | none | Child: G604 Failure recovery UX | Runway制限、worker待ち、参照画像失敗、生成失敗をユーザー向けに復旧可能な表示へ改善する。 | forced/simulated failure proof, UI copy, retry/next-action evidence, tests. | goals/G604.md |
| G605 | queued | child | codex-verifiable | G602 | Child: G605 Onboarding templates | 初回10分で価値体験できるオンボーディングと主要テンプレを整える。 | first-run flow recording, templates list, empty-state proof, mobile proof. | goals/G605.md |
| G606 | queued | child | codex-verifiable | none | Child: G606 Performance scale baseline | route/bundle/Gallery/Canvas/画像一覧負荷の baseline を測定し、低リスク改善を入れる。 | metrics before/after, build stats, screenshots/logs, remaining target proposal. | goals/G606.md |
| G607 | queued | child | codex-verifiable | none | Child: G607 Release gate unification | production monitor、launch-ops、mass-market QA、security/perfのrelease gateを一つの手順に統合する。 | script/docs proof, dry-run or read-only run, pass/fail contract. | goals/G607.md |
| G608 | queued | child | codex-verifiable | none | Child: G608 Security permissions audit | RLS/storage/signed URL/service role/secret redaction をread-only auditし、修正可能な低リスク問題を潰す。 | audit report, commands, findings fixed/deferred, no secret leakage. | goals/G608.md |
| G609 | queued | child | human-decision | none | Child: G609 Legal safety policy packet | 商用利用、著作権、ブランド模倣、ユーザー素材保存、規約/Privacyの decision packet を作る。 | human-decision packet with recommendations and exact open decisions. | goals/G609.md |
| G610 | queued | child | codex-verifiable | G605 | Child: G610 Retention workspace features | プロジェクト保存、履歴検索、ブランドキット、テンプレ再利用、チーム共有の現状差分を整理し、低リスク改善を入れる。 | implemented improvements or scoped backlog, UI proof, tests. | goals/G610.md |
| G611 | queued | child | codex-verifiable | G601-G605 | Child: G611 Beta user scenario QA | βユーザー相当5シナリオ以上を録画で流し、詰まりを修正する。 | scenario videos, issue list, fixes, pass rerun. | goals/G611.md |
| G612 | queued | child | human-decision | none | Child: G612 Competitor positioning | Lightchain/Canva/Kittl/Photoroom/Adobe Express/Runway/Shopify系との比較を更新する。 | labeled research/comparison matrix, recommendation, unverified items. | goals/G612.md |
| G613 | queued | child | codex-verifiable | G601 | Child: G613 Quality rubric prompts | 画像品質基準、NG例、prompt preset、機能別rubricをdocs/verifierへ落とす。 | docs, scorecard schema, sample review, tests if script changed. | goals/G613.md |
| G614 | queued | child | codex-verifiable | G607 | Child: G614 Operations docs | worker起動、handoff、monitor、rollback、障害復旧を最新化する。 | docs proof, command readback, runbook consistency check. | goals/G614.md |
| G615 | queued | child | codex-verifiable | G601-G614 | Child: G615 Complete regression closeout | 最後に本番完全回帰、static checks、Codex review、STATE/plan/GOAL closeoutを行う。 | all gates pass, production proof, docs updated, push. | goals/G615.md |

## Active Child Window

| ID | Window status | Reason for active window | Workspace / worktree | Notes |
|---|---|---|---|---|
| G601 | auto-ready | generation quality is the largest product-risk gate | isolated child workspace or read-only first | May split by Runway workspace limit; parent integrates. |
| G602 | auto-ready | UX parity drives all downstream user perception | isolated child workspace or read-only first | Compare with existing Lightchain proof first; parent integrates. |
| G604 | auto-ready | failure recovery can be tested independently | isolated child workspace | Do not cause irreversible actions; parent integrates. |
| G606 | auto-ready | performance baseline can run independently | isolated child workspace or read-only first | Prefer measurement before optimization; parent integrates. |
| G608 | auto-ready | security audit can run read-only in parallel | read-only first | No secret output; parent integrates. |

## Human-Needed Queue / Checkpoints

Checklist: [goals/HUMAN_NEEDED.md](goals/HUMAN_NEEDED.md)

| Item | Blocks | Summary | Status |
|---|---|---|---|
| H601 | G609 dependent implementation | Legal/commercial-use/privacy policy decisions require user/operator approval after decision packet. | open |
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

## Achievement Review

Active child window status: G601/G602/G604/G606/G608 auto-ready
Goal map status: G601-G615 queued, G401-G501 accepted
Parent goal status: active
Human-needed checkpoint status: H601/H602 open but not blocking non-dependent goals
Gap review / refreshed Gap-Closing Goal Map needed: after first active-window results
