# Lightchain → Heavy Chain current parity matrix r69

Updated: 2026-09-21

## Current source boundary

This matrix separates current-selector route evidence from the older card-ledger evidence. It is a parity inventory and proof boundary, not a completion claim.

| Evidence layer | Current evidence | Verdict |
| --- | --- | --- |
| Lightchain category/card enumeration | Fresh card ledger from 2026-08-19, selector revision 30, 26 non-video primary cards, 19 distinct routes | Historical reference; do not use as current-selector proof |
| Lightchain public source route manifest | Official public app chunk `28i12-k8opw4o.js`, 174,552 bytes, 35 primary + 9 `detailsPath` route paths (44 total) observed 2026-09-21 | Confirmed source snapshot; authenticated UI and provider behavior remain separate |
| Lightchain route readback | Fresh current-selector revision 4 route ledger, 19/19 non-video routes with URL/title/body/visible-marker readback | Confirmed read-only route baseline; historical selector scope |
| Heavy local inventory | 31 video-excluded unified feature entries; video entries remain excluded | Confirmed local inventory |
| Heavy local workflows | Fresh 2026-09-21 artifact: 31 non-video features, 4 video dashboard/detail checks, 4 source-contract routes; 0 console/page/request failures | Confirmed local contract only |
| Heavy source-route coverage | App route parser covers 44/44 official source paths, including `/model/:modelMode` and `/model-library/:modelTool` dynamic children | Confirmed static route coverage; not visual or authenticated behavior proof |
| Priority local contracts | r67 focused suites: 43/43 | Confirmed local contract only |
| Heavy production priority UI | r62 printing and r63 fabric/model target-scoped readback | Confirmed read-only UI/input markers |
| Provider output/persistence | No current same-run production provider result → save → reuse → reload proof | PENDING_CONFIRMATION |
| Mac/Windows real Chrome acceptance | No paired current-machine acceptance artifact | PENDING_CONFIRMATION |

## Current official public source route snapshot

