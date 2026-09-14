# App-isolated Cloudflare consumer authentication

Current API deployment: [API_CUTOVER.md](API_CUTOVER.md), September6 20:50JST. Both production APIs are service-only and bound to their matching Auth. Client rollout and real mail/provider/device acceptance remain incomplete; dated old-issuer/no-binding statements below are history.

Shares the Better Auth **1.7.2** implementation, but **not user accounts or sessions**. Heavy Chain uses `consumer-auth` / `consumer-auth-db`; MyPro uses `mypro-auth` / `mypro-auth-db`. Each has its own secret, issuer, cookies and D1. Old test accounts are not imported. Both services are deployed, but **neither production client has cut over yet**.

## App isolation checkpoint — 2026-09-05

Latest native grant/daily validation and deployment checkpoint:
[NATIVE_OAUTH.md](NATIVE_OAUTH.md). Auth60 tests/typecheck and actual workerd
restart/concurrency plus four-Worker isolation pass. Provider secrets are now
configured for MyPro native, but real provider/email/device QA and API/client
cutover remain incomplete. Historical checkpoints below are not current status.

Earlier: MyPro-only lifecycle RPC and subject-bound confirmation links are now
implemented/deployed as `7cce5f2b-0089-42e0-9577-0c1b2528f8dd` (100%). Migration0002,
users0/erasures0/triggers5 and public HTTP rejection read back. Auth12 tests,
typecheck and actual local service-RPC isolation integration pass. The MyPro API
now binds this private entrypoint and implements D1/R2 cleanup before Auth finish.
Native Settings and real provider-grant handling remain unfinished; production
public admission is still disabled until AUTH_SERVICE/client cutover.
See [ERASURE.md](ERASURE.md) for exact contracts, evidence and gaps.

The old MyPro `delete-account` function deletes its Auth user after cleaning its storage. A single shared Auth user would make a MyPro deletion also remove Heavy access. Therefore both apps register independently, even for the same email. This is tenant separation, not a new shared-account deletion/rejoin policy. Both production Auth databases were read back with zero users; no user migration or real signup was performed.

- MyPro config: `wrangler.mypro.jsonc`; URL `https://mypro-auth.nichika2000823.workers.dev`; D1 `9fa935e4-73d7-44ab-a56b-0c05c19259cf`, migration 0001 applied. `AUTH_SECRET` is independently generated and installed as a Worker secret; no value is stored in this repository.
- Initial split deployment (superseded by the latest lifecycle checkpoint above): MyPro Auth version `7518c2a5-a5a2-4071-a1f2-10273d6f737a`, deployment `5ba13ee6-40d4-462e-aeab-e524a9bafe41`, 100%. Same-run health200/appId=mypro/emailConfigured=false, identity401, unconfigured signup503, foreign origin403; no real signup/mail.
- MyPro hosts its own `/reset-password` and `/login` confirmation guidance. Companion visual QA passed for request, token-present form with visible query removed, and return-to-app guidance; no production form submitted. Responses are no-store/no-referrer with restrictive CSP and no external assets. Own QA session/tab cleaned up.
- Heavy's existing deployed Auth version is unchanged. The shared source now selects app-specific mail subjects and cookie prefix; default `APP_ID` is `heavy`.
- `MYPRO_API_ROOT=/path/to/muscle/cloudflare/mypro-api npm run test:isolation` now runs four actual local Workers with independent Auth/API D1s. MyPro API itself calls the private lifecycle RPC; the earlier public test-only bridge is removed. Same-email users, cross-app rejection, recovery, seven media classes and complete MyPro D1/R2/Auth cleanup with Heavy still usable pass. This is local runtime proof, not real mail/provider/native/production-user erasure.

## Security and transport

