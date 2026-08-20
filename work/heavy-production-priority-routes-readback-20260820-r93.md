# Heavy production priority-route readback r93

更新日: 2026-08-20

## Fresh settled run

- selector: `backend=chrome_plugin`, Profile 2,
  `signed_chrome_extension_profile2`, revision `6`
- fresh browser-client: `-539d-473e-8eb6-7877dc4245df`
- session: `heavy-production-auth-settle-readback-r93`
- owner lineage: current thread/session `01a01576-c224-7d81-902f-561719dc45a5`,
  turn `01a01e46-ac68-7cd0-af96-bd09d58b98f2`
- same-run `browsers.get()` and `user.openTabs()`: PASS
- bounded settle: 8 seconds after each allowlisted target navigation
- capabilities: browser `viewport`; tab `pageAssets` / `cdp`; foreground
  activation and management were not advertised

## Route readback

Each route was provisioned as a task-owned tab, read after the bounded settle,
and closed through the official target-scoped lane.

| route | tab | URL/title | visible readback |
|---|---:|---|---|
| `/tools/fabric` | task-owned (ID not retained in output) | matched / Heavy Chain title | `生地イメージ`, `生成履歴`, model/design input, fabric input, keyword, image ratio, material variants, `AI生成` (disabled until inputs) |
| `/tools/printing` | `1980904420` | matched / Heavy Chain title | `プリントイメージ`, `AI生成`, `生成履歴`, `Gallery`, `History`, `Jobs`, `Canvas` |
| `/model` | `1980904422` | matched / Heavy Chain title | `AIフィッティング`, `衣服`, `モデル`, `参考`, `AI生成`, `生成履歴` |

- `cleanup_verified=true`
- six unrelated existing tabs remained untouched

## Proof boundary

This is current production UI/auth-settle proof for the priority routes. It
does not prove provider generation, result quality, rights confirmation,
save, Gallery/Canvas/History/Jobs same-run lineage, reuse/reload, real
Mac/Windows acceptance, or internal beta acceptance.

No click, upload, rights confirmation, generation, save/reuse, selected/focus,
claim, recording, or external effect was executed.
