# GOAL.md

## Loop Metadata

Loop ID: HC-PRODUCTION-MONITORING-20260626
Parent thread name: Goal: Heavy Chain Production Monitoring
Parent thread ID: current Codex session

## Parent Goal

Add a practical daily production monitoring loop for Heavy Chain so generation failure rate, local Runway worker backlog, Supabase/Storage health, Runway import failures, and UI console/network failures are visible from one read-only command with durable proof artifacts.

## Strategic Summary

- Current generation and UI blockers are closed, but a 10M-user product needs ongoing monitoring rather than one-time QA.
- Existing `verify:launch-ops` checks UI route health, console/page errors, network failures, and asset freshness, but it does not summarize DB generation health or worker/import backlog.
- Existing Supabase observability tables (`generation_jobs`, `generated_images`, `edge_function_runs`, `usage_events`) already hold the data needed for a daily read-only health report.
- Billing, purchase, payment, identity, OTP/CAPTCHA/security prompts, secrets, and external publishing remain human-only stop points.

## Current Milestone

Production monitoring command and runbook for non-billing daily health checks.

## Root Done Evidence

- A new monitoring command produces JSON and Markdown artifacts for the latest production window.
- The command reports generation totals, failure rate, pending/processing age, worker backlog, Runway import failures, Edge Function failures, usage event failures, Storage signed-url health, and UI console/network failures.
- The command is read-only and does not submit generation, purchase, publish, mutate user data, or clean up data.
- Local validation passes: syntax, typecheck, lint, build, `git diff --check`, Codex read-only review, and an actual production monitoring run.
- `STATE.md`, `GOAL.md`, and a runbook/checklist point to the monitoring command and latest proof.
- Changes are committed and pushed.

## Quality Bar

No false green: DB readback or UI probe failures must produce blockers or warnings in the monitoring artifact. No signed URLs or secret values in committed docs/state. No automatic billing/purchase/payment/identity/security/external publishing actions.

## Non-Goals

- No paid observability vendor integration.
- No scheduled external cron setup in this loop.
- No billing system implementation.
- No public alert channel or external notification setup.

## Approval Boundaries

Allowed automatically: source/script/docs/STATE/GOAL edits, read-only Supabase/Zeabur/UI checks, local proof artifacts, commits, and push to `origin main` after gates pass.

Human-only stop points: credentials, secret entry, billing, purchase, checkout, payment, identity verification, OTP/CAPTCHA/security prompt, external public publishing, or adding an external alerting service.

## Gap-Closing Goal Map

| ID | Status | Owner | Acceptance | Depends On | Outcome | Acceptance Evidence |
|---|---|---|---|---|---|---|
| G301 | accepted | parent | codex-verifiable | none | Monitoring design and command surface are added without duplicating launch-ops. | `package.json`; `scripts/monitor-production-health.mjs`; `docs/production-monitoring-runbook-2026-06-26.md`. |
| G302 | accepted | parent | codex-verifiable | G301 | DB/Storage/worker/import health checks produce actionable daily metrics. | `output/playwright/production-monitor-20260626-full-rerun/summary.json`; `SUMMARY.md`; sections for generation, edge, usage, storage, local worker inbox. |
| G303 | accepted | parent | codex-verifiable | G302 | UI console/network monitoring is integrated and the whole loop is documented, verified, committed, and pushed. | Nested UI launch-ops proof in `output/playwright/production-monitor-20260626-full-rerun/ui/`; static gates; Codex read-only review; `STATE.md`. |

## Active Child Window

| ID | Window status | Workspace / worktree | Notes |
|---|---|---|---|
| G301-G303 | accepted | current checkout | Complete; parent executed inline because the loop was bounded and evidence-heavy. |

## Human-Needed Queue / Checkpoints

Checklist: [goals/HUMAN_NEEDED.md](goals/HUMAN_NEEDED.md)

No active human-needed items.

## Review / Integration / Push Policy

- Verify evidence before accepting each goal-map item.
- Run `node --check`, `npm run typecheck`, `npm run lint -- --max-warnings=0`, `npm run build`, `git diff --check`, relevant production monitor proof, and read-only Codex review when available before final push.
- Push only after monitoring proof and documentation/state closeout pass.

## Integration Ledger

| Child | Result | Manager Decision | Evidence |
|---|---|---|---|
| G301 | Monitoring command and runbook accepted. | accepted | Script, npm command, and runbook added. |
| G302 | DB/Storage/worker/import monitoring accepted. | accepted | Full production monitor proof `ok=true`, blockers 0. |
| G303 | UI probe integration and closeout accepted. | accepted | UI `ok=true`, static gates passed, Codex review completed. |

## Achievement Review

Active child window status: none
Goal map status: G301-G303 accepted
Parent goal status: complete
Human-needed checkpoint status: none
Gap review: no remaining blocker for this production-monitoring loop
