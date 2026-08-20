# Heavy Chain production fabric parity readback r50

Date: 2026-08-20

## result

Heavy `/tools/fabric` now matches the Lightchain single-input surface for the
garment reference. The extra `ベース画像` / `パターン参考` reference-type
buttons are absent from the fresh production DOM.

## source and deployment

- Source fix: commit `1730099315cddca1bfcb3ff2f350a0bb8d33e9bc`
- `origin/main` was updated to the same commit.
- Zeabur project: `69df815a554543d46b0f2485`
- Environment: `69df815a5ae0a69725e92048`
- Service: `6a318803302ffbcd03a92935` (`heavy-chain`)
- Final running deployment observed: `6a868c4b11420507cae04a49`
- Service status: `RUNNING`
- Runtime HTML asset: `index.DSXYQn6M.js`
- Remote material-workbench chunk exposes the garment selector as
  `allowedReferenceTypes: ['base']`; printing pattern inputs remain separate.

## fresh Chrome readback

- Selector source: `/Users/nichikatanaka/.social-flow/web-operation-backend.json`
- Selector: `backend=chrome_plugin`, `profile2`,
  `signed_chrome_extension_profile2`, revision `1`
- Fresh browser-client: `-9ac5-4802-851c-b1d299fe7490`
- Fresh owner extension instance: `f48b15fe-59a8-4443-8369-44b169a4da68`
- Fresh `openTabs()` handshake: passed; Heavy target was absent, so the
  allowlisted target-scoped provisioning path created tab `1980904183`.
- Same-run target URL: `https://heavy-chain.zeabur.app/tools/fabric`
- Same-run title: `Heavy Chain | AI制作ワークスペース`
- DOM: `生地イメージ` present, hydrated workbench present,
  `ベース画像` absent, `パターン参考` absent, authentication-preparation
  text absent.
- `cleanup_verified=true`; only the task-owned provisioned tab was closed.

## safety boundary and remaining blocker

- No selected tab, focus, claim, foreground lease, provider generation, save,
  reuse, recording, AOS UI change, or other external effect was used.
- Advertised capabilities remain `viewport`, tab `pageAssets`, and tab `cdp`.
  `foreground_activation` and `management` remain unadvertised.
- Exact blocker for foreground-dependent production generation/save/reuse:
  `chrome_foreground_activation_capability_unavailable`.

