# Human Needed

Open human-needed items exist. They do not block non-billing, non-public QA work, but they do block calling the product public-launch complete.

Human approval is required for billing, purchase, payment, checkout, identity verification, OTP/CAPTCHA/security prompt, secrets, external public publishing, paid external services, legal/commercial-use policy decisions, or any production action outside marker-scoped non-billing QA.

## Open Items

| Item | Blocks | Summary | Status |
|---|---|---|---|
| H601 | legal/policy implementation before public launch | G609 packet `docs/legal-safety-decision-packet-2026-06-26.md` is ready. Recommended default: keep conservative upload-rights confirmation, limited retention/deletion wording, no copyright/trademark/platform-clearance guarantee, and strict brand/likeness guardrails. Needed from operator: final Terms/Privacy wording, retention period, brand-reference policy, identifiable-person policy, and copyright/marketing claims. | open |
| H602 | billing/external publish | Recommended default: keep billing/payment/checkout/external publishing disabled until pricing, terms, refund/support, and public-release responsibility are decided. 課金、支払い、checkout、外部公開は今回のGoal Loopでは実行しない。 | open |
