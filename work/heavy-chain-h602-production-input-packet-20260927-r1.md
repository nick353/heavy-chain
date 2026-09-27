# H602 production completion / operator restart packet

Captured from `scripts/verify-h602-production-completion-readback.mjs`, `scripts/verify-h602-operator-readiness.mjs`, `docs/h601-h602-operator-decision-checklist-2026-07-04.md`, and `docs/h602-billing-readiness-operator-runbook-2026-06-30.md` at the current Heavy Chain HEAD. This packet contains input names, safe evidence requirements, and commands only; it intentionally contains no Apple ID, OTP, token, receipt, JWT, signed payload, payment, or identity value.

## Current fail-closed state

The current production completion artifact is expected to remain `ok=false` until all H602 proof conditions are met. The existing readback currently reports these blockers:

- `generationQuotaEnforced` is not read back as `true`.
- `productionCheckoutEnabled` is not read back as `false`.
- `verifiedNoRealChargeProofCount` is `0`.
- `transactionOrEntitlementReadback` is `false`.
- No safe final operator checkout/public-release decision is attached.
- Codex has not performed a live production billing/transaction readback.

Do not convert human attestation into machine proof. A human statement that a sandbox purchase was completed is not sufficient until a redacted transaction, receipt/server-notification, app entitlement, matching user row, or usage-event readback is present.

## Required production readback fields

The source passed to the completion verifier must be the current production readback, not a historical or local fixture. It must contain:

- `billingSettings.generationQuotaEnforced: true`.
- `billingSettings.productionCheckoutEnabled: false` until the final operator decision explicitly approves a public paid path.
- All migration and fail-closed hardening flags set to `applied: true`.
- Security readback showing raw receipt/JWT/signed-payload rejection, SHA-256-only hash fields, metadata-key allowlisting, and safe artifact URI constraints.
- `sandboxTester.registered: true` and `sandboxTester.emailRedacted: true`.
- `purchaseProofReadback.verifiedNoRealChargeProofCount > 0`.
- `purchaseProofReadback.transactionOrEntitlementReadback: true`.
- A safe artifact locator or hash-only reference for each proof; never raw purchase payloads.

## Safe operator decision contract

The operator decision JSON may contain only these keys:

```json
{
  "h602OperatorFinalDecisionAttached": true,
  "checkoutPublicReleaseDecision": "approved|deferred|blocked",
  "containsSensitivePaymentOrIdentityData": false,
  "containsRawReceiptJwtOrSignedPayload": false,
  "artifactUri": "optional-safe-relative-locator",
  "operator": "optional-redacted-operator-label",
  "decidedAt": "optional-ISO-8601",
  "notes": "optional-safe-summary"
}
```

`h602OperatorFinalDecisionAttached` must be `true`; `checkoutPublicReleaseDecision` must be one of `approved`, `deferred`, or `blocked`; both sensitive-data flags must be explicit `false`; and no additional keys are allowed. The decision is an operator record, not a substitute for production transaction or entitlement evidence.

## Exact restart commands

Refresh the fail-closed completion artifact from the current production readback:

```bash
npm run verify:h602-production-completion-readback -- --source <current-production-readback>
```

Then run the non-acceptance operator checklist with the same current completion summary and a safe decision file:

```bash
npm run verify:h602-operator-readiness -- \
  --source output/playwright/g774-h602-production-completion-current-r1/summary.json \
  --operator-decision <safe-operator-decision.json> \
  --strict
```

The strict command may pass only when the production readback, no-real-charge proof, transaction/entitlement readback, storage hardening, and safe operator decision all pass. Passing the local H602 contract suite alone does not close H602.

## Human-only hard stops

Codex must stop before and must not perform any of the following:

- Apple ID login, credential entry, or OTP/security prompts.
- Checkout or payment confirmation.
- Real or sandbox purchase execution.
- Identity verification, tax/invoice setup, refund-policy acceptance, or public publishing.

The operator may perform those actions outside Codex, then provide only redacted hashes/statuses and safe artifact locators for readback. No secret insertion, billing mutation, replay after uncertain effect, destructive cleanup, deployment, or publication is authorized by this packet.

