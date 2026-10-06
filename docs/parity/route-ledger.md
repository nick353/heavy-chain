# Route parity ledger (Light ↔ Heavy)

Viewport 1440×900 unless noted. Status: `todo` / `diffing` / `fixed-local` / `deployed` / `verified` / `unconfirmed-light` (Light state not obtainable) / `non-goal`.

| # | Route | Group | Status | Notes |
|---|---|---|---|---|
| 1 | /designProduction (project tab) | 入口 | verified | iteration 1 |
| 2 | /designProduction (dialogue tab) | 入口 | deployed | controls fixed; scene hover/selected states still to compare |
| 3 | /designProduction/detail | 入口 | todo | needs an existing conversation project |
| 4 | header / avatar menu / language / help | 入口 | todo | |
| 5 | /asset-center | 素材 | todo | |
| 6 | /board, /board/edit | 素材 | todo | |
| 7 | /creator | 作成 | verified | Light account is locked (購入後に使用可能); unlocked layout taken from Light demo video. Fixed: \\n placeholder bug, style panel, video 624px, keyword box 401px, option badges, 32px category button. **unconfirmed-light**: style panel after category selection, generate button label when unlocked |
| 8 | /printing | 作成 | verified | Light = AIグラフィックデザイン (print-design-project), not printing-image. Rebuilt to measured Light layout (empty + after-upload states). Real provider run job `ai-5aabfebc-f7fe-4fcd-af08-6ed5b42df8b7`; reload restores input + result. **unconfirmed-light**: strength labels other than 中, assist analysis output, unlocked generate label, result presentation |
| 9 | /tools/fabric | 作成 | verified | 生地イメージ. Fixed: controls row (select 202px / button 288px), closable banner, keyword box, removed in-browser preview gate (ONNX cutout hangs), session-key remount that wiped inputs/results on first generation, auto-scroll to newest result. Real provider run job `ai-be179dd6-4794-406e-92d7-ac5624912ae9` (gpt-image-1-mini, generated_images row present); inputs stay after generation; reload restores both results. **unconfirmed-light**: inputs are not restored after reload (Light behaviour unknown); console warns `Failed to persist local workspace artifact during save` (result still shown, P4) |
| 10 | /tools/printing | 作成 | verified | プリントイメージ. Rebuilt render on shared `LightchainDesignToolFrame` (same rail/tabs/notice as fabric): 564×280 reference box, プリントをアップロード+リセット, 244px スポット／全体, 120px print tile, AI生成 288×40 at (404,828) = Light. Kept draft restore + Canvas handoff; added pending 照合, navigation lock, Heavy workspace gate. Real run `ai-dfa6dbf0-4896-4ac8-8e32-e72873f931d1` (white tee + artwork, spot) → print centred on chest; reload restores via resumeJob. **unconfirmed-light**: result-panel presentation after generation (Light not generated) |
| 11 | /tools/line-draft-to-tile, /tools/line | 作成 | verified | 線画の実写化 / 平絵生成. Light shows 権限がありません (locked); Heavy runs real generation. New `LightchainLineToolsPage` on the shared frame + canonical workspace (features line-to-real / line-generation, edit-image). Geometry = Light (box 216–496, toggle 552, select 620 (288px, fixed 平置き画像/線画), style note 690–812, AI生成 828). Runs: 平絵生成 `ai-101aadd2…` (white tee → clean flat sketch), 線画の実写化 `ai-959749a0…` (sketch + モノクロ + デニム note → denim tee). Reload restores input, toggle, note and result. **unconfirmed-light**: unlocked button label and result presentation |
| 12 | /tools/pattern-to-vector, /tools/vector-special | 作成 | verified (raster) | ベクター化 通常版 (Light: 権限がありません) / プロ版 (Light usable, 使用回数 7/30, AI生成 1). Shared frame with 278px tabs + グラフィック rail; Light pileUp/carveUp cards 160×165; AI生成 at (404,828). Runs: pro `ai-b6dad42d…` (first brief drew a tee — brief fixed), 通常版 `ai-f41f75aa…` → clean flat redraw. Result is still a raster PNG ("保存された結果はラスター画像です。"); real SVG output tracked in P2 |
| 13 | /tools/svg-convert | 作成 | todo | |
| 14 | /tools/reactor | 作成 | todo | |
| 15 | /editor/pattern (+detail) | 作成 | todo | |
| 16 | /editor/patternDesign (+detail) | 作成 | todo | |
| 17 | /editor/changeColor (+detail) | 作成 | todo | |
| 18 | /model, /model/:mode | モデル | todo | |
| 19 | /model-library/* , /model-library/model-custom-form | モデル | todo | |
| 20 | /model-base/style | モデル | todo | custom-style |
| 21 | /marketing (+detail) | 機能 | todo | |
| 22 | /flow/integration (+detail) | 機能 | todo | |
| 23 | /flow/laboratory (+detail) | 機能 | todo | Wear/Lab |
| 24 | /flow/orientedDesign (+detail) | 機能 | todo | |
| 25 | /agent | 機能 | todo | 企画提案書 |
| 26 | /canvas/:id | Canvas | todo | |
| 27 | /flow/GenerateShortVideo | 機能 | non-goal (video) | difference recorded only |
| 28 | Heavy-only: /gallery, /history, /jobs | 素材 | todo | confirm Light equivalent (asset-center?) |
