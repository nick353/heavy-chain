# Production Supabase Runbook

Create migrations only through Supabase CLI:

```bash
supabase migration new <migration_name>
```

Current 2026-06-18 status: blocked. The brand insert policy migration
`supabase/migrations/20260618023000_restore_brand_insert_policy.sql` has been
applied remotely, and updated Edge Functions have been deployed. Do not rerun
remote mutation steps from release verification without explicit human-owner
approval.

Remaining blockers are signup HTTP 429, cleanup/delete not run, local DB
reset/recreate not approved, `release:doctor` current readback metadata,
scene-coordinate distinct DB readback, and focused `generate-variations` proof.
Image visual QA is PASS for `remove-background`, `colorize`, `upscale-fixed`,
`design-gacha`, `product-shots`, `model-matrix`, and
`multilingual-banner-fixed2`.

Human-owned verification order:

1. Confirm remote migration state against the target project.
2. Confirm deployed Edge Function versions against the target project.
3. Confirm `plans`, `brand_subscriptions`, `usage_events`, `edge_function_runs`, and `admin_audit_logs` exist with RLS enabled.
4. Run `release:doctor` with the current Browser Use proof directory and
   resolve current readback metadata mismatches.
5. Run `npm run smoke:edge`.
6. Rerun focused Browser Use proof and current DB readback metadata checks.

Safe preflight commands that do not deploy or mutate staging/prod:

```bash
npm run verify
npm run smoke:edge
SUPABASE_VERIFY_MODE=static bash scripts/supabase-prod-verify.sh
```

The private RPCs used by Edge Functions are:

- `private.reserve_brand_usage`
- `private.complete_usage_event`
- `private.get_brand_usage_summary`
- `private.record_edge_function_run`

Do not expose service role keys to browser code.
