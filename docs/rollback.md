# Rollback

Status: use this only after a human owner has decided to stop or reverse a
release. Current release readiness is determined by `npm run verify:release-gate`
and the latest `STATE.md`; this rollback guide is not itself a release approval.

Rollback must preserve evidence. Do not delete usage, audit, edge run, cleanup,
or generated image rows unless a legal retention policy explicitly requires it.

## Stop First

Stop before any rollback step that asks for sending, submitting, publishing,
deleting, authentication, payment, or personal information entry.

If a step needs one of those actions, write down the exact blocker and hand the
step to a human owner.

Before changing anything, run the safe proof validators:

```bash
npm run verify:readback
npm run verify:browser-use
npm run supabase:verify:static
```

The default `npm run verify:browser-use` validates historical supporting proof
only. It does not validate a newly captured rollback smoke directory.
`RELEASE_BROWSER_USE_PROOF_DIR` is for current release diagnosis, not rollback;
rollback smoke must use its own explicit `--dir` path.

If one fails, preserve the failed output and hand it to the human rollback
owner. Validator failure is evidence to carry into rollback triage, not an
automatic rollback blocker. These commands only inspect local files and static
project state.

## App Rollback Path

1. Pause or route traffic away from the bad app version.
2. Redeploy the last known good app build.
3. Run read-only smoke and DB readback.
4. Keep the failed release evidence for comparison.

Do not call the app healthy until the readback shows expected usage and edge
function records.

After read-only smoke, run:

```bash
npm run verify:browser-use -- --dir <rollback-browser-use-proof-dir>
npm run verify:readback
```

If either validator fails during rollback, save the terminal output with the
rollback evidence and continue only under the human owner's decision.

## Edge Function Rollback Path

Redeploy only from a verified last-known-good commit, tag, or exported function
artifact. Do not run this from an unknown or bad working tree.

Before deployment, capture the rollback target:

```bash
git rev-parse HEAD
git status --short
git diff --stat -- supabase/functions/generate-image
```

If `HEAD` is not the chosen last-known-good revision, stop and have the human
owner switch to the correct commit/tag/worktree first. If `git status --short`
or the function diff is not empty, stop unless the human owner explicitly
approves that exact rollback artifact.

Deploy the verified function bundle:

```bash
supabase functions deploy generate-image --project-ref <confirmed-project-ref>
```

Run this only after a human owner has chosen rollback, confirmed the target
project ref, and recorded the last-known-good revision or artifact path. It is
not a normal release-verification command.

Then run read-only DB readback:

```sql
select id, function_name, status, created_at
from public.edge_function_runs
order by created_at desc
limit 50;

select id, function_name, status, units, request_id, reserved_at, completed_at, created_at
from public.usage_events
order by created_at desc
limit 50;
```

## Database Rollback Path

Use a forward migration to repair database state. Do not hand-edit or delete
proof rows as a cleanup shortcut.

Before and after the forward migration, capture:

```sql
select id, storage_path, image_url, created_at
from public.generated_images
order by created_at desc
limit 50;

select id, function_name, status, units, request_id, reserved_at, completed_at, created_at
from public.usage_events
order by created_at desc
limit 50;
```

The generated image readback must prove that durable state is stored in
`storage_path`, and that canonical `image_url` is null, missing, or empty.

## Cleanup Boundary

Allowed cleanup:

- stop local dev servers
- remove temporary local test files that are not release evidence
- record cleanup commands and readback output

Not allowed without human approval:

- deleting production or staging records
- deleting ignored proof files before they have been reviewed
- changing auth, billing, payment, or personal data state

Historical supporting proof; not final current release or rollback proof:

```text
output/playwright/prod-db-readback.json
output/playwright/prod-cleanup.json
output/playwright/edge-deny-proof.json
output/playwright/edge-deny-cleanup.json
output/playwright/rate-limit-db-proof-2.json
output/playwright/rate-limit-cleanup-2.json
```

Use `npm run verify:readback` to check these files before relying on them. A
pass means the saved JSON is well formed; it does not approve deletion or
release. A failure should be saved and passed to the human owner rather than
treated as the reason rollback cannot proceed.
