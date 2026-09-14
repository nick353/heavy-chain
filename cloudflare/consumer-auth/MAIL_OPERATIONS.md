# Auth mail allocation and expiry maintenance

## Contract

Both Auth Workers use the same code and separate D1 databases. Before **every**
mail provider call (including unverified email sign-in), a single atomic D1
UPDATE reserves one attempt against a UTC-day limit and a persistent cumulative
allocation. No user foreign key exists. UTC rollover, user deletion and Worker
restart cannot restore the cumulative allocation; a clock rollback fails closed.
Missing/invalid/zero settings and an uncertain DB result never permit a send.
Reservations are never refunded, including rejection, timeout, unknown provider
acceptance or interruption. The code never replays a mail send automatically.

Better Auth 1.7.2 catches some mail callback errors. A request-local symbol records
failure so the outer handler can return sanitized 429/503 rather than claim
success. This state is not shared between requests or stored in D1. An unverified
user can already exist after a failed send; deliberate sign-in/resend is a new
bounded attempt, not proof that the earlier email was delivered.

The transport is the native Cloudflare Email Service `EMAIL` binding. A send is
made only as `env.EMAIL.send({to, from, subject, text})`, with the app-specific
`EMAIL_FROM`. A binding is absent or its `send` member is not callable ->
`emailConfigured=false` and the endpoint returns 503. The binding receipt must
contain a non-empty string `messageId`; it proves acceptance only and does not
prove inbox delivery. There is no automatic retry, fallback, fetch, or
`AbortSignal` path.

`EMAIL_DAILY_ATTEMPT_LIMIT` and `EMAIL_TOTAL_ATTEMPT_LIMIT` are explicitly **0** in
both production configs. Before any increase, establish the exact provider
allowance/window, other sender consumption and reserved headroom. Heavy's and
MyPro's cumulative allocations must fit their reviewed combined allocation.
This bounds these two bindings only, not account-wide quotas, provider internal
retries, billing or a rolling free quota. Sender/domain onboarding and live
delivery must be verified separately; no sender/domain state is inferred from
the config declaration. The native `EMAIL` binding is declared separately in
each production config with an app-specific allowed sender; that declaration
still does not prove sender verification or inbox delivery.
`messageId` is provider acceptance, not inbox delivery.

Hourly `17 * * * *` maintenance deletes at most 100 rows from each of
`verification` and `rateLimit` per invocation, using indexed predicates repeated
in the DELETE. Verification dates are actual adapter ISO text with a five-minute
safety margin; rate limits use epoch milliseconds and the maximum configured
60-second window plus five minutes. Refreshed/unexpired records remain.
Sessions, accounts, users, provider grants/validation, erasure/cancellation fences
and budget counters are not cleanup targets. Better Auth's existing opportunistic
rate-limit pruning is still unbounded; this schedule does not change that library
behavior. MyPro verification JWTs retain their separate cryptographic expiry.

## Verification (2026-09-06, local)

- Auth suite: 70/70 before the final additional lost-reservation-response test.
- Final mail/cleanup focused suite: 6/6, including callback failure propagation,
  exhausted-budget verified login, no refund after user deletion, lost D1 reply
  without provider dispatch, batch limits and unchanged non-target tables.
- Actual local workerd/D1: two isolated allocations, concurrent admission,
  scheduled expiry deletion and persisted counters after process restart: 1/1.
- Four-Worker app isolation/recovery/private erasure: 1/1.
- Final typecheck and both production-config dry-runs: exit 0.

Fixtures are synthetic; no actual email or provider account was used. Migration
0007 creates the anonymous counter; 0008 adds expiry indexes. Production migration,
deployment and scheduled-run evidence must be recorded separately below.

## Production

Applied only migrations 0007 and 0008 to both existing Auth databases and recorded
their names in `d1_migrations`. Heavy intentionally still lacks MyPro-only
0002–0006; do not run an indiscriminate migration apply there. Same-run SELECT
confirmed both new indexes, singleton counters at zero, users/sessions zero and
rows_written=0 for readback.

Published and independently listed at 100%:

- Heavy Auth: `7a989467-eeeb-4198-9674-eac9212c0193`, deployment
  `36ac1a40-43f2-403c-864f-b5ccd7657aac`, 2026-09-08T06:30:21.193Z.
- MyPro Auth: `da8398bb-5066-4982-b304-9f7326b9cf2b`, deployment
  `447ff128-1269-404e-857f-c7cd0ffbd0bf`, 2026-09-08T06:30:35.568Z.

The preceding versions `76a1fca4-f468-41d5-a504-1644bbc3f44d` and
`65f8d764-84c4-4f6e-8b3a-a3ed3b0b3726` are retained as historical deployment
readback, not the current production version.

Both deployment receipts show zero allocation settings and the hourly schedule.
Post-deploy live reads for the current versions: health200 with
`emailConfigured=true` and `emailBudgetConfigured=false` for both apps. The
binding is configured, but zero allocation keeps sending unavailable. The
earlier get-session200/null, anonymous identity401 and foreign-origin403
boundary remains unchanged; no-store is preserved. A deployed schedule is not
proof of a natural production cleanup run; that remains to be observed after a
scheduled time. Pre-apply SELECT had verification0 and rate-limit rows
Heavy4/MyPro2.
No old test data was copied; no actual email, signup or provider call was made.
Post-deploy D1 readback again confirmed both counters0 and users/session/
verification0 with rows_written0. Rate-limit rows were Heavy1/MyPro3; request-time
library pruning also exists, so this difference is not a scheduled-run receipt.
Real sender setup, registration, delivery, password recovery and signed-device
acceptance are still incomplete. All eleven migration requirements stay active.
