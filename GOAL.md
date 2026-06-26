# GOAL.md

## Loop Metadata

Loop ID: HC-GENERATION-POLISH-20260626
Parent thread name: Goal: Heavy Chain Generation Polish
Parent thread ID: current Codex session

## Parent Goal

Make the real Heavy Chain generation experience commercially credible by fixing the only `needs-polish` output from the last ten-feature run, checking adjacent output-quality risks, and proving the improved path with real generation artifacts, visual review, production readback, UI proof, cleanup, and deployment evidence.

## Strategic Summary

- Previous loop proved 10 real generation lanes; `variations` was the only `needs-polish` result because the output looked like a mannequin/neck-form campaign asset instead of a natural finished apparel image.
- Similar risk exists where outputs can drift into display forms, hidden product identity, or non-commercial layouts: `scene-coordinate`, `remove-bg`, and `design-gacha`.
- The durable fix must live in product prompt quality and QA harness prompts, not only in a one-off manual prompt.
- Billing, purchase, payment, identity, OTP/CAPTCHA/security prompts, secrets, and external publishing remain human-only stop points.

## Current Milestone

Generation quality polish after the real 10-feature QA run, focused on variations and adjacent commercial-output risks.

## Root Done Evidence

- Product prompt quality explicitly prevents mannequin/neck-form/display-form artifacts for variation-like apparel outputs.
- QA harness can run only selected features so credit-consuming regression checks are bounded and repeatable.
- Focused real generation produces new outputs for `variations`, `scene-coordinate`, `remove-bg`, and `design-gacha`, with actual image inspection and a visual scorecard.
- Production readback proves jobs/images/storage are persisted and usable through Heavy Chain flows, or exact blocker evidence is captured.
- Zeabur production serves the patched asset after checks and push.
- Marker-scoped cleanup removes QA jobs/images/storage after proof capture.

## Quality Bar

No claiming image quality without opening the generated image. No direct Runway API fallback or localhost dynamic-client MCP consent loop. No destructive cleanup outside marker-scoped QA artifacts. No overclaiming “perfect” if a feature still needs human subjective approval.

## Non-Goals

- No billing, purchase, checkout, payment, identity, CAPTCHA/OTP/security prompt automation.
- No external public publishing.
- No broad feature redesign beyond generation-quality polish and verification needed by this loop.

## Approval Boundaries

Allowed automatically: source/script/docs/STATE/GOAL edits, bounded Runway MCP credit use for this QA loop, Supabase marker-scoped QA rows/images/storage, local and Zeabur QA, commits, and push to `origin main` after gates pass.

Human-only stop points: credentials, secret entry, billing, purchase, checkout, payment, identity verification, OTP/CAPTCHA/security prompt, external public publishing, or a subjective product decision that remains unresolved after evidence and recommendation.

## Gap-Closing Goal Map

| ID | Status | Owner | Acceptance | Depends On | Outcome | Acceptance Evidence |
|---|---|---|---|---|---|---|
| G201 | accepted | parent | codex-verifiable | none | Durable prompt-quality and focused QA harness polish for variation-like risks. | `src/lib/productPromptQuality.ts`; `scripts/hc-10m-real-generation-qa.mjs`; `node --check`; `npm run typecheck`; `npm run lint -- --max-warnings=0`; `npm run build`; `git diff --check`; Codex read-only review. |
| G202 | accepted | parent | codex-verifiable | G201 | Bounded real generation and visual QA for variations plus adjacent risk lanes. | `output/playwright/hc-generation-polish-20260626/run-manifest.json`; `runway-images/`; `readback-after-worker.json`; `visual-scorecard.json` with 4/4 Pass. |
| G203 | accepted | parent | codex-verifiable | G202 | Production deployment, UI/readback proof, marker-scoped cleanup, and state closeout. | Zeabur asset `assets/index.BA3jKbTO.js`; `prod-ui-proof/summary.json`; `cleanup-after-proof.json`; `STATE.md`; pushed commit `9faf3e7`. |

## Active Child Window

| ID | Window status | Workspace / worktree | Notes |
|---|---|---|---|
| G201-G203 | accepted | current checkout | Complete; parent executed inline because the loop was bounded and evidence-heavy. |

## Human-Needed Queue / Checkpoints

Checklist: [goals/HUMAN_NEEDED.md](goals/HUMAN_NEEDED.md)

No active human-needed items.

## Review / Integration / Push Policy

- Verify evidence before accepting each goal-map item.
- Run `npm run typecheck`, `npm run lint -- --max-warnings=0`, `npm run build`, `git diff --check`, relevant generation/readback/UI proof, and read-only Codex review when available before final push.
- Push only after deployment/readback and cleanup evidence are captured.

## Integration Ledger

| Child | Result | Manager Decision | Evidence |
|---|---|---|---|
| G201 | Prompt quality and bounded QA harness accepted. | accepted | Static gates and Codex read-only review passed. |
| G202 | Real Runway MCP generation for 4 focused lanes accepted. | accepted | 4/4 worker imports, readback, and visual scorecard passed. |
| G203 | Deployment, UI proof, cleanup, and state closeout accepted. | accepted | Zeabur asset proof, production UI proof, cleanup proof, and STATE update. |

## Achievement Review

Active child window status: none
Goal map status: G201-G203 accepted
Parent goal status: complete
Human-needed checkpoint status: none
Gap review: no remaining blocker for this focused generation-polish loop
