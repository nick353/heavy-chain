# Heavy priority routes target-scoped readback r87

更新日: 2026-08-20

## Fresh run

- Backend: `chrome_plugin`
- Surface: `signed_chrome_extension_profile2`
- Profile: `Profile 2`
- Selector revision: `6`
- Fresh browser-client: `-8fc3-4897-aa74-0287de18a4de`
- `openTabs()` handshake: PASS, 5 tabs
- Owner lineage: current session/thread/turn matched
- Advertised capabilities: browser `viewport`; tab `pageAssets` / `cdp`
- `foreground_activation` / `management`: not advertised
- Foreground exact blocker: `chrome_foreground_activation_capability_unavailable`

## Route readback

All three routes were provisioned only when absent, read in the same fresh
target-scoped run, and closed as task-owned tabs. All returned the Heavy title,
requested URL, `readyState=complete`, and hydrated Lightchain-shaped UI.

| route | tab | current UI proof | cleanup |
| --- | --- | --- | --- |
| `/tools/fabric` | `1980904402` | `生地イメージ`, Lightchain toolbar, model/design input, fabric input, keyword, ratio, material variants, `AI生成`, `生成履歴` | PASS |
| `/tools/printing` | `1980904404` | `プリントイメージ`, base garment input, print input, spot/full range, placement adjustment, `AI生成`, result destinations `Gallery` / `History` / `Jobs` / `Canvas` | PASS |
| `/model` | `1980904406` | `AIフィッティング`, single/multi-task, garment input, description/reference/model-set tabs, quality choices, `AI生成`, history link | PASS |

The printing route displayed an existing persisted result in its history. It
was not created or modified by this read-only run and is not promoted as
current same-run generation, save, reuse, or reload proof.

## Boundary

- No `selected()`, focus, claim, foreground lease, click, upload, rights
  confirmation, provider generation, save, reuse, reload, recording, AOS UI
  change, or external effect was executed.
- `cleanup_verified=true` for all three task-owned tabs.
- Production provider generation/result/save/reuse/reload and complete
  Gallery/Canvas/History/Jobs lineage remain `PENDING_CONFIRMATION`.
