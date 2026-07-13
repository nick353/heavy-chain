# H601/H602 Operator Readback Template

Updated: 2026-07-04

This template does not close H601 or H602 by itself. Fill it only with operator-approved decisions and redacted proof locators. Do not paste secrets, raw receipts, JWTs, signed payloads, OTP/security codes, payment-card data, or personal identity data.

## H601 Final Decision Readback

- Operator/counsel reviewer:
- Review date:
- Final Terms locator:
- Final Privacy locator:
- Retention/deletion/export decision:
- Upload-rights policy decision:
- Brand/reference policy decision:
- Identifiable person/model-likeness policy decision:
- Copyright/marketing-claims decision:
- Commercial-use wording decision:
- Remaining H601 blocker, if any:
- Final H601 status: `open` or `closed-by-operator`

## H602 Machine Proof Readback

- Apple product/pricing readback locator:
- Sandbox tester readback locator:
- No-real-charge proof locator:
- Proof source type: `transaction_id_hash`, `receipt_or_server_notification_hash`, `app_entitlement_id`, `matching_supabase_user_or_usage_event`, or `other_safe_locator`
- Verified no-real-charge proof count:
- Transaction or entitlement readback: `true` or `false`
- Production checkout enabled: `false` until final operator approval
- Raw receipt/JWT/signed payload stored: `false`
- Sensitive payment payload stored: `false`
- H602 production completion readback locator:
- Remaining H602 blocker, if any:
- Final H602 status: `open` or `closed-by-operator`

## Human-Only Hard Stops

If any of the following are required, Codex stops and the operator performs them outside Codex:

- Apple ID login
- OTP/security prompt
- Checkout/payment confirmation
- Real or sandbox purchase
- Identity verification
- External public publishing

## Acceptance Boundary

- H601 is closed only after final legal/operator decisions are attached and `goals/HUMAN_NEEDED.md` is updated intentionally.
- H602 is closed only after machine proof shows verified no-real-charge count greater than zero, transaction/entitlement readback is true, final checkout/public-release scope is decided, and the production H602 completion readback has no remaining blockers.
- G619 beta evidence does not close H601 or H602.
