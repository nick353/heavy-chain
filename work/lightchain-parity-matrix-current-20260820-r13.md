# Lightchain / Heavy parity matrix — current rev6 checkpoint r13 with r14 overlay

更新日: 2026-08-20

## 1. latest Lightchain source-of-truth overlay r14

- Fresh official Chrome Plugin / Profile 2 target-scoped homepage readback:
  browser-client `-ada4-4997-8241-a6447bcb922e`, task tab `1980903824`.
- URL/title: `https://jp.linkaigc.com/` / `Lightchain AI`.
- Accessibility snapshot: four category tabs (`おすすめ Hot`, `企画デザインツール`, `AIフィッティング`, `グラフィックツール`).
- Default recommended panel: 8 visible cards, 7 non-video and 1 video (`動画ワークステーション`).
- Case-share tabs: 6 visible tabs; the default panel includes one video case.
- Cleanup: `cleanup_verified=true`, closed only task-owned tab `1980903824`, no close failures.
- No category switching or business/external effect occurred.
- Full category-panel routes and per-feature behavior remain `PENDING_CONFIRMATION`.
- Detail artifact: `work/lightchain-parity-baseline-20260820-r14.md`.

The r13 homepage readback below remains historical within this file for
provenance; the r14 overlay is the current homepage baseline.

## 2. prior current Lightchain source-of-truth readback (r13)

- surface: official Chrome Plugin / Profile 2 / `signed_chrome_extension_profile2`
- selector: `backend=chrome_plugin`, revision `6`
- fresh browser-client: `-2018-4d21-90a6-b0e78b43c518`
- homepage: `https://jp.linkaigc.com/`, title `Lightchain AI`
- same-run target-scoped task tab: `1980903811`
- cleanup: `ok=true`, closed only task-owned tab `1980903811`, close failures `[]`
- external effect: none

Fresh homepage body readback showed:

- four category labels: `おすすめ`, `企画デザインツール`, `AIフィッティング`, `グラフィックツール`
- default `おすすめ` visible cards: 7
- default visible video card: `動画ワークステーション` 1件
- default visible non-video cards: 6件
- current homepage accessibility snapshot: `- alert` only; full card accessibility completeness is `PENDING_CONFIRMATION`

The current rev6 priority-route evidence remains:

- `/tools/fabric`: `生地イメージ`, model/design input, material input, keyword, ratio, history
- `/tools/printing`: `プリントイメージ`, history and printing description
- `/model`: `AIフィッティング`, garment image inputs, reference/model-set inputs, quality selector, history

Source artifact: `work/lightchain-profile2-current-parity-readback-20260820-r4.md`.

## 3. card-ledger provenance

The prior fresh card ledger at `/Users/nichikatanaka/Documents/Codex/2026-08-17/new-chat/work/lightchain-profile2-non-video-card-ledger-20260819T082439.json` recorded 26 non-video card occurrences, 2 excluded video cards, and 19 distinct routes under selector revision 30. It is retained as a historical reference only. It is not silently promoted to current revision-6 proof.

The current revision-6 full category-card enumeration and complete accessibility snapshot are `PENDING_CONFIRMATION` because the target-scoped read-only run observed the homepage category controls but did not mutate category selection or claim/focus a foreground tab.

## 4. 31 non-video feature contract ledger

All rows below have current Heavy local route/contract coverage from the latest `featureCount=31 / failed=[]` verifier. A local contract does not prove Lightchain live behavior or Heavy production business completion; those layers remain explicitly separate.

