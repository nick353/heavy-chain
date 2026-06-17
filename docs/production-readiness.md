# Production Readiness

Status: **blocked**.

This document is the final release gate ledger for Heavy Chain. If a check says
`BLOCKED` or `DO NOT RUN`, stop. Do not guess, do not fill secrets into docs, and
do not continue into production.

Current evidence is recorded in
[`docs/release-evidence-2026-06-18.md`](./release-evidence-2026-06-18.md).

Safe local validators now exist for proof files:

```bash
RELEASE_BROWSER_USE_PROOF_DIR=<current-browser-use-proof-dir> npm run release:doctor
npm run verify:readback
npm run verify:browser-use
npm run supabase:verify:static
```

`npm run release:doctor` is the recommended first command for a safe readiness
diagnosis. It runs checks in order and stops at the first `STOP`: git clean
status, proof target, `env:check`, `verify:readback`, current readback metadata
matching, current `verify:browser-use`, `supabase:verify:static`,
`security:audit`, `smoke:edge`, `typecheck`, and `lint`. It requires
`RELEASE_BROWSER_USE_PROOF_DIR` so historical Browser Use proof is never
silently treated as current proof, and it passes current release date,
environment, and git commit expectations to `verify:browser-use`. It does not
run `supabase:verify:db`, `verify:full`, deploys, auth flows, payment,
deletion, personal information entry, or DB mutation. The displayed failure tail
redacts known secret patterns. A pass here is still not release approval.

## Final Gate

Heavy Chain can only be released after all of these are true:

1. All automated gates pass with production-like environment variables loaded.
2. Staging DB readback proves usage, cleanup, and generated image storage state.
3. Browser smoke proof is current and captured after env injection.

Current 2026-06-18 parent observation: the environment gate now passes with
`.env.production.local` sourced, current readback metadata verification has
passed, and focused authenticated `scene-coordinate` / `variations` proof has
passed. Release remains blocked by the human-approval and final-current-proof
gaps below.

## Known Blockers

- The older environment-name blocker is resolved in the current parent shell
  but remains useful historical context.
- Current parent DB readback exists at
  `output/release-prep/final-db-readback-20260618-parent/readback.json` and
  reports `jobs=1`, `images=1`, `usage=5`, `runs=5`, `storage=1`, and
  valid generated image storage readback.
- Current readback metadata verification has passed for the current release
  target.
- The brand insert migration
  `supabase/migrations/20260618023000_restore_brand_insert_policy.sql` has been
  applied remotely.
- Updated Edge Functions have been deployed.
- Image visual QA is PASS for `remove-background`, `colorize`,
  `upscale-fixed`, `design-gacha`, `product-shots`, `model-matrix`, and
  `multilingual-banner-fixed2`.
- The weak `scene-coordinate` and `variations` proof root cause is fixed in
  `generate-variations`: scene and variation inserts now save
  `generated_images.feature_type` and `generation_params.featureType`, and
  `GeneratePage` passes `featureType` explicitly for both flows. The
  `generate-variations` Edge Function has been deployed remotely.
- Focused authenticated proof now passes for `scene-coordinate` and
  `generate-variations` under
  `output/release-prep/focused-generation-20260618-parent/postfix-auth/`.
  Readback reports `images=4`, `scene_coordinate=3`, `variations=1`,
  `runs=2`, storage download ok, and `verdict=pass`; focused visual QA also
  reports `verdict=pass`. Existing DB scene rows from before the fix still have
  `feature_type=null` and remain historical only.
- Signup is blocked in this test lane by Supabase Auth HTTP 429.
- Cleanup/delete was not approved and was not run.
- Local Supabase DB verification still requires an approved local DB
  reset/recreate lane or another approved DB verification lane.
- Current Browser Use smoke metadata must be updated after the final commit.
- `release:doctor` must be rerun against final `HEAD`.
- Cleanup/no residual process state still needs confirmation.

## Required Environment Names

`npm run verify` runs `scripts/check-env.mjs`, which requires all names below.
Do not write secret values in docs, logs, screenshots, or commits.

```bash
VITE_SUPABASE_URL
VITE_SUPABASE_ANON_KEY
SUPABASE_URL
SUPABASE_ANON_KEY
SUPABASE_SERVICE_ROLE_KEY
GEMINI_API_KEY
OPENAI_API_KEY
PUBLIC_URL
```

