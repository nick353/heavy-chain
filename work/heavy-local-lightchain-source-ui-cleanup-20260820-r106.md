# Heavy local Lightchain source UI cleanup r106

Updated: 2026-08-20

## result

Removed the visible Heavy-only fabric preset picker from the unified fabric
workbench. The fabric renderer still keeps its internal deterministic preset
profile for the practical generation path, but users no longer see
`コットン` / `デニム` / `サテン` / `リネン` controls that are absent from the
current Lightchain `/tools/fabric` source readback.

## changed

- `src/pages/LightchainMaterialWorkbenchPage.tsx`
  - removed the visible `生地バリエーション` picker from both desktop
    rendering paths
  - retained the existing material renderer and generation metadata contract
    with the default internal preset set
- `scripts/verify-lightchain-material-contract.test.ts`
  - added a regression asserting that the Heavy-only visible preset picker is
    not reintroduced

## verification

- current Lightchain source readback r105 showed no visible fabric preset
  picker; source routes and cleanup passed in a fresh revision-30 owner
- `npm run --silent test:lightchain-material-contract`: 21/21 PASS
- `npm run --silent typecheck`: PASS
- `npm run --silent build`: PASS, 2609 modules transformed
- `npm run --silent verify:lightchain-all-features`: PASS,
  `featureCount=31`, `failed=[]`

## boundary

This is local UI parity progress. It does not prove production provider
generation, result quality, save/reuse/reload, Gallery/Canvas/History/Jobs
same-run lineage, Mac/Windows acceptance, or employee beta acceptance.

