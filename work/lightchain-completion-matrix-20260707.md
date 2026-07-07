# Lightchain Completion Matrix - 2026-07-07

## Scope
- Target: 31 non-video Lightchain routes currently implemented under Heavy Chain Lightchain-compatible UI.
- Source of truth:
  - `work/lightchain-full-ui-migration-status-20260707.md`
  - `output/playwright/lightchain-all-feature-workflows-20260707T052936Z/SUMMARY.json`
  - `output/playwright/lightchain-canvas-metadata-readback-20260707/SUMMARY.json`
  - `output/playwright/lightchain-all-feature-workflows-20260707-fashion-studio-r2/SUMMARY.json`
  - `output/playwright/lightchain-canvas-metadata-readback-20260707-fashion-studio-r1/SUMMARY.json`
  - `output/playwright/lightchain-all-feature-workflows-20260707-stage18-status-r1/SUMMARY.json`
  - `output/playwright/lightchain-canvas-metadata-readback-20260707-stage18-status-r1/SUMMARY.json`
  - `output/playwright/lightchain-chrome-proof-20260707-profile2-local-31routes/SUMMARY.json`
  - `output/playwright/lightchain-chrome-proof-20260707-profile2-local-fashion-studio-upgraded/SUMMARY.json`
  - `output/playwright/lightchain-chrome-proof-20260707-profile2-prod-31routes/SUMMARY.json`
  - `output/playwright/lightchain-chrome-proof-20260707-profile2-prod-fashion-studio-current-r1/SUMMARY.json`
  - `output/playwright/lightchain-chrome-proof-20260707-profile2-prod-fashion-studio-upgraded-r1/SUMMARY.json`
- Hard stops observed: no payment, checkout, credential entry, auth bypass, paid/video generation, publish, destructive cleanup, quota/security bypass. Deploy was performed only after explicit user approval.

## Current Gate
- Local all-feature workflow: latest `ok=true`, `31` non-video routes, `failed=[]`; current artifact `output/playwright/lightchain-all-feature-workflows-20260707-stage18-status-r1/SUMMARY.json`.
- Local Canvas metadata readback: latest `ok=true`, `31` routes, `failed=[]`; current artifact `output/playwright/lightchain-canvas-metadata-readback-20260707-stage18-status-r1/SUMMARY.json`.
- Chrome plugin/Profile 2 local proof: `profile2_local_auth_missing`, final URL `http://127.0.0.1:4183/login`.
- Chrome plugin/Profile 2 local focused proof for upgraded `fashion-studio`: `ok=true`, final URL `http://127.0.0.1:4185/lightchain/fashion-studio`, initial readback confirms logo, tabs, prompt, AI action, and history; `Canvasへ保存` is covered by Canvas metadata proof after preview rather than the initial Chrome readback.
- Chrome plugin/Profile 2 production proof: `ok=true`, `31` routes captured, `failedRoutes=[]`, no `profile2_prod_auth_missing`.
- Chrome plugin/Profile 2 production focused proof for upgraded `fashion-studio`: `ok=true`, artifact `output/playwright/lightchain-chrome-proof-20260707-profile2-prod-fashion-studio-upgraded-r1/SUMMARY.json`; production shows the upgraded studio workspace and safe local `AI生成` preview action adds history/readback.
- Therefore, all 31 non-video UI routes have local workflow, metadata coverage, and production Chrome/Profile 2 route proof; the audited route set is `31/31 Lightchain同等`.

## 判定基準
- `Lightchain同等`: local workflow + Canvas metadata + authenticated Chrome/Profile 2 route proof all pass.
- `ほぼ同等`: local workflow + Canvas metadata pass; Chrome/Profile 2 is blocked by auth or real external generation is intentionally not executed.
- `部分一致`: route is intentionally compatibility-only, fallback-only, or a major Lightchain behavior is out of scope.
- `Heavy未実装`: no Heavy route or usable UI evidence.
- `要承認`: needs user approval/auth/paid or external generation to verify safely.

