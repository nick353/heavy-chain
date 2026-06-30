# Heavy Chain Unified Release Gate Runbook

Updated: 2026-06-26

## Purpose

`npm run verify:release-gate` is the pre-release gate that combines the current production monitor, launch operations proof, recorded mass-market QA, retention workspace search proof, garment Canvas proof, onboarding/template proof, performance baseline, security audit, H601 legal-safety production readback, H602 billing completion readback, operations-doc consistency, generation scorecard, typecheck, lint, build, and syntax checks into one pass/fail artifact.

This gate is read-only. It does not submit generation, deploy, publish externally, purchase, bill, enter secrets, or clean production data.

## Command

```bash
npm run verify:release-gate -- --out output/playwright/10m-product-readiness-g615/release-gate-summary.json
```

During active development only:

```bash
npm run verify:release-gate -- --allow-dirty --out output/playwright/10m-product-readiness-g615/release-gate-summary.json
```

`--allow-dirty` is not release approval. It is only for debugging while a Goal Loop slice is still editing tracked files, and it must exit as a failed/non-acceptance proof.

`--skip-commands` is only for debugging readback parsing. It must exit as a failed/non-acceptance proof and cannot be used for release readiness.

The default readback artifact freshness window is 48 hours, and each artifact must carry an embedded timestamp such as `capturedAt`, `measuredAt`, or `captured_at`. File mtime is not accepted as release evidence. Override the window only for deliberate historical audits:

```bash
npm run verify:release-gate -- --max-artifact-age-hours 72 --out output/playwright/10m-product-readiness-g615/release-gate-summary.json
```

## Pass Contract

The JSON summary must have:

- `ok=true`
- `failed=[]`
- `allowDirty=false`
- production monitor `ok=true`, zero blockers, `uiOk=true`, and no skipped UI probe
- launch-ops `ok=true` and `failed=[]`
- latest matching G611 mass-market QA summary `ok=true`, `failed=[]`, `contextClosed=true`, `browserClosed=true`
- latest matching G610 retention summary plus G603, G605, G606, G608 readbacks passing
- production H601 rights readback passing
- production H602 billing completion readback passing, including hardening/hash-only migrations applied, verified no-real-charge proof greater than zero, transaction/entitlement readback true, raw receipt/payload storage blocked, and no remaining blockers
- readback artifacts fresh within the configured freshness window
- command gates passing: security audit, generation scorecard, G614 operations docs, typecheck, production build, lint, syntax checks, and `git diff --check`

## Stop Conditions

Stop before billing, payment, checkout, purchase, identity verification, OTP/CAPTCHA/security prompt, secret entry, external public publishing, destructive cleanup outside marker-scoped test artifacts, or new paid monitoring/vendor setup.

## Failure Recovery

Use the first failing item in `failed[]`.

- `readback:*`: refresh or repair the named proof artifact before release.
- `readback:production H602 billing completion readback`: attach real transaction/receipt-hash/entitlement proof, keep raw receipt/payload data out of storage, update production readback, and rerun the gate.
- stale readback freshness: rerun the named proof or deliberately rerun with a larger `--max-artifact-age-hours` for historical audit only.
- `command:security audit`: remove leaked secret-like values or unsafe persisted image URLs.
- `command:generation scorecard`: repair missing image/readback pairing or visual quality evidence.
- `command:typecheck` / `command:lint`: fix the first compiler/lint error, then rerun.
- `blocker:git_dirty`: commit or intentionally park tracked changes, then rerun without `--allow-dirty`.
- `blocker:allow_dirty_not_release_acceptance`: commit or intentionally park tracked changes, then rerun without `--allow-dirty`.
- `blocker:commands_skipped_not_release_acceptance`: rerun without `--skip-commands`.

## Relationship To Existing Tools

`release:doctor` remains a narrower legacy safety doctor. `verify:release-gate` is the 10M-readiness release gate for this Goal Loop because it also binds together production monitor, launch operations, latest mass-market recorded QA, retention search proof, Canvas/deep workflow proof, onboarding proof, performance, security, operations docs, and generation quality.
