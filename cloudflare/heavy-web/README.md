# Latest Web release — 2026-09-26 r92

## Video detail empty-upload source pair — 2026-09-26

同一Companion profileで本家とCloudflare Heavyの`/flow/GenerateShortVideo/detail`を各30秒待機後にreadback。両方が`Lightchain AI`、ready complete、同一の動画ワークステーション空アップロード文言、login marker 0、rights marker 0を返した。Heavyは認証avatar 1のみ追加で表示。証拠は`../../work/lightchain-heavy-video-detail-empty-state-readback-20260926-r1.json`。これはroute stateの直接比較であり、provider generation receipt、実remote save/reuse/reload/reconciliation、full pixel/interaction parity、billing/publish、monitor/UI、G618、H602、scorecard、strict releaseは未完了。

## Video Workstation durable save boundary — 2026-09-26

Cloudflare Worker `heavy-chain-web` version `bf8d83c0-6670-4c74-b37e-46269d35a1f6` now routes Video Workstation Save and Canvas handoff persistence through the durable workspace save contract. When the remote data plane is configured, a missing remote receipt/readback is an explicit failure (`video_workspace_remote_persistence_unverified`); local-only success is not reported. Save/Canvas controls are disabled while the same request is in flight. Typecheck, lint, Vite build, Cloudflare build, R2 upload, Wrangler dry-run/deploy, and focused persistence suites passed. `/_health` returned HTTP 200, and the deployed lazy chunk contains the fail-closed marker. Companion readback after a 30-second settle on `/flow/GenerateShortVideo` showed the video workstation, persisted task cards, avatar `1`, and zero login/password/rights markers. Evidence: `../../work/heavy-chain-video-durable-save-postdeploy-readback-20260926-r1.json`. This proves the deployed persistence boundary and authenticated route rendering only; provider generation receipt, actual remote business save/reuse/reload/reconciliation, full parity, billing/publish, monitor/UI, G618, H602, scorecard, and strict release remain open.

## In-workspace auth-cache recovery after one-login deployment — 2026-09-26

Cloudflare Worker `heavy-chain-web` version `7b5c6422-1493-408a-9d32-683fa2631034` now performs one bounded same-host auth-session refresh for an empty in-workspace cache before failing closed; Dashboard no longer emits a per-action login prompt from that transient state. Web tests `14/14`, Vite/Cloudflare build, R2 asset upload, Wrangler dry-run, and deploy passed; `/_health` returned HTTP 200 with `hosting=cloudflare` and `authProvider=cloudflare`. After a requested 30-second wait, the same Companion profile/task-owned Heavy `/designProduction` tab read back `Lightchain AI`, ready complete, visible, avatar `1`, controls `48`, and login/password/rights markers `0`. Evidence: `../../work/heavy-chain-auth-cache-recovery-postdeploy-readback-20260926-r1.json`. This release proves bounded one-login continuity and in-workspace auth-cache recovery only; provider generation, durable persistence/reuse/reload/reconciliation, full parity, billing/publish, monitor/UI, G618, H602, scorecard, and strict release gates remain open.

## Persistent login continuity after the requested 30-second wait — 2026-09-26

Cloudflare Worker `heavy-chain-web` version `6503cda5-24ee-4b55-962e-009c00adb665` was verified in the same Companion profile and task-owned tab. After a 30-second wait on `/designProduction`, the authenticated workspace remained visible with `Lightchain AI`, `readyState=complete`, avatar `1`, and zero login/password/rights markers. The same tab then navigated directly to `/board` and `/gallery` without re-authentication; Board showed six visible card columns, and Gallery settled to `ギャラリー 13枚の画像` with visible cards and no active motion opacity. Evidence: `../../work/heavy-chain-auth-continuity-postdeploy-readback-20260926-r1.json`. Auth admission `8/8`, bootstrap hydration `7/7`, session recovery `3/3`, hydration readback `4/4`, and lint passed. Source tab `1980930659` was preserved and the owned Heavy tab was closed during cleanup. The Gallery wait's final action was not dispatched after Companion authority expiry and was not replayed. This is session continuity evidence only; provider generation, durable persistence/reuse/reload/reconciliation, full pixel/interaction parity, billing, publish, monitor/UI, G618, H602, scorecard, and strict clean release remain open.

## Board six-column source parity and no-fade post-deploy readback — 2026-09-26

Cloudflare Worker `heavy-chain-web` version `6503cda5-24ee-4b55-962e-009c00adb665` now serves the source-shaped `/board` six-column compact document rail. The Light-route shell renders route content directly instead of using the source-absent initial opacity fade; this prevents a hidden-tab resume from leaving the body visually transparent while controls remain in the DOM. Same Companion profile/task-owned tab was navigated after deploy, held for 30 seconds, and read back with `Lightchain AI`, `readyState=complete`, 6 card columns, 24px ellipsis menu controls, avatar 1, login/rights markers 0, and a visible screenshot body. Evidence: `../../work/lightchain-board-postdeploy-visual-readback-20260926-r1.json`. Health HTTP 200; UI boundary 21/21, Board parity 8/8, typecheck, Vite/Cloudflare build, R2 asset upload, Wrangler dry-run, and Web tests 14/14 pass. Owned tabs were closed and the lease released; prior retained tab `1980930659` was not touched. Provider generation, durable persistence/reuse/reload/reconciliation, billing, publish, monitor/UI, G618, H602, scorecard, and strict clean release remain open.

