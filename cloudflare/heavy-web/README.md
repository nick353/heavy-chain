# Heavy Chain Cloudflare web hosting

## Latest Web release — 2026-09-20

Version `bea34181-9d09-4876-9444-17358cacf0ba` is deployed at 100% to
`heavy-chain-web.nichika2000823.workers.dev`. This release aligns the current
Light Chain video dashboard: `動画ワークステーション`, source snapshot
assets, six recent cards, five reference cards, and visible `修正` labels. The
clone remains free of rights-confirmation checkboxes, modals, and badges.
Cloudflare web tests passed 8/8, build and dry-run passed, and the authenticated
production readback after the preparation shell detached confirmed the source
shape. The first Worker-only deploy left stale static assets; the final deploy
used explicit `--assets cloudflare/heavy-web/.build/site --old-asset-ttl 0` and
uploaded the changed bundle. Evidence:
`../../work/heavy-chain-production-video-dashboard-readback-20260920-r8.md`.

### Previous Web release

Version `2718be53-bf12-41f7-857b-77cbd0c98fd5` was deployed at 100% with the
current Light-aligned model customization surface at `/model-library` and
`/model-library/model-custom-form`. The source-shaped model rail, condition
panel, centered empty state, history link, and disabled `権限がありません`
control are read back after a real 30-second authenticated wait. No rights
checkbox/modal/badge was added. Local all-feature verification passed `31/31`
desktop and mobile; focused parity tests passed `33/33`. No provider, upload,
save, billing, publish, credential, or secret effect occurred. Evidence:
`../../work/heavy-chain-production-model-library-readback-20260920.md`.

### Previous video-detail release

Version `58425e2a-b2d4-4446-9c6e-3a3cab0d66e1` is deployed at 100% from the
current Heavy parity build. The release aligns the initial
`/flow/GenerateShortVideo/detail` flow with Light: guide choices first, then the
`動画ワークステーション` / `Untitled` image dropzone after local guide
dismissal. It also retains the Light-compatible `権限がありません`
fail-closed permission surface with no rights checkbox. Build, R2 asset upload,
dry-run, and deployment completed. After a real 30-second authenticated Chrome
readback, the Heavy video detail surface matched the source controls. No
provider, upload, save, billing, publish, credential, or other external effect
occurred. Evidence: `../../work/heavy-chain-production-video-detail-readback-20260920.md`.

## Web release 2026-09-08 — provider canonicalization

Version `5f41051e-ac7a-477a-87b2-0eaf9dd7d691` is deployed at 100% with the
active GeneratePage provider path canonicalized to Cloudflare `workers_ai`.
Dry-run and deployment bindings read back `AUTH_SERVICE=consumer-auth` and the
existing public-assets bucket. Fresh health is HTTP 200 with Cloudflare auth;
the served main bundle has no Supabase URL/SDK/REST marker or legacy Gemini
runtime-mode marker and contains the canonical `workers_ai` path. 48 small
static assets changed and 71 were reused; content-addressed model assets were
not copied. This is not proof of authenticated generation, AI quality, private
R2 persistence, email/OAuth, device QA, CPU/billing, or whole-traffic-zero.
Evidence: `../../work/heavy-generation-provider-canonicalization-deploy-20260908.md`.

## Web release 2026-09-08

Version `f670ceee-fc62-43eb-9dbd-cdab8f8a3653` is deployed at 100% after fixing the print-design-detail rights-confirmation render path. Web tests8/8, CF build, focused Canvas/provider/workspace-artifact readback and dry-run passed; 48 static assets changed and 71 were reused. Fresh `_health` reports Cloudflare hosting/auth, and the served Workbench chunk contains the dedicated generate button and rights modal with no retired Supabase runtime markers. No real-user AI, private-R2 business, email/OAuth, device, or traffic-zero proof is implied.

## Web release 2026-09-07 08:48JST

Version `905305df-c150-473d-9eec-08c7681941d1` is deployed at 100% with consumer-auth and public-asset bindings unchanged. Web tests8/8, root typecheck/build and Cloudflare-only dry-run passed. 51 static assets uploaded, 68 reused; the two large model assets retained identical manifest SHA/size. Fresh health is200 with `authProvider:cloudflare`; served index and JS contain no retired Supabase runtime markers. No authenticated account, AI provider, email/OAuth, device or full-traffic-zero proof is implied. All eleven migration stages remain active.

## Web release 2026-09-07 06:51JST

