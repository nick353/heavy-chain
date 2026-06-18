# Production Supabase Runbook

Create migrations only through Supabase CLI:

```bash
supabase migration new <migration_name>
```

Current 2026-06-18 status: accepted-risk; release doctor passed on current
HEAD. The brand insert policy migration
`supabase/migrations/20260618023000_restore_brand_insert_policy.sql` has been
applied remotely, and updated Edge Functions have been deployed. The
`generate-variations` Edge Function was also redeployed after fixing
`generated_images.feature_type` and `generation_params.featureType` writes for
`scene-coordinate` and `variations`. Do not rerun remote mutation steps from
release verification without explicit human-owner approval.

Accepted risk is signup proof without an owned test mailbox. Earlier signup
attempts hit Supabase Auth HTTP 429, but the parent closeout retry used a
redacted `example.com` address and returned HTTP 400 invalid email instead; the
current-HEAD parent run found no owned test email key and did not submit
signup. This is an accepted risk, not successful signup proof; `release:doctor`
does not mechanically STOP on it, but human release review must keep it as
residual risk. Cleanup/delete is resolved from historical proof only, not from
the current parent-goal run; the historical proof covered artifact-listed QA
storage objects, `generated_images` rows, brands, and Auth users. Local DB
reset/recreate is resolved by the current-HEAD parent run: after initial
reset/start failures, it started Colima, used the Colima Docker socket, reached
a healthy local DB with valid excludes, passed `supabase migration list
--local`, completed `supabase db reset --local --no-seed`, passed
`SUPABASE_VERIFY_MODE=db bash scripts/supabase-prod-verify.sh`, and recorded
`exact_blocker=null`. Browser Use smoke proof passes on current `HEAD` under
`output/release-prep/parent-goal-20260618-current-head/browser-use-current/`,
and `release:doctor` passes with no `STOP`. `docs/release-blockers-2026-06-18.json`
records signup as the remaining accepted risk and local DB reset/recreate as
resolved.
After this docs commit, save the final doctor transcript at
`output/release-prep/parent-goal-20260618-current-head/release-doctor-after-docs-commit.txt`.
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
6. Rerun focused Browser Use proof and current DB readback metadata checks only
   when the release candidate commit changes.

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
