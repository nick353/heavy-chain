# Lightchain Profile 2 current-selector non-video route ledger r55

## Read-only scope

- selector: `chrome_plugin / Profile 2 / signed_chrome_extension_profile2 / revision=4`
- first fresh browser boundary: `9c69577a-56d3-468b-809f-fe348f9add86`
- focused hydration retry boundary: `290cdf70-e430-4147-b8d6-a9823d666e73`
- browser ids: `-7cff-4674-8194-77ed35ecd0e8`, `-ed11-4cae-b072-380c38e57bc8`
- owner session/thread: `01a01576-c224-7d81-902f-561719dc45a5`
- owner turn: `01a01dab-63b8-7b03-883e-2035c6567e49`
- `selected`/focus/claim: not used
- `external_action_executed`: `false`

## Result

All 19 non-video candidate routes were reached under the current selector and
returned exact URL/title. The first pass obtained complete body readback for
10 routes; 9 routes were `readyState=interactive` with an empty body at the
1.5-second bounded wait. Those 9 routes were given one focused 5-second
hydration retry in a new owner and all 9 then returned `readyState=complete` and
non-empty body readback.

| name | route | final readback | representative current marker |
| --- | --- | --- | --- |
| デザインワークスペース | `/designProduction` | PASS | プロジェクト／生地イメージ／プリント修正入口 |
| マーケティングワークスペース | `/marketing` | PASS | 企画入力／おすすめシーン／参考事例 |
| AIフィッティング | `/model` | PASS | シングル／マルチ、衣服、説明／参考／モデルセット、履歴 |
| ウェアデザインラボ | `/flow/orientedDesign` | PASS | 保存プロジェクト／参考事例 |
| モデル企画ライブラリ | `/model-library/model-custom-form` | PASS | 顔・体型・服サイズ・ポーズ・背景・アングル |
| ファッションスタジオ | `/flow/integration` | PASS | 保存プロジェクト／ファッションスタジオ |
| デザインエージェント | `/agent` | PASS | 企画案／インスピレーション／履歴 |
| インスピレーション | `/creator` | PASS | デザイン選択／画像／キーワード／履歴 |
| 生地プリントの試着シミュレーション | `/tools/fabric` | PASS | 生地・プリント・線画・平絵、入力、権限、履歴 |
| 線画から実写へ変換 | `/tools/line-draft-to-tile` | PASS | 線画タイプ、平置き、スタイル、権限、履歴 |
| 色変更 | `/editor/changeColor` | PASS | 色変更プロジェクト |
| 平絵をベクター化 | `/tools/svg-convert` | PASS | 入力、権限、履歴 |
| カスタムスタイル | `/model-base/style` | PASS | 学習素材、スタイルライブラリ |
| Lightchain Lab | `/flow/laboratory` | PASS | Lab／参考事例 |
| 画像修正 | `/tools/reactor` | PASS | 修復対象、マスク修正、権限、履歴 |
| AIグラフィックデザイン | `/printing` | PASS | 画像アップロード、生成履歴 |
| パターンをベクター画像に変換（プロフェッショナル版） | `/tools/vector-special` | PASS | レイヤー分け、AI生成、履歴 |
| デザインアレンジ | `/editor/pattern` | PASS | デザインアレンジプロジェクト |
| プリントデザイン | `/editor/patternDesign` | PASS | プリントデザイン／参考事例 |

Task-owned provisioning tabs from both passes were closed successfully. No
foreign tab was changed.

## Proof boundary

- This ledger proves current route reachability and read-only URL/title/DOM
  screen baselines only.
- It does not prove card-to-route mapping, category-panel enumeration,
  per-feature provider generation, result quality, save, Gallery/Canvas/History/
  Jobs lineage, reuse, reload, retry/error behavior, or production performance.
- Video routes are excluded from this ledger and Heavy scope.
- Those behavioral layers remain `PENDING_CONFIRMATION`, with production
  foreground work additionally blocked by
  `chrome_foreground_activation_capability_unavailable`.