Version `61edc449-d9f8-4d33-b762-3e7e519325e3` is deployed at 100% with consumer-auth and public-asset bindings unchanged. The normal Cloudflare build, 36 related tests and dry-run passed. Public environment allowlisting, current image provenance and the root SDK dependency removal are included. 51 static assets uploaded, 68 reused; both large asset contents matched by GET SHA/size, so neither was uploaded again. Served main, Fitting and both Workbench scripts match the built SHA hashes. Health200/session200null and the real Chrome login page/control readback passed; no forms were submitted and the dedicated session/tab were closed. Evidence: `../../work/cloudflare-web-env-release-20260907.json`. The 101-JS narrow retired-runtime-config scan had no matches; this does not establish all runtime communication, authenticated AI, email/OAuth, device or overall migration completion. Earlier release paragraphs below are historical.

## Web release 2026-09-06 23:29JST

Web fe84242c-3403-49b5-9aa6-04d188d1a3a9 created14:27:50.108UTC/deployed14:27:50.572UTC at100%, fresh versions/deployments confirmed. Reused preceding normal CF build and27 passing focused tests/dry-run.51 static assets updated/68 reused; consumer-auth/publicR2 bindings unchanged. Actual public GET matched both unique large assets (wasm26827543bytes/SHA78feeeb3d08f6bcee94d938ed322f69073bb8076b5f9d34697a574ffba8deb48; ONNX44173029bytes/SHA75da6c8d2f8096ec743d071951be73b4a8bc7b3e51d9a6625d63644f90ffeedb). No large R2 upload. Main index.DA3OCaVh.js SHA f79242778595e0f01b0f4b2d9429d64d53a765d52a421372d0ae47bb843ab912, workspaceActivity.Bwuh34S5.js SHA f65a38066aa0728846cc4e2f20c23b9227462747a76a499a18596564b503fcce, auth boundary supabase.BVwcKXm6.js SHA ff14108ddabdca915cdbe2bcd7a37513e45fe03efdbf012117e39a64430f1415 all match served bytes. Old module filename is not an SDK dependency.

Health200/cloudflare and session200/null. Companion task-owned tab1980913130 on current generation showed complete login controls and matching screenshot14:29:01.908UTC; initial loading-only tab1980913127 was automatically closed, not counted as UI success. No login/signup/provider submission; final session close cleans own retained readback tab. This proves public UI only, not authenticated Gallery/Canvas/Jobs/management or full-network-zero. No MyPro, old data/services, settings/permissions or AI invocation in this release. API remains9ce5c95f. All eleven stages remain active.

## Current deployment — 2026-09-06 22:17 JST

Version `b3fcf964-7dd5-4ef0-9c2a-18e81e121d14`100% after final default Cloudflare-only build/typecheck/dry-run. Auth SDK runtime constructor and auth-store legacy DB fallback removed; stale profile responses fenced.49 static assets updated/71 reused, no large R2 upload, consumer-auth/public bindings unchanged. Health200/cloudflare/session200null and served main/auth-boundary SHA match. See ../consumer-auth/RUNTIME_CLEANUP.md for exact tests, hashes and remaining dependency cleanup. No real account/provider/device completion is implied.

## Current deployment — 2026-09-06 22:06 JST

Gallery/print-history candidate built with `VITE_CLOUDFLARE_AUTH_ENABLED=true node cloudflare/heavy-web/build.mjs` (typecheck and Vite exit0), dry-run4.03KiB/gzip1.49 passed. Deployed version `16831a6c-c5c3-456b-a372-f7900c512a5b`, created13:06:26.714UTC/deployed13:06:27.248UTC,100% confirmed by deployments readback. AUTH_SERVICE remains consumer-auth; public assets only. 48 static files updated,72 reused. No large R2 upload: unchanged ONNX HEAD size/strong SHA ETag matched; compressed WASM HEAD lacked size, so actual GET bytes26,827,543/SHA `78feeeb3d08f6bcee94d938ed322f69073bb8076b5f9d34697a574ffba8deb48` were verified.

Fresh health200/cloudflare and session200/null. Served GallerySelector.ZzWCi1Eb.js SHA `da66d14520d08ffda39e236fef758a5facecaf328a7279c9c13900f88da0efed`, LightchainMaterialWorkbenchPage.DLNljMkB.js SHA `42c8efbf51fa5df5706e047c779db516badc2d57526caa7c07c0be31c9404368` match local build. Synthetic browser scope/reload evidence is in ../heavy-api/PRINT_PROVIDER_INPUT.md and ../../work/print-history-browser-scope-20260906.json. No new production browser login or authenticated generation occurred. All11 goal stages remain incomplete; previous deployment paragraphs below are history.

## Current deployment — 2026-09-06 20:58 JST

CF-auth candidate19:42:38JST was published without rebuilding. Version `73f5b186-d346-47db-9b2e-e3fa3d1f54ac`, created11:54:57.555UTC/deployed11:54:58.112UTC,100% read back with `AUTH_SERVICE → consumer-auth`, public assets only. Both application APIs had already cut over; see `../consumer-auth/API_CUTOVER.md`.

