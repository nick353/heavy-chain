# MyPro native OAuth code exchange

## Production auth surface readback — 2026-09-07 20:24 JST

Fresh read-only GETs against both deployed Auth Workers returned `/health` 200
with D1 storage and `emailConfigured=false`, `emailBudgetConfigured=false`, and
`/api/auth/get-session` 200 with `null`. GETs to the social sign-in endpoint
returned 404 because it is POST-only; provider callback GETs returned the
library's generic error page and did not establish a session. This is routing
and configuration readback only: no signup, email, OAuth consent, provider
token exchange, device login, or account was created.

The production secret inventory was also read without values: Heavy has only
its Auth secret; MyPro has the reviewed Apple native and Google client/secret
secret names. Secret presence is not proof of a successful provider exchange.
The exact remaining gates are real provider consent/code exchange, signed
device QA, sender/domain configuration and nonzero reviewed mail allocation.

## Native device candidate — 2026-09-06 JST

MyPro Swift now retains the server-admitted Apple SDK user reference in its
device-only session, checks it on OS revocation/foreground/private access, and
separates local invalidation from failed/unknown server logout. Actor and UI
generation guards reject old checks/refresh responses/notifications; uncertain
device states retain credentials and deny private requests. Normal logout and
erasure recovery remain distinct. Product-excerpt/native Auth/erasure/realtime
Swift contracts and final unsigned iOS build03:33:33JST pass; real OS notifications,
Keychain/UI/device/provider proof and safe pre-acceptance erasure cancellation
remain incomplete. No Worker deployment or client cutover in this stage.
Full native contract/reproduction: MyPro `tests/native-auth/README.md`.

## Latest daily validation / erasure boundary — 2026-09-06 02:54 JST

MyPro's protected Auth HTTP routes and `/v1/identity` now validate Apple/Google
grants on use, at most once per24hours per credential generation. This is not a
cron that visits inactive users. Native code exchange and verified browser
callbacks record fresh consent; Google browser OAuth requests offline access
and consent. Email accounts and Heavy's deployed behavior remain unchanged.

Migration0005 adds private `provider_validation` (fingerprint, check ID, state,
check/next-at timestamps; no tokens). A D1 claim precedes any upstream call and
survives an isolate restart or lost reply. Fixed provider URLs, manual redirects,
10-second timeout and16KiB responses apply. Refresh JWTs, if returned, must have
the exact issuer/audience/previous subject and valid RS256 signature/expiry;
refresh never adopts a user or reuses an interactive nonce. Native rotated
grants stay encrypted. Provider-token HTTP routes (`get-access-token`,
`refresh-token`, `account-info`) are closed in MyPro to prevent exposure/bypass.

Exact400 `invalid_grant` requires reauthentication and atomically removes the
user's sessions while retaining revocation credentials. Network/configuration/
malformed/other errors retain sessions/grants and deny protected access with503,
not401. **Availability tradeoff:** after an unknown/failed attempt, protected
access remains unavailable until the next daily window or fresh interactive
consent. No immediate automatic provider replay. SQL checks both the actual
account credentials and exact claim; old results cannot overwrite a new login
or remove its sessions. The session is rechecked after the provider await.

The four-Worker integration caught a deletion regression: the ordinary identity
gate also blocked missing-grant erasure. `MyProAccountLifecycle.identify` now
provides read-only, verified <15minute local-session deletion authority through
private RPC only. The API uses it before persisting the receipt and again before
freeze; `begin` repeats freshness checks. There is no general HTTP/header bypass.
Normal data access stays gated, and TN3194 missing-grant/manual guidance remains.

Auth60 tests, MyPro API53 tests, both typechecks/dry-runs and actual four-Worker
D1/R2 erasure/isolation pass. Actual workerd also proves daily refresh concurrency,
isolate restart, dynamic Apple signing, pre-effect invalidation and no duplicate
refresh. Browser OAuth create/update callbacks are real library flows with local
provider fixtures. No real provider token exchange/refresh/revocation occurred.