Requested 30-second auth-continuity readback completed on the same Companion profile and Heavy task-owned tab. After navigating `/board` to `/flow/GenerateShortVideo`, waiting 30 seconds, and reading the same tab again, both routes remained `Lightchain AI`/`readyState=complete` with the authenticated avatar, zero login/password/rights markers, and no `/login` redirect. Evidence: `../../work/lightchain-heavy-auth-persistence-current-20250925-r1.json`. Auth admission 8/8, bootstrap hydration 7/7, hydration readback 4/4, typecheck, and diff-check passed. This is browser session persistence evidence only; provider generation, durable save/reuse/reload/reconciliation, billing, publish, monitor/UI, G618, H602, scorecard, and strict clean release remain open.

The paired `/board` observation intentionally preserves an account-state/DOM difference: source had 17 controls with no avatar, while authenticated Heavy had 42 controls including avatar and card/menu buttons. The difference remains visible to parity comparison.

The route comparator now reads the recorded `heavyReadback`/`heavyCapture` aliases used by video-detail evidence. The current canonical seven-route semantic run is `work/lightchain-heavy-route-readback-current-20250925-r4.json` (`equal=0`, `different=2`, `pending_confirmation=5`, `errors=0`); this is comparison coverage only and does not claim provider or release completion. A same-logical-session 30-second source/Heavy video-dashboard readback is additionally recorded at `work/lightchain-heavy-video-route-current-20250925-r3.json`; it confirms matching title/ready/control topology and no login/rights UI, while preserving Heavy's three task-local video cards as a data-state difference. The source-board/video geometry contract is also green at `7/7` using the measured `h-60`/`flex flex-wrap` shape.

Auth continuity contract recheck after the requested 30-second wait: local session admission `8/8`, bootstrap hydration `7/7`, hydration readback `4/4`, and route comparator `6/6` passed. The production evidence remains the same source/Heavy same-tab readback in `../../work/heavy-chain-auth-continuity-postdeploy-readback-20250925-r1.json`; no provider, billing, publish, secret, or external action was executed. Full parity and the five strict release blockers remain open.

認証済みの同一Companion tabでCloudflare本番`/designProduction`を30秒待機後に確認し、そのまま`/gallery`へ遷移してさらに30秒待機。両routeとも`Lightchain AI`、通常のワークスペース本文、login marker 0、rights marker 0を維持し、画面遷移中の再ログインを再現しなかった。Evidence `../../work/heavy-chain-auth-continuity-postdeploy-readback-20250925-r1.json`。Heavy tabはtask-owned cleanupで閉鎖済み。provider生成、durable save/reuse/reload/reconciliation、PNG/interaction full parity、monitor/UI、G618、H602、real-generation scorecard、strict releaseは未完了。

`design-production-page`の外側paddingをLight Chain実測に合わせて`px-6`へ更新し、Cloudflare Worker version `885879af-d3d5-4337-93d1-4339d7bf2915`へ反映。Web tests 14/14、Cloudflare build、R2 asset upload、Wrangler dry-run、deployをPASS。`/_health`はHTTP 200（`hosting=cloudflare`、`authProvider=cloudflare`）。同一Companion profileでCloudflare `/designProduction`を30秒settle後にfresh readbackし、title=`Lightchain AI`、ready complete、control 48、avatar 1、login marker 0、rights checkbox 0、tabpanel `x=22,width=665`、CTA `y=399`・`228/228/204/168×32`を確認。証跡`../../work/heavy-chain-cloudflare-design-production-postdeploy-readback-20250925-r1.json`。cleanupはowned tab close、lease release、unknown effect/foreign mutation/external action 0。provider生成、durable save/reuse/reload/reconciliation、native PNG pixel、monitor/UI、G618、H602、real-generation scorecard、strict releaseは未完了。

認証hydration修正をCloudflare Webへ反映。公開画面が遅いhost-only Cookie/session読取りを資格情報フォームへ収束させず、同じセッションのhydration境界で待機する。旧`authWaitExpired`/`PUBLIC_AUTH_STALL_TIMEOUT_MS`は配信bundleに存在せず、再接続時もログイン状態を保持する。本番Workers version `0b8b8af8-c804-420e-99c0-37785b4e17ed`（100%）で`/_health` HTTP 200。