- Passwords use Better Auth's scrypt implementation; no custom password crypto. Email confirmation is required. Verification lasts 1 hour and recovery tokens 30 minutes. Password recovery revokes previous sessions.
- Browser integration must proxy `/api/auth/*` through the Heavy web Worker's service binding, preserving its allowlisted request URL. Cookies are Secure, HttpOnly, SameSite=Lax, host-only. Do not enable third-party cookies or wildcard origins to work around workers.dev boundaries.
- Native clients use Better Auth bearer session tokens and the existing Keychain-backed session storage. The session is sliding (30 days, refreshed after a day); no cookie-cache shortcut.
- Each application API's `AUTH_SERVICE` binding must query its own Auth `/v1/identity` using only the bearer header. D1-backed live session checks reject that app's logged-out/recovered session immediately. A token from the other app is invalid. With this binding present, there is no legacy JWT/Supabase fallback.
- Application APIs are service-only: they validate the exact issuer, verified UUID subject and verified profile returned by the bound Auth Worker, which owns live expiry and revocation. There is no API-side JWT/JWKS verifier or global-fetch fallback.
- New app principals are provisioned atomically from the verified issuer+UUID subject. Email is never used to adopt existing rows or grant a role. Profile metadata cannot grant admin rights.
- Database-backed auth rate limits survive Worker restarts. Persistent per-app mail allocations and bounded scheduled expiry maintenance are implemented; see [MAIL_OPERATIONS.md](MAIL_OPERATIONS.md) for current deployment evidence. Email uses the native Cloudflare `EMAIL` binding and the app-specific `EMAIL_FROM`; both are required before a send. Production allocations remain zero, sender/domain onboarding and live email configuration are unverified, and real signup/delivery/recovery are not yet accepted.
- `AUTH_SECRET` is a Worker secret. JWT private keys stay encrypted in D1. Do not log request bodies, tokens, verification links, or provider errors. Application telemetry and Worker observability are disabled here.

## Deployed 2026-09-05

- Account: `ffa9a931fec21b22273fd2c311bb771d`
- URL: `https://consumer-auth.nichika2000823.workers.dev`
- D1: `consumer-auth-db`, `d6ee3637-1212-40a3-b407-562fb9ccf6bc`, APAC, migration `0001_auth.sql` applied.
- Initial active version after setting `AUTH_SECRET`: `68a19781-bb4c-4d4a-a3d2-b806938473b3`.
- Native-audience support deployed as `0f99fa83-4382-4fa9-8114-7e1a3cc88ed8`, deployment `dbcf766a-c1d1-4736-92cf-b8a3280dfbdb`, 100%, verified 2026-09-05 09:50 UTC. Existing vars/secrets preserved. Post-deploy health200/emailConfigured=false, identity401, unconfigured signup503, foreign origin403. No account or email created/sent.
- Live checks: health200/emailConfigured=false; JWKS200/EC/ES256/P-256/no private fields; missing identity401; signup503; foreign origin403. D1's six expected tables exist, with zero user accounts. No email was sent.
- The local Heavy/MyPro API production candidates now pair the dedicated issuer with the matching service binding (Heavy → `consumer-auth`, MyPro → `mypro-auth`). This is configuration/code readiness only; no API deployment or client cutover is implied. Do not call this a completed auth migration.

## Verification

`npm ci --ignore-scripts`, `npm test`, `npm run typecheck`, `npm run dry-run`.

Focused API auth tests cover service-only identity admission, issuer/UUID/profile checks, live expiry/revocation responses, outages and the no-binding legacy-variable fail-closed boundary. Actual workerd/D1 tests include isolate restart and concurrent refresh; mail and providers are local fixtures. See NATIVE_OAUTH.md for current scope/limits; these tests do not prove real Google/Apple login or revocation.

The historical shared-Auth compatibility integration requires the other repository's explicit API root. It remains a proxy/API regression fixture, **not the current deployment architecture**; run `test:isolation` above for the app separation contract:

```sh
MYPRO_API_ROOT=/path/to/muscle/cloudflare/mypro-api npm run test:integration
```

This runs four real Workers (auth, Heavy API, MyPro API, Heavy web proxy) with service bindings, three local D1s and private local R2. It checks common signup/verification/login, both app profiles, Heavy brand and idempotent image save/read, MyPro meal save/read, and revocation at both APIs. The actual browser auth adapter also logs in through the web proxy with a test cookie jar, refreshes, logs out, follows a captured recovery link, resets the password, and confirms old credentials/sessions fail while the new password works. Cookies must be Secure/HttpOnly/Lax and auth responses no-store. No production app data or email is written/sent; this is runtime integration, not a live browser/device login. Miniflare 5 uses the exported `convertV4MiniflareOptions`; tests route through `dispatchFetch` because the Node `getWorker` proxy rejects browser Origin headers. D1 auth dates are ISO strings.