## Completion Matrix
| # | Tool ID | Lightchain名 | Lightchain route | Heavy route | 判定 | Evidence | 未確認/残リスク |
|---:|---|---|---|---|---|---|---|
| 1 | `marketing-home` | マーケティングワークスペース | `/marketing` | `/lightchain/marketing-home` | Lightchain同等 | all-feature ok; Canvas assertions ok; Chrome prod Profile2 proof ok | real external generation not executed |
| 2 | `marketing-detail` | マーケティング詳細キャンバス | `/marketing/detail` | `/lightchain/marketing-detail` | Lightchain同等 | all-feature ok; Canvas assertions ok; Stage16 layout proof; Chrome prod Profile2 proof ok | real external generation not executed |
| 3 | `ai-fitting` | AIフィッティング | `/model` | `/lightchain/ai-fitting` | Lightchain同等 | all-feature ok; Canvas assertions ok; Chrome prod Profile2 proof ok | real generation not executed |
| 4 | `ai-fitting-reference` | AIフィッティング 参考画像モード | `/model?tab=参考図` | `/lightchain/ai-fitting-reference` | Lightchain同等 | all-feature ok; Canvas assertions ok; Chrome prod Profile2 proof ok | real generation not executed |
| 5 | `fitting-clothing-reference` | 衣服参考ライブラリ | `/model/clothing` | `/lightchain/fitting-clothing-reference` | Lightchain同等 | all-feature ok; Canvas assertions ok; Chrome prod Profile2 proof ok | real generation not executed |
| 6 | `fitting-background-reference` | 背景参考ライブラリ | `/model/background-reference` | `/lightchain/fitting-background-reference` | Lightchain同等 | all-feature ok; Canvas assertions ok; background materialKind fixed; Chrome prod Profile2 proof ok | real generation not executed |
| 7 | `wear-design-lab` | ウェアデザインラボ | `/flow/orientedDesign` | `/lightchain/wear-design-lab` | Lightchain同等 | all-feature ok; Canvas assertions ok; Stage15 proof; Chrome prod Profile2 proof ok | real generation not executed |
| 8 | `wear-design-detail` | ウェアデザイン詳細 | `/flow/orientedDesign/detail` | `/lightchain/wear-design-detail` | Lightchain同等 | all-feature ok; Canvas assertions ok; Stage15 proof; Chrome prod Profile2 proof ok | real generation not executed |
| 9 | `model-library` | モデル企画ライブラリ | `/model-library/*` | `/lightchain/model-library` | Lightchain同等 | all-feature ok; Canvas assertions ok; Stage18 proof; Chrome prod Profile2 proof ok | real generation not executed |
| 10 | `fashion-studio` | ファッションスタジオ | `/studio-equivalent` | `/lightchain/fashion-studio` | Lightchain同等 | upgraded local all-feature ok; upgraded Canvas metadata readback ok; authenticated Chrome/Profile 2 local upgraded proof ok; Chrome prod Profile2 31-route proof ok; focused production upgraded proof ok after commit `26e408d`; safe local `AI生成` click readback confirms preview history and `Canvasへ保存` | real external generation not executed |
| 11 | `design-agent` | デザインエージェント | `/agent` | `/lightchain/design-agent` | Lightchain同等 | all-feature ok; Canvas assertions ok; Chrome prod Profile2 proof ok | real generation not executed |
| 12 | `lab` | Heavy Chain Lab | `/flow/laboratory` | `/lightchain/lab` | Lightchain同等 | all-feature ok; Canvas assertions ok; Chrome prod Profile2 proof ok | real generation not executed |
| 13 | `print-design-project` | プリントデザイン | `/editor/patternDesign` | `/lightchain/print-design-project` | Lightchain同等 | all-feature ok; Canvas assertions ok; Stage17 proof; Chrome prod Profile2 proof ok | real generation not executed |
| 14 | `print-design-detail` | プリントデザイン詳細 | `/editor/patternDesign/detail` | `/lightchain/print-design-detail` | Lightchain同等 | all-feature ok; Canvas assertions ok; Stage17 proof; Chrome prod Profile2 proof ok | real generation not executed |
| 15 | `fabric-image` | 生地イメージ | `/tools/fabric` | `/lightchain/fabric-image` | Lightchain同等 | all-feature ok; Canvas assertions ok; Chrome prod Profile2 proof ok | real generation not executed |
| 16 | `line-generation` | 平絵生成 | `/tools/line` | `/lightchain/line-generation` | Lightchain同等 | all-feature ok; Canvas assertions ok; Chrome prod Profile2 proof ok | real generation not executed |
| 17 | `line-to-real` | 線画の実写化 | `/tools/line-draft-to-tile` | `/lightchain/line-to-real` | Lightchain同等 | all-feature ok; Canvas assertions ok; Chrome prod Profile2 proof ok | real generation not executed |
| 18 | `pattern-vector` | パターンをベクター画像に変換 | `/tools/pattern-to-vector` | `/lightchain/pattern-vector` | Lightchain同等 | all-feature ok; Canvas assertions ok; Chrome prod Profile2 proof ok | real generation not executed |
| 19 | `pattern-vector-pro` | パターンをベクター画像に変換 Pro | `/tools/vector-special` | `/lightchain/pattern-vector-pro` | Lightchain同等 | all-feature ok; Canvas assertions ok; Chrome prod Profile2 proof ok | real generation not executed |
| 20 | `printing-image` | プリントイメージ | `/tools/printing` | `/lightchain/printing-image` | Lightchain同等 | all-feature ok; Canvas assertions ok; Chrome prod Profile2 proof ok | real generation not executed; mask/asset use remains local proof only |
| 21 | `image-repair` | 画像修正 | `/tools/reactor` | `/lightchain/image-repair` | Lightchain同等 | all-feature ok; Canvas assertions ok; Chrome prod Profile2 proof ok | real generation not executed |
| 22 | `svg-convert` | 平絵をベクター化 | `/tools/svg-convert` | `/lightchain/svg-convert` | Lightchain同等 | all-feature ok; Canvas assertions ok; Chrome prod Profile2 proof ok | real generation not executed |
| 23 | `model-face` | 顔変更 | `/model-library/head-form` | `/lightchain/model-face` | Lightchain同等 | all-feature ok; Canvas assertions ok; Chrome prod Profile2 proof ok | real generation not executed |
| 24 | `model-change` | モデル変更 | `/model-library/model-change-form` | `/lightchain/model-change` | Lightchain同等 | all-feature ok; Canvas assertions ok; Chrome prod Profile2 proof ok | real generation not executed |
| 25 | `body-shape` | 体型 | `/model-library/body-form` | `/lightchain/body-shape` | Lightchain同等 | all-feature ok; Canvas assertions ok; Chrome prod Profile2 proof ok | real generation not executed |
| 26 | `clothing-size` | 服のサイズ | `/model-library/size-form` | `/lightchain/clothing-size` | Lightchain同等 | all-feature ok; Canvas assertions ok; Chrome prod Profile2 proof ok | real generation not executed |
| 27 | `pose-change` | ポーズ | `/model-library/pose-form` | `/lightchain/pose-change` | Lightchain同等 | all-feature ok; Canvas assertions ok; Chrome prod Profile2 proof ok | real generation not executed |
| 28 | `background-change` | 背景 | `/model-library/background-form` | `/lightchain/background-change` | Lightchain同等 | all-feature ok; Canvas assertions ok; Chrome prod Profile2 proof ok | real generation not executed |
| 29 | `angle-change` | アングル | `/model-library/perspective-form` | `/lightchain/angle-change` | Lightchain同等 | all-feature ok; Canvas assertions ok; Chrome prod Profile2 proof ok | real generation not executed |
| 30 | `model-custom` | モデルカスタマイズ | `/model-library/model-custom-form` | `/lightchain/model-custom` | Lightchain同等 | all-feature ok; Canvas assertions ok; Chrome prod Profile2 proof ok | real generation not executed |
| 31 | `custom-style` | カスタムスタイル | `/model-base/style` | `/lightchain/custom-style` | Lightchain同等 | all-feature ok; Canvas assertions ok; Stage14 proof; Chrome prod Profile2 proof ok | real generation not executed |

## Summary
- `Lightchain同等`: 31
- `ほぼ同等`: 0
- `部分一致`: 0
- `Heavy未実装`: 0 for the 31 non-video route set
- `要承認`: external/real generation verification only

## Next Safe Step
1. Treat external/real AI generation, paid/video generation, and production mutation paths as separate scoped proof, not as blockers for the 31-route UI parity slice.
2. If local-only Chrome proof is required, repeat Chrome/Profile 2 after local auth is available; do not enter credentials or bypass auth automatically.
