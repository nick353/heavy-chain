# GOAL.md

## Loop Metadata

Loop ID: HC-LIGHTCHAIN-20260626
Parent thread name: Goal: Heavy Chain Lightchain Product Excellence
Parent thread ID: 019ef728-e38a-7d01-988d-451c95668bf5

## Parent Goal

Make Heavy Chain a Lightchain-compatible, production-grade apparel generation product: intuitive planning for every generation lane, image/material-first editing, useful generated results, Canvas/Gallery/Jobs continuation, mobile quality, and production evidence.

## Strategic Summary

- Start from one request or one uploaded material, then show a useful generation plan.
- Preserve Heavy Chain advantages: Runway worker, Jobs recovery, Gallery/History, Canvas, material metadata safety.
- Verify with local and Zeabur evidence, not static code claims.
- Billing is inactive and ignored; purchase/payment/identity/security flows remain human-only.

## Current Milestone

Product-excellence pass after the campaign-image Lightchain planning UI landed in production. This milestone expands that pattern across remaining feature lanes and verifies the full product workflow.

## Root Done Evidence

- All known generation features either have Lightchain-style assistant planning or a documented, verified alternative.
- Canvas/Gallery/Jobs continuation is verified after generation or representative saved outputs.
- Mobile and desktop screenshots/videos/DOM summaries show no relevant console/page/request failures for key routes.
- `npm run typecheck`, `npm run lint -- --max-warnings=0`, `npm run build`, and relevant Playwright proof pass.
- Zeabur production proof must exist for the final user-facing flow before the loop is complete; marker-scoped test rows/artifacts are cleaned when created.
- `STATE.md`, docs, and launch/readiness notes point to the final proof bundle.

## Quality Bar

No hidden billing gate. No raw reference image persistence regression. No destructive cleanup outside marker-scoped test artifacts. No UI that hides the primary action behind dense technical panels on first use. No overclaim of pixel-identical Lightchain parity where Heavy Chain intentionally differs.

## Non-Goals

- No billing, purchase, checkout, payment, identity, CAPTCHA/OTP/security prompt automation.
- No external public publishing.
- No direct Runway API fallback or localhost dynamic-client MCP consent flow.
- No unrelated redesign of landing/auth/account pages unless blocking product QA.

## Approval Boundaries

### Codex may do automatically

- write/update allowed files: app source, tests/scripts, docs, `STATE.md`, `PROJECT_DESIGN.md`, `GOAL.md`, `goals/*`, proof artifacts
- launch `queued` child goals from the approved Goal Map: yes
- create/use parent wake-up automation: yes if needed while children are active
- maximum parallel children: five
- run validation/review commands: yes
- integrate accepted child results: yes
- commit/branch/PR: commit on current branch allowed
- push: push to `origin main` allowed after passing checks

### Human approval required

- new or materially changed goals outside this map
- expanded scope or approval boundaries
- unresolved product/spec/quality decisions that require taste judgment beyond the defined criteria
- credentials, external accounts, payments, deployments outside GitHub/Zeabur normal push-triggered deploy, or other external side effects
- merge: not applicable unless a PR is created
- actions always requiring approval: billing, purchase, payment, checkout, identity verification, OTP/CAPTCHA/security prompt, secrets, external public publishing

## Gap-Closing Goal Map

| ID | Status | Owner | Acceptance | Depends On | Child thread name | Outcome | Acceptance Evidence | Child Packet |
|---|---|---|---|---|---|---|---|---|
| G001 | accepted | parent-integrated | codex-verifiable | none | Child: G001 Generate Planning Matrix | All 10 major generate lanes now have request-aware AI assistant planning and feature-specific form reflection. | `node scripts/verify-generate-assistant-planning.mjs`; `output/playwright/lightchain-product-excellence-20260626/generate-assistant-planning-summary.json`; type/lint/build passed. | goals/G001.md |
| G002 | accepted | parent-integrated | codex-verifiable | none | Child: G002 Results Canvas Continuation | Generated/saved result cards expose a real `Canvasへ` continuation with material/layer metadata handoff. | `node scripts/verify-generated-canvas-handoff.mjs`; `output/playwright/lightchain-product-excellence-20260626/g002-canvas-handoff-summary.json`; Canvas Properties DOM proof. | goals/G002.md |
| G003 | accepted | parent-integrated | codex-verifiable | none | Child: G003 Garment Library Canvas Polish | Canvas now surfaces generated material/layer/mask metadata on selected image objects, building on the existing garment/material workbench proof. | `g002-canvas-handoff-summary.json`; existing `material_workbench_slice` and `generation_material_workbench_slice` proof in `STATE.md`. | goals/G003.md |
| G004 | accepted | parent-integrated | codex-verifiable | none | Child: G004 Mobile And Visual Simplification | Primary Generate flow keeps the Lightchain-like assistant action visible across feature lanes without adding a second vertical navigation layer. | `generate-assistant-planning-summary.json`; local screenshots/videos under `output/playwright/lightchain-product-excellence-20260626/`; type/lint/build passed. | goals/G004.md |
| G005 | accepted | parent | codex-verifiable | G001,G002,G003,G004 | Child: G005 Production UAT And Docs | Final Zeabur UAT verified the pushed user-facing flow and updated docs/STATE with current proof. | Zeabur asset `assets/index.C72ffPix.js`; `output/playwright/lightchain-product-excellence-prod-20260626/generate-assistant-planning-summary.json`; launch-ops readback. | goals/G005.md |

