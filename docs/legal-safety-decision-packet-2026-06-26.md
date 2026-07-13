# Heavy Chain Legal And Safety Decision Packet

Updated: 2026-06-26

This packet is not legal advice. It is the operator decision packet for G609: what Heavy Chain should enforce in-product now, what must remain a human/operator decision, and which source documents should be reviewed before public launch or paid usage.

## Source Review

Reviewed current public source pages on 2026-06-26:

| Source | Why it matters | Product implication |
|---|---|---|
| Runway Terms of Use, `https://runwayml.com/terms-of-use` | Upstream generation provider terms and prohibited content/input boundaries. | Heavy Chain must keep user responsibility and prohibited-content guardrails visible before generation and in Terms. |
| Runway commercial-use help, `https://help.runwayml.com/hc/en-us/articles/21668707517587-Can-I-use-the-content-I-made-in-Runway-for-commercial-purposes` | Runway describes commercial use and ownership posture between user and Runway. | Heavy Chain can present generated outputs as commercially usable only with rights/third-party caveats. |
| Runway Privacy Policy, `https://runwayml.com/privacy-policy` | Provider data retention and privacy posture. | Heavy Chain must disclose that generation may involve upstream AI providers and set its own retention/deletion policy. |
| U.S. Copyright Office AI page and registration guidance, `https://www.copyright.gov/ai/` and `https://www.federalregister.gov/documents/2023/03/16/2023-05321/copyright-registration-guidance-works-containing-material-generated-by-artificial-intelligence` | U.S. copyright treatment for works containing AI-generated material. | Avoid promising copyright ownership/registrability of purely AI-generated output; require human contribution disclosure where relevant. |
| Japan Agency for Cultural Affairs copyright/AI overview, `https://www.bunka.go.jp/english/policy/copyright/` | Japan-facing AI/copyright guidance overview. | Japanese users need the same copyright caveat and rights-to-input warning. |
| Canva AI Product Terms, `https://www.canva.com/policies/ai-product-terms/` | Useful adjacent SaaS pattern for user input/output responsibility. | Heavy Chain should mirror the pattern: users must have rights to uploaded inputs and are responsible for outputs they publish. |

## Recommended Default Policy

Adopt this policy before public launch:

1. Users must only upload materials they own, licensed, or have permission to use. This includes garment photos, model images, logos, brand marks, artwork, and reference images.
2. Heavy Chain must not promise that generated outputs are copyright-protectable, trademark-clear, platform-policy-safe, or exclusive. The product can say outputs are generated for commercial design workflows, subject to user rights, upstream terms, and local law.
3. Public publishing, paid checkout, storefront submission, and external ad posting require an explicit final review step. The app may prepare assets, but should stop before irreversible publication/payment.
4. Brand mimicry should be blocked at the prompt/UX layer when a user asks for a living brand, designer, logo, celebrity/person likeness, or confusingly similar trade dress without permission.
5. User-uploaded image retention should be intentionally limited. Recommended default: store generation handoff images only as long as needed to complete the job, remove marker/test handoffs during cleanup, and expose a user deletion path for retained project assets.

## Product Guardrails To Implement Or Keep

| Area | Required guardrail | Current status | Next owner |
|---|---|---|---|
| Upload rights | Add Terms/UX copy: "I have rights or permission to use uploaded materials." | decision required before public launch | H601/operator |
| Brand/logo imitation | Block prompts requesting exact third-party logos, counterfeit-looking products, or "same as [brand]" output. | backlog unless already covered by prompt safety | G615 or safety follow-up |
| Person/model consent | Require permission for uploaded identifiable people and model likeness references. | decision required | H601/operator |
| Copyright caveat | Do not guarantee copyright registration or exclusivity for AI-only outputs. | packet recommendation | H601/operator |
| Commercial-use wording | Phrase as "usable in commercial workflows subject to your rights and applicable terms," not "fully cleared." | packet recommendation | H601/operator |
| Privacy/retention | Publish what is retained: projects, generated images, prompts, job metadata, handoff images, logs. | partial technical behavior exists; policy text needed | H601/operator |
| Deletion/export | User deletion/export path for project assets before broad launch. | likely G610/G615 scope | G610/G615 |
| External publishing | Continue stopping before external publish unless user explicitly approves that workflow. | already boundary in GOAL | keep |
| Billing/payment | Continue excluding checkout/payment from this loop. | already boundary in GOAL | keep |

## User-Facing Copy Recommendation

Use this short copy in Terms, onboarding, and pre-generation confirmation:

```text
By uploading materials or generating assets, you confirm that you have the rights, licenses, or permissions needed to use your inputs. Generated outputs may be used in commercial design workflows subject to your input rights, third-party rights, provider terms, and applicable law. Heavy Chain does not guarantee copyright registration, trademark clearance, exclusivity, or platform approval for generated assets. Review assets before publishing, selling, or advertising them.
```

For brand/likeness blocking:

```text
We cannot generate assets that copy a third-party logo, protected brand identity, celebrity/person likeness, or another creator's distinctive work unless you confirm you have permission.
```

## Human Decisions Still Required

H601 remains open. The operator should decide:

| Decision | Recommendation | Why it stays human-owned |
|---|---|---|
| Final Terms/Privacy wording | Use counsel-reviewed Terms before public launch. | Legal text depends on business entity, target markets, and data handling commitments. |
| Retention period | Start conservative: temporary generation handoffs deleted after completion/cleanup; project assets retained until user deletion/account closure. | Retention is a business/privacy commitment. |
| Whether to allow brand references | Allow descriptive style categories; block direct logo/brand imitation unless permission is documented. | Trademark risk tolerance is operator-specific. |
| Whether to allow identifiable people | Require explicit permission and avoid celebrity/public-figure likeness by default. | Consent/personality rights vary by jurisdiction. |
| Copyright claims in marketing | Do not market outputs as automatically copyright-owned or registrable. | AI copyright law and registration treatment remain case-specific. |

## Acceptance For G609

G609 is accepted when this packet exists and is referenced from `GOAL.md`, `plan.md`, `STATE.md`, and `goals/HUMAN_NEEDED.md`. This packet does not close H601. It creates the exact operator decision surface needed before legal/policy implementation or public launch.
