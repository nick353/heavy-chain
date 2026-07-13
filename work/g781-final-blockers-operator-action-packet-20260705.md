# G781 Remaining Blockers Operator Action Packet

Date: 2026-07-05
Status: public/10M readiness is not accepted.

## Current Clean Baseline

- Latest clean release gate: `output/playwright/g780-release-gate-post-g779-clean-r1`
- Latest 10M audit: `output/playwright/g780-10m-completion-post-g779-current-r1/summary.json`
- G619 readiness: `output/playwright/g780-g619-beta-readiness-current-r1/summary.json`
- H601 readiness: `output/playwright/g780-h601-operator-readiness-current-r1/summary.json`
- H602 readiness: `output/playwright/g780-h602-operator-readiness-current-r1/summary.json`

## Exact Remaining Work

1. G618/G620: wait until after `2026-07-07T17:38Z`, preferably after `2026-07-07T18:28Z`, then rerun the scale/security readbacks and release/10M gates.
2. G619: collect three real beta sessions for `g619-beta-004`, `g619-beta-005`, and `g619-beta-006`; each needs consent, duration >= 5 minutes, friction/no-friction note, redaction pass, usable behavior evidence, and non-placeholder notes.
3. H601: provide final human/operator decisions for Terms, Privacy, retention/deletion/export, upload rights, brand/reference, person/likeness, copyright/marketing claims, commercial-use wording, counsel/operator review, and safe summary fields.
4. H602: provide verified no-real-charge proof, transaction/entitlement readback, and safe final checkout/public-release decision JSON.
5. G617/G669/G670: strict same-run all-10 generation proof is still open. It requires an approved generation-submit path, quota/workspace capacity, and operator approval before it can be rerun.

## Safe Commands After Inputs Exist

- `npm run verify:g619-beta-readiness`
- `npm run verify:g619-beta-evidence`
- `npm run verify:h601-operator-readiness -- --operator-decision <safe-json> --strict`
- `npm run verify:h602-operator-readiness -- --operator-decision <safe-json> --strict`
- `npm run verify:release-gate -- --out output/playwright/<new-release-gate>`
- `npm run verify:10m-completion -- --out output/playwright/<new-10m-audit>`

## Hard Stops

Do not automatically perform billing, checkout, payment, purchase, Apple login, credentials, identity verification, OTP/CAPTCHA/security prompt, secret entry, external publishing, destructive cleanup, quota bypass, deploy, or generation submit.

## Next Safe Step

Wait for operator-provided G619/H601/H602 evidence and the G618/G620 readback window. Until then, keep public/10M readiness unaccepted and use this packet plus G780 proofs as the handoff surface.
