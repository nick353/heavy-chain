# Lightchain Full UI Screenshot Survey - 2026-07-07

## Result

Logged-in Lightchain was surveyed for Heavy Chain parity work. Video-related routes were intentionally skipped because the user said video costs money. Payment, checkout, credential, OTP, CAPTCHA, and security prompts were not touched.

This pass produced:

- 4 category screenshots from the Lightchain home screen.
- 31 direct route screenshots for non-video Lightchain feature screens.
- 50 generation-flow screenshots for selected image tools, including upload modal, existing asset selection, `AI生成` click, and post-click states.

Artifact root:

`/Users/nichikatanaka/Desktop/アパレル１/output/playwright/lightchain-full-survey-20260707`

## Core Artifacts

- Category survey JSON: `/Users/nichikatanaka/Desktop/アパレル１/output/playwright/lightchain-full-survey-20260707/category-survey.json`
- Direct route survey JSON: `/Users/nichikatanaka/Desktop/アパレル１/output/playwright/lightchain-full-survey-20260707/direct-route-survey.json`
- Generation screenshots directory: `/Users/nichikatanaka/Desktop/アパレル１/output/playwright/lightchain-full-survey-20260707/generation`

## Category Screenshots

- `category-おすすめ.png`
- `category-企画デザインツール.png`
- `category-AIフィッティング.png`
- `category-グラフィックツール.png`

## Direct Route Coverage

The following non-video routes were opened directly and screenshotted. The direct route list came from `src/pages/LightchainWorkbenchPage.tsx` because top-page card clicks did not reliably navigate in Chrome automation.

1. `/marketing` - マーケティングワークスペース
2. `/marketing/detail` - マーケティング詳細キャンバス
3. `/model` - AIフィッティング
4. `/model?tab=参考図` - AIフィッティング 参考画像モード
5. `/model/clothing` - 衣服参考ライブラリ
6. `/model/background-reference` - 背景参考ライブラリ
7. `/flow/orientedDesign` - ウェアデザインラボ
8. `/flow/orientedDesign/detail` - ウェアデザイン詳細
9. `/model-library` - モデル企画ライブラリ
10. `/studio-equivalent` - ファッションスタジオ
11. `/agent` - デザインエージェント
12. `/flow/laboratory` - Lightchain Lab
13. `/editor/patternDesign` - プリントデザイン
14. `/editor/patternDesign/detail` - プリントデザイン詳細
15. `/tools/fabric` - 生地イメージ
16. `/tools/line` - 平絵生成
17. `/tools/line-draft-to-tile` - 線画の実写化
18. `/tools/pattern-to-vector` - パターンをベクター画像に変換
19. `/tools/vector-special` - パターンをベクター画像に変換 Pro
20. `/tools/printing` - プリントイメージ
21. `/tools/reactor` - 画像修正
22. `/tools/svg-convert` - 平絵をベクター化
23. `/model-library/head-form` - 顔変更
24. `/model-library/model-change-form` - モデル変更
25. `/model-library/body-form` - 体型
26. `/model-library/size-form` - 服のサイズ
27. `/model-library/pose-form` - ポーズ
28. `/model-library/background-form` - 背景
29. `/model-library/perspective-form` - アングル
30. `/model-library/model-custom-form` - モデルカスタマイズ
31. `/model-base/style` - カスタムスタイル

## Generation Flow Coverage

`AI生成` was clicked where the page could be advanced with existing library assets and no payment/security boundary appeared.

Captured flows:

- `生地イメージ` (`/tools/fabric`)
  - Initial state, material modal, existing asset `使用`, `AI生成` click, post-click states.
  - Important usability finding: first required slot can be filled from existing assets. The second required `生地画像` slot was difficult to target from the visible viewport; repeated attempts produced a validation/toast-style state such as `先に生地をアップロードしてください` or returned to the initial required-slot state. Heavy should make multi-slot upload targeting clearer and easier.
- `平絵生成` (`/tools/line`)
  - Initial state, material modal, existing asset `使用`, `AI生成` click, 5s and 50s post-click screenshots.
- `線画の実写化` (`/tools/line-draft-to-tile`)
  - Initial state, material modal, existing asset `使用`, `AI生成` click, 5s and 50s post-click screenshots.
- `パターンをベクター画像に変換` (`/tools/pattern-to-vector`)
  - Initial state, material modal, existing asset `使用`, `AI生成` click, 5s and 50s post-click screenshots.
- `画像修正` (`/tools/reactor`)
  - Initial state, material modal, existing asset `使用`, `AI生成` click, 5s and 50s post-click screenshots.
- `パターンをベクター画像に変換 Pro` (`/tools/vector-special`)
  - Initial, modal, and after-use screenshots were captured before the automation was interrupted.

Not fully completed in this pass:

- `プリントイメージ` generation requires multiple inputs and was not fully completed before the automation interruption/reclaim issue.
- `平絵をベクター化` generation was not fully completed before the automation interruption/reclaim issue.
- Several workspace-style pages such as marketing, design agent, fashion studio, model-library forms, and custom style were screenshotted but not submitted/generated because their flows are multi-step and need per-tool input choices.

## Heavy Chain Parity Implications

Heavy Chain should not only copy the feature names. It should match these Lightchain interaction patterns:

1. Same category entry structure: `おすすめ`, `企画デザインツール`, `AIフィッティング`, `グラフィックツール`.
2. Direct feature pages with the same primary labels and input slots.
3. Material picker modal with `履歴アップロード`, `生成履歴`, `マイライブラリー`, `チームライブラリー`, `プラットフォームアセット`.
4. Existing asset `使用` flow.
5. Clear required-slot state before `AI生成`.
6. `AI生成` as the primary action, not secondary to Canvas/order-sheet workflows.
7. Result/history area visible on the same page.
8. Heavy extras such as Canvas, Gallery, and advanced workspaces should be secondary actions after Lightchain-like generation.

## Next Required Work

1. Continue generation runs for the unfinished multi-input tools:
   - `プリントイメージ`
   - `平絵をベクター化`
   - `パターンをベクター画像に変換 Pro`
2. Run workspace-style generation tests one by one with explicit input choices:
   - `マーケティングワークスペース`
   - `AIフィッティング`
   - `モデル企画ライブラリ`
   - `デザインエージェント`
   - model-library form tools
3. Build a Heavy implementation matrix from `direct-route-survey.json`:
   - Lightchain route
   - Lightchain controls
   - required inputs
   - generate behavior
   - Heavy current route
   - Heavy gap
   - target implementation component
