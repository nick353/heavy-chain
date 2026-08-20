# Heavy production UI cleanup readback r60 — 2026-08-20

## Source and deployment

- Source commit: `ef3a3d88d8da081afaef9944720ebee773e3ca49` (`hide heavy-only printing readiness chrome`)
- Zeabur project/service: `automation-wiled / heavy-chain`
- Deployment: `6a8699130f08f89df0cd10cc`
- Plan: `docker`
- Deployment status: `RUNNING`
- Domain HTTP status: `200`
- Remote bundle: `/assets/index.B4xChLSi.js`
- Remote/local bundle SHA-256: `55aa0e2d6098b23b43de095fcf5a22a861e3e7f073366c7b82a8ea1c8c312669` (match)

## Product change

The Heavy-only printing readiness panel remains in the state/accessibility contract as `printing-readiness-summary`, but its visible presentation is `sr-only aria-live`. The visible Lightchain route is intended to omit the extra readiness chrome while preserving generation state and safety logic.

## Fresh Chrome readback

- Surface: official Chrome Plugin / Profile 2 / `signed_chrome_extension_profile2`
- Selector revision: `4`
- Fresh browser id: `-da2e-4975-8843-f59ce32756eb`
- `openTabs()`: success, 9 tabs
- Target: task-owned `/tools/printing` tab provisioned through the official allowlisted path
- URL/title: `https://heavy-chain.zeabur.app/tools/printing` / `Heavy Chain | AI制作ワークスペース`
- Cleanup: task-owned tab `1980904318` closed; `cleanup_verified=true`
- `selected()` / focus / claim / foreground lease / upload / generation / save / reuse / recording / external effect: not used
- Source-thread artifact: `/Users/nichikatanaka/Documents/New project/work/chrome-plugin-heavy-printing-target-readback-20260820.json`

DOM readback failed with `Runtime.evaluate` timeout after URL/title admission. Therefore the absence of the readiness text and the presence of the Lightchain controls are `PENDING_CONFIRMATION`; this artifact is not a visual parity completion proof.

## Exact blocker / restart point

- Readback blocker: `chrome_extension_target_readback_timeout`
- Existing production foreground blocker: `chrome_foreground_activation_capability_unavailable`
- Next action: after a browser/runtime state change, create a new official Profile 2 browser-client and perform one target-scoped DOM readback. Do not reuse this binding or task tab. Keep provider generation/save/reuse/reload fail-closed until the official foreground capability is advertised.
