# Lightchain / Heavy priority route ledger — 2026-08-20 r1

## Fresh run contract

- backend: `chrome_plugin`
- Profile: `2` / `signed_chrome_extension_profile2`
- selector revision: `6`
- browser-client: `-4d88-4f63-a2e9-f4267acc60d4`
- session boundary: `398a3d47-695e-40f7-bbb0-2b1419697b78`
- `openTabs()` handshake: PASS, 8 tabs
- all four task-owned route tabs were closed through the official target-scoped cleanup contract with `ok=true`
- no selected/claim/focus/foreground lease, upload, rights mutation, provider generation, save/reuse, recording, AOS, or external effect

## Route observations

| Route | Heavy readback | Lightchain readback | Current classification |
|---|---|---|---|
| `/tools/printing` | `825` body chars; garment/pattern selectors, spot/full, rights attestation, AI生成, history, Canvas保存; an existing provider result was visible | `291` body chars; reference/print inputs, spot/full, AI生成, history; `権限がありません` not observed on this readback | Heavy input/result surface is richer for the internal beta; new generation proof is PENDING_CONFIRMATION |
| `/model` | `335` body chars; AIフィッティング, single/multi task, clothing input, reference/model controls, rights attestation, AI生成, history | `202` body chars; AIフィッティング inputs and `権限がありません`, no AI生成 action | Heavy rights/generation gate is an intentional all-user beta difference; exact copy/input parity remains PENDING_CONFIRMATION |

## Important boundary

The existing Heavy printing result included a historical provider job identifier and Canvas保存導線. It was observed by read-only DOM inspection and is not a new same-run provider receipt. Provider generation, result quality, save, Gallery/Canvas/History/Jobs persistence, reuse, retry, and reload remain unproven until foreground ownership is available.

## Next interaction sequence once foreground is restored

1. Select one approved product-owned garment and one approved textile/pattern from the Heavy Gallery selector.
2. Confirm rights in the same run.
3. Generate fabric and printing results through the provider.
4. Read the result, save to Gallery/Canvas, verify History/Jobs lineage, reload, and reuse once.
5. Repeat the analogous approved-input sequence for AI fitting.