同一Companion task-owned session/tabを使い、Cloudflare `/designProduction` と `/gallery`をそれぞれ30秒待機後にsemantic＋visual readback。両routeとも`Lightchain AI`、readyState=`complete`、login marker/form 0、rights marker 0、avatar 1。session close、task tab close、lease release、foreign mutation、unknown effectは完了/0。証跡`../../work/heavy-chain-auth-hydration-cloudflare-deploy-readback-20250925-r1.json`。Zeaburの同一認証修正deployment `6ab6516f10778e353136ad64`もRUNNING/health 200を確認済み。provider実生成、upload、save/readback/reconciliation、payment、publish、secret投入は未実行。full pixel/interaction parityとstrict release-gate 5 blockerは継続。

# Latest Web release — 2026-09-25 r79

Fresh release gate（`2026-09-25T07:21:53.645Z`）は`ok:false`で、production monitor/UI、G618、H602 billing、generation scorecard、dirty releaseの5 blockerが継続。
証跡の正本ファイルは`../../work/heavy-chain-fashion-studio-card-auth-continuity-deploy-readback-20260925-r1.json`。

Fashion Studio `/flow/integration` の保存カードを本家実測へ再同期。閉じたカードは`overflow-hidden`、メニュー表示時だけ`overflow-visible`、新規カードも本家と同じ`div`/`group relative h-60 w-55 cursor-pointer overflow-hidden rounded-2xl`。Cloudflare version `e9ac1051-5923-445a-9922-dddbbb71e92d`、Zeabur deployment `6ab61e9de92e928954ad08c8`（docker/RUNNING、`/_health` 200）へ反映。30秒settle後の両環境でcard 30件、220×240、article 0、nested project button 0、login/rights 0、avatar 1、credit badge 1をsemantic＋visual readback。detail routeは遷移後30秒＋reload後30秒も`Lightchain AI`、avatar 1、login 0、rights 0、upload dropzone visible。local parity 6/6、typecheck/lint/build pass。証跡`../../work/heavy-chain-fashion-studio-card-auth-continuity-deploy-readback-20250925-r1.json`。provider生成、upload、save/readback/reconciliation、payment、publish、secret投入は未実行。full pixel/interaction parityとstrict release-gate 5 blockerは継続。

# Latest Web release — 2026-09-25 r78

Fashion Studio `/flow/integration` のカードDOMを本家形状へ揃え、保存カードの`article`＋内側`button`をクリック可能な`div`へ変更。新規カードも`group relative h-60 w-55 cursor-pointer overflow-hidden rounded-2xl`へ統一。Cloudflare Web version `d43cd3d6-ab2a-4eb5-821b-120931c0c416`、Zeabur deployment `6ab61a4a10778e353136a911`（docker/RUNNING、health 200）へ反映し、両環境を30秒settle後にsemantic/visual readback。saved card 30件、nested project button 0、article 0、login/rights marker 0、credit badge 1。detail routeも両環境で30秒待機しavatar 1、login 0、rights 0、upload dropzone visibleを確認。証跡`../../work/heavy-chain-fashion-studio-card-auth-continuity-deploy-readback-20250925-r1.json`。provider生成、upload、save、payment、publish、secret投入は未実行。full pixel/interaction parity、provider persistence/reconciliation、strict release-gate evidence remain open.

# Latest Web release — 2026-09-25 r77

現行作業ツリーの動画詳細geometry修正をZeabur `heavy-chain`へ再deploy。deployment `6ab615385d7569a2d1c7201b`はRUNNING、finishedAt `2026-09-25T06:37:57.570Z`、health HTTP 200。配信asset `index.Vt01RFr4.js`/`index.BK1YKy2d.css`に`h-[534.28px]`、`w-[768px]`、`top-1/2`、`-translate-y-1/2`、mobile width 768pxを確認。30秒settle後のZeabur動画詳細readbackはtitle=`Lightchain AI`、ready、avatar 1、login marker 0、rights marker 0、responsive upload rect `x=16,y=76.86328125,width=677,height=534.2734375`。証跡`../../work/heavy-chain-source-heavy-video-detail-zeabur-deploy-readback-20260925-r2.json`。Cloudflare version `24d4fc8a-087c-4c16-8311-3bf29b6b7080`もhealth 200。provider生成、upload、save、payment、publish、secret投入は未実行。full pixel/interaction parity、provider persistence/reconciliation、strict release-gate evidence remain open.

# Latest Web release — 2026-09-25 r76

Video Workstation detailの空アップロード領域をLight Chain本家の実測geometryへ合わせた。sourceのwide viewportは`x=328,y=76.859375,width=768,height=534.28125`、Heavyは`top-1/2`/`-translate-y-1/2`と`h-[534.28px] w-[768px] max-w-[calc(100vw-32px)]`を採用し、responsive viewportのreadbackは`x=16,y=77.86328125,width=677,height=534.2734375`。Cloudflare Web version `24d4fc8a-087c-4c16-8311-3bf29b6b7080`、health HTTP 200。動画関連combined suite 19/19、typecheck、lint、Cloudflare build、R2 upload、Wrangler dry-run pass。Zeabur deployment `6ab6104fe92e928954ad05cb`はBUILDING継続で、旧health 200のためZeabur完了は未主張。証跡`../../work/heavy-chain-source-heavy-video-detail-geometry-deploy-readback-20260925-r1.json`。provider生成、upload、save、payment、publish、secret投入は未実行。full pixel/interaction parity、provider persistence/reconciliation、strict release-gate evidence remain open.

