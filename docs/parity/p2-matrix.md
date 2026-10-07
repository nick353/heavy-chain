# P2 strict31 matrix (2026-10-07)

Common conditions from the handoff: (a) Light's own screen/inputs, (b) original input kept, (c) same-run request/job/image in D1 (+ private R2 path), (d) Gallery/Canvas/History/Jobs surfaces, (e) reload/reuse, (f) confirmed failure + recovery without unknown replay, (g) full-size quality.

Evidence sources: `route-ledger.md` (a, b, e — each route verified against Light at 1440×900 and after reload) and D1 `heavy_ai_requests` ⋈ `generated_images` queried 2026-10-07 (c — every listed job `completed` with exactly 1 stored image; `feature_type` shown).

Legend: ✅ evidenced · ◻ not yet evidenced for this row · — not applicable (reason given).

| feature | route (#) | job (D1 completed, 1 image) | a | b | c | d | e | f | g |
|---|---|---|---|---|---|---|---|---|---|
| marketing-home | /marketing (21) | ai-ce0299f2 `marketing-dialogue` | ✅ | ✅ | ✅ | ◻ | ✅ | ◻ | ◻ |
| marketing-detail | /marketing/detail (21) | ai-c7037b09 `marketing-dialogue` (follow-up turn 2 in project 3557a8a9) | ✅ | ✅ | ✅ | ◻ | ✅ | ◻ | ◻ |
| fitting-clothing-reference | /model (18) | — generic ai-be628dda only | ✅ | ◻ | ◻ | ◻ | ◻ | ◻ | ◻ |
| fitting-background-reference | /model (18) | — | ✅ | ◻ | ◻ | ◻ | ◻ | ◻ | ◻ |
| wear-design-lab | /flow/orientedDesign (24) | ai-32c0b07f `lightchain-wear-design-lab` | ✅ | ✅ | ✅ | ◻ | ✅ | ◻ | ◻ |
| wear-design-detail | (24) detail | — | ✅ | ◻ | ◻ | ◻ | ◻ | ◻ | ◻ |
| fashion-studio | /flow/integration (22) | ai-95b6af64 `fashion-studio-detail-generated-result` | ✅ | ✅ | ✅ | ◻ | ✅ | ◻ | ◻ |
| design-agent | /agent (25) | ai-be119a6a `lightchain-design-agent` | ✅ | ✅ | ✅ | ◻ | ✅ | ◻ | ◻ |
| lab | /flow/laboratory (23) | ai-b55722a0 `lightchain-lab` | ✅ | ✅ | ✅ | ◻ | ✅ | ◻ | ◻ |
| print-design-project | /printing (8) | ai-5aabfebc `lightchain-print-design-project` | ✅ | ✅ | ✅ | ◻ | ✅ | ◻ | ◻ |
| print-design-detail | (8) detail | — | ✅ | ◻ | ◻ | ◻ | ◻ | ◻ | ◻ |
| fabric-image | /tools/fabric (9) | ai-be179dd6 `lightchain-fabric-image` | ✅ | ✅ | ✅ | ◻ | ✅ | ◻ | ◻ |
| line-generation | /tools/line (11) | ai-101aadd2 | ✅ | ✅ | ✅ | ◻ | ✅ | ◻ | ◻ |
| line-to-real | /tools/line-draft-to-tile (11) | ai-959749a0 | ✅ | ✅ | ✅ | ◻ | ✅ | ◻ | ◻ |
| pattern-vector | /tools/pattern-to-vector (12) | ai-f41f75aa | ✅ | ✅ | ✅ | ◻ | ✅ | ◻ | ◻ |
| pattern-vector-pro | /tools/vector-special (12) | ai-b6dad42d | ✅ | ✅ | ✅ | ◻ | ✅ | ◻ | ◻ |
| printing-image | /tools/printing (10) | ai-dfa6dbf0 | ✅ | ✅ | ✅ | ◻ | ✅ | ◻ | ◻ |
| image-repair | /tools/reactor (14) | ai-62130895 | ✅ | ✅ | ✅ | ◻ | ✅ | ◻ | ◻ |
| svg-convert | /tools/svg-convert (13) | ai-c900cd58 (+ real SVG export) | ✅ | ✅ | ✅ | ◻ | ✅ | ◻ | ◻ |
| custom-style | /model-base/style (20) | — non-generation (style_presets row + design_assistant_requests 57c092c1) | ✅ | ✅ | ✅ | — | ✅ | ◻ | — |
| ai-fitting | /model (18) | — generic ai-be628dda `model-matrix` | ✅ | ◻ | ◻ | ◻ | ◻ | ◻ | ◻ |
| ai-fitting-reference | /model/:mode (18) | — | ✅ | ◻ | ◻ | ◻ | ◻ | ◻ | ◻ |
| model-library | /model-library (19) | ai-f035b13b | ✅ | ✅ | ✅ | ◻ | ✅ | ◻ | ◻ |
| model-face | (19) head | ai-c56447bb | ✅ | ✅ | ✅ | ◻ | ✅ | ◻ | ◻ |
| model-change | (19) | ai-80210c48 | ✅ | ✅ | ✅ | ◻ | ✅ | ◻ | ◻ |
| body-shape | (19) body | ai-3e40c8e0 | ✅ | ✅ | ✅ | ◻ | ✅ | ◻ | ◻ |
| clothing-size | (19) size | ai-9b9b85cc | ✅ | ✅ | ✅ | ◻ | ✅ | ◻ | ◻ |
| pose-change | (19) pose | ai-6e11e91b | ✅ | ✅ | ✅ | ◻ | ✅ | ◻ | ◻ |
| background-change | (19) background | ai-ba4a5fba | ✅ | ✅ | ✅ | ◻ | ✅ | ◻ | ◻ |
| angle-change | (19) angle | ai-cb7af975 | ✅ | ✅ | ✅ | ◻ | ✅ | ◻ | ◻ |
| model-custom | /model-library/model-custom-form (19) | ai-f035b13b (tagged `lightchain-model-library`) | ✅ | ✅ | ✅ | ◻ | ✅ | ◻ | ◻ |

## Open work, in order
1. Per-row runs still missing (6 rows): wear-design-detail, print-design-detail, ai-fitting, ai-fitting-reference, fitting-clothing-reference, fitting-background-reference.
2. (d) four surfaces per run: check each job id appears in /gallery, /history, /jobs (and Canvas where Light has one).
3. (f) one confirmed failure + recovery per row type (never replaying an unknown-effect operation).
4. (g) full-size quality review per feature rubric.
5. (c) private-R2 object existence for each `storage_path` (needs R2 read access).
