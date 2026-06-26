# GOAL.md

## Loop Metadata

Loop ID: HC-LIGHTCHAIN-SUPERSET-CLONE-20260626
Parent thread name: Goal: Heavy Chain Lightchain Superset Clone
Parent thread ID: 019ef728-e38a-7d01-988d-451c95668bf5

## Parent Goal

Heavy Chain を Lightchain の上位互換として作り直す。UI/UX、情報設計、生成フロー、成果物確認、履歴/Canvas 連携を Lightchain と同じ使い心地に揃え、その上で Heavy Chain 独自機能だけを自然に追加する。

## Strategic Summary

- `PROJECT_DESIGN.md` の狙いは Lightchain-compatible なアパレル生成ワークスペースであり、現状は機能追加が先行して画面構成が Heavy Chain 独自に散らかっている。
- ユーザーの最新方針は、まず Lightchain と全体構成を同じにしてから Heavy Chain 独自機能を追加すること。
- 主導線は `おすすめ`、`企画デザインツール`、`AIフィッティング`、`グラフィックツール` の4カテゴリに寄せる。
- 生成画面は `カテゴリ選択 -> 機能選択 -> 画像/素材入力 -> 任意キーワード -> AI生成 -> 生成履歴/Canvas` の流れに統一する。
- 成果物の同等性は文章ではなく、録画、スクリーンショット、DOM、生成結果、DB/Storage/readback、Lightchain比較表で確認する。

## Current Milestone

Lightchain clone foundation and full-flow parity. まず `/generate` と各生成レーンの構成を Lightchain と同じ骨格に作り替え、全機能要素と成果物フローを録画つきで検証する。

## Root Completion Criteria

- `/generate` 未選択画面が Lightchain と同じ 4カテゴリ起点のホーム構成になっている。
- `/generate?feature=...` 詳細画面が左の機能一覧、中央の素材/入力/生成、右の結果/履歴という Lightchain 生成画面と同じ操作骨格になっている。
- 既存 Heavy Chain 独自機能が4カテゴリのどれかへ自然に統合され、旧 `画像編集` / `事例共有` / 旧FeatureSelector分類が主導線に露出しない。
- 全主要機能で、画像/素材入力、任意キーワード、生成計画または生成実行、結果表示、履歴/Canvas連携を確認する。
- Lightchain実画面または既存証跡との比較表に、同じ点、違う点、意図的追加、未解消差分を記録する。
- デスクトップとモバイルで録画、スクリーンショット、DOM/URL証跡、console/page/network failure確認が残っている。
- 非課金生成が許可される範囲では実生成/worker/readback/画像目視を行い、生成成果物がプロンプト意図に合っているかを短い視覚スコアで確認する。
- `npm run typecheck`, `npm run lint -- --max-warnings=0`, `npm run build`, `git diff --check`, Codex read-only review, relevant Playwright recorded QA が通る。
- `STATE.md`, `plan.md`, `GOAL.md` が現在の真実と証跡パスを指し、push と production readback まで完了する。

## Quality Bar

Lightchain と同じ使い心地が基準。Heavy Chain 独自の説明カード、運用ステータス、Runway/課金/技術説明は主導線から外し、必要な時だけ折りたたみや設定導線に置く。機能が多くてもカテゴリと選択中パネルで整理し、第一画面を説明文で埋めない。画像生成や成果物品質は、実画像を開いて確認するまで完了扱いしない。

## Non-Goals

- Lightchain のロゴ、商標、固有ブランドをそのまま使うこと。
- 課金、購入、checkout、支払い、本人確認、OTP/CAPTCHA、秘密入力、外部公開。
- Lightchain にない余計なナビや説明を主導線に増やすこと。
- 旧 `localhost:15554` Runway OAuth 動的クライアント経路を復活させること。

## Approval Boundaries

Codex may do automatically: source/script/docs/STATE/GOAL edits, local and Zeabur UI QA, Playwright recording, screenshots, DOM/readback capture, non-billing marker-scoped generation jobs/images/usage rows, marker-scoped cleanup, bounded Runway MCP credit use for QA, Codex read-only review, commit and push to `origin main` after gates pass.

Human approval required: credentials, secret entry, billing, purchase, checkout, payment, identity verification, OTP/CAPTCHA/security prompt, external public publishing, destructive cleanup outside marker-scoped QA artifacts, new paid external observability/cron/vendor setup.

## Gap-Closing Goal Map

