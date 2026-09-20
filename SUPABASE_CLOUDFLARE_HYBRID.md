# Heavy Chain Cloudflare-first migration boundary

Current goal (2026-09-08): no Supabase runtime dependency after verified staged cutover, and **no old test-data copy**. This file is a migration-history record; the active setup is [SETUP.md](SETUP.md) and the authoritative acceptance state is in `STATE.md` and `plan.md`. The temporary/legacy descriptions below must not be used as current fallback instructions. Production auth/client, signed candidate-image delivery, precise print/many-design parity and image-quality acceptance remain incomplete.

This project follows the shared [Supabase + Cloudflare Hybrid Standard](../../../New%20project/SUPABASE_CLOUDFLARE_HYBRID_STANDARD.md).

## Temporary migration bridge

- The existing Supabase Auth session is a temporary bearer-token bridge while
  an OIDC provider and account-linking flow are configured.
- Existing Supabase data and Edge Functions remain source references during
  reconciliation only; they are not a reason to silently claim cutover.

## Cloudflare target

- Workers provide the authenticated API and domain operations.
- D1 holds the migrated identity, application metadata, and authorization
  relationships.
- Private R2 holds migrated media behind the Worker boundary.

## Candidate R2 media

- private `generated-images`
- private `brand-assets`
- private `exports`

## Migration state

- Provider-neutral identity boundary: implemented in `src/lib/mediaReference.ts` with focused regression coverage in `scripts/verify-media-reference-boundary.test.ts`.
- Browser read boundary: implemented in `src/lib/mediaGateway.ts` and `src/lib/storage.ts`. The Heavy Worker now exposes an authenticated, short-lived HMAC capability gateway for Cloudflare-owned `generated-images`; it remains disabled by default, but an explicit Cloudflare provider order and HTTPS gateway origin can activate the R2 route.
- Heavy client data-plane wiring: when the explicit Cloudflare flag is enabled,
  brand creation/settings, Dashboard/Gallery generated-image listing, favorites,
  deletion, Jobs/workspace activity, Lightchain Library, Fitting history/resume,
  Workbench material gallery, and GallerySelector image reads use the Worker
  adapter. Generated-image deletion removes the private R2 object before the
  D1 metadata row; D1 folders and image-folder memberships cover the selector
  and folder manager with brand-role checks and cycle rejection. Brand logo
  upload/read also uses the private Worker media contract. The Supabase path
  remains the reversible fallback while the flag is off. D1 tags and
  image-tags now cover TagManager with owner/brand checks, and D1 style
  presets cover StylePresets with editor-scoped writes.
- D1 team management now covers owner-synthesized members, manager-scoped
  invitation records and acceptance, role changes, revocation, and member
  removal. TeamManagement uses this contract only when the explicit Cloudflare
  data-plane flag is enabled; Supabase remains the fallback otherwise.
- D1 share links now cover editor-authorized creation and public,
  expiry-checked reads. Public image bytes are served from private R2 through
  the Worker token route; `PUBLIC_SHARE_ENABLED` is an explicit opt-in and is
  false in the example configuration.
- Local verification: Worker tests (`33`), typecheck, production dry-run, and
  the Heavy Chain frontend build pass.
- Authenticated gateway boundary: implemented locally in `supabase/functions/media-gateway/index.ts`. It uses Supabase user identity plus brand-role checks, permits only the three private media buckets, and returns short-lived R2 S3-compatible presigned GET URLs. The Edge Function remains undeployed until server-side R2 secrets, origin policy, target readback, and rollback evidence are approved.
- R2 account access is now available through the authenticated Wrangler
  account. The empty APAC Standard bucket `heavy-chain-private-media` was
  provisioned; `heavy-chain-api` is now deployed with the common MyPro
  Supabase Auth OIDC bridge. Same-run `/v1/health` returned `200` with
  `media=private-r2`; an unauthenticated protected request returned `401`.
- The verified public frontend origin is `https://heavy-chain.zeabur.app`.
  The authorized Zeabur service variables now point the frontend at the MyPro
  Supabase Auth project and enable the Heavy Cloudflare API endpoint. Fresh
  deployment `6a9ac68b4e43204d5880fb1c` is `RUNNING`; the public origin
  returns `200`, the served bundle contains the Heavy Worker URL and common
  Auth issuer, and the runtime model asset is present. This is static/client
  deployment proof, not authenticated E2E or full client cutover proof.
- Supabase source inventory: captured in `../../../New project/work/supabase-cloudflare-media-inventory-20260824.json`; the local read-only reconciliation plan is implemented, but per-object checksum reconciliation is not started because the current capture contains bucket totals only.
- Data copy: not started.
- Supabase fallback: remains available only while the explicit Cloudflare rollout flag is disabled.

