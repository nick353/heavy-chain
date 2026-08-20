# Heavy target-scoped action dispatch readback r124

Date: 2026-08-20 JST

## Fresh action boundary

- Preflight: `status=ready`, selector
  `chrome_plugin / Profile 2 / signed_chrome_extension_profile2 / revision=30`,
  `exact_blocker=null`.
- Browser: `-6537-48dd-a4ec-3f5a128601a2`.
- Owner turn: `01a01f0e-3f10-7f51-8996-6652bab1bda3`.
- Same-owner `list -> get -> openTabs` succeeded.
- Heavy target: `/tools/printing`, task-owned tab `1980904727`.
- Pre-action readback showed the exact target descriptor and the visible
  `無地Tシャツを使う（推奨）` control. The generation button was disabled
  because the input preparation was incomplete.

## Action attempt

- Action: one target-scoped `click` on
  `data-testid=use-trusted-blank-garment`.
- Effect mode: `authorized_target_scoped`, scoped to the active Heavy internal
  beta goal and this exact route/control.
- The first attempt with an invalid callback option (`timeout`) was never
  accepted as a successful dispatch and was not repeated.
- A new task tab and fresh descriptor were then used with the official
  `timeoutMs` option. The action still returned:
  `chrome_extension_target_action_dispatch_failed`.
- Because dispatch completion was unknown, the click was not retried.

## Post-readback and cleanup

- Direct target-scoped readback showed the control and page state unchanged;
  the generation button remained disabled.
- `selected()`, focus, claim, blank-anchor recovery, writer lease, foreign-tab
  takeover, alternate browser surface, provider generation, upload, save, and
  external effect were not used.
- Task-owned tab `1980904727` was closed with `ok=true`; unrelated tabs were
  preserved.

## Current boundaries

- Read-only target-scoped parity remains available and successful.
- Target-scoped mutating action admission is currently blocked by
  `chrome_extension_target_action_dispatch_failed`; the shared Chrome thread
  has been given the fresh descriptor, corrected callback contract, and
  no-replay evidence for raw cause diagnosis.
- Foreground-only operations remain separately gated by
  `chrome_foreground_activation_capability_unavailable`.

