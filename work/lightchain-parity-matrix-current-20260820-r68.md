# Lightchain → Heavy Chain current parity matrix r68

Updated: 2026-08-20

## Current source boundary

This matrix separates current-selector route evidence from the older card-ledger evidence. It is a parity inventory and proof boundary, not a completion claim.

| Evidence layer | Current evidence | Verdict |
| --- | --- | --- |
| Lightchain category/card enumeration | Fresh card ledger from 2026-08-19, selector revision 30, 26 non-video primary cards, 19 distinct routes | Historical reference; do not use as current-selector proof |
| Lightchain route readback | Fresh current-selector revision 4 route ledger, 19/19 non-video routes with URL/title/body/visible-marker readback | Confirmed read-only route baseline |
| Heavy local inventory | 31 video-excluded unified feature entries; video entries remain excluded | Confirmed local inventory |
| Heavy local workflows | r66 verifier: 31 features, 277 assertions, no console/page/request failures | Confirmed local contract only |
| Priority local contracts | r67 focused suites: 43/43 | Confirmed local contract only |
| Heavy production priority UI | r62 printing and r63 fabric/model target-scoped readback | Confirmed read-only UI/input markers |
| Provider output/persistence | No current same-run production provider result → save → reuse → reload proof | PENDING_CONFIRMATION |
| Mac/Windows real Chrome acceptance | No paired current-machine acceptance artifact | PENDING_CONFIRMATION |

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
