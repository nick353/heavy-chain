# Heavy Chain Production Root Cause Check

Captured: 2026-07-08T06:29:14Z

## Conclusion

The current production UI probe fails because the authenticated route is not reached: the browser lands on `/login`, Supabase `/auth/v1/token` returns 400, and the console reports `Invalid Refresh Token: Already Used`. This is consistent with an invalid or reused Playwright auth state; current read-only DB, Storage, generation-job, and usage-event checks remain healthy when the UI probe is skipped.

## Evidence

- Current read-only production monitor: `output/playwright/root-cause-current-monitor-20260708-r1/summary.json`
  - `ok=true`
  - `blockers=0`
  - `generationFailureRate=0`
  - `staleActiveJobs=0`
  - `storageErrors=0`
  - UI probe intentionally skipped, so this artifact proves backend/storage/generation health only
## Current UI Probe Incident

- Current UI probe: `output/playwright/root-cause-current-ui-probe-20260708-r1/summary.json`
  - expected asset `assets/index.CC7SsdCO.js` is served by Zeabur
  - page redirects to `/login`
  - Supabase token refresh returns 400
  - console error: `AuthApiError: Invalid Refresh Token: Already Used`
  - exact blocker remains `generate_detail_form_missing` because the authenticated generate/dashboard route is not reached
- Prior UI-inclusive monitor: `output/playwright/g835-production-monitor-current-r1/summary.json`
  - DB, generation, usage, and Storage checks passed
  - UI launch-ops probe failed
  - detailed UI summary: `output/playwright/g835-production-monitor-current-r1/ui/summary.json`
  - that prior UI detail had two issues: stale expected asset `assets/index.CxLJvrDR.js` while production served `assets/index.CC7SsdCO.js`, plus the same Supabase refresh-token 400 pattern
  - the current UI probe confirms the asset mismatch is no longer present, leaving the auth-state failure as the reproducible current UI-probe blocker

## Historical Unrelated Generation Incident

- Previous G620 strict 96h monitor: `output/playwright/g764-g620-security-ops-r1/production-monitor-readback/summary.json`
  - one historical failed `generate-image` job from 2026-07-05
  - provider `gemini`
  - error was Gemini 429 quota exceeded / free-tier limit 0
  - this is a separate 96h capacity/provider incident candidate, not the current UI-probe failure

## Root Cause

Observed current UI-probe facts:

- `/auth/v1/token` returns 400.
- Console records `AuthApiError: Invalid Refresh Token: Already Used`.
- The browser is redirected to `/login`.
- The authenticated dashboard/generate route is not reached.

Likely current UI-probe cause:

- Saved Playwright auth state, including `output/playwright/g689-prod-temp-auth-r2/auth-state.json` and related recovery attempts, likely has an invalidated or already-used Supabase refresh token.

Separate historical generation incident candidate:

- The 2026-07-05 failed `generate-image` job was caused by Gemini 429 quota exhaustion or unavailable free-tier quota for the configured server-side Gemini model/key at that time.

## Impact Boundary

- Current production app endpoint is reachable.
- Zeabur serves the expected production asset.
- Current read-only DB, generation-job, usage-event, and Storage readbacks pass in the backend-only monitor (`usage events readable` passed with `total=0`).
- UI-inclusive monitoring still fails until the monitor auth state is refreshed and revalidated.
- No generation submit, payment, checkout, purchase, external publish, or cleanup action was performed during this investigation.

## Next Action

Refresh the QA/monitor auth state through an approved human login path, then rerun `npm run monitor:production` without `--skip-ui`. Acceptance requires `dashboard route renders`, `No app/Supabase HTTP request failures`, and no `/auth/v1/token` 400. Treat the 2026-07-05 Gemini 429 as a separate capacity/provider configuration incident unless it recurs in the fresh monitor window.
