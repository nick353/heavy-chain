# G619 Real Beta Evidence Packet

Updated: 2026-06-30

## Purpose

G619 is the real-user evidence layer after G611 recorded QA. G611 proves that the product can be operated by scripted beta-like scenarios. G619 must prove that consented beta users or external collaborators can use Heavy Chain in production without the operator hand-holding the flow.

This packet does not replace G617 fresh all-feature generation, H601 legal decisions, or H602 billing/external-publish decisions.

## Hard Stops

Stop before billing, purchase, payment, checkout, identity verification, OTP/CAPTCHA/security prompts, secret entry, external public publishing, broad data deletion, destructive cleanup, or legal-policy finalization.

Allowed:

- consented screen recording with anonymized participant aliases
- production browsing and non-billing UI use
- image upload using assets the participant confirms they may use
- generation readiness checks that stop before irreversible submit when capacity is unavailable
- marker-scoped non-billing generation only when Runway capacity is available and cleanup/readback is planned
- anonymized feedback notes and friction logs

## Required Evidence

The acceptance manifest must use `schema: heavy-chain.g619.real-beta-evidence.v1` and live at:

```text
output/playwright/g619-real-beta-evidence/manifest.json
```

Minimum acceptance:

- at least 3 consented beta sessions
- at least 1 desktop session and 1 mobile session
- at least 5 distinct workflows across the sessions
- required workflows covered at least once: `lightchain_entry`, `generate_readiness`, `upload_material`, `canvas_edit`, `gallery_or_history_reuse`, `jobs_or_failure_recovery`
- every session has a local evidence file: recording, screenshot set, transcript, or observation notes
- every session records hard-stop compliance
- every session has a friction list or an explicit no-friction note
- no email address, phone number, payment card pattern, OTP/security code, access token, API key, secret, or public-publish receipt appears in the manifest or evidence notes

## Template

Create a starter manifest:

```bash
npm run verify:g619-beta-evidence -- --init-template
```

Validate collected evidence:

```bash
npm run verify:g619-beta-evidence
```

The verifier is intentionally strict. Missing real-user evidence is not accepted as a pass. A template-only packet is useful preparation, not G619 completion.

## Evidence Handling

- Use participant aliases such as `beta-001`, not names, emails, handles, or company names.
- Store recordings and notes under `output/playwright/g619-real-beta-evidence/`.
- Notes should describe behavior and friction, not personal identity.
- If a user reaches billing, payment, external publish, OTP, CAPTCHA, or secret-entry screens, stop and record `exactBlocker`.
- If marker-scoped generation is performed, include DB/Storage/readback and cleanup artifacts.

## Completion Boundary

G619 can be marked accepted only when `npm run verify:g619-beta-evidence` exits with `ok=true` against real collected evidence. Until then, G619 remains queued or human-needed.
