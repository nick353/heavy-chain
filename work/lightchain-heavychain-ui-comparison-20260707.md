# Lightchain / Heavy Chain UI Comparison - 2026-07-07

## Result

Lightchain live site initially redirected to login, so no credential entry or login bypass was performed by Codex. After the user completed login, `/tools/fabric` was inspected in the live Lightchain UI. The comparison now uses the user's Lightchain screenshots, logged-in Lightchain Chrome inspection, Heavy Chain production Chrome inspection, and fresh local source reads.

Heavy Chain production has Lightchain-derived feature names, but the same-name features do not yet behave like the Lightchain generator UI in the screenshots. Heavy currently routes many same-name tools into generalized Heavy workspaces such as `/patterns`, `/generate`, `/fitting`, `/models`, and `/studio`.

## Evidence

- Lightchain URL checked: `https://jp.linkaigc.com/`
- Lightchain observed state: redirected to `https://jp.linkaigc.com/login?redirect=/?`
- Lightchain login readback: visible inputs `アカウントを入力`, `パスワードを入力する`, and `ログイン`
- Lightchain logged-in tool checked: `https://jp.linkaigc.com/tools/fabric`
- Lightchain live screenshots: `output/playwright/lightchain-live-ui-20260707/`
- Lightchain live DOM readback: `output/playwright/lightchain-live-ui-20260707/lightchain-tools-dom-readback.json`
- Heavy production checked: `https://heavy-chain.zeabur.app/lightchain`
- Heavy production checked: `https://heavy-chain.zeabur.app/lightchain/fabric-image`
- Heavy production checked: `https://heavy-chain.zeabur.app/lightchain/printing-image`
- Heavy production checked: `https://heavy-chain.zeabur.app/lightchain/line-to-real`
- Heavy production checked: `https://heavy-chain.zeabur.app/lightchain/line-generation`
- Heavy production checked: `https://heavy-chain.zeabur.app/lightchain/pattern-vector`
- Heavy production checked: `https://heavy-chain.zeabur.app/lightchain/svg-convert`
- Source read: `src/lib/lightchainParityCatalog.ts`
- Source read: `src/pages/LightchainWorkbenchPage.tsx`
- Source read: `docs/master-plan-lightchain-full-parity-2026-06-30.md`
- Related Heavy all-feature QA artifact: `output/playwright/g831-prod-lightchain-all-features-current-r1/SUMMARY.json`

Important: the Heavy production observations in this document prove UI reachability and visible screen structure only. They are not an all-feature production QA pass. The latest related all-feature artifact is red (`ok=false`) and includes a `marketing-workspace-artifact` CORS/request failure, so it must not be used as completion proof for full Heavy Lightchain parity.

## Lightchain Screenshot Contract

Observed from the provided screenshot. This is screenshot-derived evidence, not a logged-in live Lightchain browser readback:

- Shell: `LIGHTCHAIN`, language selector, help center, account icon.
- Left vertical tool nav: `ツールバー`, `デザインツール`, `フィッティングツール`, `グラフィックデザインツール`.
- Tool tabs: `生地イメージ`, `プリントイメージ`, `線画の実写化`, `平絵生成`.
- `生地イメージ` left form:
  - required `モデル/デザイン画像 *`
  - large upload zone: `参考画像をアップロードしてください`, `20MB以下の画像アップロードしてください`
  - required `生地画像 *`
  - bottom aspect ratio dropdown: `画像比率自動`
  - primary action: `AI生成`
- `生地イメージ` right panel:
  - `生成履歴`
  - title `生地イメージ`
  - subtitle `異なる生地の効果を生成できます`
  - tutorial/reference preview image

## Lightchain Logged-In Live UI

Logged-in `/tools/fabric` inspection confirmed the same core contract live:

- The four tools `生地イメージ`, `プリントイメージ`, `線画の実写化`, and `平絵生成` are sibling tabs inside the same Lightchain tool page.
- The left shell includes `ツールバー`, `デザインツール`, `フィッティングツール`, `グラフィックデザインツール`, and `衣類生産ツール`.
- The page shows the deprecation banner and the `今すぐ体験` link to `/designProduction`.
- `AI生成` and `生成履歴` are visible on the tool surface. `AI生成` was not clicked.
- Screenshots were saved:
  - `output/playwright/lightchain-live-ui-20260707/生地イメージ.png`
  - `output/playwright/lightchain-live-ui-20260707/プリントイメージ.png`
  - `output/playwright/lightchain-live-ui-20260707/線画の実写化.png`
  - `output/playwright/lightchain-live-ui-20260707/平絵生成.png`
  - `output/playwright/lightchain-live-ui-20260707/生地イメージ-upload-modal.png`
  - `output/playwright/lightchain-live-ui-20260707/生地イメージ-after-existing-asset-use.png`

Observed tab details:

- `生地イメージ`
  - URL: `/tools/fabric`
  - Inputs: `モデル/デザイン画像*`, `生地画像*`, optional keyword textarea.
  - Extra visual control observed during the live session: scale guidance around `拡大縮小` / `4.0`. This was treated as visual evidence, not as a stable DOM assertion.
  - Ratio control: `画像比率自動`.
  - Right text: `生地イメージ`, `異なる生地の効果を生成できます`.
- `プリントイメージ`
  - URL: `/tools/printing`
  - Inputs: reference image upload, `プリントをアップロード`, image upload.
  - Placement controls: `スポット`, `全体`.
  - Right text: `プリントイメージを使用し、版下を作成せずに印刷効果を確認できます`.
- `線画の実写化`
  - URL: `/tools/line-draft-to-tile`
  - Inputs: reference image upload.
  - Type controls: `カラー線画`, `モノクロ線画`.
  - Output control: `生成画像の種類`, default `平置き画像`.
  - Textarea: `スタイルのカスタム説明`, optional, `文字数：0/200`.
  - Right text observed: `線画の実写化`, `平絵を編集可能なベクター画像に変換します`.
- `平絵生成`
  - URL: `/tools/line`
  - Inputs: reference image upload.
  - Type controls: `平置き画像`, `モデル図`.
  - Output control: `生成画像の種類`, default `線画`.
  - Additional visible selection: `トップス`.
  - Right text: `平絵生成`, `衣類の着用画像や平置き画像から平絵に変換`.

Material attachment behavior:

1. Clicking a Lightchain upload zone opens a `素材を選択` modal.
2. The modal tabs are `履歴アップロード`, `生成履歴`, `マイライブラリー`, `チームライブラリー`, and `プラットフォームアセット`.
3. The modal supports a local upload route labeled `ファイルをアップロード`, but it also shows existing assets.
4. Existing assets expose `使用` buttons.
5. Selecting an existing asset with `使用` closed the modal; the follow-up screenshot captured the post-selection surface, but the DOM JSON should be treated as modal-close/readback evidence rather than a strong assertion about which exact slot received the asset.

Not covered in this pass:

- real `AI生成` execution;
- generation result quality;
- credit or quota consumption;
- generated result persistence into `生成履歴`.

## Heavy Production Current State

`/lightchain` category cards are visible and usable in production for navigation/read-only inspection. These are the production catalog categories from `src/lib/lightchainParityCatalog.ts` and the production Chrome readback:

- `おすすめ`: マーケティングワークスペース, AIフィッティング, ウェアデザインラボ, 動画ワークステーション, モデル企画ライブラリ, ファッションスタジオ, デザインエージェント, Heavy Chain Lab, 商品画像からSNS動画構成へ.
- `企画デザインツール`: 生地プリントの試着シミュレーション, 線画から実写へ変換, 色変更, 平絵をベクター化, カスタムスタイル, 部分修正・対話編集, AIファッションデザイン：シリーズ生成.
- `AIフィッティング`: モデル背景変更, 体型・サイズ変更, 平置き画像から着用画像, EC向けモデル着用画像を一括生成.
- `グラフィックツール`: インスピレーションデザイン, AIグラフィックデザイン, パターンをベクター画像に変換, デザインアレンジ, プリントデザイン, 背景削除・切り抜き, 高解像度アップスケール, 類似バリエーション生成, Canvasで編集・管理.