# Latest Web release — 2026-09-25 r75

Video Workstation detail rails were aligned to the Light Chain source: the Heavy-only remote video project icon was removed from both the empty upload rail and the populated editor rail. The source and Heavy detail route were read back after a 30-second settle in one Companion profile; both showed the same `動画ワークステーション` text rail, upload empty state, `Lightchain AI` title, and no rights UI. Focused video suite 33/33, typecheck, lint, production/Cloudflare build, asset upload, and Wrangler dry-run passed. Cloudflare version `d0ede199-e4ba-4061-973b-84e7fe0fcdc5` is deployed and was freshly reloaded/read back. Zeabur deployment `6ab6104fe92e928954ad05cb` was still `BUILDING` at capture; its prior health endpoint returned HTTP 200, so Zeabur release completion is not claimed. Evidence: `../../work/heavy-chain-source-heavy-video-detail-parity-deploy-readback-20260925-r1.json`. Provider generation, upload, save, payment, publish, and secret insertion were not performed; full pixel/interaction parity and strict release-gate evidence remain open.

## Latest Web release — 2026-09-25 r74

Fashion Studio overviewへ認証済みusage由来の`残りクレジット`バッジを追加し、本家/Heavyを同一Companion profileで30秒待機後にpaired visual/semantic readback。source credit `375311`、Heavy credit `15`（アカウントデータ差）だが、同位置のsource-shaped badgeを確認。Heavyはtitle=`Lightchain AI`、ready、login marker 0、rights marker 0。本家/Heavyのsource/Heavyタブはclose済み。Focused suite 56/56、Web tests 14/14、typecheck、lint、production/Cloudflare build、Wrangler dry-runがpass。Cloudflare version `8f95225d-5545-4a70-9cb4-7ce6dbdca89c`、Zeabur deployment `6ab60a61e92e928954ad04a4`（Docker/RUNNING、`/_health` 200）。証跡は`../../work/heavy-chain-source-heavy-integration-credit-badge-deploy-readback-20260925-r1.json`。provider生成、upload、save、payment、publish、secret投入は未実行。full pixel/interaction parity、production monitor/UI、G618、H602 billing、real scorecard、strict clean releaseは未完了。

## Latest Web release — 2026-09-25 r73

認証サービス停止時のprotected chromeでも公開ヘッダーを描画しないよう、Layoutの保護条件へ`authServiceUnavailable`を追加した。auth admission 7/7、typecheck、lint、production buildがpass。Cloudflare Web version `7b80ad54-cdf1-47e5-8b98-cdf22cc438e9`をdeployし、health HTTP 200、匿名protected routeの307、fresh assetの再接続境界を確認。Zeabur同一ソースのdeployment `6ab6058ee92e928954ad03a5`も`docker`/`RUNNING`、`/_health` HTTP 200、配信Layout chunkに保護条件を確認。provider生成、upload、save、payment、publishは未実行。

## Latest Web release — 2026-09-25 r72

auth serviceの一時的な5xx/transport failureをanonymous扱いせず、protected routeを現在位置のままSPAへ渡して再接続UIを表示するtri-state境界を追加した。valid sessionのshell admissionと匿名時の307 login redirectは維持し、Light Chainにない権利確認UIは追加していない。

Web tests 14/14、production/Cloudflare build、R2 upload、Wrangler dry-runがpass。Cloudflare Web version `369375fc-3d45-425a-8d19-10b2d8949eaf`を`heavy-chain-web.nichika2000823.workers.dev`へdeployし、health HTTP 200と配信JSの`authServiceUnavailable`/`認証サービスに再接続しています`を確認した。Zeabur同一ソースのdeployment `6ab601be5d7569a2d1c71ee9`も`docker`/`RUNNING`、`https://heavy-chain.zeabur.app/_health` HTTP 200。provider生成、upload、save、payment、publishは未実行。詳細は`../../work/heavy-chain-auth-service-transient-route-boundary-deploy-20260925-r1.json`。

## Latest Web release — 2026-09-25 r71

認証の毎画面ログイン収束を修正した。valid sessionのreadback直後にprotected shellを開き、
profile/brand hydrationは非同期継続する。認証猶予とrequest timeoutは30秒で、通常の遅延では
ログインリンクへ収束しない。Consumer Authのsession Cookieには`Path=/`を明示した。

