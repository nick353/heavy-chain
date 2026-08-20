# Lightchain Profile 2 current-selector non-video route ledger r97

更新日: 2026-08-20

## Fresh read-only run

- selector: `backend=chrome_plugin`, Profile 2,
  `signed_chrome_extension_profile2`, revision `6`
- fresh browser-client: `-96e6-4daa-b1d3-1f04b5a85979`
- session name: `🔎 Lightchain rev6 route ledger`
- owner lineage: thread/session `01a01576-c224-7d81-902f-561719dc45a5`,
  turn `01a01e59-d8e0-7263-9764-e83c5ce6c658`
- same-run `browsers.get()` and `user.openTabs()`: PASS; 4 pre-existing tabs
  remained untouched
- browser capability: `viewport`; `foreground_activation` and `management`
  were not advertised
- route readback: 19/19 exact URL/title/body PASS
- hydration: 17 routes were `readyState=complete` in the first pass; the two
  `interactive` routes (`/editor/changeColor`, `/editor/pattern`) passed one
  focused 6-second settle read in new task-owned tabs
- cleanup: 21 task-owned provisioned tabs closed; no foreign tab was changed
- external effect: none; no click, upload, login, generation, save, reuse,
  reload, recording, or selected/focus/claim operation

## Homepage card binding readback

- A fresh homepage target-scoped readback reached `https://jp.linkaigc.com/`
  with title `Lightchain AI`, `readyState=complete`, and non-empty DOM; the
  task-owned tab was closed.
- The seven non-video card names and the video card were visible in body text.
  The homepage DOM exposed the category/example tab controls, but the card
  containers did not expose `href`, `role=button`, `data-testid`, or an
  equivalent route attribute in this read-only readback.
- Therefore exact homepage card-to-route binding remains
  `PENDING_CONFIRMATION`; no card was clicked or navigated as part of this
  ledger.

## Priority source route supplement

- The same fresh browser-client also provisioned and read
  `/tools/printing`: `readyState=complete`, title `Lightchain AI`,
  `プリントイメージ`, `プリントをアップロード`, `スポット`, `全体`,
  `AI生成`, and `生成履歴` were visible; the task-owned tab was closed.
- Together with `/tools/fabric` and `/model` in the 19-route pass, the three
  priority source routes now have current rev6 URL/title/DOM control evidence.
- This remains read-only route evidence. Provider generation, result, save,
  Gallery/Canvas/History/Jobs lineage, reuse, and reload remain unverified.

## Current non-video route baseline

| Lightchain feature | route | representative fresh markers |
|---|---|---|
| デザインワークスペース | `/designProduction` | プロジェクト、生地イメージ、プリント修正、生地プロジェクト |
| マーケティングワークスペース | `/marketing` | 企画入力、おすすめのシーン、参考事例 |
| AIフィッティング | `/model` | シングル、マルチ、衣服、参考画像、モデルのセット写真、履歴 |
| ウェアデザインラボ | `/flow/orientedDesign` | 保存プロジェクト、参考事例、デザイン要素融合 |
| モデル企画ライブラリ | `/model-library/model-custom-form` | 顔変更、体型、服のサイズ、ポーズ、背景、アングル |
| ファッションスタジオ | `/flow/integration` | 保存プロジェクト、参考事例、ファッションスタジオ |
| デザインエージェント | `/agent` | 企画案、インスピレーション、AIグラフィックデザイン、履歴 |
| インスピレーション | `/creator` | デザイン選択、画像、キーワード、生成履歴 |
| 生地プリントの試着シミュレーション | `/tools/fabric` | 生地イメージ、プリントイメージ、線画の実写化、平絵生成、権限、履歴 |
| 線画から実写へ変換 | `/tools/line-draft-to-tile` | 平置き画像、スタイル、カラー／モノクロ線画、権限、履歴 |
| 色変更 | `/editor/changeColor` | 色変更、参考事例 |
| 平絵をベクター化 | `/tools/svg-convert` | 参考画像、権限、生成履歴 |
| カスタムスタイル | `/model-base/style` | ラーニング素材、カスタムスタイルライブラリ、チームスペース |
| Lightchain Lab | `/flow/laboratory` | Lab、参考事例 |
| 画像修正 | `/tools/reactor` | 修復、マスクツール、権限、生成履歴 |
| AIグラフィックデザイン | `/printing` | 画像アップロード、対応形式、生成履歴 |
| パターンをベクター画像に変換（プロフェッショナル版） | `/tools/vector-special` | レイヤー分け、積み重ね／分割、AI生成、生成履歴 |
| デザインアレンジ | `/editor/pattern` | デザインアレンジ、参考事例 |
| プリントデザイン | `/editor/patternDesign` | プリントデザイン、参考事例 |

## Proof boundary

This establishes current rev6 route reachability and read-only screen/input
markers for all 19 non-video candidate routes. It does not yet prove exact
homepage card-to-route binding, provider generation, result quality, save,
Gallery/Canvas/History/Jobs lineage, reuse, reload, retry/error behavior, or
production performance.

The foreground-dependent production flow remains blocked by
`chrome_foreground_activation_capability_unavailable`; target-scoped
read-only remains available.
