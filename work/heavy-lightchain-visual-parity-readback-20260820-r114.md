# Heavy / Lightchain visual parity readback r114

Updated: 2026-08-20

## result

The standalone Lightchain feature toolbar was removed from generic feature
workbenches, and the full-screen Canvas route now uses the Lightchain browser
title. The final production readback covered all 28 distinct non-video routes
in one official Profile 2 target-scoped run after deployment.

## release and same-run proof

- generic feature toolbar removal commit: `9546ae4`
- standalone Canvas title commit: `060c390`
- latest deployment: `6a86df91a158dec405723d95`
- deployment plan/status: `docker / RUNNING`
- Profile 2 preflight: `status=ready`, revision `30`,
  `chrome_plugin / Profile 2 / signed_chrome_extension_profile2`,
  `exact_blocker=null`
- browser-client: `-ea87-4fa5-89f8-5e71eebaba72`
- same owner fresh checks: session inventory readback followed by
  `openTabs()`; open tabs `2`
- owner binding: session/thread
  `01a01576-c224-7d81-902f-561719dc45a5`, turn
  `01a01eac-b082-7530-890c-c34be097a3c2`
- target-scoped lane only; no selected/focus/claim/foreground lease,
  upload, generation, save, reuse, recording, AOS change, or external effect

## final 28-route readback

Routes:

`/marketing`, `/model`, `/flow/orientedDesign`,
`/model-library/model-custom-form`, `/flow/integration`, `/agent`,
`/flow/laboratory`, `/creator`, `/tools/fabric`, `/tools/printing`,
`/tools/line-draft-to-tile`, `/editor/changeColor`, `/tools/svg-convert`,
`/model-base/style`, `/fitting`, `/printing`, `/tools/vector-special`,
`/editor/pattern`, `/editor/patternDesign`, `/tools/reactor`,
`/generate?feature=upscale`, `/generate?feature=generate-variations`,
`/generate?feature=chat-edit`, `/canvas/new`,
`/workflows/design-exploration`, `/workflows/ec-product-set`,
`/workflows/sns-campaign`, `/designProduction`

- route count: `28/28`
- `Lightchain AI` browser title: `28/28`
- non-empty DOM: `28/28`
- `readyState=complete`: `28/28`
- authentication/login redirects: `0`
- standalone Heavy-only feature toolbar items: `0`
- `/tools/fabric`: Lightchain-shaped material input/history/Gallery surface
- `/tools/printing`: Lightchain-shaped print input/history surface; no
  Heavy-only print-area adjustment
- `/model`: Lightchain-shaped AI fitting input surface
- `/canvas/new`: `Lightchain AI` title and Canvas surface

## cleanup

- task-owned tab `1980904688` was closed
- `cleanup_verified=true` (`absentAfterClose=true`)
- the pre-existing new-tab and unrelated job tab remained untouched

## remaining blocker

Production provider generation → result → save → Gallery/Canvas/History/Jobs
→ reuse → reload remains `chrome_foreground_activation_capability_unavailable`.
The official Profile 2 lane still does not advertise the required foreground
activation/management capability; target-scoped read-only proof does not clear
that gate.

## next action

Continue dependency-independent local parity and beta QA. After the official
foreground capability advertisement changes, run a mandatory Profile 2
preflight and fresh owner `list -> get -> openTabs()` boundary, then prove the
fabric/printing practical flow and AI fitting. Do not reuse this read-only
binding, tab, run, or artifact for foreground work.
