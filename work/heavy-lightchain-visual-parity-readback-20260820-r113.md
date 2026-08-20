# Heavy / Lightchain visual parity readback r113

Updated: 2026-08-20

## result

The authenticated Heavy entry and priority routes were read back through the
official Chrome Plugin/Profile 2 target-scoped lane after the visual parity
corrections. The Heavy-only material toolbar was removed, authenticated `/`
now enters `/lightchain`, and Lightchain route titles are restored.

## release and same-run proof

- toolbar removal commit: `ac451b6`
- authenticated-root commit: `3234633`
- title-sync commit: `8b34705`
- deployments: `6a86d5bb29f0931a12bf89b7`,
  `6a86d7a7a158dec405723c0f`, `6a86d909acafc201d5032279`
- latest deployment: `6a86d909acafc201d5032279`, plan type `docker`, status
  `RUNNING`
- preflight: `status=ready`, revision-30 selector,
  `exact_blocker=null`
- browser-client: `-ea87-4fa5-89f8-5e71eebaba72`
- same-run `list -> get -> openTabs()` completed; initial open tabs: `2`
- advertised capabilities: browser `viewport`; tab `pageAssets` / `cdp`
- no selected/focus/claim, upload, generation, save, reuse, recording, or
  external effect was used

## Heavy route readback

| route | tab | actual URL/title | parity checks |
|---|---:|---|---|
| `/` | `1980904620` | `/lightchain` / `Lightchain AI` | authenticated redirect, Lightchain header, four category controls, home cards |
| `/tools/fabric` | `1980904621` | `/tools/fabric` / `Lightchain AI` | no Heavy-only toolbar, material tabs and upload/Gallery controls present |
| `/tools/printing` | `1980904622` | `/tools/printing` / `Lightchain AI` | no Heavy-only toolbar, `リセット=true`, `スポット=true`, `全体=true`, `AI生成=true`, `生成履歴=true`, print-area adjustment absent |
| `/model` | `1980904623` | `/model` / `Lightchain AI` | no Heavy-only toolbar, single/multi tabs, fitting settings, `AI生成`, and history present |

## cleanup

- `cleanup_verified=true`
- only task-owned tabs `1980904620`–`1980904623` were closed
- pre-existing new-tab and unrelated job tab were not touched

## remaining blocker

Production provider generation → save → Gallery/Canvas/History/Jobs → reuse
→ reload remains `chrome_foreground_activation_capability_unavailable`.
The official signed Profile 2 distribution still advertises only read-only
capabilities.

## next action

Continue local parity and beta QA that do not require foreground capability.
After the official capability advertisement changes, use a fresh Profile 2
owner for the approved fabric/printing provider proof, then AI fitting. Do not
reuse this read-only browser binding or tabs.
