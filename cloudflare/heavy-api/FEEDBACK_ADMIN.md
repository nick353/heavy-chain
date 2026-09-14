# Heavy feedback / admin — Cloudflare contract

最新2026-09-08: private media capability tokenのcanonical base64url検査を追加し、末尾文字だけを改変した署名を401へ拒否。API全体86/86、feedback/admin20/20、typecheck、production dry-runをPASS後、`8d436ae8-de33-485f-8ebc-10784a70ae99`へ100%配置。D1/private-R2/consumer-auth/AI allowlist/public-share=falseを保持し、health200・未認証profile/media gateway401をfresh確認。認証済みfeedback/admin画面・実スクリーンショット・platform admin付与は未実施。

Updated: 2026-09-06 JST. This is implemented API/UI code, not proof of authenticated production use or completed Cloudflare cutover.

15:05 JST follow-up: [IMAGE_AI.md](IMAGE_AI.md) records the new D1 image ledger/UsageStats and image-scoped admin estimates/latency. Current API is `46758029-c7c9-4943-acbc-f5c42eeeeab3`100%, image inference disabled and existing auth preserved. The 54-test/version8db evidence below is the earlier feedback stage, not the latest deployment. Full API now67 tests; image runtime/client checks do not replace the still-missing authenticated feedback/admin UI QA.

## Scope and authorization

- `FeedbackForm` and `AdminDashboard` no longer call Supabase DB, functions, or Storage. They use `cloudflareDataPlane`; missing configuration/errors never fall back to the legacy provider.
- The API resolves the verified issuer/subject to the canonical D1 user. Submitted user IDs, email addresses, roles, status, and object paths cannot choose the author or confer authority. Feedback email is taken from D1, and a supplied brand requires current joined membership/ownership.
- `platform_admins` is a separate, initially empty table. A brand owner/admin is **not** a platform admin. Signup, profile updates, custom headers, and announcements cannot grant this role. `/v1/profile.is_admin` is derived from the live table, not caller metadata. Any production grant requires an explicitly authorized target; no production grant was made.
- Each admin request verifies a live session and current platform role. Screenshots are fetched through an authenticated endpoint into a browser-local blob URL, never a public R2 URL, bearer query string, or reusable signed URL. Modal changes/unmount retire the blob; role/session revocation blocks subsequent reads.

## API

| Route | Access | Contract |
| --- | --- | --- |
| `POST /v1/feedback` | Verified user; optional brand membership | UUID `request_id`, bounded message/PNG; one immutable receipt per user/request |
| `GET /v1/admin/stats` | Platform admin | Real D1 user/image counts; unimplemented billing/usage/duration are `null`, not false zeroes |
| `GET /v1/admin/users` | Platform admin | Limited user fields and server-derived admin flag |
| `GET /v1/admin/feedback` | Platform admin | Feedback, author/brand labels, attachment state, note/revision |
| `PATCH /v1/admin/feedback/:id` | Platform admin | Only status/note + expected revision; CAS conflict is 409, resolved timestamp is server-owned |
| `GET /v1/admin/feedback/:id/screenshot` | Platform admin | Exact server-selected PNG key, digest/size/receipt metadata checked, private/no-store |
| `POST /v1/admin/announcements` | Platform admin | Bounded plain text and UUID request ID; idempotent per author/request |
| `GET /v1/announcements` | Verified user | Published announcements; bounded pagination |

Lists accept `limit` 1–100 and `offset` 0–100000; the current UI shows the latest 100. Search/filter operates within those users. There is no role-change HTTP endpoint. Announcements are in-app records, not outbound mail/push delivery.

## Receipt and attachment recovery

