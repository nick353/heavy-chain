# Production Supabase Runbook

Create migrations only through Supabase CLI:

```bash
supabase migration new <migration_name>
```

Current 2026-06-18 release blocker: the brand insert policy migration
`supabase/migrations/20260618023000_restore_brand_insert_policy.sql` exists in
the repo but has not been applied to staging/prod. Do not apply it from release
verification without explicit human-owner approval because migration apply is a
DB mutation.

Human-owned apply order:

1. Review migrations locally with `supabase migration list --local`.
2. Apply to a staging project first only after explicit approval.
3. Confirm `plans`, `brand_subscriptions`, `usage_events`, `edge_function_runs`, and `admin_audit_logs` exist with RLS enabled.
4. Deploy Edge Functions with `npm run supabase:deploy:functions` only after explicit approval.
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
