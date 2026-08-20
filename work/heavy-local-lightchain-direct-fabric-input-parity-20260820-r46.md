# Heavy local Lightchain direct fabric input parity r46

## result

The current fresh Lightchain `/tools/fabric` readback showed no reference-type toggle on the `モデル/デザイン画像` input, while Heavy showed extra `ベース画像` / `パターン参考` controls. The Heavy direct fabric route now uses the same single-input surface.

## changed

- `/Users/nichikatanaka/Documents/Codex/external-repos/heavy-chain/src/pages/LightchainMaterialWorkbenchPage.tsx`
  - direct `/tools/fabric` `モデル/デザイン画像` selector changed from `allowedReferenceTypes={['base', 'pattern']}` to `allowedReferenceTypes={['base']}`
  - Gallery selection, garment role, required input, fabric input, generation, rights, history, and retry contracts remain intact
- `/Users/nichikatanaka/Documents/Codex/external-repos/heavy-chain/scripts/verify-lightchain-material-contract.test.ts`
  - added regression that the direct fabric route has no extra reference-type toggle

## verification

- focused material contract: `15/15 PASS`
- `npm run typecheck --silent`: PASS
- `git diff --check`: PASS

## proof boundary

This is local source/UI proof only. The fresh production readback that motivated the change is in `work/heavy-lightchain-fresh-target-scoped-readback-20260820-r45.md`; production deployment and post-deploy visual/readback verification are not claimed in this artifact.

## remaining blocker / next action

- Production provider generation/save/reuse/reload: `PENDING_CONFIRMATION` behind `chrome_foreground_activation_capability_unavailable`
- After an authorized deployment or next production refresh, perform one fresh target-scoped `/tools/fabric` readback to confirm the extra toggle is absent. Do not use the previous production tab as current proof.