## Heavy browser candidate (2026-09-05)

`src/lib/cloudflareBrowserAuth.ts` implements same-origin session/signup/login/logout/recovery/OAuth calls. Browser tokens remain in memory; the host-only cookie is the reload/refresh authority. Session reads crossing a successful logout cannot resurrect the old session. BroadcastChannel invalidates other tabs. The transitional Supabase-shaped types do not instantiate the SDK in Cloudflare auth mode: remaining legacy data calls fail explicitly instead of sending old traffic.

From the Heavy root, `VITE_CLOUDFLARE_AUTH_ENABLED=true node cloudflare/heavy-web/build.mjs` generates the matching web AUTH_SERVICE binding and omits the old Supabase URL/key. The current `.build/` is this **undeployed candidate**. Do not deploy it alone while the APIs still use the old issuer or email/provider setup is incomplete. Login and token-present/missing reset screens were visually checked locally through Companion. The reset page removes the token from the visible URL, while its Worker response uses no-referrer/no-store. Full production auth and all legacy feature replacement remain unverified.

## Remaining cutover work

1. Heavy browser auth/session/recovery, same-origin proxy and `/reset-password` are implemented and locally verified; finish real mail/provider and production cutover verification. Keep credentials/tokens out of persistent browser storage.
2. MyPro email/native Apple+Google, refresh/revoke/recovery transport is implemented behind the explicit `CLOUDFLARE_AUTH_ENABLED` build flag, with separate Keychain selection and an iOS build candidate. Verify Keychain/real provider/device workflows before cutover; see MyPro `tests/native-auth/README.md`. Both native Auth and recovery web URLs now use `mypro-auth`; they must not use Heavy's issuer or reset page.
3. Keep the public-email acceptance sequence binding-first: complete Cloudflare Email Service sender/domain onboarding for each configured sender, deploy and verify the matching `EMAIL` binding plus valid `EMAIL_FROM`, establish the account allowance/other senders/headroom, and explicitly allocate the existing per-app mail budgets before opening public signup or recovery. Bounded expiry maintenance is implemented; production scheduling evidence is tracked in MAIL_OPERATIONS.md. A web subdomain does not provide sender DNS ownership. This is an acceptance gate for public email, not a code dependency for an independently verified API cutover.
4. An independent API cutover still requires the matching `AUTH_ISSUER` and `AUTH_SERVICE` together with its client: Heavy → `consumer-auth`; MyPro → `mypro-auth`. The service-only verifier rejects old JWT/JWKS/Supabase sessions and does not adopt old API rows by email. Never cross-bind the apps; keep the old source until representative business flows and zero Supabase runtime traffic are verified.

References: [Better Auth database](https://better-auth.com/docs/concepts/database), [password auth](https://better-auth.com/docs/authentication/email-password), [bearer](https://better-auth.com/docs/plugins/bearer), [JWT](https://better-auth.com/docs/plugins/jwt).

## Native OAuth configuration

`GOOGLE_CLIENT_ID` is the Web client paired with `GOOGLE_CLIENT_SECRET`; optional `GOOGLE_IOS_CLIENT_ID` adds the reviewed iOS audience. `APPLE_CLIENT_ID` is the Web Service ID paired with `APPLE_CLIENT_SECRET`; optional `APPLE_APP_BUNDLE_IDENTIFIER` adds the reviewed native bundle ID. Both providers use explicit arrays for ID-token verification. Values supplied by a client are never adopted as the audience. Apple origin is accepted only on POST `/api/auth/callback/apple` when the provider is configured; all other host/origin checks remain exact. These settings are implemented but the actual provider credentials/audiences are not yet configured or verified.

Primary specifications: [Google cross-platform ID tokens](https://better-auth.com/docs/authentication/google), [Apple native ID tokens and callback origin](https://better-auth.com/docs/authentication/apple).