The implementation file `src/pages/LightchainWorkbenchPage.tsx` also defines a broader internal category set for the `/lightchain/:toolId` workbench: `おすすめ`, `マーケティング`, `AIフィッティング`, `企画デザイン`, `グラフィック`, `モデル企画`, `動画`, and `Lab`. That internal set is not the same as the top production catalog grouping above.

Same-name detail pages currently show:

- `生地イメージ`: one file input, upload text `柄・ロゴ・服モックをアップロード`, steps `素材を入れる / 調整する / Canvasへ保存`, action `生地置換へ`.
- `プリントイメージ`: one file input, same generic graphics upload text, action `プリント反映へ`.
- `線画の実写化`: one file input, same generic graphics upload text, action `実写化する`.
- `平絵生成`: one file input, same generic graphics upload text, action `線画化を作る`.
- `パターンをベクター画像に変換`: one file input, same generic graphics upload text, action `ベクター化へ`.
- `平絵をベクター化`: one file input, same generic graphics upload text, action `SVG化へ`.

## Main Gap

Heavy has the names and routes, but not the Lightchain interaction contract.

Lightchain is a direct generator:

1. choose same-name tab
2. attach exact required inputs by upload or existing asset reuse
3. set the tab-specific controls such as scale, type, placement, output type, optional description, or image ratio
4. click `AI生成`
5. see history/tutorial/result area in the same page

Heavy is currently a generalized workbench:

1. open feature card
2. upload one generic material
3. optionally mask/extract/layer
4. save order sheet to Canvas or jump to another Heavy workspace

## Required Alignment Work

1. Add a Lightchain-exact generator layout for Lightchain-derived tools.
2. Keep Heavy-native pages such as `/patterns` as advanced workspaces, not as the default UI for these exact Lightchain-derived names.
3. Make `生地イメージ`, `プリントイメージ`, `線画の実写化`, and `平絵生成` appear as sibling tabs in the same page, matching the screenshot.
4. For `生地イメージ`, replace the generic one-upload panel with:
   - `モデル/デザイン画像 *`
   - `生地画像 *`
   - 素材選択モーダル: `履歴アップロード / 生成履歴 / マイライブラリー / チームライブラリー / プラットフォームアセット`
   - existing asset `使用` flow, with slot reflection verified by screenshot/DOM after implementation
   - scale control if present after asset selection
   - `画像比率自動`
   - `AI生成`
   - `生成履歴`
   - right-side title/subtitle/tutorial/result panel.
5. For `プリントイメージ`, use:
   - reference/服画像 upload
   - `プリント画像 *`
   - `スポット / 全体` placement control
   - `AI生成`
   - `生成履歴`.
6. For `線画の実写化`, use:
   - `線画画像 *`
   - `カラー線画 / モノクロ線画`
   - `生成画像の種類`
   - `スタイルのカスタム説明`
   - `AI生成`
   - `生成履歴`.
7. For `平絵生成`, use:
   - `参考画像 *`
   - `平置き画像 / モデル図`
   - `生成画像の種類`
   - garment type selector such as `トップス`
   - `AI生成`
   - `生成履歴`.
8. After generation, provide Heavy extras as secondary actions:
   - Canvasへ保存
   - Galleryで見る
   - Historyで再開
   These should not replace the Lightchain primary `AI生成`.
9. Update `/patterns` card flow so `生地プリントの試着シミュレーション` can launch the exact Lightchain-like generator first, with `/patterns` remaining available as `高度編集` or `制作ボード`.
10. Add production QA for each exact tool:
   - visible fields
   - upload reflection
   - existing asset `使用` flow and slot reflection
   - material modal tab presence
   - disabled/enabled generate state
   - no accidental Canvas/save side effect
   - result/history panel presence
   - mobile layout.

## Stop Conditions

- Do not enter Lightchain credentials.
- Do not bypass login, OTP, CAPTCHA, security prompts, billing, checkout, payment, quota, or purchase.
- Do not click real generation unless explicitly approved and safety gates are satisfied.
- Do not deploy from this comparison pass.

## Next Live-Use Step

If generation behavior must be compared, obtain explicit approval for one `AI生成` action, define the exact input assets and stop condition, and verify whether a result appears in the right panel and `生成履歴`. Do not perform generation as part of read-only UI parity inspection.
