# Dedicated API Auth cutover — 2026-09-06

Update20:58JST: paired Heavy Web candidate is now deployed as `73f5b186-d346-47db-9b2e-e3fa3d1f54ac`,100%, AUTH_SERVICE→consumer-auth. Existing large asset hashes verified, same-origin no-session200/null and real login-page screenshot confirmed; no user submission. Details `../heavy-web/README.md`. MyPro signed-device rollout and real provider/mail/business checks remain. Companion update completed and fresh generation was used; the later pause notice below is historical.

## Production result (20:50 JST)

Both API verifiers now use only their app-specific Auth service. No API JWT/JWKS/global-fetch fallback remains. Missing binding or invalid issuer fails closed. This does not establish complete client rollout or real-user business completion.

| API | Auth service / issuer | Current version | Deployment UTC |
|---|---|---|---|
| heavy-chain-api | consumer-auth / https://consumer-auth.nichika2000823.workers.dev | 3ef72e23-1be9-40b9-83d2-00fd8f1d3b59 | 11:49:53.121 |
| mypro-api | mypro-auth / https://mypro-auth.nichika2000823.workers.dev | d0a0df2c-f864-47cb-bd1e-4ba5062eae6f | 11:49:54.617 |

Fresh version and deployment readbacks show100% each and no AUTH_AUDIENCE/AUTH_JWKS_URL/AUTH_CLOCK_SKEW_SECONDS. Heavy MEDIA_READ_SECRET/private R2/D1/AI restrictions remain. MyPro AUTH_LIFECYCLE/private R2/D1/realtime/cron and three enabled AI actions remain; gym is disabled. No Auth deployment, migration, provider action, account mutation, old-data copy/deletion or new purchase in this cutover unit.

Production Heavy health200, both profile endpoints unauthenticated401. MyPro read-only POST erasure/status with empty input now returns400 invalid_request (previously503 erasure_unavailable): the matching binding makes lifecycle admission reachable, not anonymously authorized. The initial Heavy /v1/me probe was404 because that route does not exist; /v1/profile was then checked. No real deletion/cancellation was dispatched.

Pre-cutover same-run D1 SELECTs: each Auth user/session0; Heavy user_identities/users0; MyPro user_identities/profiles0; all verification rows_written0. This does not prove the old Supabase databases empty or real signup complete.

## Local acceptance

Direct Option1 judgment Astra/high, implementation Luna/max, then Astra accepted the API slice. Model/effort were requested explicitly; actual runtime model metadata was not returned. Eleven owned files changed: both auth.ts, Env declarations, focused auth tests, production/example configs, plus consumer-auth README. Existing client candidates were not rebuilt.

- Focused auth5/5 each; both typechecks exit0 after fixing Headers.keys to forEach in test fixtures.
- Existing four actual local Workers/D1/R2 isolation1/1, 20,470.27ms: same-email independent accounts, cross-app denial, recovery/session invalidation and MyPro lifecycle/cancellation isolation. Actual command: `MYPRO_API_ROOT=/Users/nichikatanaka/Desktop/muscle/muscle/cloudflare/mypro-api npm run test:isolation` from consumer-auth.
- Production-config dry-runs: Heavy178.39KiB/gzip38.02, MyPro250.85KiB/gzip48.75. Both git diff checks passed. Startup5ms/4ms is not a load/CPU-budget guarantee.
- Focused expired/revoked cases mock Auth401; the integration provides actual local invalidation evidence. Neither substitutes for real production provider/email/native/device testing.

## Remaining and next action

Old Supabase sessions are now rejected by these APIs. The old clients cannot use their protected endpoints until paired client rollout. Reuse Heavy CF-auth Web candidate from19:42:38JST and MyPro unsigned candidate20:22:58JST; do not recreate accepted implementation. Heavy web publication, usable login/mail configuration, selected-device signing/install and real-user same-run evidence remain. No API rollback is implied by missing email/device acceptance.

Companion is paused for update coordination with task01a07303-ab12-7773-8c77-6fb990a96bc0 until its completion notice; no browser fallback. Its last notice reports manual extension reload pending, not update complete. Independent CLI/deployment work can continue. Full eleven-stage Goal remains active; real runtime-zero verification and old-service retirement remain unproved.
