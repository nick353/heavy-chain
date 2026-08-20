# Heavy target-scoped action cause-chain readback r126

Date: 2026-08-20 JST

## Fresh recovery and owner

- Official recovery re-advertised Chrome Plugin/Profile 2 without IAB
  fallback: browser `-6775-4ccd-a47f-a32a470c1a47`.
- Extension instance: `64b91b0b-80a7-4bc8-8d1a-da222c416685`.
- Fresh session boundary: `d76ecaf7-6ce4-4909-be21-97f84bbef634`.
- Same-run `list -> get -> openTabs` succeeded.
- Owner turn: `01a01f18-3fb6-7183-9b60-6993dbfb69ea`.

## Single target action

- Heavy route: `/tools/printing`.
- Task-owned target tab: `1980904732`.
- Pre-action readback: `data-testid=use-trusted-blank-garment` was visible;
  the generation button was disabled while inputs were incomplete.
- Action: one `click`, `effectMode=authorized_target_scoped`.
- Result: `chrome_extension_target_action_dispatch_failed`.
- The newly preserved cause chain was:

  `Error: Timed out after 3000ms waiting for selector [data-testid="use-trusted-blank-garment"] >> nth=0: Timed out after 439ms waiting for CDP command Runtime.evaluate. waiting on click for selector [data-testid="use-trusted-blank-garment"] >> nth=0`

- `cause_chain.exact_blocker=null`, `cause_chain.code=null`.
- Click completion was unknown; no replay was attempted.

## Cleanup and boundary

- Task-owned tab `1980904732` closed with `ok=true`.
- Unrelated tabs were preserved.
- No provider generation, upload, save, reuse, recording, AOS change,
  foreground selection, or alternate browser surface was used.

## Next action

The shared Chrome thread has the exact raw chain. Do not retry this action
until the CDP `Runtime.evaluate`/target action timeout path is repaired or the
official lane reports a changed state. Then create a new owner and repeat the
approved action once before entering the provider flow.