Cloudflare Web version `e0fa3ad8-83a8-463b-9ca4-b76acd47b4c9`、Consumer Auth version
`e8b72a35-0e02-4787-a8be-d4019cb1c831`をdeploy。Web/Auth healthはHTTP 200、未認証の
`/asset-center`はloginへ307 redirect。認証focused 26/26、Consumer Auth 15/15、Web 12/12、
typecheck、lint、build、R2 upload、Wrangler dry-runがpass。

公式Companionの同一task-owned tabで`/asset-center`を待機後にreadbackし、`マイライブラリー`、
8 library groups、`画像／動画`、`お気に入り`、`一括操作`、実データカードを確認した。tab/lease/
session cleanupは成功し、foreign変更・retained・unknown effectは0件。provider生成、upload、
save、payment、publishは未実行。詳細は
`../../work/heavy-chain-auth-persistence-deploy-readback-20260925-r1.md`。

Zeaburの同一ソースdeployはdeployment `6ab5552ee92e928954ace661`（`docker` / `RUNNING`）で反映し、
`https://heavy-chain.zeabur.app/_health` はHTTP 200。Cloudflareでは同じCompanion session・同じtabで
`/asset-center`、`/gallery`、`/history`を連続readbackし、ログインへ戻らず本体を表示した。

# Heavy Chain Cloudflare web hosting

## Latest Web release — 2026-09-25 r70

The canonical `/asset-center` source contract now covers the eight library groups,
`画像／動画`, `お気に入り`, `一括操作`, and the expandable `ライブラリー検索`
control. The isolated full verifier passed 31/31 desktop and mobile features,
video 4 routes, source 7 routes, failed 0, and complete cleanup.

Cloudflare Web tests 12/12, production build, R2 upload, Wrangler dry-run, and
deployment passed. Version `ace0a71c-cc6a-4b48-87f6-80afedb7be29` is deployed at
100% to `heavy-chain-web.nichika2000823.workers.dev`. Fresh public `/_health`
returned HTTP 200; unauthenticated `/asset-center` and `/board` returned the
expected login redirect. A fresh authenticated Chrome tab waited 30 seconds and
read back the production `/asset-center` visually and semantically, including the
library groups, filters, bulk action, search expansion, cards, and zero rights
checkboxes. No provider generation, upload, save, payment, or publish was done.

## Latest Web release — 2026-09-25 r69

The source-readback acceptance ledger now covers the canonical `/board` list and
`/board/edit` editor in addition to the four existing Lightchain source routes.
The isolated full verifier passed 31/31 desktop and mobile features, video 4
routes, source 6 routes, failed 0, and complete cleanup. This is local semantic
source-contract evidence; it does not replace the pending authenticated
Cloudflare Board readback.

## Latest Web release — 2026-09-25 r68

Version `828826d5-f196-4b90-b31b-ad525cd94476` is deployed at 100% to
`heavy-chain-web.nichika2000823.workers.dev`. The Lightchain account-menu
design-document route now points to the canonical `/board` list and
`/board/edit` editor. The Board list, title, zoom, local save/reopen flow, and
source-shaped header are deployed without adding the Light-only rights
checkbox/modal/badge.

Cloudflare Web tests 12/12, production build, R2 upload, Wrangler dry-run, and
deployment passed. The final fresh browser tab reached the protected login
boundary; authenticated Cloudflare Board readback still requires the user's
session to be re-established in that tab. No provider generation, payment, or
publish was performed.

## Latest Web release — 2026-09-24 r67

Version `41a90fb9-2daa-4935-b80b-1eb1974ff0a2` is deployed at 100% to
`heavy-chain-web.nichika2000823.workers.dev`. The video source editor now has
local save, Canvas handoff, Gallery reuse, and reload persistence for the
source-shaped video flow. Production readback confirmed the save/reuse path in
one authenticated Heavy Companion tab. Video generation remains fail-closed
until the video provider is admitted; the Light-only rights checkbox remains
absent.

Web tests 12/12, production build, R2 asset upload, Wrangler dry-run, public
health/protected-route readback, and the Companion save/reuse readback passed.
This release still does not claim Light-source paired visual equality or a
provider receipt/remote video output.

## Latest Web release — 2026-09-22 r66

Version `9dcbd73e-c0e5-49a3-addd-ab40d3e0a190` is deployed at 100% to
`heavy-chain-web.nichika2000823.workers.dev`. The Agent workbench now uses the
current Light Chain hero imagery for all four business tabs and matches the
source reference-case rail layout and imagery. The Light-only rights checkbox
remains absent.

The fresh local all-feature verifier passed 31/31 features, desktop/mobile,
video/source routes, 404 assertions, zero console/page/request failures, and
cleanup. Production build, R2 upload, Wrangler dry-run, deployment, and
authenticated Companion readback passed. Full provider/save/reuse/
reconciliation and strict production release-gate evidence remain separate
gates.

## Latest Web release — 2026-09-21 r65