## Release Target Environment Names

`npm run release:doctor` also requires this non-secret target name:

```bash
RELEASE_BROWSER_USE_PROOF_DIR
```

Set it to the current env-injected Browser Use proof directory for this release.
The standalone `npm run verify:browser-use` command still defaults to historical
supporting proof. That historical proof is expected to fail if current metadata
expectations are supplied.

Historical note: on 2026-06-17, `.env.production.local` plus the shell still
missed `SUPABASE_URL`, `SUPABASE_ANON_KEY`, `SUPABASE_SERVICE_ROLE_KEY`, and
`PUBLIC_URL`.

## Historical Passed Gates

These checks are recorded as passed for 2026-06-17. They are historical proof,
not 2026-06-18 release approval:

```bash
npm run build
npm run verify:readback
npm run verify:browser-use
npm run supabase:verify:static
npm run supabase:verify
npm run security:audit
npm run smoke:edge
npm run typecheck
npm run lint
npm run e2e
```

`npm run build` and `npm run e2e` were also re-run with
`.env.production.local` sourced so Vite received the required `VITE_*` values.

2026-06-18 start state: before editing this document and adding
`docs/release-evidence-2026-06-18.md`, `git status` was clean and
`npm run release:doctor --silent` reported `OK git clean`.

`npm run supabase:verify:static` checks project files, RLS/grants, usage quota
guards, public service RPC wrappers, authenticated usage summary boundaries,
and static secret guards. It does not validate release evidence JSON and skips
database access by default.

## Blocked Gate

```bash
npm run verify
```

Result: current parent verification passes after `.env.production.local` is
sourced. Historical failures from missing environment names are no longer the
active release blocker.

## Human Stop Rule

Stop immediately before any action that asks for or performs:

- sending, submitting, publishing, deleting, authentication, payment, or personal
  information entry
- production traffic changes without current staging proof
- database deletion of usage, audit, edge run, cleanup, or generated image proof

If one of those appears, record the blocker and ask a human owner to continue.

## Proof Validators

Use these before a human reads the evidence:

```bash
npm run verify:readback
npm run verify:browser-use
```

If a validator fails, stop. The failure line names the file and missing proof.
When validator failures are surfaced through `npm run release:doctor`, the
doctor's displayed tail uses known-pattern redaction. Fix the evidence source,
recapture if needed, and rerun the validator.

For current release evidence, run the readback validator with explicit metadata
expectations:

```bash
npm run verify:readback -- --expect-release-date 2026-06-18 --expect-environment staging --expect-git-commit <commit>
```

With those flags, every proof JSON must include matching `release_date`,
`environment`, `git_commit`, and a valid `captured_at`.
`npm run release:doctor` applies that current-proof check automatically using
the latest `docs/release-evidence-YYYY-MM-DD.md`, `staging` by default, and the
current git commit. It also applies the Browser Use directory from
`RELEASE_BROWSER_USE_PROOF_DIR`. Override with `RELEASE_DATE`,
`RELEASE_ENVIRONMENT`, or `RELEASE_GIT_COMMIT` only for an intentional
human-owned target.
The automatic git commit target is `HEAD`; it is only a release-candidate-current
target after `git clean` passes.

For current Browser Use evidence, run the Browser Use validator with the same
metadata expectations:

```bash
npm run verify:browser-use -- --dir <current-browser-use-proof-dir> --expect-release-date 2026-06-18 --expect-environment staging --expect-git-commit <commit>
```

With those flags, both `home-env-eval.json` and `login-eval.json` must include
`metadata.release_date`, `metadata.environment`, `metadata.git_commit`, and a
valid `metadata.captured_at`. Without those flags, `npm run verify:browser-use`
remains compatible with the historical supporting Browser Use proof.

## DB Readback SQL

Use read-only SQL for staging proof. Save the output as release evidence.

```sql
select id, function_name, status, units, request_id, reserved_at, completed_at, created_at
from public.usage_events
order by created_at desc
limit 50;

select id, function_name, status, created_at
from public.edge_function_runs
order by created_at desc
limit 50;

select id, storage_path, image_url, created_at
from public.generated_images
order by created_at desc
limit 50;
```

For generated images, release proof must show that durable state is
`storage_path`, and that canonical `image_url` is null, missing, or empty.
