# G750 Current Blockers Handoff 2026-07-04

Status: public/10M readiness is still not accepted.

Latest pushed commit:
- `65e62d0` records G619 next collection blockers after G749.

G750 update:
- G619 docs/verifier are current, but existing `g619-beta-001` through `g619-beta-003` are pre-G742 scaffolds and should not be reused by simple rerun.
- Next G619 collection must create new aliases with current `npm run create:g619-beta-session`.
- Collect real consent, useful duration, H601/H602 checklist linkage, hard-stop readback, redaction review, friction/no-friction notes, and behavior evidence.

Current G619 proof:
- `output/playwright/g742-g619-beta-evidence-current-hard-stop-linkage-r1/summary.json` remains `ok=false` with 30 blockers.

Still blocked:
- Production monitor, G618/G620 readbacks, H602 no-real-charge and transaction/entitlement proof, H601 final human/legal decision, G617 strict same-run all-10, G619 real beta evidence, G669/G670 unless replaced by accepted G617/replacement goal.

Next safe timing:
- 24h monitor rerun useful after `2026-07-04T17:38Z`; prefer after `2026-07-04T18:28Z`.
- G618/G620 96h rerun useful after `2026-07-07T17:38Z`; prefer after `2026-07-07T18:28Z`.

Do not perform:
- billing, checkout, payment, purchase
- Apple login, credential/secret entry, CAPTCHA/OTP/security prompt, identity verification
- external public publishing
- destructive cleanup, quota bypass, deploy
- generation submit unless explicitly approved for a verification run
