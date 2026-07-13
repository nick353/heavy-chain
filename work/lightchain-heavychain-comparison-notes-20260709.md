# Lightchain / Heavy Chain 比較メモ - 2026-07-09

## 結論
- Lightchain の同名機能は Heavy Chain に実装されている。
- ただし、UI の構成は 1:1 ではなく、Heavy 側は共通ワークベンチ化されている。
- 画像のスクリーンショットは Lightchain ではなく Heavy 側 `PatternWorkspacePage` に一致する。

## 見比べた正本
- Lightchain 実画面契約: `work/lightchain-heavychain-ui-comparison-20260707.md`
- Heavy 実装: `src/pages/LightchainWorkbenchPage.tsx`
- Heavy スクリーンショット一致頁: `src/pages/PatternWorkspacePage.tsx`
- 既存マトリクス: `work/lightchain-completion-matrix-20260707.md`

## 同名項目の比較

### 1. fabric-image / 生地イメージ
- Lightchain: `生地イメージ` タブ。必須アップロード 2 項目、比率選択、`AI生成`、`生成履歴` の流れ。
- Heavy: `fabric-image` はあるが、汎用 `lightchain-input-material-panel` に載る。`素材を選択`、`参考画像をアップロードしてください`、`画像比率`、`AI生成` はある。
- 判定: 機能名は一致。UI は近いが、スクリーンショット契約とは別構成。

### 2. printing-image / プリントイメージ
- Lightchain: `プリントイメージ` は sibling tab の 1 枚。
- Heavy: `printing-image` は存在し、専用 detail 面ではなく共通実装の一部。
- 判定: 機能名は一致。UI は共通ワークベンチ寄り。

### 3. line-to-real / 線画の実写化
- Lightchain: `線画の実写化` タブ。線画種別、説明欄、履歴、生成結果の流れ。
- Heavy: `line-to-real` は専用条件と `AI生成` があり、方向性は近い。
- 判定: 機能名は一致。文言とレイアウトは完全一致ではない。

### 4. line-generation / 平絵生成
- Lightchain: `平絵生成` タブ。線画/モデル図の切替、生成画像の種類、履歴。
- Heavy: `line-generation` はあるが、同様に共通面の中で提供される。
- 判定: 機能名は一致。UI は一致しない。

### 5. pattern-vector / svg-convert / image-repair
- Lightchain: 類似のグラフィック系機能群として存在。
- Heavy: 個別 route として分割実装されている。
- 判定: 名前は揃っているが、共通基盤化されている。

## 仕様差として扱うもの
- Heavy 側の `素材作業台`、`現在の制作Brief`、`素材スロット` は Lightchain そのものではなく、Heavy の別ワークスペース。
- スクリーンショットに一致するのはこの Heavy 側ページで、Lightchain の `fabric` 画面ではない。

## 修正要否
- いまの証拠では、明確なバグ修正ではなく「比較結果の確定」が先。
- もし修正するなら、Lightchain の直感的なタブ構成に寄せる UI 変更が候補。
- ただし、既存の completion matrix が 31 routes を Lightchain同等としているため、修正前にどの route を対象とするかを再定義する必要がある。

## Route 分類

### 一致寄り
- `marketing-home`
- `marketing-detail`
- `ai-fitting`
- `ai-fitting-reference`
- `fitting-clothing-reference`
- `fitting-background-reference`
- `wear-design-lab`
- `wear-design-detail`
- `model-library`
- `design-agent`
- `lab`
- `print-design-project`
- `print-design-detail`
- `model-face`
- `model-change`
- `body-shape`
- `clothing-size`
- `pose-change`
- `background-change`
- `angle-change`
- `model-custom`
- `custom-style`

### UI差が目立つが機能は揃う
- `fabric-image`
- `printing-image`
- `line-to-real`
- `line-generation`
- `pattern-vector`
- `pattern-vector-pro`
- `svg-convert`
- `image-repair`

### 仕様差として扱う
- `素材作業台`
- `現在の制作Brief`
- `素材スロット`
- スクリーンショットに出ていた Heavy 側 `PatternWorkspacePage`

## 修正候補
- もし Lightchain 実画面との完全一致を優先するなら、`fabric-image` と `line-generation` の detail 導線を優先して詰める。
- ただし、現状の `31 routes Lightchain同等` マトリクスは機能名ベースで成立しているため、修正は UI 契約の見直しとして扱うべき。

## 追加のChrome実画面確認

### fabric-image
- Lightchain live text: `生地イメージ`, `モデル/デザイン画像*`, `生地画像*`, `画像比率自動`, `AI生成`, `生成履歴`.
- Heavy live text: `生地イメージ` title exists, same required upload language, `画像比率自動`, `AI生成`, `生成履歴`.
- Conclusion: UI contract is very close, but Heavy keeps it inside the shared workbench shell.

### printing-image
- Lightchain live text: `プリントイメージ`, `プリントをアップロード`, `スポット`, `全体`, `AI生成`, `生成履歴`.
- Heavy live text: same feature name and same control words appear, but still inside the shared shell.
- Conclusion: feature parity is strong; layout is still not the original Lightchain sibling-tab shell.

### line-to-real
- Lightchain live text: `線画の実写化`, `カラー線画`, `モノクロ線画`, `生成画像の種類`, `平置き画像`, `スタイルのカスタム説明`, `AI生成`, `生成履歴`.
- Heavy live text: same feature name and same core controls appear.
- Conclusion: behavior contract matches closely, while navigation shell differs.

### line-generation
- Lightchain live text: `平絵生成`, `平置き画像`, `モデル図`, `生成画像の種類`, `線画`, `AI生成`, `生成履歴`.
- Heavy live text: same feature name and same control pair appear.
- Conclusion: functionally aligned, but not a sibling-tab page like the Lightchain screenshot.

### svg-convert
- Heavy live text: `平絵をベクター化`, `AI生成`, `生成履歴`.
- Conclusion: this one is closer to a simplified graphics tool than the detailed Lightchain sibling-tab contract.

### `video-workstation` / `video-detail`
- Heavy live text: `APPAREL AI DESIGN WORKSPACE`, `HEAVY CHAIN AI`, `生成、フィッティング、柄、Canvas編集まで進めるアパレル特化AIワークスペース。`, `生成を始める`, `ログイン`, `指示を入力してください...`.
- Conclusion: these routes behave as the broader Heavy Chain entry shell, not as a Lightchain-style sibling-tab generator page.

### `fashion-studio`
- Heavy live text: `ファッションスタジオ`, `スタジオ案`, `コーディネート`, `360度表示`, `スタジオ案履歴`.
- Conclusion: this route is a dedicated studio workspace and fits the Lightchain-derived feature family, but it is not the same shell as the Lightchain `fabric` screenshot.
