# Heavy local print UI cleanup r109

Updated: 2026-08-20

## result

The visible Heavy `/tools/printing` parity view now keeps the current
Lightchain input flow and removes Heavy-only controls that were visible beside
the inputs.

## changed

- Removed the visible `画像のプリント領域を調整` action from the garment input.
- Removed the visible `↻ リセット` action from the print input card.
- Removed the visible `画像のプリント領域を調整` action from the design input.
- Kept library/upload selection, `スポット` / `全体`, `AI生成`, generation
  history, and the underlying placement/mask implementation for internal
  workflow compatibility.
- Updated the focused desktop parity test to assert that those extra visible
  controls are absent.

## verification

- `npm run --silent test:printing-foundation`: 244/244 PASS
- `npm run --silent typecheck`: PASS

## remaining blocker

This local UI change is not yet deployed or fresh-read from Heavy production.
Provider generation → save → reuse → reload remains
`chrome_foreground_activation_capability_unavailable` until the official
Profile 2 lane advertises the required foreground capability.

## next action

Build, deploy the tracked UI change to the existing Heavy service, then run one
fresh Profile 2 target-scoped read-only readback of `/tools/printing` and
confirm the extra controls are absent while the Lightchain controls remain.
