# G620 Security Operations Runbook

Updated: 2026-06-30

## Purpose

G620 closes the gap between a static security audit and production security operations. It proves that Heavy Chain has machine-checkable controls for abuse prevention, audit logging, incident response, production monitoring, and human-only boundaries before a 10M-user readiness claim.

This is not a penetration test, legal approval, billing launch, or public publishing approval.

## Hard Stops

Stop before billing, purchase, payment, checkout, identity verification, OTP/CAPTCHA/security prompt, secret entry, external public publishing, destructive production cleanup, broad data deletion, or new paid vendor setup.

Allowed without extra approval:

- read-only production monitor readback
- local source, migration, and runbook checks
- static verification of RLS, RPC grants, Edge Function ordering, audit logs, and irreversible-action markers
- marker-scoped local artifacts under `output/playwright/10m-product-readiness-g620/`

## Abuse-Case Matrix

| Abuse case | Required control | Evidence checked by G620 |
|---|---|---|
| Anonymous generation attempt | Edge Functions require user auth before brand access | `createUserClient`, `requireUser`, and JWT config guards |
| Viewer/member privilege escalation | Generation requires brand `editor` or stronger | `requireBrandRole(..., 'editor')` in every generation function |
| Unapproved Runway MCP use | Brand approval is required before usage reservation | `requireRunwayMcpConnectionApproval` appears before `reserveBrandUsage` |
| Generation spam | Short-window brand/user rate limits remain active while billing is inactive | `v_brand_recent_units + p_units > 5`, `v_user_recent_units + p_units > 3` |
| Stale reservation abuse | Old reservations are released and marked | `reservation_stale`, `INTERVAL '15 minutes'`, `status = 'released'` |
| Edge failure invisibility | Started/succeeded/failed Edge runs are recorded | `edge_function_runs`, `recordEdgeFunctionRun`, monitor readback |
| Storage trust without object proof | Signed URL readback is required | production monitor storage checks |
| Platform-admin action misuse | Admin-only approvals and audit log readback are constrained | `private.is_current_user_admin()`, `admin_audit_logs` RLS |
| Secret leakage | Repository secret scan remains release-gated | `npm run security:audit` and release gate command checks |

## Audit Sources

Security operations rely on these durable tables and proof artifacts:

- `public.usage_events`: usage reservations, succeeded/failed/released state, idempotency key, stale release metadata.
- `public.edge_function_runs`: Edge Function status, request id, duration, error message, and brand/user linkage.
- `public.admin_audit_logs`: platform-admin-only audit log visibility.
- `public.runway_mcp_connection_approvals`: brand-level Runway MCP approval lifecycle.
- `output/playwright/10m-product-readiness-g620/summary.json`: G620 acceptance summary.
- `output/playwright/10m-product-readiness-g620/production-monitor-readback/summary.json`: read-only production monitor input.

## Incident Response

1. Preserve the exact artifact directory and do not delete production rows.
2. Classify the incident: generation abuse, access/role issue, worker/import failure, storage readback failure, Edge Function failure, or suspected secret exposure.
3. Use `request_id`, `brand_id`, `user_id`, `generation_jobs.id`, `usage_events.id`, and `edge_function_runs.id` to join evidence.
4. Stop generation by disabling or repairing the approved local worker path, not by using broad destructive cleanup.
5. For Runway approval issues, revoke or reject the brand approval through the approved admin path and preserve the audit trail.
6. For storage issues, do not trust Gallery until signed URL readback passes.
7. Rerun:

```bash
npm run verify:g620-security-ops
npm run verify:release-gate -- --out output/playwright/10m-product-readiness-g620/release-gate-after-g620.json
```

## Monitoring SLOs

G620 requires the production monitor to prove:

- generation failure rate is `0`
- recent failed generation jobs are `0`
- stale pending/processing jobs are `0`
- generated-image storage signed URL errors are `0`
- failed usage events are `0`
- stale reserved usage events are `0`
- failed Edge Function runs are `0`
- stale started Edge Function runs are `0`

Warnings may be operator-triage items only when explicitly allowlisted by the verifier.

If the 96-hour window contains no `usage_events` or no `edge_function_runs`, G620 must not silently imply live-row coverage. The verifier records `production_usage_sample_absent` and/or `production_edge_function_sample_absent` warnings while still checking the source/RPC completion and observability paths. Rerun after safe production usage exists to replace those warnings with live-row proof.

## Verification

Run:

```bash
npm run verify:g620-security-ops
```

The verifier checks this runbook, source-level access controls, database/RLS/RPC constraints, read-only production monitor output, irreversible-action markers, and release-gate wiring. It does not submit generation, publish externally, deploy, purchase, pay, or clean production data.