Dry-run4.03KiB/gzip1.49 passed;53 changed static files uploaded,67 reused. Both unique oversized objects were streamed from the existing public deployment and matched the candidate SHA-256 and size: wasm26,827,543bytes and ONNX44,173,029bytes. No oversized R2 object upload, private media copy or rebuild occurred. Old Supabase project URL was absent from candidate JS search; this narrow search does not prove all runtime traffic/SDK removal.

Fresh health200 reports authProvider=cloudflare; same-origin `/api/auth/get-session` returns200/null without login; reset-password200/no-store/no-referrer. New-generation Companion tab1980913078 showed the rendered login page at11:57:15.895UTC, with email/password/recovery/Google/Apple/register controls; no form was submitted. Earlier semantic query captured loading before the later screenshot, not login-success evidence. Tab/lease auto-closed and session closed with no retained/unknown/foreign effects. Real registration/mail/provider/authenticated workflow and UI branding cleanup remain incomplete.

Companion update coordinator confirmed schema/generation refresh; old leases were not reused. The Sites hosting skill was inspected but not applied because this is the user's existing Cloudflare Worker, not a Sites project. Historical temporary-bridge instructions below are superseded by the CF-auth build command in consumer-auth README.

The frontend is built from the Heavy Chain repository into this package's
ignored `.build/site`, without replacing the existing `dist` deployment.
Files above Cloudflare Static Assets' 25 MiB limit are served at their existing
same-origin URLs by a small Worker. Only allowlisted build `.onnx`/`.wasm`
files are offloaded, into `heavy-chain-public-assets`. Identical content shares
one hash-addressed R2 key. This Worker has **no private user-media binding**.

## Build and deploy

Run from the Heavy Chain repository root. The existing dependencies in
`cloudflare/heavy-api/node_modules` provide Wrangler. The build is now
Cloudflare-only and always binds consumer-auth. No Supabase credentials are
accepted into the bundle; the public environment prefix allowlist excludes retired configuration. Actual local secret files are not rewritten by the build.

```sh
node --test cloudflare/heavy-web/test/web.test.mjs
node cloudflare/heavy-web/build.mjs
node cloudflare/heavy-web/upload-assets.mjs
cloudflare/heavy-api/node_modules/.bin/wrangler deploy --dry-run --config cloudflare/heavy-web/.build/wrangler.json
cloudflare/heavy-api/node_modules/.bin/wrangler deploy --config cloudflare/heavy-web/.build/wrangler.json
```

`build.mjs` fails closed before writing a deployable Wrangler package when a
literal public image/runtime reference is unresolved or when image bytes do
not match the requested extension. This prevents an SPA HTML fallback from
being packaged or served as an image (including a misleading `image/png`
Content-Type). Missing template assets are therefore a release blocker; do
not substitute unrelated assets to make the build pass.

The upload command uploads only the generated manifest's build assets; it does
not copy Supabase data. Keep the generated `.build` intact between upload and
deploy. Uploaded bytes are checked against the build's SHA-256 before upload.
After deployment verify GET/HEAD/Range/content hash on each unique large asset,
SPA routes and a real rendered home/login page. A static health response is not
an authentication, AI, or private-media E2E success.

## Current boundary

- Target URL: `https://heavy-chain-web.nichika2000823.workers.dev`.
- D1/private-media APIs: `https://heavy-chain-api.nichika2000823.workers.dev`.
- This build sets the media provider to `cloudflare_r2` only and supplies the
  Heavy media gateway URL. The API requires `MEDIA_READ_SECRET` as a Worker
  secret. Never put it into `VITE_*` settings.
- Authentication uses consumer-auth. Real email/provider flows, new D1 identities,
  remaining legacy feature-source cleanup, and authenticated AI verification remain unfinished.
- The existing Zeabur service remains available; no billing cancellation,
  destructive cutover, old data import, DNS change or domain purchase is
  performed by these scripts.

## Official references

- [Static Assets limits](https://developers.cloudflare.com/workers/static-assets/billing-and-limitations/)
- [Selective Worker routing](https://developers.cloudflare.com/workers/static-assets/routing/worker-script/)
- [R2 Worker API](https://developers.cloudflare.com/r2/api/workers/workers-api-reference/)
## Current deployment — 2026-09-08

Version `6a5d71be-6bc8-46d1-8074-18d3a6d7af39` is deployed at 100% after aligning public OG/Twitter metadata and Admin feedback origin allowlisting with the canonical Cloudflare Web origin. Local Web Worker tests 8/8, build, and dry-run passed; fresh Web `_health`, HTML metadata, and Heavy API `/v1/health` readbacks passed. No authenticated generation, real AI/provider, email/OAuth, device, or traffic-zero proof is implied.
