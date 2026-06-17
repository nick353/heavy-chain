# Release Checklist

Status: **not release-ready**.

Use this checklist from top to bottom. If any line says `STOP`, stop there and
write down the blocker. Do not skip ahead.

## 1. Start Clean

- Confirm `git status --short` is empty.
- Confirm the release evidence file for the day exists.
- Do not include secret values in the evidence.

2026-06-17 result: start state was clean.

## 2. Load Environment

Load every environment name required by `scripts/check-env.mjs` before final
verification:

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

Do not continue if any value is missing.

2026-06-17 result: `STOP`. `npm run verify` failed because these names were
missing, even after `.env.production.local` was sourced: `SUPABASE_URL`,
`SUPABASE_ANON_KEY`, `SUPABASE_SERVICE_ROLE_KEY`, and `PUBLIC_URL`.

## 3. Automated Gates

Passed on 2026-06-17:

```bash
npm run build
npm run supabase:verify
npm run security:audit
npm run smoke:edge
npm run typecheck
npm run lint
npm run e2e
```

`npm run build` and `npm run e2e` were re-run with `.env.production.local`
sourced. This matters because a dev server without env injection produced a
blank root, while the env-injected Browser Use smoke rendered normally.

Blocked on 2026-06-17:

```bash
npm run verify
```

Do not mark the release ready until `npm run verify` passes with the required
environment loaded.

## 4. Browser Smoke

Use the env-injected browser proof only:

```text
output/release-prep/browser-use-20260617/home-env-full.png
output/release-prep/browser-use-20260617/home-env-state.txt
output/release-prep/browser-use-20260617/home-env-eval.json
output/release-prep/browser-use-20260617/login-full.png
output/release-prep/browser-use-20260617/login-state.txt
output/release-prep/browser-use-20260617/login-eval.json
```

The first dev server without env injection showed a blank root and a Vite error.
Do not use that first capture as release proof.

## 5. Staging Readback

Run read-only DB readback after staging is deployed. Save the output and confirm:

- usage events show expected reserved and final states
- edge function run records exist for the smoke path
- generated image rows use durable storage state and do not persist signed URLs
  or data URLs as canonical `image_url`

2026-06-17 result: `STOP`. Staging readback and `image_url` non-persistence
readback are not complete.

## 6. Gates Not To Run

Do not run any gate that requires sending, submitting, publishing, deleting,
authentication, payment, or personal information entry. Stop and hand that step
to a human owner.

During release verification, do not run these without explicit human ownership:

```bash
npm run verify:full
npm run supabase:deploy:functions
supabase functions deploy ...
```

Also stop before any staging or production mutation, including migration apply,
real generation smoke, auth-provider login, or cleanup deletion.

## 7. Release Decision

Current decision: **do not release**.

Resume only after the missing env names are available, `npm run verify` passes,
and staging DB readback has current proof.