Version `cb5553df-ca3a-4f3b-892d-a14668bb3905` is deployed at 100% to
`heavy-chain-web.nichika2000823.workers.dev`. The Lightchain homepage launcher
now matches the freshly observed source card title `インサイト意思決定ワークベンチ`
and the source route order for all four categories; the Light-only rights
checkbox/modal/badge remains absent.

The change passed the focused launcher suite 17/17, typecheck, diff-check, and
the isolated full verifier (31/31 non-video features on desktop/mobile,
canonical video/source routes, zero console/page/request failures, cleanup
complete). Production build, R2 upload, Wrangler dry-run, and deployment
passed. Fresh public readback returned HTTP 200 for `/_health`, `/lightchain`,
and `/model`. Authenticated visual equality and provider/persistence receipts
remain separate gates.

## Latest Web release — 2026-09-21 r64

Version `8eded371-db03-408a-889c-01417b2d950c` is deployed at 100% to
`heavy-chain-web.nichika2000823.workers.dev`. Fresh public readback returned
HTTP 200 for `/_health`, `/lightchain`, and `/model`; the health payload reports
`service=heavy-chain-web`, `hosting=cloudflare`, and `authProvider=cloudflare`.

The release path passed web tests 11/11, production build, R2 asset upload,
Wrangler dry-run, and deployment. The isolated local full verifier also passed
31/31 non-video features on desktop/mobile, the canonical video and source
routes, 404/redirect coverage, 404 interaction assertions, and cleanup with
zero console/page/request failures. Production UI/navigation verifiers were
then invoked and correctly stopped before navigation at
`explicit_auth_state_required`; no credential or auth state was exported or
used, and no provider generation or other external action was started.

This is a public deployment and local-contract readback, not authenticated
Lightchain pixel equality or provider/save/reuse/reconciliation evidence.

## Latest local parity evidence — 2026-09-21 r63

The fresh isolated all-feature runner passed with 31/31 non-video features on
desktop and mobile, both canonical video dashboard/detail routes on desktop
and mobile, and source-contract parity for `/designProduction`, `/creator`,
`/tools/fabric`, and `/model`. It reported failed `0`, console/page/request
failures `0`, and complete browser/context/preview cleanup. Evidence:
`output/playwright/lightchain-all-feature-workflows-20260921T072859Z-kTODFc/SUMMARY.json`.

This is local contract evidence only. The current authenticated Lightchain
pixel baseline and real provider receipt/save/reuse/reconciliation remain
required before production parity can be claimed.

## Latest Web release — 2026-09-21 r62

Version `1432521e-a0d6-4b8a-b539-b9f9a1bcbead` is deployed at 100% to
`heavy-chain-web.nichika2000823.workers.dev`. The Lightchain parity workbench
now derives its provider admission flag from the observed source entitlement:
model-matrix and fabric generation remain denied, and the unobserved printing
generation route is fail-closed. This keeps the Light source's
`権限がありません` surface without adding a Heavy-only rights checkbox,
modal, or badge.

Typecheck, lint, provider coverage 22/22, permission parity 8/8, material
contract 28/28, fitting lifecycle 10/10, route coverage 28/28, production
build, asset upload, Wrangler dry-run, deployment, and fresh public readback
passed. Public `/_health` returned HTTP 200 and `/lightchain` returned HTTP
200. The official protected source was not authenticated in the task-owned
tab, so this release does not claim provider generation or private artifact
reconciliation.

## Latest Web release — 2026-09-21 r61

Version `c4f3f8fe-a3fb-49d9-91b6-67807f5991dc` is deployed at 100% to
`heavy-chain-web.nichika2000823.workers.dev`. The official authenticated
Lightchain `/model` flow keeps `生成履歴` in the same workbench and opens it
as a right-pane view; Heavy now matches that interaction with a button and an
in-place history panel instead of navigating to `/model#fitting-history`.
The panel preserves the source empty-state copy and 14-day retention text,
while fitting-compatible saved results remain reusable when present.

The official source `/gallery`, `/history`, `/jobs`, and `/canvas` paths were
also checked and return 404; Heavy's global routes remain explicit
Heavy-owned continuation surfaces, not claims that those source URLs exist.
Provider-contract tests passed 22/22, route tests 28/28, and typecheck, lint,
build, R2 asset preparation, Wrangler dry-run, and deployment passed. No
provider submit or permission-gate bypass was performed.

## Latest production readback — 2026-09-21 r60

Production API configuration was checked without exposing secret values. The
image provider is configured as OpenAI and the production secret names include
`OPENAI_API_KEY` and `MEDIA_READ_SECRET`. The official Lightchain AI-fitting
route and Heavy's route were each waited for 30 seconds; both showed the same
`権限がありません` action and no Light-absent rights checkbox or modal. No
permission gate was bypassed and no provider request was submitted.

