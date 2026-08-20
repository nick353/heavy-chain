# Lightchain source homepage readback r88

更新日: 2026-08-20

## Fresh run

- Backend: `chrome_plugin`
- Surface: `signed_chrome_extension_profile2`
- Profile: `Profile 2`
- Selector revision: `6`
- Fresh browser-client: `-7c3a-4223-9236-d622cd86e48e`
- Target: `https://jp.linkaigc.com/`
- Title: `Lightchain AI`
- Task-owned tab: `1980904408`
- `openTabs()` handshake: PASS, 6 tabs
- `readyState=complete`, hydrated DOM: PASS
- Cleanup: `cleanup_verified=true`

## Current source UI

- Header: Lightchain logo, language, help center, avatar
- Hero: `LIGHTCHAIN AI` and `アパレル特化のAIデザインワークスペース`
- Prompt: `指示を入力してください... 例：『モデルの着せ替え』`
- Categories: `おすすめ Hot`, `企画デザインツール`, `AIフィッティング`,
  `グラフィックツール`
- Recommended cards: 8 total, including one `動画ワークステーション` card
- Non-video recommended cards: デザインワークスペース、マーケティングワークスペース、
  AIフィッティング、ウェアデザインラボ、モデル企画ライブラリ、
  ファッションスタジオ、デザインエージェント
- Case tabs: `おすすめの事例`, `デザイン修正`, `柄・プリント`,
  `ビジュアル素材`, `マーケティングコンテンツ`, `生産`

The video card and video case examples are source evidence only and remain
excluded from Heavy's internal beta scope.

## Comparison consequence

The current Heavy launcher already matches the source information hierarchy and
non-video card set, but its case-sharing area previously exposed only the
recommended five items. The current Heavy implementation now supplies
non-video case items for all six case tabs while preserving the video scope
exclusion.

Visual evidence: `work/lightchain-source-home-readback-20260820-r88.png`.

No category mutation, click, upload, provider generation, save/reuse, or other
external effect occurred.