The existing private-bucket membership checks and short-lived signed reads must be retained. No source object may be deleted until target readback, application readback, checksum reconciliation, and rollback evidence all pass.

## Current safety flags

- Local identity boundary: verified by the focused test; the module performs no provider reads or writes.
- Runtime provider order: defaults to Supabase; the browser gateway path is explicit, authenticated, HTTPS-only, and fail-closed on an invalid response. `resolveMediaUrlByProviderOrder` only visits the caller's explicit providers, continues after a provider miss, and never calls a reader for an invalid object path.
- Gateway implementation: focused boundary tests cover Supabase auth, brand-role authorization, the exact private `generated-images` / `brand-assets` / `exports` allowlist, safe object paths, HTTPS-only R2 endpoint validation, bounded 60–3600 second presigned URL lifetime, and JWT-protected deployment registration.
- Dual-read wiring: generated-image reads support the configured provider order; R2 remains inactive until a private gateway and target readback exist. Gateway responses must explicitly identify the matching provider, bucket, object path, and HTTPS signed URL.
- Active provider: Cloudflare is the intended target and the frontend flag is
  configured for the deployed Worker; static deployment readback passed, but
  authenticated client behavior and full cutover remain unverified.
- R2 gateway deployment, source checksum reconciliation, target upload, data
  copy, and source deletion: not completed. The provisioned bucket is empty.
- R2 credentials: not used in the browser or repository.
- `MEDIA_READ_SECRET` is server-only and must be registered with Wrangler as a
  secret before enabling the browser gateway; it is intentionally absent from
  the example variables and local production configuration.

## Current free-tier feasibility (official read on 2026-09-04)

- R2 Standard includes 10 GB-month, 1 million Class A operations, 10 million
  Class B operations per month, and free egress. Infrequent Access is not
  included in that free tier.
- Workers Free includes 100,000 inbound requests per day and 10 ms CPU time
  per HTTP invocation. The Free request-body limit is 100 MB.
- D1 Free includes 5 million rows read per day, 100,000 rows written per day,
  5 GB total account storage, 10 databases per account, and 50 D1 queries per
  Worker invocation. Since 2026-09-01, exceeding the daily row limits makes
  D1 queries fail until the daily reset.
- Therefore the proposed split is feasible for a small, quota-aware pilot, not
  an unlimited free production guarantee. The app must use indexed queries,
  bounded pagination, upload caps, and usage readback before enabling both
  projects.

Official references: [R2 pricing](https://developers.cloudflare.com/r2/pricing/),
[Workers limits](https://developers.cloudflare.com/workers/platform/limits/),
[D1 pricing](https://developers.cloudflare.com/d1/platform/pricing/), and
[D1 limits](https://developers.cloudflare.com/d1/platform/limits/).

## Auth boundary — 2026-09-04

- The Cloudflare Workers now include a strict OIDC/JWKS verifier for RS256 and
  ES256 tokens. It checks HTTPS issuer/JWKS configuration, issuer, audience,
  expiry, not-before, signature, and key rotation.
- The verifier is fail-closed when its variables are unset. The app's existing
  Supabase session token is the explicitly authorized temporary common bridge
  for both MyPro and Heavy until a dedicated OIDC/login flow is selected.

The live Supabase restriction is separate from the local Cloudflare proof.
Cloudflare R2 does not provide a drop-in identity provider. Cloudflare
Access's generic OIDC setup requires an identity provider to be configured in
Cloudflare One; PKCE is supported for the OIDC flow. Therefore the provider
choice, redirect URLs, claims, and account-linking policy must be configured
before removing the temporary Supabase session bridge.

Supabase's current guidance says egress restrictions clear at the next billing
cycle or immediately after an organization plan upgrade; usage and billing
must be checked in the organization billing/usage views. References:

- https://supabase.com/docs/guides/platform/manage-your-usage/egress
- https://supabase.com/docs/guides/platform/cost-control
- https://developers.cloudflare.com/cloudflare-one/integrations/identity-providers/generic-oidc/

## Restart point and required verification

Restart at the authenticated Cloudflare staging stage: apply D1 migrations,
configure OIDC variables, deploy both Workers, and perform same-run API/media
readback. Only then run read-only source
checksum reconciliation and copy-and-verify. Do not delete source objects or
perform production cutover before target and rollback evidence pass.

Rerun the local boundary check before any future integration change:

```bash
node --experimental-strip-types --test scripts/verify-media-reference-boundary.test.ts
npm run test:media-gateway-boundary
npm run test:media-gateway-edge-boundary
npm run test:media-inventory-reconciliation
```