1. Authenticate, check brand, validate a streamed JSON body (7 MiB max), message (4000 chars), PNG (5 MiB max), viewport and configured frontend origin. Strip URL query/hash to avoid storing invitation/recovery tokens. New feedback is limited to 20 receipts per user/hour; exact replay does not consume another receipt.
2. D1 records immutable normalized-payload SHA-256 and a unique `(user_id, request_id)` before R2. Attachment receipts start `pending`; text-only receipts start `accepted`. A pending row means text is persisted, **not** that its attachment is usable.
3. Store only `feedback/v1/<server-generated-id>.png`, with conditional create and server-owned checksum/size/receipt metadata. Read the exact key after uncertain writes. Same-ID parallel calls/restarts cannot create another object or replace mismatched content.
4. Mark accepted only after matching R2 readback. Lost D1/R2 replies keep the same row/key for reconciliation. A mismatched payload/object is 409; unavailable/pending storage is 503. Never delete an object merely because a commit response was lost.
5. The mounted form retains the original payload/ID for explicit receipt recheck after an uncertain response and disables message edits during that check. It does not persist screenshots to browser storage or silently retry/fallback. Closing/reloading the form does not restore its in-memory receipt; pending-server inspection/retention remains operational work.

The screen distinguishes pending attachment, loading, failure, and absence. Unmeasured costs/units/runtime show `未計測`; old hard-coded growth percentages were removed. The old moderation tab had no actual data connection; it now states that instead of claiming an empty reviewed queue. Image UsageStats and estimated image cost/latency are now connected as documented in IMAGE_AI.md; actual billing and general CPU/runtime measurement remain open.

## Verified locally in this stage

- API tests **54/54**, including 11 feedback/admin real-SQL tests: author/brand/admin boundaries, bounded input, concurrency, request conflict, lost insert/put/accept response, pending recovery, no overwrite, rate limit, role revocation, CAS and announcements.
- Actual workerd + two Workers (real Better Auth service binding, real local D1 and R2): registration/verification via a **local mail fixture**, feedback concurrency/PNG read, admin update, announcement, isolate restart/recovery and logged-out admin rejection. This is not real email/provider or production registration.
- Actual four-Worker Heavy/MyPro Auth/data isolation, recovery and MyPro private erasure integration passed after the Heavy change.
- Real browser-client module tests **3/3** (new Cloudflare Auth enabled, bearer-only endpoints, blob response, no automatic retry/fallback) plus existing Auth/workspace regressions **10/10**. The Node harness supplies `window.location`; these are not rendered browser UI tests.
- Worker typecheck/dry-run and full web `tsc -b && vite build` with CF Auth/API enabled passed. App `tsc --noEmit` alone has empty root files and is not sufficient verification. After the final receipt-confirmation capture lock, browser-client3/3, full build and diff check passed again. Final AdminDashboard bundle: `dist/assets/AdminDashboard.DLv60vyP.js`, 04:12:35 JST, SHA-256 `0f345a1064d49495b3a170a4babb9cba731b2e03c3adf69ed584706ea2bc4572`. Web was **not** deployed.

Reproduce from this directory:

```sh
npm run typecheck
npm test
npm run test:feedback-runtime
npm run dry-run
```

From the Heavy repository root:

```sh
node --test scripts/verify-cloudflare-feedback-admin.test.mjs
node --test scripts/verify-cloudflare-browser-auth.test.mjs scripts/verify-cloudflare-workspace-save.test.mjs
VITE_CLOUDFLARE_AUTH_ENABLED=true VITE_CLOUDFLARE_API_ENABLED=true VITE_CLOUDFLARE_API_BASE_URL=https://heavy-chain-api.nichika2000823.workers.dev npm run build
```

## Production placement

- Applied only `0010_feedback_admin.sql` to `heavy-chain-production-db` (`f2a6ef3b-14d0-4527-94eb-59ed22a469d9`). No old data copied and no platform administrator seeded.
- Deployed `heavy-chain-api` version `8dbd4599-bf95-4b1e-a4db-30e944a030fd` with `--keep-vars --strict`; existing issuer/JWKS, origins, private R2, media secret and public-share disabled state are preserved. **AUTH_SERVICE/consumer-auth cutover is not part of this deployment.**
- Same-run version/binding/D1/HTTP readback is recorded in the coordinator's migration report; production authenticated feedback, admin screenshots, real screen QA, billing/metering, new-auth client publication and full end-to-end use remain unverified.

All eleven migration stages remain in `/Users/nichikatanaka/Documents/Codex/2026-09-03/h/Plan.md`. Next independent implementation: real AI adapters and measured quota/usage; do not wait for a domain to start that work. Preserve MyPro cancel/recovery/device work, mail/provider setup, cutover, real registrations, production/device QA, zero Supabase traffic and service retirement.
