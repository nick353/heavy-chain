# Production Supabase Runbook

Create migrations only through Supabase CLI:

```bash
supabase migration new <migration_name>
```

Current 2026-06-18 status: blocked. The brand insert policy migration
`supabase/migrations/20260618023000_restore_brand_insert_policy.sql` has been
applied remotely, and updated Edge Functions have been deployed. The
`generate-variations` Edge Function was also redeployed after fixing
`generated_images.feature_type` and `generation_params.featureType` writes for
`scene-coordinate` and `variations`. Do not rerun remote mutation steps from
release verification without explicit human-owner approval.

Remaining blockers are signup HTTP 429 and local DB reset/recreate failure.
Signup was retried and still returned HTTP 429. Cleanup/delete was approved by
the current user request and completed only for artifact-listed QA storage
objects, `generated_images` rows, brands, and Auth users. Local DB
reset/recreate was approved and attempted, but `supabase db reset` failed with
`StorageBackendError: Migration optimize-existing-functions-again not found`.
Current Browser Use smoke metadata verification passed for the final parent
`HEAD`, and cleanup/no residual process state was confirmed after the parent
run. `release:doctor` now stops at release blockers because
`docs/release-blockers-2026-06-18.json` records the remaining unresolved
blockers with `blocks_release=true`.
Existing DB scene rows were generated before the fix and still have
`feature_type=null`; focused authenticated Browser Use proof now passes for
`scene-coordinate` and `variations` under
`output/release-prep/focused-generation-20260618-parent/postfix-auth/`.
Readback reports `images=4`, `scene_coordinate=3`, `variations=1`, `runs=2`,
storage download ok, and `verdict=pass`; focused visual QA also reports
`verdict=pass`. Image visual QA is PASS for `remove-background`,
`colorize`, `upscale-fixed`, `design-gacha`, `product-shots`, `model-matrix`,
and `multilingual-banner-fixed2`.

Human-owned verification order:

1. Confirm remote migration state against the target project.
2. Confirm deployed Edge Function versions against the target project.
3. Confirm `plans`, `brand_subscriptions`, `usage_events`, `edge_function_runs`, and `admin_audit_logs` exist with RLS enabled.
4. Run `release:doctor` with the current Browser Use proof directory.
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
