# Production Supabase Runbook

Create migrations only through Supabase CLI:

```bash
supabase migration new billing_usage_limits
```

Apply order:

1. Review migrations locally with `supabase migration list --local`.
2. Apply to a staging project first.
3. Confirm `plans`, `brand_subscriptions`, `usage_events`, `edge_function_runs`, and `admin_audit_logs` exist with RLS enabled.
4. Deploy Edge Functions with `npm run supabase:deploy:functions`.
5. Run `npm run smoke:edge`.

The private RPCs used by Edge Functions are:

- `private.reserve_brand_usage`
- `private.complete_usage_event`
- `private.get_brand_usage_summary`
- `private.record_edge_function_run`

Do not expose service role keys to browser code.
