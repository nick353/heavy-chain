# Lightchain current parity baseline r14

日時: 2026-08-20 JST

## result

Fresh official Chrome Plugin / Profile 2 target-scoped readback of the
Lightchain homepage succeeded.

- selector: `backend=chrome_plugin`, revision `6`
- surface: `signed_chrome_extension_profile2`
- browser-client: `-ada4-4997-8241-a6447bcb922e`
- owner session/thread: `01a01576-c224-7d81-902f-561719dc45a5`
- owner turn: `01a01bf8-eef4-7992-8ef1-467948963a0b`
- target tab: `1980903824`
- URL: `https://jp.linkaigc.com/`
- title: `Lightchain AI`

## current homepage readback

The fresh accessibility snapshot exposed:

- category tabs: `おすすめ Hot`, `企画デザインツール`, `AIフィッティング`,
  `グラフィックツール`
- recommended primary cards: 8 visible
  - `デザインワークスペース`
  - `マーケティングワークスペース`
  - `AIフィッティング`
  - `ウェアデザインラボ`
  - `動画ワークステーション`
  - `モデル企画ライブラリ`
  - `ファッションスタジオ`
  - `デザインエージェント`
- current non-video count on the default panel: 7
- video exclusion candidate: `動画ワークステーション` (1)
- case-share tabs: `おすすめの事例`, `デザイン修正`, `柄・プリント`,
  `ビジュアル素材`, `マーケティングコンテンツ`, `生産`
- current default case panel includes one video case titled
  `動画ワークステーション：レジャーブランドの春夏ショールーム`

The accessibility snapshot also exposed the homepage search textbox and the
selected default tabs. The cards were represented as visible text in the
tabpanel rather than direct route links, so exact card href/route mapping is
still `PENDING_CONFIRMATION`.

## changed

No category tab was clicked. No login, upload, generation, save, reuse,
download, recording, AOS change, or external effect occurred.

## verification

- fresh `openTabs()` inventory: PASS
- exact Lightchain target URL/title/DOM readback: PASS
- accessibility snapshot with category and card structure: PASS
- task-owned cleanup: `cleanup_verified=true`
- closed tab: `1980903824` only
- close failures: none

## remaining blocker

The full current revision-6 category-card ledger remains
`PENDING_CONFIRMATION` because this read-only run did not switch category
panels. Per-feature Lightchain generation, result, save, reuse, error/retry,
and performance evidence also remains pending. The Heavy production provider
gate remains separately blocked by
`chrome_foreground_activation_capability_unavailable`.

## next action

Use one fresh target-scoped read-only run after an approved state change to
enumerate the four category panels without selected/claim/focus or foreign-tab
operations. Keep the current 8-card homepage baseline as the source-of-truth
for this run, and keep video excluded from Heavy.
