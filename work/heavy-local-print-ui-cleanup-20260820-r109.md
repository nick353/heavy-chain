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

## deployment and fresh readback

- commit: `93a2d9beb797b48b1d702c0b0e8d2732fcfbb05b`
- deployment: `6a86cfbaacafc201d503219c`
- deployment status: `RUNNING`
- selector: `chrome_plugin` / Profile 2 / `signed_chrome_extension_profile2` /
  revision `30`
- browser-client: `-ea87-4fa5-89f8-5e71eebaba72`
- target descriptor: tab `1980904576`
- target URL/title: `https://heavy-chain.zeabur.app/tools/printing` /
  `Heavy Chain | AI制作ワークスペース`
- `readyState=complete`
- extra controls absent: `画像のプリント領域を調整=false`, `↻ リセット=false`
- Lightchain controls present: `参考画像をアップロード`, `プリントをアップロード`,
  `スポット`, `全体`, `AI生成`, `生成履歴`
- `cleanup_verified=true`

## remaining blocker

Provider generation → save → reuse → reload remains
`PENDING_CONFIRMATION` under
`chrome_foreground_activation_capability_unavailable`. The readback above is
read-only and did not upload, generate, save, reuse, or change external state.

## next action

Continue with the foreground-capability gate for the fabric/printing practical
flow. Do not repeat this UI readback fingerprint unless the production bundle
or current source changes again.
