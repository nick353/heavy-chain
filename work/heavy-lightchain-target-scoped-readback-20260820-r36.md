# Heavy / Lightchain target-scoped readback r36

- checked_at: `2026-08-20T13:07:22+09:00`
- backend: `chrome_plugin`
- profile: `Profile 2`
- surface: `signed_chrome_extension_profile2`
- selector revision: `30`
- browser_id: `-b030-44db-953f-4481afcccf4d`
- extension_instance_id: `f48b15fe-59a8-4443-8369-44b169a4da68`
- browser-client session/thread: `01a01576-c224-7d81-902f-561719dc45a5`
- turn: `01a01d58-9221-7870-930e-d8b0ffe66695`
- advertised browser capabilities: `viewport` only
- `foreground_activation`: not advertised
- `management`: not advertised
- `openTabs()` initial inventory: 4 tabs; neither target was present

## Lightchain fresh reference

- task-owned provisioned tab: `1980904106`
- URL: `https://jp.linkaigc.com/tools/fabric`
- title: `Lightchain AI`
- same-run DOM readback: PASS
- visible reference markers: `ツールバー`, `デザインツール`, `フィッティングツール`, `グラフィックデザインツール`, `衣類生産ツール`, `生地イメージ`, `プリントイメージ`, `線画の実写化`, `平絵生成`, `生成履歴`
- official DOM snapshot exposed the current material tabs and `生地イメージ` heading; full accessibility completeness remains `PENDING_CONFIRMATION` because the snapshot included an alert boundary.
- cleanup: `cleanup_verified=true`

## Heavy current target

- task-owned provisioned tab: `1980904108`
- URL: `https://heavy-chain.zeabur.app/tools/fabric`
- title: `Heavy Chain | AI制作ワークスペース`
- same-run DOM readback: PASS
- authenticated/hydrated markers: no login or workspace-preparation blocker; material inputs, gallery selection, rights confirmation gate, `AI生成`, and `生成履歴` visible
- visible inputs: base image, pattern reference, fabric image, keyword, ratio, fabric variants, upload/gallery selection controls
- generation state: `AI生成` disabled until the two required images are supplied
- cleanup: `cleanup_verified=true`

## Boundary

- No `tabs.selected()`, focus, claim, foreground lease, provider generation, upload, rights confirmation, save, reuse, recording, or external effect was performed.
- `chrome_foreground_activation_capability_unavailable` remains the exact blocker for foreground-only production generation and same-run save/reuse proof.
