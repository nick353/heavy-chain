# Heavy Chain model-matrix provenance continuity r78

Date: 2026-08-20
Scope: AI-fitting provider receipt continuity across `/model`, `/fitting`, History, and Canvas.

## result

The model-matrix response now carries the provider name, model used, and provider task ID from the Edge Function to the client. Fitting stores these values in each durable artifact and History group, and Canvas reuse restores them in the generated-result parameters. The unified `/model` workbench also keeps the same fields in its provider result and Canvas metadata.

## changed

- `src/lib/imageApi.ts`: extended the model-matrix item contract with `provider`, `modelUsed`, and `providerTaskId`.
- `supabase/functions/model-matrix/index.ts`: returns `providerTaskId` in each persisted matrix item.
- `src/pages/FittingPage.tsx`: preserves provider/model/task/backend lineage in local artifacts, hydrated History, in-memory History, and Canvas reuse.
- `src/pages/LightchainWorkbenchPage.tsx`: preserves the same provenance for `/model` and generic model-matrix provider results.
- `src/stores/canvasStore.ts`: formally admits provider model/task metadata in Canvas object metadata.
- `scripts/verify-provider-persistence-readback.test.ts`: added regression coverage for the full provenance chain.

## verification

- `npm run test:provider-persistence-readback`: 13/13 passed.
- `npm run test:lightchain-provider-coverage`: 18/18 passed.
- Fitting history/resilience/unified persistence suite: 18/18 passed.
- `npm run test:lightchain-material-contract`: 20/20 passed.
- `npm run build`: passed, 2608 modules transformed.
- `git diff --check`: passed.

## proof boundary

This verifies the source-level lineage contract and local build. It does not claim a live production provider response, output quality, remote save/reuse/reload, current Lightchain card parity, or paired Mac/Windows Chrome acceptance.

## remaining blocker / next action

The production same-run proof remains gated by `chrome_foreground_activation_capability_unavailable` and the current-selector target readback blocker `chrome_extension_target_readback_target_session_not_owned`, plus separate production-auth and human beta/legal inputs. After an official state change, create a fresh Profile 2 owner and verify the live receipt against this contract; do not reuse an old browser, binding, tab, run, or artifact.
