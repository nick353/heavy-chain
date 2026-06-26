# G614 Operations Runbook

Updated: 2026-06-26

## Purpose

This is the current operator map for Heavy Chain after the Lightchain-style UI, local Runway MCP worker queue, production monitor, release gate, beta QA, and competitor-positioning slices.

Use this file as the index. Keep the detailed procedure in these source runbooks:

- Launch/customer work: `docs/launch-operations-runbook-2026-06-25.md`
- Production monitoring: `docs/production-monitoring-runbook-2026-06-26.md`
- Unified release gate: `docs/release-gate-runbook-2026-06-26.md`
- Rollback: `docs/rollback.md`
- Legal/operator decisions: `goals/HUMAN_NEEDED.md`

## Hard Stop Rules

Stop before billing, purchase, payment, checkout, identity verification, OTP/CAPTCHA/security prompt, secret entry, external public publishing, broad production deletion, or new paid vendor setup.

Allowed without extra approval:

- read-only production UI/DB/Storage monitoring
- local build/type/lint/security checks
- marker-scoped non-billing QA that records exact cleanup proof
- local worker import of approved Runway MCP result JSON when the job ID is explicit

## Normal Production Generation

1. Start the approved local worker lane:

```bash
npm run worker:local-runway:watch
```

2. In Heavy Chain production, create the generation job from the intended feature. Do not use the old `localhost:15554` dynamic-client consent path.
3. If the job has a material/reference image, build the handoff:

```bash
npm run build:local-runway-handoff -- --job-id <generation_jobs.id>
```

4. Upload the generated local reference file to Runway through the approved existing client and use the returned Runway-hosted reference URL. Do not send Supabase signed URLs, Heavy Chain Storage paths, data URLs, or local filesystem paths as Runway `referenceImages`.
5. Save the Runway MCP result JSON into `output/runway-mcp-results/inbox` with `heavyChainJobId` or `generationJobId`.
6. Accept the run only after DB/Storage/Gallery/Canvas readback and visual review pass.

Single-job recovery:

```bash
npm run worker:local-runway -- --job-id <generation_jobs.id> --mcp-result output/runway-mcp-results/inbox/<generation_jobs.id>.json
```

## Daily Monitoring

Run:

```bash
npm run monitor:production
```

Review:

- stale pending/processing generation jobs
- failed worker/import/storage jobs
- local Runway MCP inbox backlog
- generated-image Storage signed-url readback
- Zeabur route health, console/page/network failures

Use `output/playwright/production-monitor-*/SUMMARY.md` for human review and `summary.json` for exact blockers.

For release gate input refresh, write to the fixed artifact paths consumed by `npm run verify:release-gate`:

```bash
npm run monitor:production -- --out output/playwright/goal-loop-10m-20260626/production-monitor-after-deploy
npm run verify:launch-ops -- --out output/playwright/goal-loop-10m-20260626/launch-ops-after-deploy
```

The ad-hoc daily `production-monitor-*` output is useful for operator review, but it does not by itself refresh the release gate readback paths.

## Release Readiness

Run the unified gate:

```bash
npm run verify:release-gate -- --out output/playwright/10m-product-readiness-g615/release-gate-summary.json
```

The gate must not be accepted with `--allow-dirty` or `--skip-commands`. It binds production monitor, launch-ops, mass-market QA, G603/G605/G606/G608 readbacks, security audit, generation scorecard, typecheck, build, lint, syntax checks, and `git diff --check`.

## Failure Triage

| Symptom | First action | Recovery |
|---|---|---|
| pending job older than 10 minutes | Check `output/runway-mcp-results/inbox` and worker process | Start `npm run worker:local-runway:watch`; ensure JSON has `heavyChainJobId` or `generationJobId` |
| JSON moved to `failed/` | Read worker error and manifest | Fix job ID, result path, asset URL, or JSON shape; retry single-job import |
| reference-image failure | Confirm UI job has `hasReferenceImage=true` and `referenceImageHandoff` | Rebuild handoff, upload local reference file to Runway, use Runway-hosted reference URL |
| storage readback failure | Inspect `generated_images.storage_path` and bucket object | Do not trust Gallery until Storage signed URL/download succeeds |
| production UI probe failure | Open nested Playwright screenshots/video and console/network logs | Fix UI/runtime issue, rerun monitor and release gate |
| release gate dirty tree | Commit or park changes | Rerun without `--allow-dirty` |

## Rollback

Rollback is human-approved only. Preserve failed evidence and prefer forward fixes for database state. Use `docs/rollback.md` for the exact route. Do not delete production rows, proof artifacts, auth state, billing/payment data, or personal data without explicit approval.

## G614 Verification

This runbook is machine-checked by:

```bash
npm run verify:g614-ops
```

The verifier checks required runbook references, stop rules, command names, package script existence, and that rollback no longer claims the current app is categorically not release-ready based on the old 2026-06-18 state.