The canonical source reference for this revision is [https://jp.linkaigc.com/](https://jp.linkaigc.com/). The route list below was extracted from the public app chunk `/_next/static/chunks/28i12-k8opw4o.js` on 2026-09-21. It is a source-code route snapshot, not a claim that the protected workbench was authenticated or that provider calls succeeded.

| # | Official source path | Heavy App coverage |
|---:|---|---|
| 1 | `/` | exact |
| 2 | `/creator` | exact |
| 3 | `/tools/fabric` | exact |
| 4 | `/tools/line` | exact |
| 5 | `/tools/line-draft-to-tile` | exact |
| 6 | `/agent` | exact |
| 7 | `/model-base/style` | exact |
| 8 | `/tools/printing` | exact |
| 9 | `/tools/svg-convert` | exact |
| 10 | `/printing` | exact |
| 11 | `/editor/pattern` | exact |
| 12 | `/tools/pattern-to-vector` | exact |
| 13 | `/tools/vector-special` | exact |
| 14 | `/model` | exact |
| 15 | `/model/clothing` | `/model/:modelMode` |
| 16 | `/model/model-reference` | `/model/:modelMode` |
| 17 | `/model/pose-reference` | `/model/:modelMode` |
| 18 | `/model/background-reference` | `/model/:modelMode` |
| 19 | `/tools/reactor` | exact |
| 20 | `/flow/orientedDesign` | exact |
| 21 | `/flow/integration` | exact |
| 22 | `/flow/laboratory` | exact |
| 23 | `/editor/patternDesign` | exact |
| 24 | `/editor/changeColor` | exact |
| 25 | `/model-library/model-custom-form` | exact |
| 26 | `/model-library/head-form` | `/model-library/:modelTool` |
| 27 | `/model-library/model-change-form` | `/model-library/:modelTool` |
| 28 | `/model-library/body-form` | `/model-library/:modelTool` |
| 29 | `/model-library/size-form` | `/model-library/:modelTool` |
| 30 | `/model-library/pose-form` | `/model-library/:modelTool` |
| 31 | `/model-library/background-form` | `/model-library/:modelTool` |
| 32 | `/model-library/perspective-form` | `/model-library/:modelTool` |
| 33 | `/flow/GenerateShortVideo` | exact |
| 34 | `/marketing` | exact |
| 35 | `/designProduction` | exact |

The source chunk also exposed `/model` as the base route plus the four dynamic model children above; the primary snapshot has 35 paths when the base route is counted once. The static acceptance test is `test:lightchain-parity-routes`, and it asserts 44 unique source paths (35 primary + 9 detail) with zero uncovered paths. This only closes route coverage; visual diff, authenticated workbench behavior, provider result, persistence, and cross-device acceptance remain separate gates.

### Official source detail paths

The same chunk defines these nine detail transitions in addition to the 35 primary paths. They are included in the same static acceptance test.

| # | Official detail path | Heavy App coverage |
|---:|---|---|
| 1 | `/editor/pattern/detail` | exact |
| 2 | `/flow/orientedDesign/detail` | exact |
| 3 | `/flow/integration/detail` | exact |
| 4 | `/flow/laboratory/detail` | exact |
| 5 | `/editor/patternDesign/detail` | exact |
| 6 | `/editor/changeColor/detail` | exact |
| 7 | `/flow/GenerateShortVideo/detail` | exact |
| 8 | `/marketing/detail` | exact |
| 9 | `/designProduction/detail` | exact |

The resulting source route coverage is 44/44 (35 primary + 9 detail). It still does not prove authenticated controls, provider completion, persistence, or pixel equality.

## Current Lightchain primary route baseline

The current revision-4 route ledger confirms these 19 non-video routes. It proves route reachability and read-only screen markers only; input behavior, generation, output, persistence, retry/error, and performance remain separate layers.

| # | Current route | Representative marker |
|---:|---|---|
| 1 | `/designProduction` | project / fabric image / print correction entry |
| 2 | `/marketing` | brief input / recommended scenes / references |
| 3 | `/model` | single/multi task / garment / reference / model set / history |
| 4 | `/flow/orientedDesign` | saved projects / reference cases |
| 5 | `/model-library/model-custom-form` | face / body / clothing size / pose / background / angle |
| 6 | `/flow/integration` | saved projects / fashion studio |
| 7 | `/agent` | planning / inspiration / history |
| 8 | `/creator` | design selection / image / keyword / history |
| 9 | `/tools/fabric` | fabric / print / line-art / flat-drawing input and history |
| 10 | `/tools/line-draft-to-tile` | line-art type / flat-lay / style / history |
| 11 | `/editor/changeColor` | color-change project |
| 12 | `/tools/svg-convert` | input / permission / history |
| 13 | `/model-base/style` | training material / style library |
| 14 | `/flow/laboratory` | lab / reference cases |
| 15 | `/tools/reactor` | repair target / mask repair / history |
| 16 | `/printing` | image upload / generation history |
| 17 | `/tools/vector-special` | layer separation / AI generation / history |
| 18 | `/editor/pattern` | design arrangement project |
| 19 | `/editor/patternDesign` | print design / reference cases |

## Heavy non-video implementation inventory

The 31-row local inventory is the implementation surface. A local route or test pass does not promote the corresponding live Lightchain behavior or provider result.

| # | Feature ID | Category | Heavy unified route |
|---:|---|---|---|
| 1 | `marketing-home` | recommended | `/lightchain/marketing-home` |
| 2 | `marketing-detail` | planning | `/lightchain/marketing-detail` |
| 3 | `ai-fitting` | fitting | `/lightchain/ai-fitting` |
| 4 | `ai-fitting-reference` | fitting | `/lightchain/ai-fitting-reference` |
| 5 | `fitting-clothing-reference` | fitting | `/lightchain/fitting-clothing-reference` |
| 6 | `fitting-background-reference` | fitting | `/lightchain/fitting-background-reference` |
| 7 | `wear-design-lab` | recommended | `/lightchain/wear-design-lab` |
| 8 | `wear-design-detail` | planning | `/lightchain/wear-design-detail` |
| 9 | `model-library` | fitting | `/lightchain/model-library` |
| 10 | `fashion-studio` | recommended | `/lightchain/fashion-studio` |
| 11 | `design-agent` | recommended | `/lightchain/design-agent` |
| 12 | `lab` | planning | `/lightchain/lab` |
| 13 | `print-design-project` | graphics | `/lightchain/print-design-project` |
| 14 | `print-design-detail` | graphics | `/lightchain/print-design-detail` |
| 15 | `fabric-image` | graphics | `/lightchain/fabric-image` |
| 16 | `line-generation` | graphics | `/lightchain/line-generation` |
| 17 | `line-to-real` | graphics | `/lightchain/line-to-real` |
| 18 | `pattern-vector` | graphics | `/lightchain/pattern-vector` |
| 19 | `pattern-vector-pro` | graphics | `/lightchain/pattern-vector-pro` |
| 20 | `printing-image` | graphics | `/lightchain/printing-image` |
| 21 | `image-repair` | fitting | `/lightchain/image-repair` |
| 22 | `svg-convert` | graphics | `/lightchain/svg-convert` |
| 23 | `model-face` | fitting | `/lightchain/model-face` |
| 24 | `model-change` | fitting | `/lightchain/model-change` |
| 25 | `body-shape` | fitting | `/lightchain/body-shape` |
| 26 | `clothing-size` | fitting | `/lightchain/clothing-size` |
| 27 | `pose-change` | fitting | `/lightchain/pose-change` |
| 28 | `background-change` | fitting | `/lightchain/background-change` |
| 29 | `angle-change` | fitting | `/lightchain/angle-change` |
| 30 | `model-custom` | fitting | `/lightchain/model-custom` |
| 31 | `custom-style` | planning | `/lightchain/custom-style` |

## Acceptance layers

| Layer | Required same-run evidence | Current state |
|---|---|---|
| Reference | Current Lightchain category/card/route/input readback | Route layer confirmed; current-selector card enumeration remains PENDING_CONFIRMATION |
| Behavior | Input ordering, validation, loading, failure, retry, duplicate-submit behavior | Local contracts confirmed; paired production behavior PENDING_CONFIRMATION |
| Output | Provider result and visual/semantic quality readback | PENDING_CONFIRMATION |
| Persistence | Result saved and reloaded through Gallery/Canvas/History/Jobs with lineage | Local guards confirmed; production same-run proof PENDING_CONFIRMATION |
| Performance | Current Chrome desktop interaction/settle/readback timing | Local desktop layout confirmed; Mac/Windows paired acceptance PENDING_CONFIRMATION |

## Restart and stop boundary

- Exact blocker for production provider stages: `chrome_foreground_activation_capability_unavailable`.
- The latest fresh official Profile 2 capability proof advertised `viewport` only; `foreground_activation` and `management` were absent.
- After an official capability state change, create a new Profile 2 owner and run one same-run capability → `openTabs()` → owner-lineage proof. If advertised, continue fabric/printing provider → result → save/reuse/reload, then AI fitting.
- Do not reuse old browser clients, bindings, tabs, runs, or the revision-30 card ledger as current proof.
