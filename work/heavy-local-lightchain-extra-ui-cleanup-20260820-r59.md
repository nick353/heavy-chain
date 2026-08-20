# Heavy local Lightchain extra-UI cleanup r59

- The Printing workbench readiness funnel remains part of the generation-state and accessibility contract, but its Heavy-only visual summary panel is now `sr-only` with `aria-live="polite"`.
- This removes the persistent Heavy-specific `生成前の準備 / 入力 → マスク → 配置 → 生成` panel from the visible Lightchain-parity frame while preserving readiness calculation, disabled-generation safety, and screen-reader status.
- No provider call, upload, save, reuse, reload, deployment, Chrome operation, recording change, AOS change, or external effect was performed in this local change.
