# GOAL.md

## Loop Metadata

Loop ID: HC-10M-REAL-GENERATION-QA-20260626
Parent thread name: Goal: Heavy Chain 10M Real Generation QA
Parent thread ID: 019ef728-e38a-7d01-988d-451c95668bf5

## Parent Goal

Make Heavy Chain credible as a mass-market apparel generation product by proving, with real generated images and production evidence, that the core generation features create useful outputs, save/recover correctly, continue into Gallery/Jobs/Canvas, and stay understandable on desktop and mobile.

## Strategic Summary

- Real image quality is now the key gap: UI planning passed, but all feature outputs must be generated and judged against expected image criteria.
- Heavy Chain should preserve its safe production route: Zeabur UI/Edge queue, approved-client Runway MCP, local worker import, DB/Storage readback, Gallery/Jobs/Canvas continuation, and marker-scoped cleanup.
- A 10M-user product needs quality scoring, failure triage, recovery steps, and launch-readiness proof, not only feature existence.
- Billing, purchase, payment, identity, OTP/CAPTCHA/security prompts, secrets, and external publishing remain human-only stop points.

## Current Milestone

Real-generation quality and launch-readiness pass after the Lightchain-style UI expansion. This loop must prove or fix the actual generated outputs for every major generation lane.

## Root Done Evidence

- All 10 Generate features have at least one real generated output or a precisely documented external/tool blocker: `campaign-image`, `product-shots`, `model-matrix`, `design-gacha`, `scene-coordinate`, `multilingual-banner`, `remove-bg`, `colorize`, `upscale`, and `variations`.
- For each generated output, there is a prompt/expectation, image artifact, visual QA rubric score, pass/fail decision, and notes on prompt adherence, apparel fidelity, unwanted text/watermark/UI artifacts, composition, and commercial usefulness.
- Heavy Chain production readback proves generated artifacts can be imported or observed through Jobs, Gallery, History, and Canvas, or the exact blocker is captured with URL/DOM/screenshot/API evidence.
- Lightchain comparison is refreshed around generation feel, not only static UI: start, upload/reference, planning, generation, result review, and continuation.
- Product launch readiness covers desktop/mobile route QA, Runway worker failure/retry, storage/cleanup, monitoring/runbook, and no relevant console/page/network failures.
- Required checks pass before final push: `npm run typecheck`, `npm run lint -- --max-warnings=0`, `npm run build`, `git diff --check`, relevant Playwright/Runway proof, Codex read-only review, Zeabur readback.

## Quality Bar

No fake image-quality claims. No claiming generated images are correct without inspecting the actual image. No raw reference image persistence regression. No destructive cleanup outside marker-scoped test artifacts. No purchase/payment/identity/secret/CAPTCHA bypass. No direct Runway API fallback or localhost dynamic-client MCP consent flow. No overclaim that Heavy Chain is complete if a generation lane is blocked.

## Non-Goals

- No billing, purchase, checkout, payment, identity, CAPTCHA/OTP/security prompt automation.
- No external public publishing.
- No direct Runway API fallback, hosted `mcp-remote` bridge fallback, or `localhost:15554` consent loop.
- No broad brand/marketing strategy rewrite beyond release-readiness and UX fixes required by the QA evidence.

## Approval Boundaries

### Codex may do automatically

- write/update allowed files: app source, tests/scripts, docs, `STATE.md`, `PROJECT_DESIGN.md`, `GOAL.md`, `goals/*`, proof artifacts
- launch `queued` child goals from the approved Goal Map: yes
- create/use parent wake-up automation: yes if needed while children are active
- maximum parallel children: five
- run validation/review commands: yes
- use Runway MCP credits for bounded QA generation: yes
- create marker-scoped production jobs/images/usage rows and clean them up: yes
- integrate accepted child results: yes
- commit/branch/PR: commit on current branch allowed
- push: push to `origin main` allowed after passing checks

### Human approval required

- new or materially changed goals outside this map
- expanded scope or approval boundaries
- unresolved subjective product decisions after Codex has produced evidence and a recommendation
- credentials, external accounts, payments, deployments outside GitHub/Zeabur normal push-triggered deploy, or other external side effects
- merge: not applicable unless a PR is created
- actions always requiring approval: billing, purchase, payment, checkout, identity verification, OTP/CAPTCHA/security prompt, secrets, external public publishing

## Gap-Closing Goal Map