An existing Heavy AI-fitting result was followed through the source-shaped
save flow into Canvas. Canvas save changed to `サーバー確認済み`, and the
exact persisted Canvas URL was reloaded until the same image layer returned
with `サーバー確認済み` again. Gallery, History, and Jobs were then read
back in the same session: Gallery showed 15 account images, History showed
`保存済み 0件`, and Jobs showed queue `0`. This proves the Canvas
save/reload path and route continuity, but not provider generation or
cross-surface artifact reconciliation. The remaining Goal and six external
release-gate evidence items stay open.

## Latest Web release — 2026-09-21 r59

Version `88055441-c1a5-4c06-9673-be9644eb23c3` is deployed at 100% to
`heavy-chain-web.nichika2000823.workers.dev`. This release aligns the public
Lightchain root with the official source header and launcher: the shared
124x24 SVG header logo, the 318x48 launcher wordmark, and the 48px source
top padding. The Light-only rights checkbox and modal remain absent.

The source and Heavy roots were each read back after a 30-second wait in the
same authenticated Chrome profile. Heavy returned the source title, header
controls, launcher search, category tabs, and feature cards; typecheck, lint,
production build, R2 asset preparation, and deployment passed. This is root
visual-contract evidence only; provider execution, durable save/reuse,
reconciliation, billing, publish, and private-media completion remain open.

## Latest Web release — 2026-09-21 r58

Version `3515ec9d-4042-4469-a95f-c257f15fcb0a` is deployed at 100% to
`heavy-chain-web.nichika2000823.workers.dev`. This release aligns the
authenticated `/flow/GenerateShortVideo/detail` editor with the official
Lightchain source: source-sized image layers and rounded corners, the compact
reference panel, the asset button and icon, and the exact bottom-toolbar
geometry. It keeps the source labels, reference controls, disabled
`権限がありません 6` action, and no Light-absent rights checkbox or modal.

The source and Heavy detail pages were each read back after a 30-second wait
in the same authenticated Chrome profile. The final Heavy geometry matched
the source at the measured positions; typecheck, lint, diff check, build, R2
asset preparation, Wrangler dry-run, and the video provider boundary test
passed. The source project identifier and Heavy fixture identifier differ by
account, so this release claims UI contract parity, not fixture identity. No
provider generation, render, save, payment, publish, or private-media
completion is claimed.

## Latest Web release — 2026-09-21 r57

Version `64bdc7a3-9f6d-4320-b34f-8133ebf617f5` is deployed at 100% to
`heavy-chain-web.nichika2000823.workers.dev`. This release aligns the
authenticated `/marketing` home with the current official Lightchain source:
the source upload placeholder and dark tutorial, six scene recommendations,
fixed 220px project cards, source-shaped PROJECT new-file artwork, source empty-state artwork, and the top-right
remaining-credit badge. Project cards read remote generated-image rows with
signed URLs, keep a local fallback, and expose pin/library-save/delete menus.
The Light-only rights checkbox and modal remain absent.

The marketing parity contract passed 1/1 and the Lightchain route suite passed
28/28; typecheck, diff check, Cloudflare build, R2 asset preparation, and
Wrangler dry-run passed. Fresh public readback returned HTTP 200 for
`/_health`, `/lightchain`, and `/marketing`; the served parity chunk contains
the source artwork references, 220px cards, credit badge, project menus, and
no `権利確認` marker. A fresh authenticated Chrome readback waited 30 seconds,
showed the aligned project row and prompt surface, and opened/closed one
project menu with the expected three actions. Account-specific project images
and credit values are not treated as static source fixtures. No provider,
payment, publish, or private-media completion is claimed.

## Prior Web release — 2026-09-21 r56

Version `9399b16b-51dd-487f-b9ce-b454d8013bd3` is deployed at 100% to
`heavy-chain-web.nichika2000823.workers.dev`. This release aligns the
authenticated `/designProduction` surface with the current official Lightchain
source: five creation cards, the plain dashed `新規ファイル` card, the source
T-shirt icon, source spacing, single source-style action buttons, and a live
remaining-credit badge from the Heavy usage endpoint. The source and Heavy
pages were each read back after a 30-second wait in the same Chrome viewport;
the Heavy row matched the source layout and there is no rights-confirmation
checkbox or modal.

Focused route tests passed 28/28 and the design-production contract passed
2/2; typecheck, lint, build, R2 asset preparation, and Wrangler dry-run passed.
Fresh public readback returned HTTP 200 for `/_health`, `/lightchain`, and
`/designProduction`; the served parity chunk contains the five-card layout,
dashed first card, credit badge, and no `権利確認` marker. The live credit
number is account-specific and is not treated as a static source fixture. No
provider, payment, publish, or private-media completion is claimed.

## Prior Web release — 2026-09-21 r55

