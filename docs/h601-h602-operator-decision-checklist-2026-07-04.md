# H601/H602 Operator Decision Checklist

Updated: 2026-07-04

This checklist does not close H601 or H602. It lists the operator decisions and proof still required before public launch, paid checkout, or external publishing.

Use `docs/h601-h602-operator-readback-template-2026-07-04.md` to record the final decisions and redacted proof locators. Do not paste secrets, raw receipts, JWTs, signed payloads, OTP/security codes, payment-card data, or personal identity data.

## H601 Legal / Safety Decisions

- [ ] Final Terms wording is approved.
- [ ] Final Privacy wording is approved.
- [ ] Retention period is approved for projects, generated images, prompts, job metadata, handoff images, logs, and deletion/export behavior.
- [ ] Upload-rights policy is approved: users must have rights, licenses, or permission for uploaded materials.
- [ ] Brand/reference policy is approved: descriptive style categories may be allowed; direct third-party logo, brand imitation, counterfeit-like product, or confusingly similar trade dress remains blocked unless permission is documented.
- [ ] Identifiable-person / model-likeness policy is approved: uploaded identifiable people require permission; celebrity/public-figure likeness remains blocked by default unless permission is documented.
- [ ] Copyright/marketing claims are approved: do not claim AI outputs are automatically copyright-registrable, trademark-clear, exclusive, platform-approved, or fully cleared.
- [ ] Commercial-use wording is approved as caveated: usable in commercial workflows subject to user input rights, third-party rights, provider terms, and applicable law.
- [ ] Counsel/operator review is attached before any public-launch completeness claim.

## H602 Billing / Checkout / External Publish Decisions

- [ ] Confirm Apple product IDs and prices match the approved operator pricing.
- [ ] Confirm Apple sandbox testers are test-only and cannot create real charges.
- [ ] Attach verified no-real-charge proof greater than zero.
- [ ] Attach transaction, receipt/server-notification, app-side entitlement, matching Supabase user row, or usage-event readback proving the sandbox path.
- [ ] Confirm production checkout remains disabled until operator approval.
- [ ] Decide final checkout/public release scope.
- [ ] Decide tax, invoice, support, refund, and customer-facing billing policy.
- [ ] Confirm raw receipts, JWTs, signed payloads, and sensitive payment payloads are not stored; only hashes/status/safe artifact locators are allowed.
- [ ] Attach final H602 production completion readback with no remaining blockers.
- [ ] Stop for Apple ID login, OTP/security prompt, checkout/payment confirmation, real or sandbox purchase, identity verification, or external public publishing. These actions are human/operator-only; Codex must not perform them. Preserve proof only after the operator performs the action outside Codex.

## Current Implemented / Verified Baseline

- H601 product-side guards are implemented and locally verified, but final legal/operator decisions remain open.
- H602 quota enforcement, checkout-disabled state, Apple sandbox tester table, purchase-proof tables, RLS, fail-closed hardening, SHA-256 hash constraints, metadata allowlist, and safe artifact URI constraints are implemented/read back.
- Current H602 completion readback remains `ok=false`.
- Verified no-real-charge proof count is `0`.
- Human attestation exists but is not machine verification.
