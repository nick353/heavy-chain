# Heavy priority local regression r85

更新日: 2026-08-20

## Scope

This is a source-level regression checkpoint for the two priority workflows and
their shared result/persistence contracts. It does not claim a production
provider run or replace same-run Chrome proof.

## Verification

All focused suites passed:

| area | command | result |
| --- | --- | --- |
| fabric material synthesis | `npm run test:fabric-material-synthesis` | 3/3 |
| provider result/persistence/history/Canvas promotion | `npm run test:provider-persistence-readback` | 13/13 |
| AI fitting model-matrix normalization | `npm run test:model-matrix-verification` | 3/3 |
| Canvas generation and Gallery handoff | `npm run test:canvas-generation-readback` | 5/5 |
| print input artifact restore | `npm run test:print-input-artifacts-runtime` | 1/1 |

Total: **25/25** focused tests passed.

The checks cover material distinction, provider persistence guards, owned
canonical artifact paths, History and Canvas promotion, model-matrix payload
normalization, actual Canvas placement before success, Gallery blob-first
imports, and print input restoration after a fresh module load.

## Boundary

- This proves local implementation contracts only.
- Production fabric/printing and AI-fitting provider generation, save, reload,
  Gallery/Canvas/History/Jobs same-run lineage, and reuse remain
  `PENDING_CONFIRMATION`.
- The official Chrome Plugin/Profile 2 capability advertisement still lacks
  `foreground_activation` and `management`; the exact blocker remains
  `chrome_foreground_activation_capability_unavailable`.
- No browser click, upload, rights confirmation, provider generation, save,
  recording, or external effect was performed.
