# Human Needed

Open human-needed items exist. They do not block non-billing, non-public QA work, but they do block calling the product public-launch complete.

Human approval is required for billing, purchase, payment, checkout, identity verification, OTP/CAPTCHA/security prompt, secrets, external public publishing, paid external services, legal/commercial-use policy decisions, or any production action outside marker-scoped non-billing QA.

## Open Items

| Item | Blocks | Summary | Status |
|---|---|---|---|
| H601 | legal/policy implementation before public launch | Product-side conservative guard is implemented and verified: upload-rights confirmation before generation, brand/logo/person-likeness prompt blocking, shared server-side guard across generation Edge Functions, Terms/Privacy/Legal caveats, and release-gate command wiring. Recommended default: keep conservative upload-rights confirmation, limited retention/deletion wording, no copyright/trademark/platform-clearance guarantee, and strict brand/likeness guardrails. Needed from operator: final Terms/Privacy wording, retention period, brand-reference policy, identifiable-person policy, and copyright/marketing claims. | open |
| H602 | billing/external publish | Billing quota enforcement/tester-exemption groundwork is implemented and applied to production. Apple readback confirms Developer Program agreement accepted, Paid Apps Agreement active for `2026-06-30 - 2026-10-19`, app version `1.0` is `配信準備完了`, monthly/yearly subscriptions approved at Japan prices `￥980.00` and `￥4,400.00`, and one Japan sandbox tester exists. Production readback confirms migration `20260630102537` applied, quota enforcement enabled, checkout disabled, RLS enabled, and the sandbox tester registered. Migration `20260630130507` adds a purchase-proof readback layer and registers the operator's completed-purchase report as `human_attested`; migration `20260630132500` hardens it so the summary RPC is brand-scoped only, raw receipt-like metadata is rejected, and `verified` requires machine proof sources; migration `20260630134000` constrains proof fields to SHA-256 hashes or short entitlement identifiers and blocks bare receipt/payload metadata keys; migration `20260630135000` allowlists metadata keys and constrains artifact URIs to short relative proof locators. Verified no-real-charge proof count is still `0` because no transaction ID, receipt/server notification, app-side entitlement, matching Supabase user row, or usage event proves no-real-charge yet. Still human/operator gated: sandbox transaction/entitlement readback, tax/refund/support decisions, final checkout/public release decision, and external publishing. | open |

## Now Needed

1. H601 legal/policy finalization:
   - Recommended default: keep conservative upload-rights confirmation, limited retention/deletion wording, no copyright/trademark/platform-clearance guarantee, and strict brand/likeness blocking.
   - Operator decision needed: final Terms wording, final Privacy wording, retention period, third-party brand/reference policy, identifiable-person/likeness policy, and allowed copyright/marketing claims.
   - Use `docs/h601-h602-operator-readback-template-2026-07-04.md` to attach final decision locators and remaining-blocker readback without secrets or personal data.
   - Blocks: public-launch completeness and final policy copy. Local product/source guard verification currently passes, but this does not finalize operator legal policy.

2. H602 billing/external publish:
   - Implemented locally: quota enforcement readiness, Apple sandbox/tester no-real-charge account table, usage-event bypass metadata, quota UI copy, and `npm run verify:h602-billing`.
   - Apple readback done 2026-06-30: Developer Program agreement accepted; Paid Apps Agreement active for `2026-06-30 - 2026-10-19`; app version `1.0` remains `配信準備完了`; monthly subscription `com.nichika.muscle.premium.month` is approved at Japan price `￥980.00`; yearly subscription `com.nichika.muscle.premium.oneyear` is approved at Japan price `￥4,400.00`; one Japan sandbox tester exists. Proof: `output/playwright/h602-apple-appstore-readback-20260630/summary.json`.
   - Production billing readback done 2026-06-30: migration `20260630102537` applied, quota enforcement enabled, checkout disabled, billing tables RLS enabled, and the Apple sandbox tester registered in `billing_test_accounts`. Proof: `output/playwright/h602-production-billing-readback-20260630/summary.json`.
   - Purchase-proof readback layer done 2026-06-30: migration `20260630130507` applied, `billing_purchase_proofs`/summary RPC exist, and the operator's completed-purchase report is registered as `human_attested`. Hardening migration `20260630132500` is also applied: summary readback is brand-scoped only, raw receipt-like metadata is blocked, and `verified` requires machine proof sources. Hash-only migration `20260630134000` is also applied: hash fields must be SHA-256 hex, entitlement ids must be short identifiers, and bare receipt/payload metadata keys are blocked. Artifact/metadata allowlist migration `20260630135000` is also applied: metadata keys are allowlisted and artifact URIs must be short relative proof locators. Proof: `output/playwright/h602-production-billing-readback-20260630/purchase-proof-db-readback.json`, `output/playwright/h602-production-billing-readback-20260630/purchase-proof-hardening-readback.json`, `output/playwright/h602-production-billing-readback-20260630/purchase-proof-hash-only-readback.json`, and `output/playwright/h602-production-billing-readback-20260630/purchase-proof-artifact-allowlist-readback.json`.
   - Sandbox purchase attempt 2026-06-30: operator reported purchase flow completed, but App Store Connect did not expose transaction history in the sandbox tester detail and production DB has no matching `users` row or usage event for that sandbox tester; verified no-real-charge proof count remains `0`. Human-attestation artifact: `output/playwright/h602-production-billing-readback-20260630/sandbox-purchase-human-attestation.json`.
   - Operator action needed: attach transaction/receipt/entitlement proof or sign into the app with the sandbox tester so Supabase can read back a matching user/entitlement path, then decide tax/invoice/refund/support/public sharing scope.
   - Use `docs/h601-h602-operator-readback-template-2026-07-04.md` to attach only safe proof locators or hashes; never paste raw receipts, JWTs, signed payloads, OTP/security codes, payment-card data, or identity data.
   - Blocks: paid launch, checkout/payment confirmation, external publish features, public launch completeness.

3. G619 real beta evidence:
   - Recommended default: collect consented beta sessions without personal data, public posting, purchases, payment, checkout, or destructive actions.
   - Human action needed: recruit or provide at least three consenting testers or session recordings/notes that meet the packet requirements. For each session, use the current `npm run create:g619-beta-session` scaffold, give the participant the generated `session-instructions.md`, follow `operator-checklist.md`, then attach anonymized behavior evidence, real duration, consent, friction/no-friction notes, redaction review, and sha256-covered artifacts.
   - Each session must preserve the H601/H602 boundary with `h601H602DecisionStatus: open_not_closed_by_g619`, link `docs/h601-h602-operator-decision-checklist-2026-07-04.md`, and keep Apple login, real/sandbox purchase, checkout confirmation, and legal-policy finalization as `not_touched`.
   - Blocks: `npm run verify:g619-beta-evidence` passing and full 10M completion.

4. G617 Runway availability:
   - Recommended default: wait until the connected approved Runway workspace can sustain Heavy Chain image generation, then rerun with at most two concurrent generations through the existing Codex-approved Runway MCP client.
   - Human/external action needed if workspace limits persist: resolve Runway workspace/model capacity outside Codex, or provide an approved workspace/client that can complete image tasks.
   - Blocks: same-run all-10 fresh generation, visual scorecard, strict 10M audit.