Auth0005 applied; version `38383cce-a809-49a3-9670-0081691902e3`, deployment
`24477021-c9d6-4a01-a84c-4e172aadd055`,100% at17:52:03UTC Sept5.
MyPro API version `113ed852-d544-4920-9010-8e2445121c97`, deployment
`a69a4260-39f6-4469-b78b-8a4596d4ed7f`,100% at17:52:51UTC.
Same-run readback: Auth users/accounts/sessions/validation rows0; API identities/
erasures/media0, reads wrote0 rows. Eight Auth secrets, API old issuer/no
AUTH_SERVICE, private lifecycle/R2/D1/realtime/minute cron retained. No API schema
change, Heavy deployment, client cutover, Swift/build/device operation or signup.
Auth health200/emailConfigured=false; missing native Apple/Google401, invalid
bearer get-session401, closed provider/private HTTP routes404, public erasure503.
Native credential-revoked/system-account-change handling, real provider/device
QA, mail/domain/fees and the full production migration remain incomplete.

Sources: [Apple daily validation](https://developer.apple.com/documentation/signinwithapple/verifying-a-user),
[Apple refresh exchange](https://developer.apple.com/documentation/signinwithapplerestapi/generate-and-validate-tokens),
[Google offline access and refresh](https://developers.google.com/identity/protocols/oauth2/web-server),
[Apple missing-grant deletion](https://developer.apple.com/documentation/technotes/tn3194-handling-account-deletions-and-revoking-tokens-for-sign-in-with-apple).

## Previous Apple configuration / recovery — 2026-09-06 02:12 JST

Human Apple Developer login was followed by same-profile semantic + visual
readback. Team `75TGS5QG82`, primary App ID `com.Nichika.muscle`, capability enabled.
Existing key `57G53GZX39` (My Pro AppleID 1) has only Sign in with Apple enabled;
its primary is MyPro and its one displayed grouped ID is
`com.Nichika.muscle.web` (Muscle Web Sign-In), not Heavy. Notification URL empty.
No Apple capability/key/grouping/notification setting was changed or revoked.
The original matching local P-256 key was retained and restricted to mode600,
then sent through stdin to MyPro Auth's private-key secret (never printed).

APPLE_APP_BUNDLE_IDENTIFIER, APPLE_NATIVE_TEAM_ID, APPLE_NATIVE_KEY_ID and
APPLE_NATIVE_PRIVATE_KEY are installed; existing AUTH_SECRET and Google3 remain.
`withAppleNativeSecret` generates an ES256 client secret for the exact native
bundle/team/key, valid for five minutes, per native sign-in/reauthentication or
revocation operation. No scheduled six-month static JWT replacement is needed.
Partial/invalid signing configuration fails closed without static/web fallback;
static credentials remain supported when no signing fields are configured.
It does not enable browser Apple OAuth or configure the existing web Service ID.
The server secret is never persisted in a user record or returned to the app.

Also fixed Google's lost revocation response: exact bounded400 invalid_token
permits app deletion with durable manual-revocation guidance, not a claim that
all provider grants were revoked. Other errors retain the grant and stay pending.

37 tests/typecheck/MyPro dry-run pass, including actual workerd/D1 dynamic Apple
ES256 signing and native Apple+Google admission/reauthentication, and separate
erasure signing with invalid-key credential retention. Upstream providers are
fixtures. Swift unchanged; its last unsigned build remains01:27:58JST.
MyPro Auth version `bb83f531-150a-4538-acde-b0ec06bd44c5`, deployment
`25ba5b2b-75f5-407f-92cc-83d117e0a55b`,100% at17:08:33UTC on Sept5 read back.
No schema migration or Heavy/data API/issuer/client cutover. Fresh remote
users/accounts/sessions0, rows_written0; health200/emailConfigured=false;
missing native Apple/Google credentials and Apple reauth now401, identity401.
This verifies configuration/signing execution, not a real Apple code exchange.
Real consent/login/revoke, signup, device QA, notification/daily validation,
email/domain/fees and full production migration remain unverified/incomplete.

Sources: [Apple key configuration](https://developer.apple.com/help/account/capabilities/create-a-sign-in-with-apple-private-key/),
[Apple token validation](https://developer.apple.com/documentation/signinwithapplerestapi/generate-and-validate-tokens),
[client-secret reference linked by Apple's REST index](https://developer.apple.com/documentation/accountorganizationaldatasharing/creating-a-client-secret),
[Google revocation errors](https://developers.google.com/identity/openid-connect/reference).

## Google real configuration — 2026-09-06 01:31 JST

Google project `mypro-cloudflare-auth` (323947851016) is dedicated to MyPro;
the legacy project `practical-lodge-465506-r6` also contains AOS and is unchanged.
The new OAuth app is MyPro/External/Testing with the requested Gmail as support,
developer contact and its one saved test user. Home/privacy/terms are not set;
the public-configuration warning remains. No publication or real consent/login.

- GOOGLE_CLIENT_ID (Web): `323947851016-i2p5a8penblvt6c6rre4mh4e9hrbhfcl.apps.googleusercontent.com`
- GOOGLE_IOS_CLIENT_ID: `323947851016-00rdj0tvup54pe5ordj4jfd04i85ne22.apps.googleusercontent.com`
- Web callback: `https://mypro-auth.nichika2000823.workers.dev/api/auth/callback/google`; no JS origins.
- iOS bundle `com.Nichika.muscle`, Apple Team `75TGS5QG82`; App Store ID optional/unset, Firebase App Check not enabled.

Both IDs and GOOGLE_CLIENT_SECRET are Worker secrets; no secret value belongs
in this file or native bundle. Official downloaded credential was restricted to
mode600, piped to Wrangler stdin and removed after installation. AUTH_SECRET
was preserved. Latest MyPro Auth version `0699c1ad-3394-43b3-9d7f-736792645380`,
deployment `5ae8a202-cfcc-4fd7-97b0-1dfeea41fd0b`,100% at16:22:32UTC on Sept5.
Only secrets changed on the Worker; code and DB schema are unchanged.
Fresh users/accounts/sessions0. Missing Google native credentials now return
401 INVALID_NATIVE_CREDENTIAL (configuration present, not a successful login).
Apple native remains503; health200/emailConfigured=false. Heavy/data APIs
and production client/issuer cutover unchanged.

Swift selects these public IDs only when CF Auth is enabled, refuses missing CF
config without legacy fallback, and includes the iOS reversed-ID callback scheme.
Native transport PASS; unsigned generic iOS build exit0/dylib01:27:58JST and
compiled IDs/callback/CF Auth+API YES verified. No device/Simulator/distribution.
At this older checkpoint Apple Developer needed human login. See the latest
checkpoint above for Apple configuration and lost-revoke recovery.

## Previous verified checkpoint — 2026-09-05 23:41 JST

MyPro Auth version `30db1c5a-7e26-4737-b56b-4c5cbdc7605c`, deployment
`fabb5193-0de8-49ee-a737-e2030ddaaa04`,100% at14:40:09UTC. Migration0004 is
applied to `mypro-auth-db` (`9fa935e4-73d7-44ab-a56b-0c05c19259cf`);
account.nativeGrant TEXT/no pending migrations were verified at the previous
checkpoint; this code-only deployment adds no migration. Fresh users0/accounts0/
sessions0 read back.
AUTH_SECRET preserved; no provider secrets added. Heavy and both data APIs
were not redeployed. Existing production issuer/client cutover is unchanged.

Live native Apple/Google reauthentication returns503 NATIVE_OAUTH_NOT_CONFIGURED;
malformed expectedSubject400, foreign Origin403 and Heavy route404. Both Auth
health200/emailConfigured=false, MyPro identity/profile401, public erasure503.
No real signup/mail/provider exchange/revoke, device installation, billing,
old test data copy/deletion or source retirement.

## Contract

- Swift forwards Apple authorizationCode and Google serverAuthCode in memory
  to POST /api/auth/sign-in/native with the ID token and Apple's raw nonce.
  Codes are neither persisted nor retried after an ambiguous result. Missing
  codes cannot fall back to ID-token-only login. Google restores do not invent codes.
- MyPro-only route requires its exact Auth Origin and bounded input. A D1
  per-IP rate limit runs before keys/provider calls. The client cannot choose
  audiences, secrets, endpoints or identity metadata.
- Pinned JOSE6.2.11 verifies both signatures, RS256, configured issuer/audience,
  expiry/issued-at, same subject and verified-email claims. Apple verifies
  SHA256(raw nonce) on both tokens and c_hash when present. Google validates
  an explicitly configured authorized party when present. Exchanged audience
  must be the server-selected client.
- A SHA256 code digest is atomically consumed before exchange; a lost result
  requires fresh provider authorization. Local receipts last ten minutes and
  expired entries are removed in bounded batches on later requests. Provider
  one-use validation is still authoritative after receipt expiry.
- Apple uses APPLE_APP_BUNDLE_IDENTIFIER + a runtime-generated native client
  secret (or explicit APPLE_NATIVE_CLIENT_SECRET), never the Web Service ID
  secret. Google uses GOOGLE_CLIENT_ID (web),
  GOOGLE_IOS_CLIENT_ID and GOOGLE_CLIENT_SECRET. Apple omits redirect_uri;
  Google uses an empty native redirect_uri. Fixed HTTPS destinations, timeout,
  bounded response, manual redirect mode and exact200 acceptance.
- Better Auth retains identity verification, account/session creation and
  crypto. A session-create BEFORE hook writes authenticated ciphertext with
  the app-specific secret, binding provider/subject/client and revocable grant.
  nativeGrant is deliberately absent from Better Auth's public additional-field
  schema; list-accounts does not expose it. Public access/refresh fields stay null.
- New admission requires a refresh grant. Returning responses that omit one
  can retain the old encrypted grant only for the same provider/subject/client.
  Storage errors/frozen-account triggers prevent session issuance. Missing
  returning Apple email can use only the previously bound subject's verified
  email, never email-based account adoption.
- MyPro public sign-in/social ID-token requests are rejected; browser redirect
  OAuth remains. Heavy's routes do not change to MyPro's native protocol.
- Erasure decrypts the matching grant and selects the native Apple credentials
  or fixed Google revoke endpoint. Missing/corrupt credentials still permit app
  deletion with manual guidance, never a claim of automatic provider revocation.

## Same-account erasure reauthentication

- POST /api/auth/reauthenticate/native additionally requires expectedSubject,
  normalized as a UUID. It constrains the existing app account; it is not proof
  of identity. The verified provider subject/issuer must already belong to that
  exact verified user, with no erasure freeze. No email-based linking or signup.
- Session creation checks the UUID again. User/account create hooks reject all
  writes on this route, including deletion between the pre-read and callback.
  Better Auth1.7.2's ID-token route reads provider.disableSignUp while built-in
  providers keep that setting under options: the flag alone did not stop account
  resurrection in the deletion-race fixture. The write hooks fix that failure
  without changing dependencies or ordinary signup.
- Native recovery offers email, Apple and Google. It captures the receipt user
  before provider interaction, then checks the receipt and fresh session again.
  The temporary bearer is never admitted to the ordinary app session or persisted.
  Wrong-account sessions and sessions after attempted erasure are signed out on
  a best-effort basis; a failed network logout is not confirmed revocation.
  Cancelling provider UI retains the receipt and does not cancel a server erasure.

## Verification / runtime finding

npm test:32 pass; typecheck and MyPro dry-run pass. Tests include actual
workerd/D1 Apple+Google HTTP login with real RSA signatures, encryption/readback,
replay rejection, distinct reauthentication sessions and temporary logout without
invalidating the original session. Apple/Google no-signup, wrong/frozen/deleted
account and deletion-race fixtures pass. Providers are fixtures, not real Apple/Google.
Swift transport verifies exact reauthentication payload, same UUID, wrong-account
logout and no signup fallback. Four-Worker Auth/API/R2 isolation passed at the
previous checkpoint; it was not repeated for this MyPro-only route change.

Actual workerd rejected redirect:error before sending, despite its appearance
in public Request docs. A bounded runtime diagnostic reproduced the exact
Invalid redirect value error. Exchange and erasure now use manual+exact200;
redirect fixtures never follow Location. This fixes execution, not provider setup.

Final generic unsigned iOS build exit0; dylib23:40:37JST, empty log
/tmp/mypro-native-provider-reauth-final-build-20260905.log. Info.plist Auth/API YES,
MyPro URLs and version1.1(202608210260) unchanged. No device/Simulator operation,
default-config cutover or distribution occurred.

## Next / unverified

Real consent recovery for missing refresh grants, credential-revoked notifications
and periodic server provider refresh. Lost-revocation recovery is fixture-tested,
not real-provider-tested. MyPro Google project and Apple key/grouping have now
been inspected separately from Heavy; separate D1s alone are not that proof.
Actual device Keychain/CoreData/notifications/cache/UI, real provider/email,
API/client cutover, AI/Heavy feedback/admin, cost limits, production E2E, zero
runtime Supabase and source retirement remain in the unchanged full Goal.

Sources: [Apple tokens](https://developer.apple.com/documentation/signinwithapplerestapi/generate-and-validate-tokens),
[Google native code](https://developers.google.com/identity/sign-in/ios/offline-access),
[Better Auth OAuth](https://better-auth.com/docs/concepts/oauth),
[Cloudflare Request](https://developers.cloudflare.com/workers/runtime-apis/request/).