| row | Heavy local contract | Lightchain live per-feature operation | Heavy production generation/save/reuse |
| --- | --- | --- | --- |
| `marketing-home` | verified | PENDING_CONFIRMATION | PENDING_CONFIRMATION |
| `marketing-detail` | verified | PENDING_CONFIRMATION | PENDING_CONFIRMATION |
| `ai-fitting` | verified | PENDING_CONFIRMATION | PENDING_CONFIRMATION |
| `ai-fitting-reference` | verified | PENDING_CONFIRMATION | PENDING_CONFIRMATION |
| `fitting-clothing-reference` | verified | PENDING_CONFIRMATION | PENDING_CONFIRMATION |
| `fitting-background-reference` | verified | PENDING_CONFIRMATION | PENDING_CONFIRMATION |
| `wear-design-lab` | verified | PENDING_CONFIRMATION | PENDING_CONFIRMATION |
| `wear-design-detail` | verified | PENDING_CONFIRMATION | PENDING_CONFIRMATION |
| `model-library` | verified | PENDING_CONFIRMATION | PENDING_CONFIRMATION |
| `fashion-studio` | verified | PENDING_CONFIRMATION | PENDING_CONFIRMATION |
| `design-agent` | verified | PENDING_CONFIRMATION | PENDING_CONFIRMATION |
| `lab` | verified | PENDING_CONFIRMATION | PENDING_CONFIRMATION |
| `print-design-project` | verified | PENDING_CONFIRMATION | PENDING_CONFIRMATION |
| `print-design-detail` | verified | PENDING_CONFIRMATION | PENDING_CONFIRMATION |
| `fabric-image` | verified | PENDING_CONFIRMATION | PENDING_CONFIRMATION |
| `line-generation` | verified | PENDING_CONFIRMATION | PENDING_CONFIRMATION |
| `line-to-real` | verified | PENDING_CONFIRMATION | PENDING_CONFIRMATION |
| `pattern-vector` | verified | PENDING_CONFIRMATION | PENDING_CONFIRMATION |
| `pattern-vector-pro` | verified | PENDING_CONFIRMATION | PENDING_CONFIRMATION |
| `printing-image` | verified | PENDING_CONFIRMATION | PENDING_CONFIRMATION |
| `image-repair` | verified | PENDING_CONFIRMATION | PENDING_CONFIRMATION |
| `svg-convert` | verified | PENDING_CONFIRMATION | PENDING_CONFIRMATION |
| `model-face` | verified | PENDING_CONFIRMATION | PENDING_CONFIRMATION |
| `model-change` | verified | PENDING_CONFIRMATION | PENDING_CONFIRMATION |
| `body-shape` | verified | PENDING_CONFIRMATION | PENDING_CONFIRMATION |
| `clothing-size` | verified | PENDING_CONFIRMATION | PENDING_CONFIRMATION |
| `pose-change` | verified | PENDING_CONFIRMATION | PENDING_CONFIRMATION |
| `background-change` | verified | PENDING_CONFIRMATION | PENDING_CONFIRMATION |
| `angle-change` | verified | PENDING_CONFIRMATION | PENDING_CONFIRMATION |
| `model-custom` | verified | PENDING_CONFIRMATION | PENDING_CONFIRMATION |
| `custom-style` | verified | PENDING_CONFIRMATION | PENDING_CONFIRMATION |

Excluded rows:

- `video-workstation`
- `video-detail`

## 5. behavioral parity dimensions

| dimension | current Lightchain evidence | Heavy evidence | status |
| --- | --- | --- | --- |
| homepage/category information architecture | current rev6 URL/title/body readback; four categories visible | local Lightchain-shaped shell and launcher contracts | partially verified |
| library/input controls | current rev6 priority-route controls read | local material/UI and fitting input contracts | partially verified |
| provider generation | no effectful Lightchain operation in read-only baseline | local provider adapter and persistence contracts only | PENDING_CONFIRMATION |
| result quality and visual comparison | no live result generated in current baseline | no same-run production result | PENDING_CONFIRMATION |
| save and reload | no live Lightchain save in current baseline | local persistence/reload contracts | PENDING_CONFIRMATION |
| Gallery/Canvas/History/Jobs lineage | no new Lightchain effectful run | local lineage/readback contracts | PENDING_CONFIRMATION |
| failed generation and retry | no live Lightchain failure/retry run | local retry and recovery contracts | PENDING_CONFIRMATION |
| performance | current target readback transport/hydration only | local desktop 228/228 | PENDING_CONFIRMATION for production parity |
| video | visible in Lightchain baseline, explicitly excluded from Heavy scope | Heavy video provider fail-closed and hidden from non-video launcher | verified scope exclusion |

## 6. current Heavy gate

- Heavy `/tools/fabric` semantic hydration: verified in `work/heavy-chain-semantic-hydration-readback-20260820-r8.md`.
- Local non-video and desktop contracts: verified in `work/heavy-chain-local-acceptance-r4-20260820.md`.
- Production provider generation gate: `chrome_foreground_activation_capability_unavailable`.
- G619 real beta: `acceptance=not_claimed`, sessions `0/3`.
- H601 operator readiness: `missingCount=10`.

## next action

1. Keep this matrix as the current source-of-truth boundary.
2. Do not reuse the revision-30 card counts as revision-6 proof.
3. After foreground capability advertisement, execute the bounded fabric-print generation/save/reuse flow in a fresh Profile 2 owner and fill the behavioral columns with same-run evidence.
4. Then perform the equivalent AI-fitting flow and only afterward close Mac/Windows and internal-beta acceptance.
