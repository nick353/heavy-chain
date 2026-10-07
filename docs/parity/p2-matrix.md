# P2 strict31 matrix (2026-10-07)

Common conditions from the handoff: (a) Light's own screen/inputs, (b) original input kept, (c) same-run request/job/image in D1 (+ private R2 path), (d) Gallery/Canvas/History/Jobs surfaces, (e) reload/reuse, (f) confirmed failure + recovery without unknown replay, (g) full-size quality.

Evidence sources: `route-ledger.md` (a, b, e — each route verified against Light at 1440×900 and after reload) and D1 `heavy_ai_requests` ⋈ `generated_images` queried 2026-10-07 (c — every listed job `completed` with exactly 1 stored image; `feature_type` shown).

Legend: ✅ evidenced · △ evidenced with a quality issue (see Quality review) · ◻ not yet evidenced for this row · — not applicable (reason given).

| feature | route (#) | job (D1 completed, 1 image) | a | b | c | d | e | f | g |
|---|---|---|---|---|---|---|---|---|---|
| marketing-home | /marketing (21) | ai-ce0299f2 `marketing-dialogue` | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ |
| marketing-detail | /marketing/detail (21) | ai-c7037b09 `marketing-dialogue` (follow-up turn 2 in project 3557a8a9) | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ |
| fitting-clothing-reference | /model/clothing (18) | ai-3ba338d8 `edit-image` (garment + 参考画像 model, inputImageCount 2) | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ |
| fitting-background-reference | /model/background-reference (18) | ai-cade89c9 `edit-image` (garment + model + background, inputImageCount 3) | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ |
| wear-design-lab | /flow/orientedDesign (24) | ai-32c0b07f `lightchain-wear-design-lab` | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ |
| wear-design-detail | /flow/orientedDesign/detail (24) | ai-99ff43af `lightchain-wear-design-detail` | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ |
| fashion-studio | /flow/integration (22) | ai-95b6af64 `fashion-studio-detail-generated-result` | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ |
| design-agent | /agent (25) | ai-be119a6a `lightchain-design-agent` | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ |
| lab | /flow/laboratory (23) | ai-b55722a0 `lightchain-lab` | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ |
| print-design-project | /printing (8) | ai-5aabfebc `lightchain-print-design-project` (+ ai-bba23e61, ai-ed699633, ai-1ac6dced, ai-ed398fc1, ai-fcedf521) | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ |
| print-design-detail | /editor/patternDesign/detail (8) | ai-7669333b `lightchain-pattern-print-design` (route #8 run) | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ |
| fabric-image | /tools/fabric (9) | ai-be179dd6 `lightchain-fabric-image` | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ |
| line-generation | /tools/line (11) | ai-101aadd2 | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ |
| line-to-real | /tools/line-draft-to-tile (11) | ai-959749a0 | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ |
| pattern-vector | /tools/pattern-to-vector (12) | ai-f41f75aa | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ |
| pattern-vector-pro | /tools/vector-special (12) | ai-b6dad42d (+ ai-6395b84a) | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ |
| printing-image | /tools/printing (10) | ai-dfa6dbf0 | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ |
| image-repair | /tools/reactor (14) | ai-62130895 | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ |
| svg-convert | /tools/svg-convert (13) | ai-c900cd58 (+ real SVG export; ai-78733149) | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ |
| custom-style | /model-base/style (20) | — non-generation (style_presets row + design_assistant_requests 57c092c1) | ✅ | ✅ | ✅ | — | ✅ | ◻ | — |
| ai-fitting | /model (18) | ai-f90badcb `model-matrix` (garment + 説明生成 text) | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ |
| ai-fitting-reference | /model?tab=参考図 (18) | ai-1368e577 `model-matrix` (garment + 参考画像 model, inputImageCount 2) | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ |
| model-library | /model-library (19) | ai-f035b13b | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ |
| model-face | (19) head | ai-c56447bb | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ |
| model-change | (19) | ai-80210c48 | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ |
| body-shape | (19) body | ai-3e40c8e0 | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ |
| clothing-size | (19) size | ai-9b9b85cc (+ ai-91ab68c8, ai-95b8504c) | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ |
| pose-change | (19) pose | ai-6e11e91b | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ |
| background-change | (19) background | ai-ba4a5fba | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ |
| angle-change | (19) angle | ai-cb7af975 (+ ai-5af143da) | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ |
| model-custom | /model-library/model-custom-form (19) | ai-f035b13b (tagged `lightchain-model-library`) | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ |

## Open work, in order
1. Per-row runs: done for all 31 rows (a, b, c, e).
2. (d) done 2026-10-07: production /jobs and /history (same 50-job timeline) list a completed job for every generating row (task names read from the page); /gallery shows the newest results as thumbnails. Light has no /gallery, /history or /jobs (route #28), so Canvas checks follow each row's own route.
3. (f) partly: input failure on /model (model-matrix) — a corrupt PNG is rejected before any request (衣服の画像 0/4, AI生成 disabled, no new D1 row); a valid upload in a new tab recovers (1/4, AI生成 enabled). The rejection shows the toast 「画像の寸法を読み込めませんでした。」 (observed on a second run; the first check read the page after the toast had closed). Provider-side failure (2026-10-07 20:02–20:05, /tools/pattern-to-vector, edit-image): OpenAI answered HTTP 429 three times (ai-a6cc0864, ai-c9b0b5aa, ai-803eb67a — D1 state failed, error_code image_provider_request_rejected, candidate descriptor status 429). The page shows 「画像の生成に失敗しました。保存済みの結果は保持されています。」, keeps the input, and AI生成 stays usable; each retry was a new known-failed request (no unknown replay). Recovery: after the account owner added credit, the same tab's next AI生成 completed (ai-a790ff1d, 20:21 UTC) — failed requests stayed failed, nothing was replayed.
4. (g) done 2026-10-07 — full-size (1024 px) review of every row's own result:
   - OK: the four fitting rows (garment kept: bow, ruffled front, double bell sleeves, colour), ai-fitting, wear-design-detail (short sleeves), wear-design-lab (navy trim), marketing home/detail, design dialogue, design agent (board), fashion studio, background/pose/body/model/face change, model library, print-design-detail (repeat on garment), image-repair, line-generation, line-to-real (denim), printing-image, fabric-image.
   - lab: first run drew a polo-player-like mark; after PR #14 the re-run (ai-fa8de647) is a simple abstract navy mark → ✅.
   - △ pattern-vector / pattern-vector-pro / svg-convert: the test input had a black background; outputs kept a dark glowing background (and pro drew a T-shirt). Re-run of pattern-vector with a white-background copy (ai-85578203): clean flat colours on white, but the open red arch became a closed ring. After PR #14, the original black-background input (ai-a790ff1d) gives a white background, no glow, and the arch stays open → pattern-vector ✅; pro / svg-convert use the same brief change but were not re-run.
   - △ angle-change: back view has an invented "ANGL." neck label. △ clothing-size: requested bottoms L→XXL; the jeans look unchanged. △ print-design-project ai-5aabfebc: drawn on a hoodie mockup (the later run asks for graphic only).
   - 2026-10-07 21:00–21:18, after PR #15/#16/#17 (one-line prompt additions): pattern-vector-pro ai-6395b84a — white background, no glow or T-shirt, arch open → ✅. svg-convert first re-run ai-1a6d83c8 drew a jacket and dropped the outer ring; after #15 ai-78733149 is the motif only, outer ring kept, white → ✅. angle-change back view ai-5af143da: plain back, no label → ✅. clothing-size bottoms L→XXL: ai-91ab68c8 visibly looser jeans but added a chest pocket; after #17 ai-95b8504c looser jeans, no pocket → ✅. print-design-project: the mockup issue is gone (ai-bba23e61 and later are graphic-only), but with a black-background reference the output keeps a grey background with glow (ai-ed699633 after #15, ai-1ac6dced after #16; the prompt with pure-white #FFFFFF is confirmed in generated_images.prompt) → still △ (gpt-image-1-mini ignores the background rule for this free-design route).
   - 2026-10-07 22:28–22:40: print-design-project with the black reference — whitened reference alone (PR #19) still gave dark neon art on gpt-image-1-mini (ai-ed398fc1); with gpt-image-1.5 for this route (PR #21) ai-fcedf521 is the motif on pure white, no glow → ✅.
5. (c) done 2026-10-07: every `storage_path` of the 48 jobs named in route-ledger/p2-matrix/PROGRESS read from R2 bucket heavy-chain-private-media with wrangler → 48 present, 0 missing.
