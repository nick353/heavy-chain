# G632 Incident Response Drill

Updated: 2026-07-01

## Purpose

This drill turns the G620 incident-response guidance into a machine-checkable, non-destructive operations rehearsal. It is not a production outage simulation, load test, billing test, purchase, checkout, external publishing test, or destructive cleanup.

## Hard Stops

Stop before billing, purchase, payment, checkout, identity verification, OTP/CAPTCHA/security prompt, secret entry, external public publishing, destructive production cleanup, broad data deletion, DNS/hosting changes, or new paid vendor setup.

Allowed without extra approval:

- read-only production monitor and release-gate readback
- local source, migration, runbook, and verifier checks
- marker-scoped local artifacts under `output/playwright/g632-incident-response-drill/`
- screenshot/video/DOM proof from existing non-submit QA artifacts

## Drill Matrix

| Scenario | Detect | First action | Recovery rehearsal | Required proof | Stop condition |
|---|---|---|---|---|---|
| Runway failure | `generation_jobs` pending/stale or Runway `workspace_limit` / provider error in artifact | Preserve run artifact, job id, provider task id, and local worker inbox state | Use approved existing Runway MCP client only, rebuild local handoff if needed, retry with a new marker run and at most two concurrent generations | `runway-workspace-limit-after-successful-probe.json`, `run-manifest.json`, `readback*.json`, `cleanup*.json`, and G617 restart notes | Do not use `localhost:15554` / `mcp-remote`; stop if workspace/model availability is unavailable |
| Worker stop | local worker not running, stale pending/processing jobs, or MCP result JSON left in inbox | Start `npm run worker:local-runway:watch` or use single-job import with explicit job id | Verify result JSON has `heavyChainJobId` or `generationJobId`, then import and read back DB/Storage/Gallery | production monitor local inbox warning, worker command in G614 runbook, job readback/cleanup proof | Do not broad-delete jobs or consume untagged MCP JSON by default |
| Storage readback failure | generated image exists but signed URL/download fails | Do not trust Gallery or completion claim | Inspect `generated_images.storage_path`, bucket object, signed URL readback, and Storage RLS/grants | production monitor storage signed URL checks, G620 storage SLO, release-gate storage readback | Stop public UX acceptance until signed URL/download succeeds |
| RLS or permission anomaly | DB readback, role check, RPC, RLS policy, or service-role wrapper fails | Preserve request id, brand id, user id, table/RPC name, and error text | Repair source/migration path, rerun `npm run security:audit`, `bash scripts/supabase-prod-verify.sh`, and release gate | G620 abuse-case matrix, RLS/grant checks, admin audit logs, Edge/usage observability | Do not bypass RLS with ad-hoc service-role scripts for user-facing completion proof |
| Generation-quality regression | generated output has visible UI/watermark/text artifact, wrong garment, bad crop, or scorecard `fail` / unresolved `needs-polish` | Keep image, prompt, feature, job/task id, and scorecard row | Rerun bounded prompt/style fix for the affected feature only, then rescore | `docs/generation-quality-rubric-2026-06-26.md`, `npm run verify:generation-scorecard`, image artifact, scorecard summary | Do not call all-10 generation complete until every feature is `pass` |

## Rehearsal Commands

Run the non-destructive drill verifier:

```bash
npm run verify:g632-incident-response
```

For a release candidate, follow with:

```bash
npm run monitor:production -- --out output/playwright/production-monitor-post-g630-20260701-r1
npm run verify:release-gate -- --out output/playwright/release-gate-g631-current-clean-20260701-r2/summary.json
```

## Acceptance

G632 is accepted only when the verifier confirms every scenario has:

- a detection signal
- a first action
- a recovery rehearsal path
- a required proof artifact or command
- an explicit stop condition
- no irreversible action requirement

The drill can pass while G617, G619, H601, H602, and the public domain remain open. It proves response readiness, not public-launch completion.
