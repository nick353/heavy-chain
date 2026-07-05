# G619 Real Beta Evidence Packet

Updated: 2026-06-30

## Purpose

G619 is the real-user evidence layer after G611 recorded QA. G611 proves that the product can be operated by scripted beta-like scenarios. G619 must prove that consented beta users or external collaborators can use Heavy Chain in production without the operator hand-holding the flow.

This packet does not replace G617 fresh all-feature generation, H601 legal decisions, or H602 billing/external-publish decisions. Use `docs/h601-h602-operator-decision-checklist-2026-07-04.md` as the separate operator checklist for those still-open H601/H602 decisions; collecting G619 beta evidence does not close that checklist.

## Hard Stops

Stop before billing, purchase, payment, checkout, identity verification, OTP/CAPTCHA/security prompts, secret entry, external public publishing, broad data deletion, destructive cleanup, or legal-policy finalization.

If a beta session reaches Apple login, OTP/security prompt, checkout/payment confirmation, real or sandbox purchase, identity verification, or external public publishing, stop immediately. Those actions are human/operator-only; Codex and beta-session operators must not perform them as part of G619 evidence collection.

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
- every session records `h601H602DecisionStatus: open_not_closed_by_g619` and links `docs/h601-h602-operator-decision-checklist-2026-07-04.md`
- every session records operator-only hard stops for Apple login, real/sandbox purchase, checkout confirmation, and legal-policy finalization as `not_touched`
- every session has a friction list or an explicit no-friction note
- no email address, phone number, payment card pattern, OTP/security code, access token, API key, secret, or public-publish receipt appears in the manifest or evidence notes

## Template

Create a starter manifest:

```bash
npm run verify:g619-beta-evidence -- --init-template
```

This writes an `ok=false` starter packet and exits non-zero by design. It is preparation, not acceptance.

Create a consent-safe session scaffold after scheduling a real beta session:

```bash
npm run create:g619-beta-session -- --session-id g619-beta-001 --alias beta-001 --platform desktop --persona apparel-ec-operator --workflows lightchain_entry,generate_readiness,upload_material
```

The scaffold writes session-local `session-instructions.md`, `operator-checklist.md`, `consent.json`, `notes.md`, `redaction-review.json`, and `readback.json` files under `output/playwright/g619-real-beta-evidence/sessions/<alias>/`, appends the session to the manifest, and stores artifact `sha256` values. It also records the H601/H602 decision boundary and operator-only hard stops that G619 must not cross. It does not make G619 pass by itself: real consent, real session duration, and at least one behavior evidence artifact such as `recording`, `screenshot(s)`, `transcript`, `observation`, or `observation_notes` are required. Redaction review must cover every non-redaction artifact, including the participant instructions and operator checklist, and match their manifest hashes.

Check the short collection readiness summary during or before evidence collection:

```bash
npm run verify:g619-beta-readiness
```

This readiness command is not acceptance proof. It writes `readiness-summary.json`, keeps `acceptance: not_claimed`, and only summarizes missing consent, duration, friction/no-friction notes, redaction review, placeholder notes, and behavior evidence per session. Use `--strict` only when a non-zero exit is useful for automation.

Validate collected evidence:

```bash
npm run verify:g619-beta-evidence
```

The verifier is intentionally strict. Missing real-user evidence is not accepted as a pass. A template-only packet is useful preparation, not G619 completion.

## Evidence Handling

- Use participant aliases such as `beta-001`, not names, emails, handles, or company names.
- Store recordings and notes under `output/playwright/g619-real-beta-evidence/`.
- Give each participant the generated `session-instructions.md`; use `operator-checklist.md` during and after the session so coaching, hard stops, redaction, and artifact review are consistent.
- Notes should describe behavior and friction, not personal identity.
- If a user reaches billing, payment, external publish, OTP, CAPTCHA, or secret-entry screens, stop and record `exactBlocker`.
- If a user reaches Apple login, real/sandbox purchase, checkout confirmation, legal-policy finalization, identity verification, or external publishing, stop and record `exactBlocker`; do not try to complete the action as part of G619.
- If marker-scoped generation is performed, include DB/Storage/readback and cleanup artifacts.

## Completion Boundary

G619 can be marked accepted only when `npm run verify:g619-beta-evidence` exits with `ok=true` against real collected evidence. Until then, G619 remains queued or human-needed.
