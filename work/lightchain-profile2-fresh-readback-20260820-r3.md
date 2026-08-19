# Lightchain homepage fresh target-scoped readback r3

- Date: 2026-08-20
- Selector: `backend=chrome_plugin`, `Profile 2`, `signed_chrome_extension_profile2`, `revision=6`
- Fresh browser-client: `-f847-469f-930f-f0182d3f3024`
- Created task-owned tab: `1980903749`
- URL/title: `https://jp.linkaigc.com/` / `Lightchain AI`
- Same-run URL/title/DOM readback: PASS after a bounded hydration wait
- Cleanup: `cleanup_verified=true`; only the created tab was closed

## Current source signals

- Header: `Lightchain AI`, `日本語`, `ヘルプセンター`, account avatar
- Search: `指示を入力してください... 例：『モデルの着せ替え』`
- Categories: `おすすめ`, `企画デザインツール`, `AIフィッティング`, `グラフィックツール`
- Recommended cards: 7 visible, including one `動画ワークステーション` card that is excluded from the Heavy beta scope
- Example tabs: `おすすめの事例`, `デザイン修正`, `柄・プリント`, `ビジュアル素材`, `マーケティングコンテンツ`, `生産`
- No login text was present in the hydrated source page

The video card is present in current Lightchain production and remains an explicit non-goal for Heavy. Heavy's non-video launcher must exclude it while preserving the other current cards and categories.

No click, upload, provider generation, save/reuse, recording, AOS UI change, or other external effect was performed.
