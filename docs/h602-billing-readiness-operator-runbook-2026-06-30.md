# H602 Billing Readiness Operator Runbook

Status: partial implementation complete; Apple/App Store Connect readback partially complete; Apple/operator actions still required.

## What Is Implemented

- Generation quota enforcement is restored through `private.reserve_brand_usage`.
- `public.billing_settings` records that billing is operator-managed and that the migration does not configure Apple ID credentials or checkout.
- `public.billing_test_accounts` marks Apple sandbox testers / internal QA accounts that may exercise purchase-like flows without real charges.
- Usage events record `generation_quota_enforced`, `billing_test_account_quota_bypass`, and `apple_sandbox_tester_no_real_charge`.
- `/credits` and dashboard usage cards no longer claim "no billing gate" or "unlimited"; they show remaining quota and monthly quota.

## Tester Setup

Use Apple sandbox/tester accounts only for purchase-flow verification. Those testers should also be registered in `public.billing_test_accounts` by `user_id` or lowercase `email`. Brand-wide quota bypass is intentionally not used for H602 tester proof.

Example service-role SQL after the test user exists:

```sql
insert into public.billing_test_accounts (email, provider, reason, metadata)
values (
  lower('tester@example.com'),
  'apple_sandbox',
  'Apple sandbox tester: purchase flow should not create real charges',
  '{"operator_confirmed_apple_sandbox": true}'::jsonb
)
on conflict (email) where email is not null and is_active
do update set
  provider = excluded.provider,
  reason = excluded.reason,
  metadata = public.billing_test_accounts.metadata || excluded.metadata,
  updated_at = now();
```

## Human-Only Apple Actions

These steps require the operator in Apple/App Store/Apple ID surfaces:

- Confirm the paid product/pricing matches the previously approved amount.
- Confirm sandbox testers are configured as test-only and do not create real charges.
- Confirm production checkout is connected to the intended account before enabling any public paid path.
- Preserve readback proof: Apple product IDs/prices, sandbox tester identity, test transaction result, and no-real-charge evidence.

## 2026-06-30 Apple Readback

Read-only App Store Connect / Developer Account proof is saved at `output/playwright/h602-apple-appstore-readback-20260630/summary.json`.

Confirmed:

- Developer Account no longer shows the Apple Developer Program License Agreement blocker; the license agreement shows effective date `2026-06-18` and agreement date `2026-06-30`.
- App Store Connect app `6754215885` (`マイプロ - AI食事管理と筋トレ記録`) still shows iOS version `1.0` as `配信準備完了`, with no agreement blocker visible on the app version page.
- App Store Connect Business no longer shows the Paid Apps Agreement new-version banner; Paid Apps Agreement is `有効` for `2026-06-30 - 2026-10-19`.
- Subscription group `Myprotein Subscribe` (`21830664`) has two approved subscriptions: `com.nichika.muscle.premium.month` at Japan price `￥980.00`, and `com.nichika.muscle.premium.oneyear` at Japan price `￥4,400.00`.
- One Apple sandbox tester is configured for Japan; the tester identity is intentionally redacted from the proof artifact.
- Production Supabase migration `20260630102537_enable_billing_enforcement_test_exemptions.sql` is applied to `heavy-chain-production`, and readback confirms quota enforcement enabled, checkout disabled, RLS enabled, and the Apple sandbox tester registered in `billing_test_accounts`. Proof: `output/playwright/h602-production-billing-readback-20260630/summary.json`.
- The operator reported that the sandbox purchase flow was completed after Codex stopped before the purchase/checkout confirmation boundary. This is recorded as human attestation, not as transaction proof, at `output/playwright/h602-production-billing-readback-20260630/sandbox-purchase-human-attestation.json`.
- Production Supabase migration `20260630130507_h602_purchase_proof_readback.sql` is applied. It adds `billing_purchase_proofs` and `get_billing_purchase_proof_summary` so future Apple transaction/receipt/entitlement evidence can be recorded as redacted hashes/status. The current human attestation is registered as `human_attested`; it cannot satisfy verified no-real-charge proof. Readback: `output/playwright/h602-production-billing-readback-20260630/purchase-proof-db-readback.json`.
- Production Supabase migration `20260630132500_h602_purchase_proof_fail_closed_hardening.sql` is applied. It makes purchase-proof summary readback brand-scoped only, rejects raw receipt-like metadata keys/values, renames the legacy false `raw_receipt_stored` metadata key to `sensitive_payload_stored`, and requires machine proof sources for `verified`. Readback: `output/playwright/h602-production-billing-readback-20260630/purchase-proof-hardening-readback.json`.
- Production Supabase migration `20260630134000_h602_purchase_proof_hash_only_constraints.sql` is applied. It constrains `transaction_id_hash`, `original_transaction_id_hash`, and `receipt_hash` to SHA-256 hex strings only, constrains `entitlement_id` to a short identifier, and blocks bare `receipt` / `payload` metadata keys. Readback: `output/playwright/h602-production-billing-readback-20260630/purchase-proof-hash-only-readback.json`.
- Production Supabase migration `20260630135000_h602_purchase_proof_artifact_metadata_allowlist.sql` is applied. It allowlists purchase-proof metadata keys and constrains `artifact_uri` to short relative proof locators, so raw receipts/JWTs/signed payloads cannot be hidden in neutral metadata keys or artifact fields. Readback: `output/playwright/h602-production-billing-readback-20260630/purchase-proof-artifact-allowlist-readback.json`.

Still open:

- No Apple sandbox transaction ID, StoreKit receipt/server notification, or app-side premium entitlement readback has been captured.
- The sandbox tester email is registered in `billing_test_accounts`, but no matching Supabase `users` row exists yet, so `get_brand_usage_summary` cannot yet prove `apple_sandbox_tester_no_real_charge=true` for that user.

## Stop Conditions

Do not proceed automatically through Apple ID login, credential entry, OTP/security prompts, checkout confirmation, real purchase, payment, tax/invoice setup, refund policy acceptance, or external public publishing.

## Verification

Run:

```bash
npm run verify:h602-billing
npm run verify:h602-production-completion-readback
```

`npm run verify:h602-billing` passing proves the readiness layer and fail-closed incomplete boundary only. H602 can be closed only after production H602 readback is `ok=true`, verified no-real-charge proof is greater than zero, transaction/entitlement readback is true, and human Apple/operator proof is attached to `STATE.md`, `GOAL.md`, and `goals/HUMAN_NEEDED.md`.

`npm run verify:h602-production-completion-readback` refreshes `output/playwright/g759-h602-production-completion-current-r1/summary.json` from the existing production readback and is expected to exit 1 while H602 remains incomplete. That failing artifact is the current fail-closed proof until verified no-real-charge and transaction/entitlement evidence are captured.
