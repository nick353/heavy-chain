# Heavy production Lightchain fabric/model parity readback r63 — 2026-08-20

## Fresh target-scoped proof

- Surface: official Chrome Plugin / Profile 2 / `signed_chrome_extension_profile2`, selector revision `4`
- Fresh browser: `-03ab-4141-a3ae-23879f102b4a`
- Owner-bound session/thread: `01a00fe4-9c5e-7d00-8b6a-09811c03df36`
- Fresh run turn: `01a01ddb-729d-7b42-8426-e77fec7b0bae`
- Initial target inventory had neither route; official `tabs.new()` → allowlisted `goto()` created task-owned tabs `1980904329` and `1980904330`.

## Fabric route

- URL: `https://heavy-chain.zeabur.app/tools/fabric`
- Title: `Heavy Chain | AI制作ワークスペース`
- Markers all present: `生地イメージ`, `モデル/デザイン画像`, `キーワード`, `生成履歴`
- Target-scoped DOM snapshot: `1933` characters

## AI fitting route

- URL: `https://heavy-chain.zeabur.app/model`
- Title: `Heavy Chain | AI制作ワークスペース`
- Markers all present: `AIフィッティング`, `衣服の画像`, `参考画像`, `モデルのセット写真`, `生成履歴`
- Target-scoped DOM snapshot: `1071` characters

## Boundaries and cleanup

- `selected()` / focus / claim / foreground lease: not used
- upload / provider generation / rights confirmation / save / reuse / recording / alternate surface / external effect: not used
- both task-owned tabs closed; `cleanup_verified=true`; post-cleanup tab count `11`
- `exact_blocker=null` for this read-only lane
- Source-thread artifact: `/Users/nichikatanaka/Documents/New project/work/chrome-plugin-heavy-fabric-model-target-readback-20260820.json`

This proves current UI/input marker parity for fabric and AI fitting. It does not prove provider output, save/reuse/reload, or business completion.
