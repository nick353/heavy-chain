# MyPro Auth erasure component — not complete app erasure

## Current contract — 2026-09-06 02:54 JST

Daily provider validation and private fresh deletion identity are deployed in
MyPro Auth `38383cce-a809-49a3-9670-0081691902e3` and API
`113ed852-d544-4920-9010-8e2445121c97`, both100% read back. Auth0005 applied;
Auth60/API53 tests and actual four-Worker erasure/isolation pass. Current evidence
and remaining real-provider/device limits: [NATIVE_OAUTH.md](NATIVE_OAUTH.md).
API public deletion remains503 until the separate client/AUTH_SERVICE cutover.

## Previous deployment — 2026-09-05 14:03 UTC

MyPro Auth version `2e276aa1-e01e-43aa-8d3d-da5d3594fd6a`, deployment
`fd821330-6e04-40e4-bbd7-9efe88939270`,100%. Migration0004/nativeGrant TEXT,
users0/accounts0/no pending migrations read back. Auth28 tests/typecheck,
runtime native-code, four-Worker integration and unsigned iOS build pass.
Provider/email settings are still missing; no real signup/revocation.
Full current native contract: [NATIVE_OAUTH.md](NATIVE_OAUTH.md).

## Earlier deployment — 2026-09-05 13:23 UTC

Migration0003 applied; MyPro Auth version `7e5cf092-a08d-44eb-b8a9-e023c05e984e`,
deployment `cd32fae3-a47f-4612-b250-0e7bc6d2375a`,100% read back.
`manual_revocation` TEXT/default[] present, users0/erasures0, no pending migrations.
Auth13 tests/typecheck, MyPro52 tests/typecheck, real four-Worker isolation,
both dry-runs and native contract/final unsigned build pass. Both production Auth
health checks return200/emailConfigured=false; MyPro identity401. No actual
signup, deletion, email or provider revocation was attempted. Heavy not redeployed.

`src/mypro.ts` exports the named `MyProAccountLifecycle` Worker RPC entrypoint.
There is no HTTP lifecycle endpoint, and Heavy's entrypoint does not export it.
The MyPro API now has a private binding and durable D1/R2 coordinator. Its public
route is disabled until AUTH_SERVICE/native cutover. Never expose the RPC as
public HTTP or call `finish` before durably confirming scoped D1/R2 cleanup.

## Internal contract

- `identify(authorization)`: read-only private RPC returning only issuer/subject
  for a verified <15minute local session. No provider refresh, token issuance,
  profile access, provisioning or freeze. API uses it only for initial/retried
  erasure authority, then persists the receipt before `begin`. Missing/revoked
  provider grants cannot prevent app deletion; ordinary data APIs still use
  the daily-gated public identity verifier. No HTTP/header bypass exists.
- `begin(authorization, requestId)`: the request ID is a pre-persisted 64-hex
  identifier. It requires a live, email-verified MyPro bearer session created
  less than 15 minutes ago. Unknown provider types still return
  `provider_revocation_required` before any freeze. Missing Apple/Google grants
  do not prevent app deletion: migration0003 persists provider names in
  `manual_revocation`, later returned as optional `manualRevocation` guidance.
- Acceptance atomically inserts one `auth_erasure` row and removes all sessions.
  Five migration0002 triggers block subsequent session insert/update, account
  insert/update and user update. They close races with already-started auth calls.
- `status(requestId)` reconciles that exact request after a lost response. It is
  trusted-server-only, not authorized merely by a caller-supplied public ID.
- `finish(requestId)` revokes stored Google/Apple grants using exact HTTPS POST
  destinations with a 10-second timeout and no redirects. Only HTTP200 advances;
  unknown/failed responses remain retryable and are not called successful.
  Each accepted provider revocation removes its account row before advancing.
  Then one D1 transaction removes user-bound recovery records, the Auth user
  (cascading accounts/sessions), and clears the user ID from the completed receipt.
  Repeating a completed request returns the same `deleted` state.
- Missing Apple/Google revocation inputs are removed with an atomic provider-only
  notice update, not mislabeled as automatically revoked. The notice survives
  final-commit retries and user-ID scrubbing. The native client must display it
  after completing local cleanup, including after a lost completion response.

