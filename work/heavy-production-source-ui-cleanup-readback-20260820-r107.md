# Heavy production source UI cleanup readback r107

Updated: 2026-08-20

## result

The source-aligned Heavy fabric UI cleanup was deployed to the existing
`heavy-chain` service and verified through a fresh Chrome Plugin/Profile 2
target-scoped readback.

## deployment proof

- project: `automation-wiled`
- service: `heavy-chain`
- deployment: `6a86cc9aacafc201d50320b0`
- plan type: `docker`
- status: `RUNNING`
- source commit: `144087ea5384604023be7f8dcc84f511d6f0f3d3`
- Dockerfile SHA-256: `3a62ebb5688ab50e7339c21ffd2a548355a9ab853ffae62b45c3e6434964661c`

## fresh readback proof

- selector: `chrome_plugin` / Profile 2 /
  `signed_chrome_extension_profile2` / revision `30`
- preflight: `status=ready`, `exact_blocker=null`
- browser-client: `-8399-4259-b834-594dabf033e9`
- session boundary: `5d8fc596-c3d8-4b16-9e09-0a7dbd9efb31`
- owner session/thread: `01a01576-c224-7d81-902f-561719dc45a5` /
  `01a01576-c224-7d81-902f-561719dc45a5`
- owner turn: `01a01e87-f2d3-7852-8530-b5e947af14be`
- `openTabs()`: success, 2 tabs
- target: Heavy `/tools/fabric`, tab `1980904570`
- URL/title: matched, `Heavy Chain | AI制作ワークスペース`
- `readyState`: `complete`

## parity verification

- `preset_picker_visible=false`: Heavy no longer shows
  `コットン` / `デニム` / `サテン` / `リネン` controls
- retained: Lightchain toolbar, model/design input, fabric input, keyword,
  ratio, `AI生成`, and `生成履歴`
- `cleanup_verified=true`; only task-owned tab `1980904570` was closed
- no selected/focus/claim/foreground operation, upload, rights confirmation,
  provider generation, save, reuse, reload, recording, AOS change, or external
  effect was executed

## remaining blocker

`chrome_foreground_activation_capability_unavailable` remains the blocker for
production provider generation and same-run result/save/reuse/reload proof.
The deployment/readback proves the UI cleanup and runtime availability only.

