# Heavy Chain current operator / connection inputs — 2026-09-27 r2

このpacketは、capacityまたはowner-provisioned inputが戻ったときに再開順を誤らないためのread-only handoffである。秘密値、cookie、OTP、法的承認、決済、provider submitを保存・推測・代行しない。

## Fresh baseline

- Captured: `2026-09-27T15:38:11+09:00`
- Branch: `heavy-chain/checkpoint-20260926`
- Worktree: clean after commit `9961a42`
- Goal: `active` after user resume; the core Astra package remains blocked by the same Adaptive capacity/hold condition
- Adaptive runtime: Graph/live process available, but `capacity_guard=capacity_blocked`, `live_capacity_observable=false`, active routes empty
- Heavy package: `heavy-cross-surface-astra-engineering` = `waiting_human`, `automatic_dispatch=false`, `claim_id=null`, `start_receipt=null`
- Heavy-related capacity-recovery Graph fork: none

## Fresh local evidence

- `npm run verify:goal-readiness:incomplete-ok`: 5/5 local Cloudflare runtime/static checks pass; production generation, AI quality, R2 durability, and browser business completion are explicitly outside scope.
- `npm run verify:h602-billing`: local Cloudflare contract passes with `productionProof.status=not_verified` and `releaseApproval=false`; no provider, billing, checkout, deployment, or external write.
- Latest release gate: `ok=false`; remaining failures are production monitor/UI pair, G618 scale ops baseline, production H602 completion readback, and real-generation visual scorecard.
- Current production mass-market QA and Lightchain all-feature order previews pass in the latest release gate; the 10M audit still references older G668/G659 artifact paths and must not be treated as a replacement for current provenance.

## Required owner-provisioned inputs

1. **Monitor/G618**: short-lived `HEAVY_CHAIN_MONITOR_API_URL`, `HEAVY_CHAIN_MONITOR_BRAND_ID`, and `HEAVY_CHAIN_MONITOR_TOKEN` through the approved process environment. Never extract browser cookies or reuse old auth caches.
2. **Production UI pair**: matching non-local Playwright `auth-state.json` through the approved owner path, then GET-only monitor readback before the 96-hour G618 baseline.
3. **Runway/G617**: official Runway app connection or an actually exposed approved tool. Then a new runId, no prior assets, provider receipt, storage/readback, scorecard, reconciliation, and cleanup.
4. **H601**: human/operator or counsel decisions and safe locators for terms/privacy, retention/deletion/export, upload rights, brand/reference, likeness, copyright/marketing, commercial use, and final review.
5. **H602**: approved live read path and operator decision for quota enforcement, checkout-disabled state, verified no-real-charge proof, transaction/entitlement readback, live constraints, and final checkout/public-release decision.

## Re-entry order

`fresh Adaptive status → existing Astra package claim/start if capacity permits → monitor/auth GET-only readback → G618 baseline → H601 decision → one provider run → private save/reuse/reload/reconciliation → H602 live readback/operator decision → scorecard → strict gate`

Until the inputs and receipts above exist, do not mark health, queued state, local tests, UI success, or a plan as business completion. No external effect occurred while preparing this packet.
