# G632 Incident Response Drill

Updated: 2026-09-08

## Purpose

This drill turns the current Heavy Chain incident-response guidance into a
machine-checkable, non-destructive local rehearsal. It validates the operator
path for Cloudflare provider-action failures, durable job/receipt readback
stalls, private-media delivery failures, auth-boundary anomalies, and
generation-quality regressions. It is not a production outage simulation,
load test, billing test, purchase, checkout, external publishing test, or
destructive cleanup.

The verifier checks the current Cloudflare contract in the G620 source/schema
and the image, monitoring, feedback/admin, and Canvas recovery runbooks. A
passing result is local rehearsal readiness only; it is not production
completion and does not establish live provider, browser, billing, or
release evidence.

## Hard Stops

Stop before billing, purchase, payment, checkout, identity verification,
OTP/CAPTCHA/security prompts, secret entry, external public publishing,
destructive production cleanup, broad data deletion, DNS/hosting changes,
deployment, or new paid vendor setup.

Allowed without extra approval:

- local source, runbook, and verifier checks
- marker-scoped local artifacts under `output/playwright/g632-incident-response-drill/`
- read-only inspection of existing local receipts/readbacks and non-submit QA artifacts

The rehearsal commands do not authorize generation, provider-action
submission, retry, billing or payment, or deployment. They do not copy old
data, invoke a provider, load credentials, contact a production API, or prove
that real legacy-service communication is zero.

## Drill Matrix

| Scenario ID | Detect | First action | Recovery rehearsal | Required proof | Stop condition |
|---|---|---|---|---|---|
| `provider-adapter-failure` | A Cloudflare provider-action failure, disabled action, or failed durable receipt appears in the local monitor/job artifact | Preserve the run marker, request ID, provider action, error class, and current readback; do not retry automatically | Confirm the server-side provider-action boundary and rerun only static/read-only checks; a real provider retry requires explicit approval | `npm run verify:g620-security-ops`, `cloudflare/heavy-api/IMAGE_AI.md`, current receipt/readback, and the incident summary | Stop when provider availability, current auth/role, secret boundary, or retry approval is unavailable |
| `job-readback-stall` | A `pending`/`processing` job exceeds the configured freshness window or Jobs/History readback stalls | Preserve the request/job state and timestamp, then compare Jobs, History, and usage readback | Reconcile the exact marker-scoped request and verify stale-job handling without submitting a new generation | `cloudflare/heavy-api/MONITORING.md`, current receipt/readback JSON, and the incident summary | Do not replay a request or mark it complete without same-run durable readback |
| `storage-readback-failure` | A private media readback failure affects an otherwise recorded image or its capability/object | Preserve the image ID, private object path, digest/size metadata, and receipt; do not trust the Gallery card as a completed artifact | Verify the private R2 path, owner-scoped access, and exact content readback with static/local checks | `cloudflare/heavy-api/MONITORING.md`, `cloudflare/heavy-api/IMAGE_AI.md`, and the incident summary | Stop before changing buckets, access policy, media capabilities, or deleting an artifact |
| `auth-boundary-anomaly` | A cross-workspace object, owner/brand mismatch, stale role, or auth boundary anomaly appears in a readback | Isolate the affected user, brand, request, and route; preserve the exact response; do not bypass the auth boundary | Rerun static Cloudflare checks and request an authorized current-session readback; no caller-supplied role or service credential workaround | `cloudflare/heavy-api/FEEDBACK_ADMIN.md`, `cloudflare/heavy-api/CANVAS_SAVE_RECOVERY.md`, and the incident summary | Stop when the verified session, current role, or owner-scoped readback is unavailable |
| `generation-quality-regression` | The quality scorecard reports `fail`/`needs-polish` or the output has a wrong garment, crop, text, or watermark artifact | Keep the prompt, feature, request/candidate ID, image, and scorecard row; do not submit a replacement | Review the bounded feature-specific rubric and prepare a fix plan; a new provider action requires explicit approval | `cloudflare/heavy-api/IMAGE_AI.md`, `docs/generation-quality-rubric-2026-06-26.md`, and the incident summary | Do not claim quality or production completion while any required row is unresolved |

## Rehearsal Commands

Run the non-destructive local Cloudflare contract and incident-response
verifier:

```bash
npm run verify:g632-incident-response
```

An explicit JSON path is supported for an isolated local summary. The command
does not authorize generation, provider-action submission, retry, billing,
payment, or deployment.

```bash
npm run verify:g632-incident-response -- --out /tmp/g632-cloudflare-local-20260908/summary.json
```

For a release candidate, any monitor or release-gate readback remains a
separate operation and must retain its own authorization and evidence. This
drill does not run those operations.

## Acceptance

G632 is accepted only when the verifier confirms every scenario has:

- a detection signal
- a first action
- a recovery rehearsal path
- a required current Cloudflare proof artifact or command
- an explicit stop condition
- no irreversible action requirement

The output records `productionCompletion: not_verified` and
`zeroRealSupabaseCommunication: not_verified` explicitly. The drill can pass
while production authentication, source attribution, billing completion,
provider execution, external reviewer verification, image quality, and the
public release gate remain open. It proves response readiness, not public
launch completion or zero real legacy-service communication.