Version `091ac99e-2dcc-4dc1-acaf-2095297b14e8` is deployed at 100% to
`heavy-chain-web.nichika2000823.workers.dev`. This release adds the official
Lightchain `/flow/laboratory/detail` route with the source empty-canvas state:
`Lightchain Lab`, `Untitled`, the dotted workspace background, and the
20MB image dropzone. Route parity passed 28/28 and entry-routing passed 26/26;
typecheck, lint, build, R2 asset preparation, and Wrangler dry-run passed.
Fresh public readback returned Web `/_health` HTTP 200,
`/lightchain` HTTP 200, and `/flow/laboratory/detail` HTTP 200; the served
detail chunk contains the source copy and no rights checkbox. No provider,
payment, publish, or private-media completion is claimed.

## Latest Web release — 2026-09-21 r54

Version `45464b67-f097-4c1d-bdcb-5a28a0c979ff` is deployed at 100% to
`heavy-chain-web.nichika2000823.workers.dev`. This release adds the official
Lightchain `/login-m` route to the shared authentication surface and keeps the
public layout classification aligned with it. Route parity tests passed 27/27
and entry-routing tests passed 25/25; typecheck, lint, Cloudflare build, R2
asset preparation, and Wrangler dry-run passed. Fresh public readback returned
Web `/_health` HTTP 200 and `/lightchain` HTTP 200, and the served main/Layout
bundles contained `login-m` plus the color-change detail route. No credential,
provider, payment, publish, or private-media completion is claimed.

## Latest Web release — 2026-09-21 r53

Version `817850ef-8b37-482b-9e59-0a1b4466f17d` is deployed at 100% to
`heavy-chain-web.nichika2000823.workers.dev`. This release adds the official
Lightchain `/editor/changeColor/detail` route and keeps it on the existing
color-change surface. Route parity tests passed 26/26 and entry-routing tests
passed 24/24; typecheck, lint, Cloudflare build, R2 asset preparation, and
Wrangler dry-run also passed. Fresh public readback returned Web `/_health`
HTTP 200 and `/lightchain` HTTP 200, and the served main/feature bundles
contained `editor/changeColor/detail` and the `colorize` route feature. No
provider, payment, publish, or private-media completion is claimed.

## Latest Web release — 2026-09-21 r52

Version `77edd2cb-8464-4127-83af-dcf8008f0b20` is deployed at 100% to
`heavy-chain-web.nichika2000823.workers.dev`. This release aligns the
Lightchain launcher/workbench video entry with the current official source:
the video workstation is visible in the launcher and the catalog records the
official task family `GenerateShortVideoV2`, `StoryboardVideoV2`,
`CustomizedStoryboardVideo`, `ReplicationVideo`, `StoryboardImage`, and
`EditingVideo`. The deeper video detail/provider path remains fail-closed until
an authenticated production provider receipt and readback exist; no video
generation request was submitted. Web Worker tests passed 8/8, the Cloudflare
build and Wrangler dry-run passed, and fresh public readback returned Web
`/_health` HTTP 200 and `/lightchain` HTTP 200. The served catalog and
workbench bundles contain the expected video identifiers. No authenticated UI
readback, provider generation, payment, publish, or private-media completion is
claimed by this release.

## Latest Companion route readback — 2026-09-20 r51

Fresh task-owned Companion read-only coverage reached 10/10 Cloudflare Web
routes with failed=0 and cleanup complete. Temporary protected-route tabs
remained in the workspace-preparation shell, so this proves route reachability
and cleanup only; it does not prove stable authenticated business state,
provider generation, private-media persistence, reconciliation, or release
acceptance. No auth cookie, token, or storage state was exported.

## Latest readback — 2026-09-20 r50

Fresh Web `/_health` and Heavy API `/v1/health` readbacks returned HTTP 200.
The authenticated video detail flow accepted the Heavy-owned `fitting-v1.png`
input while keeping `動画生成（provider未接続）` disabled; no provider request
was submitted. The API's unauthenticated readbacks remained fail-closed with
401/400 responses. This does not prove provider generation, private-media
business completion, reconciliation, or release acceptance. Zeabur's
environment-variable/deploy permission boundary remains separately open.

## Latest Web release — 2026-09-20 r49

Version `603551a8-c9b6-4df8-92b9-d299ed33463f` is deployed at 100% to
`heavy-chain-web.nichika2000823.workers.dev` from the current tracked Heavy
parity build. Web tests passed 8/8, the Cloudflare build and Wrangler dry-run
passed, two existing large R2 app assets were uploaded/readied, and 104 changed
static assets were deployed. Fresh public readback returned health 200 and
`/lightchain` HTTP 200. Served `assets/index.DnyV_Ymg.js` matched the local
build byte-for-byte: 716759 bytes, SHA-256
`b5c37151bd6b42325dfdc7bc22969f70ed62c3fcec195a0c059c35870fe7dcbb`.

After a real 30-second authenticated same-tab wait, `/lightchain` showed the
canonical Lightchain launcher, category tabs, and feature cards. The DOM
readback reported one header, zero checkbox controls, and zero rights-related
text. This proves the production UI deployment/readback only; authenticated
provider generation/result/save/reuse, reconciliation, operations evidence,
and strict release acceptance remain open.

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
