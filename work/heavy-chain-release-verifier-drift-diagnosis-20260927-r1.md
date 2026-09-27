# Heavy Chain release verifier drift diagnosis — 2026-09-27 r1

## Scope

Read-only diagnosis of the two command failures reported by the fresh 10M completion audit.
No verifier source, provider, auth, billing, publication, or external state was changed.

## G619 beta evidence

Fresh artifact: `output/playwright/g619-real-beta-evidence/summary.json`

- `capturedAt`: `2026-09-27T06:50:53.516Z`
- `ok`: `false`
- sessions: `3`
- checks: `179`
- blockers: `21`
- all three sessions still use the scaffold target `https://heavy-chain.zeabur.app`
- consent is unconfirmed, recording is not allowed, duration is `0` minutes
- friction/no-friction notes are empty
- usable behavior evidence artifact count is `0`
- notes remain scaffold placeholder text

The verifier failure is therefore a legitimate missing-human-evidence boundary, not a command
transport failure. Creating or editing these artifacts would fabricate participant consent or
behavior evidence and is not allowed.

## Generation scorecard

Fresh command:

```text
npm run verify:generation-scorecard --silent
```

Result: exit `1`, failed default `primary`, with the exact issue:

```text
scorecard_artifact_missing:output/playwright/hc-10m-real-generation-qa-20260626/visual-scorecard.json
```

The verifier defaults in `scripts/verify-generation-quality-scorecard.mjs` reference three
historical scorecard paths:

- `output/playwright/hc-10m-real-generation-qa-20260626/visual-scorecard.json`
- `output/playwright/hc-generation-polish-20260626/visual-scorecard.json`
- `output/playwright/g677-openai-mini-low-cost-proof/visual-scorecard.json`

All three are absent in the current `output/playwright` tree; no current `visual-scorecard.json`
or `visual_scorecard.json` candidate exists. This proves the scorecard command currently lacks a
real-generation artifact, but does not prove a new provider run should be dispatched or that an old
default should be silently repointed.

## Release gate relationship

The latest unified release gate remains `ok=false` with four readback/command failures:

1. production monitor and UI pair;
2. G618 scale ops baseline;
3. production H602 billing completion readback;
4. generation scorecard.

The Lightchain release-gate contract itself remains 16/16 pass and its manifest test 1/1 pass.

## Astra decision required

Before editing either verifier, Astra engineering must decide the canonical artifact registry and
freshness/provenance rules. The possible repair is not limited to changing a path: it must preserve
same-run provider identity, readback pairing, scorecard provenance, and the no-synthetic-evidence
boundary. Until then, keep the verifier fail-closed and keep the Goal active.
