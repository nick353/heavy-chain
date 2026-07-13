# Release Evidence 2026-06-21

Status: **production deployed; public QA passed; authenticated QA passed; release doctor passed with no STOP**.

This file records the final AparelAI / Heavy Chain production closeout for the
current `main` commit. It is an evidence ledger, not a payment or purchase
approval.

## Target

```text
app_git_commit=7c93b450b77ad47c1a46773d5c74a865336fd645
branch=launch-readiness-final
remote=origin/main
production_url=https://heavy-chain.zeabur.app
supabase_project=heavy-chain-production
supabase_project_ref=ghwjymozrwmcrpjqvbmo
```

## Closed Changes

```text
onboarding localStorage is user-scoped and no longer reappears after completion
canvas guide localStorage is user-scoped and no longer reappears after completion
workspace navigation includes fitting, marketing, history, jobs, and credits
dashboard shows live workspace activity, failed-job recovery, and credit summary
jobs, credits, and history pages read from production Supabase data
failed job resume links prefill feature and prompt on /generate
workspace activity pages show retry UI on read failures
gallery search TODO was implemented
route lazy-loading and release proof metadata were updated
```

Commits pushed to `origin/main` during this closeout:

```text
7c0efdc Fix onboarding persistence and release checks
5a3b82b Add workspace navigation pages
b75e1bc Refine mobile workspace navigation
7b78702 Add workspace activity pages
e69bfc5 Add workspace retry states
0795381 Support text-to-image resume links
7c93b45 Label text-to-image workspace jobs
```

## Production Reflection

Supabase production was confirmed as:

```text
project=heavy-chain-production
ref=ghwjymozrwmcrpjqvbmo
```

Production database migration state:

```text
supabase migration list --linked      PASS
supabase db push --linked --dry-run   PASS, remote database is up to date
```

Production Edge Functions deployed:

```text
generate-image
remove-background
upscale
colorize
generate-variations
design-gacha
product-shots
model-matrix
multilingual-banner
optimize-prompt
bulk-download
share-link
```

## Local Verification

Latest local verification on current HEAD:

```text
npm run typecheck   PASS
npm run lint        PASS
npm run build       PASS
npm run e2e         PASS, 10/10
```

Release proof validators:

```text
npm run verify:readback -- --expect-release-date 2026-06-20 --expect-environment production --expect-git-commit 7c93b450b77ad47c1a46773d5c74a865336fd645
PASS

npm run verify:browser-use -- --dir output/release-prep/onboarding-fix-20260621/browser-use-current --expect-release-date 2026-06-20 --expect-environment production --expect-git-commit 7c93b450b77ad47c1a46773d5c74a865336fd645
PASS
```

## Production URL QA

Artifact:

```text
output/release-prep/final-production-20260621/public-url-qa/qa-summary.json
verdict=pass
git_commit=7c93b450b77ad47c1a46773d5c74a865336fd645
captured_at=2026-06-21T09:38:17.679Z
```

Public routes covered:

```text
/
/login
/signup
/forgot-password
/terms
/privacy
```

Protected route redirect checks covered:

```text
/dashboard
/generate
/gallery
/canvas
/fitting
/marketing
/history
/jobs
/credits
```

## Authenticated Production QA

Artifact:

```text
output/release-prep/final-production-20260621/auth-qa/qa-auth-summary.json
verdict=pass
git_commit=7c93b450b77ad47c1a46773d5c74a865336fd645
captured_at=2026-06-21T09:39:52.563Z
```

Authenticated routes covered:

```text
/dashboard
/generate
/gallery
/fitting
/marketing
/history
/jobs
/credits
/brand/settings
/canvas/new
```

Onboarding and guide persistence proof:

```text
dashboard onboarding first visit: shown
dashboard onboarding after completion reload: not shown
canvas guide first visit: shown
canvas guide after completion reload: not shown
```

Cleanup proof:

```text
output/release-prep/final-production-20260621/auth-qa/cleanup.json
remainingQaUsers=0
errors=[]
```

## Release Doctor

Artifact:

```text
output/release-prep/final-production-20260621/release-doctor-after-deploy.txt
```

Result:

```text
OK   release blockers
OK   git clean
OK   proof target
OK   env:check
OK   verify:readback
OK   verify:readback:current
OK   verify:browser-use
OK   supabase:verify:static
OK   security:audit
OK   smoke:edge
OK   typecheck
OK   lint
OK: release readiness passed with no STOP
```

## Residual Risk

The service-role key provided in the session was not rotated because the user
explicitly said not to change it. Do not print or store the key value in docs.