## Active Child Window

| ID | Window status | Reason for active window | Workspace / worktree | Notes |
|---|---|---|---|---|
| G001 | accepted | Core generate parity | current checkout | Integrated, deployed, and verified on Zeabur |
| G002 | accepted | Result continuation parity | current checkout | Integrated, deployed, and verified by local structured handoff plus launch-ops |
| G003 | accepted | Garment reference parity | current checkout | Existing workbench proof plus Canvas metadata panel accepted |
| G004 | accepted | Mobile/clutter polish | current checkout | No new nested nav; assistant flow verified locally |
| G005 | accepted | Production UAT and docs | current checkout | Zeabur asset flip and production readback completed |

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
- Internal quality pass required for UX/visual/copy goals.
- Child Codex review required when available for code/config changes; fallback may be parent review if usage limits block Codex.

Parent gates:
- Verify evidence before accepting.
- Run `npm run typecheck`, `npm run lint -- --max-warnings=0`, `npm run build`, and relevant Playwright proof before push.
- Push after checks pass and production deploy/readback is verified.

## Integration Ledger

| Child | Result | Child Gates | Manager Decision | Integration / Push | Goal Map Status Update | Notes |
|---|---|---|---|---|---|---|
| G001 | All Generate feature lanes received feature-specific assistant planning and form reflection. | typecheck/lint/build passed; strict local and Zeabur Playwright assistant matrix passed; Codex review passed. | accepted | Integrated, pushed, deployed, and verified on Zeabur asset `assets/index.C72ffPix.js`. | accepted | Covers 10 feature IDs and direct URL hydration. |
| G002 | Generated result cards now hand off to Canvas with feature, prompt, IDs, material, layer, mask, and composition metadata. | proof build passed; real UI Canvas handoff verifier passed; Codex review passed. | accepted | Integrated, pushed, deployed, and covered by launch-ops Canvas readback plus local structured Canvas handoff proof. | accepted | Verifier uses actual upload, assistant plan, saved result card button, and Canvas DOM/storage readback. |
| G003 | Canvas selected image properties now expose material/layer/mask metadata from generated-result and workspace handoffs. | covered by G002 handoff proof and prior workbench proof in `STATE.md`. | accepted | Integrated, pushed, deployed, and covered by local structured metadata proof. | accepted | No fake segmentation or destructive image processing added. |
| G004 | Generate flow stays assistant-first without adding another side rail; mobile proof artifacts captured by the assistant matrix run. | typecheck/lint/build passed; screenshot/video artifacts present; launch-ops mobile readback passed. | accepted | Integrated, pushed, deployed, and verified by Zeabur assistant matrix plus launch-ops readback. | accepted | Deeper visual polish remains future product iteration, not a blocker for this loop. |
| G005 | Zeabur served the pushed build and production assistant planning passed across all 10 feature lanes. | asset flip observed; production assistant matrix passed; launch-ops readback rerun after docs update. | accepted | Pushed commit `1b27ef6`; final docs/state update in follow-up commit. | accepted | No generation submit, billing, purchase, payment, external publish, or destructive cleanup in the final UI slice. |

## Achievement Review

Active child window status: G001-G005 accepted
Goal map status: all accepted
Parent goal status: complete
Human-needed checkpoint status: none
Gap review / refreshed Gap-Closing Goal Map needed: not needed for this loop
