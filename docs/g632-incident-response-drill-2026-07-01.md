# G632 Incident Response Drill

Updated: 2026-08-18

## Purpose

This drill turns the current Heavy Chain incident-response guidance into a
machine-checkable, non-destructive operations rehearsal. It validates the
operator path for provider failures, job/readback stalls, storage failures,
permission anomalies, and generation-quality regressions. It is not a
production outage simulation, load test, billing test, purchase, checkout,
external publishing test, or destructive cleanup.

## Hard Stops

Stop before billing, purchase, payment, checkout, identity verification,
OTP/CAPTCHA/security prompts, secret entry, external public publishing,
destructive production cleanup, broad data deletion, DNS/hosting changes,
deployment, or new paid vendor setup.

Allowed without extra approval:

- read-only production monitor and release-gate readback
- local source, migration, runbook, and verifier checks
- marker-scoped local artifacts under `output/playwright/g632-incident-response-drill/`
- screenshot/video/DOM proof from existing non-submit QA artifacts

## Drill Matrix

| Scenario ID | Detect | First action | Recovery rehearsal | Required proof | Stop condition |
|---|---|---|---|---|---|
| `provider-adapter-failure` | A provider adapter error, disabled provider, or failed Edge Function readback appears in the monitor/job artifact | Preserve the run marker, job id, provider error class, and current readback; do not retry automatically | Confirm the configured server-side adapter boundary and re-run only static/read-only checks; a real provider retry requires explicit approval | `npm run verify:g620-security-ops`, current monitor/readback JSON, and the incident summary | Stop when provider availability, secret presence, or retry approval is unavailable |
| `job-readback-stall` | A `pending`/`processing` job exceeds the configured freshness window or the Jobs/History readback stalls | Preserve the job state and timestamp, then compare Jobs, History, and usage readback | Reconcile the marker-scoped job state and verify stale-job handling without submitting a new generation | Jobs/History readback, `npm run monitor:production -- --skip-ui`, and the incident summary | Do not replay a job or mark it complete without same-run readback |
| `storage-readback-failure` | A generated image row exists but its signed URL or download readback fails | Preserve the image id and storage path metadata; do not trust the Gallery card as a completed artifact | Verify storage-path and signing contracts with static checks and a read-only database/storage readback | workspace readback JSON, storage contract checks, and the incident summary | Stop before changing buckets, policies, or deleting an artifact |
| `rls-permission-anomaly` | A cross-workspace row, missing source attribution, or permission error appears in a readback | Isolate the affected workspace and record the exact table/operation; do not bypass RLS | Re-run static security checks and request an authorized Supabase/RLS readback; no service-role workaround | `scripts/security-audit.mjs`, `scripts/supabase-prod-verify.sh`, and the incident summary | Stop when authenticated Supabase readback or security-definer proof is unavailable |
| `generation-quality-regression` | The quality scorecard reports `fail`/`needs-polish` or the output has a wrong garment, crop, text, or watermark artifact | Keep the prompt, feature, job/task id, image, and scorecard row; do not generate a replacement | Review the bounded feature-specific rubric and prepare a fix plan; a new generation requires explicit approval | `docs/generation-quality-rubric-2026-06-26.md`, `npm run verify:generation-scorecard`, and the incident summary | Do not claim all-feature quality completion while any required row is unresolved |

## Rehearsal Commands

Run the non-destructive drill verifier:

```bash
npm run verify:g632-incident-response
```

For a release candidate, follow with the read-only production monitor and the
release gate. These commands do not authorize generation, retry, billing, or
deployment.

```bash
npm run monitor:production -- --skip-ui
npm run verify:release-gate -- --out output/playwright/release-gate-current/summary.json
```

## Acceptance

G632 is accepted only when the verifier confirms every scenario has:

- a detection signal
- a first action
- a recovery rehearsal path
- a required proof artifact or command
- an explicit stop condition
- no irreversible action requirement

The drill can pass while beta evidence, production source attribution,
billing completion, provider execution, external reviewer verification, and
the public release gate remain open. It proves response readiness, not public
launch completion.