Provider tests use a local send fixture: **no real provider revocation occurred**.
Native Apple/Google now sends one-use codes with ID tokens and saves encrypted
grants before sessions; erasure consumes the matching grant. Provider
reauthentication and real-provider setup/consent remain. This legacy-grant recovery is not a
substitute for collecting revocable grants at new account creation. Review
provider project/app-group isolation from Heavy before configuring real grants.
Provider responses lost after success (including Google's invalid-token response)
still need a bounded reconciliation path; do not turn repeated4xx into completion.
MyPro ID-token-only admission is blocked; code receipts and upstream one-use
validation replace it. Real provider behavior still needs cutover verification.

## Confirmation-link isolation

Better Auth1.7.2's default verification token contains email but not user ID and
updates by email. MyPro's sender now issues a library-signed, one-hour token with
subject, issuer and purpose. Its verification route validates that token and
uses one atomic ID+email UPDATE, excluding frozen users. Old links cannot verify
a different re-registered user, even with the same email. Password/session crypto
still belongs to Better Auth; auto-login after verification remains disabled.
Relative default callbacks such as `/` resolve against the clean Auth origin;
foreign origins/credentials are rejected before any update. Headers are
no-store/no-referrer. Heavy's verification behavior is unchanged.

## Verification and deployment — 2026-09-05

- `npm test`: 13 tests pass; `npm run typecheck`: pass.
- `MYPRO_API_ROOT=/path/to/muscle/cloudflare/mypro-api npm run test:isolation`:
  now uses four actual local Workers with independent Auth/API D1s. The MyPro API
  performs D1/R2 cleanup before calling the named service RPC to finish. Seven
  media classes become empty opaque fences; profile/meal/identity/media rows and
  Auth user/session/account rows are gone. Heavy remains usable. The obsolete
  public test bridge has been removed. ID-token-only Apple/Google fixtures now
  also complete through the real four-Worker RPC with manual guidance retained.
  Real mail/provider/native flow is not proven.
- Fault injection covers post-commit response loss, final D1 failure, provider
  failure/retry and persisted provider progress; other-user isolation, stale
  sessions, missing grants, blocked writes, private HTTP boundary, same-email
  re-registration and old-link rejection are also covered.
- Initial real-runtime verification exposed rejection of default relative `/`;
  the fix passes the final full suite and RPC integration. Intermediate version
  `f48addf9-0265-4133-9a96-068e7019cc91` was superseded, not retained as verified.
- MyPro Auth migration0002 applied: production users0/erasures0/triggers5,
  no pending migrations. Existing `AUTH_SECRET` preserved.
- Final version `7cce5f2b-0089-42e0-9577-0c1b2528f8dd`, deployment
  `7c0cfb66-a8d7-4b1d-a367-c086f767362f`, 100%, at11:29:40UTC read back.
  Health200/emailConfigured=false, identity401, signup503, foreign-origin403,
  invalid-verification400, public lifecycle routes404 and recoveryHTML200.
  No production signup, deletion, email, grant revocation or secret-value change.

## Data coordinator and native candidate connected

MyPro migration0020 and API version `8c4a04a5-1848-4172-8562-67aa4eb9217d` are
deployed. The private lifecycle binding is present, but AUTH_SERVICE/client
cutover is still pending, so public erasure admission returns503. MyPro's
`cloudflare/mypro-api/ERASURE.md` owns the receipt, retry, D1 cascade/non-FK/counter,
R2 empty-fence and retained opaque-marker contract. Local52 tests plus real
four-Worker integration pass. No production user erasure or registration occurred.

Native Settings/Keychain/cache are connected in the unsigned candidate, with
receipt persistence, status/resume, email reauthentication and strict202/200.
Provider-only completion guidance persists independently of the erased account.
Actual device QA, native provider reauthentication and real-provider grant capture
remain. Auth-only delete is never a substitute for the whole app-data flow.

## Corrected missing-token behavior and upstream isolation

[Apple TN3194](https://developer.apple.com/documentation/technotes/tn3194-handling-account-deletions-and-revoking-tokens-for-sign-in-with-apple)
requires fulfilling app deletion even when refresh/access tokens and the code are
unavailable, then directing the user to manual revocation. This supersedes the
previous missing-grant hard rejection. Successful app deletion is not evidence
of upstream revocation. Valid stored grants still take the automatic path.

Native code exchange now validates both ID token and code, stores encrypted
grants, uses the native Apple secret and refuses replay/mismatched subjects.
Swift forwards `GIDSignInResult.serverAuthCode`. Better Auth1.7.2 omits the
refreshToken in its ID-token account argument, so a session-before hook persists
the verified server-only envelope instead. See [NATIVE_OAUTH.md](NATIVE_OAUTH.md),
[Apple token validation](https://developer.apple.com/documentation/signinwithapplerestapi/generate-and-validate-tokens),
[Google offline access](https://developers.google.com/identity/sign-in/ios/offline-access).

The local Heavy-session test proves separate application Auth databases only.
[Google revocation](https://developers.google.com/identity/protocols/oauth2/web-server#tokenrevoke)
affects all clients in the same OAuth project, and
[Apple grouped-app revocation](https://support.apple.com/en-us/102571) can affect
other apps from the developer. Verify app-specific provider project/group
configuration before production credentials or revocation tests; do not infer
provider isolation merely from separate Worker/D1 names.

Primary references: [Supabase user deletion](https://supabase.com/docs/guides/auth/managing-user-data),
[Cloudflare RPC](https://developers.cloudflare.com/workers/runtime-apis/rpc/),
[Apple revocation](https://developer.apple.com/documentation/signinwithapplerestapi/revoke-tokens),
[Google revocation](https://developers.google.com/identity/protocols/oauth2/web-server#tokenrevoke).