| ID | Status | Owner | Acceptance | Depends On | Child thread name | Outcome | Acceptance Evidence | Child Packet |
|---|---|---|---|---|---|---|---|---|
| G101 | accepted | parent | codex-verifiable | none | Child: G101 Real Generation Harness | Added a repeatable marker-scoped harness for all-feature real generation QA. | `scripts/hc-10m-real-generation-qa.mjs`; `node --check`; enqueue/readback/cleanup modes; production readback with 10 completed jobs/images. | goals/G101.md |
| G102 | accepted | parent | codex-verifiable | G101 | Child: G102 Ten Feature Image Quality QA | All 10 Generate features produced real Runway images, were imported by the worker, and were visually scored. | `output/playwright/hc-10m-real-generation-qa-20260626/visual-scorecard.json`; `runway-images/`; `readback-after-worker.json`. | goals/G102.md |
| G103 | accepted | parent | codex-verifiable | G102 | Child: G103 Continuation And Recovery QA | Generated artifacts were verified through Gallery, Jobs, Canvas route load, DB/Storage readback, and worker processed-file archive. | `ui-prod/summary.json`; `readback-after-worker.json`; `output/runway-mcp-results/inbox/processed/*`; local post-fix proof. | goals/G103.md |
| G104 | accepted | parent | codex-verifiable | G102 | Child: G104 Lightchain Feel And UX Polish | Fixed the two UX gaps found by the real run: Jobs no longer truncates an all-feature batch to 8, and Canvas guide no longer blocks production flow by default. | `src/lib/workspaceActivity.ts`; `src/components/canvas/CanvasGuide.tsx`; `local-after-fix/summary.json`. | goals/G104.md |
| G105 | accepted | parent | codex-verifiable | G101 | Child: G105 Scale And Launch Ops Readiness | Launch checks passed for the final deployed asset; the broad launch-ops verifier also drove the mobile Canvas label fix and current STATE asset update. | `npm run typecheck`; `npm run lint -- --max-warnings=0`; `npm run build`; `git diff --check`; `launch-ops-final/summary.json`. | goals/G105.md |
| G106 | accepted | parent | codex-verifiable | G102,G103,G104,G105 | Child: G106 Final Integration And Release Proof | Final docs/state/goal reflect current truth; commits were pushed, Zeabur served the final asset, production Jobs/Canvas readback passed, and marker-scoped cleanup removed QA rows/images. | `STATE.md`; commits `5599fc5`, `aa88c1c`; final docs commit; Zeabur asset `assets/index.nS7-jc2b.js`; `prod-after-final-deploy/summary.json`; `cleanup-after-final-proof.json`. | goals/G106.md |

## Active Child Window

| ID | Window status | Reason for active window | Workspace / worktree | Notes |
|---|---|---|---|---|
| G105 | accepted | Launch checks and cleanup proof accepted | current checkout | Complete |
| G106 | accepted | Final integration, push, deploy readback accepted | current checkout | Complete |

## Human-Needed Queue / Checkpoints

Checklist: [goals/HUMAN_NEEDED.md](goals/HUMAN_NEEDED.md)

| Item | Blocks | Summary | Status |
|---|---|---|---|

## Child Wait / Automation State

Thread automation:
- status: not-created
- cadence: on demand in current session
- automation id:

## Review / Integration / Push Policy

Child gates:
- Child validation required unless docs/research-only and marked `not_required`.
- Internal quality pass required for visual output, UX, copy, and strategy goals.
- Child Codex review required for code/config/runtime changes when available; fallback is parent read-only review.

Parent gates:
- Verify evidence before accepting.
- For real-generation QA, do not accept a feature as passing unless the actual generated image has been inspected and scored.
- Run `npm run typecheck`, `npm run lint -- --max-warnings=0`, `npm run build`, `git diff --check`, relevant Playwright/Runway proof, and Codex read-only review before push.
- Push after checks pass and production deploy/readback is verified.

## Integration Ledger

| Child | Result | Child Gates | Manager Decision | Integration / Push | Goal Map Status Update | Notes |
|---|---|---|---|---|---|---|

## Achievement Review

Active child window status: none
Goal map status: G101-G106 accepted
Parent goal status: complete
Human-needed checkpoint status: none
Gap review / refreshed Gap-Closing Goal Map needed: not needed for this loop; remaining product polish is tracked as follow-up, not a blocker