| ID | Status | Owner | Acceptance | Depends On | Child thread name | Outcome | Acceptance Evidence | Child Packet |
|---|---|---|---|---|---|---|---|---|
| G401 | accepted | parent | codex-verifiable | none | Parent inline: G401 Lightchain IA clone | `/generate` と各詳細画面の骨格を Lightchain 4カテゴリ構成へ作り替えた。 | `output/playwright/lightchain-workbench-parity-apparel-local-20260626-r11-image-variations-detail/SUMMARY.json` confirms 4 categories, no old duplicate sidebars, compact detail workbench, desktop/mobile screenshots and videos. | goals/G401.md |
| G402 | accepted | parent | codex-verifiable | G401 | Parent inline: G402 Feature-flow parity | 全主要機能を4カテゴリへ統合し、機能選択から入力/生成/結果/Canvasまで同じ流れに揃えた。 | `scripts/verify-lightchain-clone-layout.mjs` and `e2e/smoke.spec.ts` assert `design-arrange` and `image-variations` under graphics; r11 recorded proof confirms upload, prompt, detail tabs, operation details, and mobile. | goals/G402.md |
| G403 | accepted-with-caveat | parent | codex-verifiable | G402 | Parent inline: G403 Output and generation QA | 非課金範囲で全10主要生成機能の成果物を readback/目視確認した。 | `output/playwright/hc-all-features-real-generation-after-lightchain-clone-20260626/readback-after-worker.json` and `visual-scorecard.json`; 10/10 completed and visually passed, but only 2 fresh in this run and 8 recent same-prompt Runway assets reused due `workspace_limit`. | goals/G403.md |
| G404 | in-progress | parent | codex-verifiable | G401-G403 | Parent inline: G404 Production closeout | static gates, Codex review, Zeabur deploy/readback, STATE/plan closeout, pushまで完了する。 | Static gates pass locally after r11; production deploy/readback and push still pending in this loop. | goals/G404.md |

## Active Child Window

| ID | Window status | Reason for active window | Workspace / worktree | Notes |
|---|---|---|---|---|
| G404 | active | Final closeout after accepted G401-G403. | current checkout | Requires build, final Codex review, docs closeout, commit/push, and production readback if deployed in this loop. |

## Human-Needed Queue / Checkpoints

Checklist: [goals/HUMAN_NEEDED.md](goals/HUMAN_NEEDED.md)

No active human-needed items. Human review may still be requested for final subjective "same feel" acceptance after Codex self-review and evidence packet are complete.

## Child Wait / Automation State

Thread automation:
- status: not-created
- cadence: not required while parent executes inline in this session
- automation id: n/a

## Review / Integration / Push Policy

- Run `npm run typecheck`, `npm run lint -- --max-warnings=0`, `npm run build`, `git diff --check`, relevant Playwright recorded UI proof, and Codex read-only review before final push.
- For UI/UX claims, use screenshots/recordings plus DOM/URL/console evidence; do not rely on static build only.
- For generated-output claims, open the generated image and record prompt adherence, apparel fidelity, unwanted text/watermark/UI artifacts, composition, and commercial usefulness.
- Push only after parent accepts G401-G404 and updates `STATE.md` / `plan.md`.

## Integration Ledger

| Child | Result | Child Gates | Manager Decision | Integration / Push | Goal Map Status Update | Notes |
|---|---|---|---|---|---|---|
| G401 | accepted | r11 recorded Lightchain clone verifier passed with `ok=true`, `failed=[]`. | Accept local UI skeleton parity. | Integrated in `Layout`, `LandingPage`, `LoginPage`, `GenerateLightchainEntry`, `GeneratePage`, catalog. | accepted | Lightchain brand assets were not copied; Heavy Chain branding retained. |
| G402 | accepted | Static gates and r11 verifier cover category/card/detail/mobile. | Accept flow parity for primary generate entry. | `image-variations` and `design-arrange` both graphics; verifier/e2e now assert both. | accepted | Old categories are not primary IA. |
| G403 | accepted-with-caveat | Readback 10/10, visual scorecard 10/10, cleanup done. | Accept output path with explicit Runway workspace-limit caveat. | Proof artifacts kept locally; marker rows/inbox cleaned. | accepted-with-caveat | 2 fresh outputs in this run, 8 reused recent same-prompt Runway assets. |

## Achievement Review

Active child window status: G404 active
Goal map status: G401-G402 accepted, G403 accepted-with-caveat, G404 in-progress
Parent goal status: active
Human-needed checkpoint status: none
Gap review: local Lightchain-vs-Heavychain comparison and all-feature generation QA complete; production deploy/readback remains before final complete.
