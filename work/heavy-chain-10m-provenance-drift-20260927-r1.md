# Heavy Chain 10M / release-gate provenance drift — 2026-09-27 r1

## Fresh evidence

- `output/playwright/10m-completion-audit/summary.json`: captured `2026-09-27T06:31:48.295Z`, `ok=false`, 16 blockers.
- `output/playwright/10m-completion-audit/release-gate-summary.json`: captured `2026-09-27T06:31:50.431Z`, `ok=false`.
- Latest release-gate failures are exactly: production monitor/UI pair, G618 scale ops baseline, production H602 completion readback, and real-generation visual scorecard.
- Current production mass-market QA and Lightchain all-feature order previews pass in the latest release gate.
- `npm run verify:g618-scale-ops` fail-closed before browser/build because explicit Cloudflare API origin, brand, live session, and baseline limits are absent.

## Provenance mismatch

The 10M verifier still hardcodes older proof paths such as:

- `prod-post-g668-dashboard-recent-preview-20260702-r1/SUMMARY.json`
- `prod-post-g659-lightchain-order-preview-20260701-r2/SUMMARY.json`
- `output/playwright/g764-g618-scale-ops-r1/summary.json`

The current release gate reads newer current artifacts for the mass-market and Lightchain lanes. This document records the mismatch only; it does not promote either artifact family, loosen freshness rules, or change acceptance criteria.

## Safe repair boundary

Before editing `scripts/verify-10m-completion-audit.mjs`, obtain a fresh Astra engineering decision for the canonical artifact registry and proof identity rules. Any repair must preserve:

- same-run identity, exact origin, timestamp/freshness, cleanup, and zero-failure checks;
- no promotion from local/old artifacts to production proof;
- no provider, billing, publication, secret, or destructive effect;
- explicit failure when the canonical current artifact is absent or stale.

When owner-provisioned monitor/auth inputs become available, run the GET-only production monitor first, then G618, then refresh the current UI pair and rerun both verifiers. Do not create synthetic summaries to clear the gate.
