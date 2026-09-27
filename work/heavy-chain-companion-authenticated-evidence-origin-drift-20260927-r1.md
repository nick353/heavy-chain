# Companion authenticated evidence origin drift — 2026-09-27 r1

## Fresh observation

On 2026-09-27, a new task-owned Companion session read `/model`, `/gallery`, `/history`, `/jobs`, and `/canvas/new` on the current authenticated browser surface. Each route reached `readyState=complete`; semantic and visual readback passed; the authenticated marker was `avatar` on the four Lightchain routes and `canvas-save` on Canvas. The task-owned tab was closed with an `aos.chrome_companion.owner_cleanup_receipt.v1` receipt (`ok=true`, `external_action_executed=false`, no retained or unknown-effect tabs).

The fresh browser origin was:

`https://heavy-chain-web.nichikatanaka.workers.dev`

The evidence is recorded in `work/heavy-chain-companion-authenticated-evidence-20260927-r2.json`. Provider receipt, source sync, and reconciliation remain explicitly `unverified`; this is authenticated route continuity evidence only.

## Verifier drift

`npm run verify:companion-auth -- --evidence work/heavy-chain-companion-authenticated-evidence-20260927-r2.json` fails only with `origin_mismatch`, because `scripts/verify-companion-authenticated-evidence.mjs` still hard-codes the older `https://heavy-chain-web.nichika2000823.workers.dev` origin. The verifier was not weakened and the fresh origin was not rewritten to make the artifact pass.

## Required follow-up

Before promoting the new artifact into the canonical release-gate input, an Astra-scoped technical decision must determine the current production origin source of truth and update the verifier/release-gate contract together. Until then, retain the old canonical artifact for the existing gate and treat this fresh artifact as evidence of auth continuity plus an unresolved origin-contract mismatch. Do not infer provider generation, R2 persistence, billing, publication, or deployment completion from it.
