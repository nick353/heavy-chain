# Light Chain parity — progress ledger

Goal loop started 2026-10-06 (Claude Code). Source of truth for the plan: `docs/HANDOFF_LIGHTCHAIN_PARITY_2026-10-06.md`.
Each iteration: read this file → advance the next open item → append result (変更／検証／残blocker／次の作業) → commit.

## Standing rules
- Compare Light (`https://jp.linkaigc.com`) and Heavy (`https://heavy-chain.zeabur.app`) with AOS Chrome Companion at 1440×900 (also 1280 / 2560).
- Release = production 360-file input set (`docs/handoff/production-input-manifest-20261006.json` + reverse overlay patch) **plus only the files changed for the accepted fix**. Never ship the 10 unverified WIP files or pending Worker/migration changes wholesale.
- Deploy: `zeabur deploy --service-id 6a318803302ffbcd03a92935 --json -i=false` from the release tree (project 69df815a554543d46b0f2485, env 69df815a5ae0a69725e92048). Pre-approved.
- Do not replay historical unknown-effect operations (Canvas r1008, Studio pendingACK, Pose, Angle back, Wear R07, old Light viewport tab).

## User directive 2026-10-06 (after iteration 3)
- Every feature that Light shows as 「購入後に使用可能」/「権限がありません」 must be fully generatable in Heavy: same Light layout/inputs, but the run button really generates, saves and restores. Each route's acceptance now includes one real Heavy generation + reload.
- Known Heavy-side locks to remove: `src/features/lightchain/sourceFeatureAccess.ts` (fabric-image, model-matrix generation 'denied'), `PermissionLockedButton`, `ParityPermissionGate` (「この機能は未実装です」).
- Cloudflare read permission: user given a `.claude/settings.local.json` allow-rule command for `npx wrangler d1 execute` / `npx wrangler r2`; retry the read-only D1 probe only after the user confirms.

## Release tree overlay (files that differ from the 2026-10-06 production input)
- src/pages/LightchainParityPages.tsx, src/components/DesignArtifactThumbnail.tsx, src/index.css, src/lib/designProjectArtifacts.ts (iteration 1)

## Phase status
| Phase | Status |
|---|---|
| P0 source reproduction | done — build/typecheck/119 regressions + Worker 158 pass; prod 360-file hash match after reverse patch |
| P1 route/state parity ledger | in progress — see `docs/parity/route-ledger.md` |
| P2 20 items / 31 features | open |
| P3 Provider/D1/R2 identity, unknown-op settlement | open — needs Cloudflare admin access (self-acquire) |
| P4 quality / speed / Mac 1280–2560 | open (Windows device + operator out of scope for now) |
| P5 final reconciliation | open |

## Known pre-existing test failures (not caused by parity work)
- `scripts/verify-heavy-canonical-aliases.test.ts` — alias boundary regex
- `scripts/verify-design-artifact-thumbnail.test.ts` — expects old `onOpen={openProject}` card wiring

## Log

### 2026-10-06 iteration 1 — /designProduction project + dialogue tabs
- 変更: conversation projects merged into Light's single recency-ordered "マイプロジェクト" / "最近のプロジェクト" grids (`mergeDesignProjectGridItems`); card CSS no longer depends on nth-child (the extra conversation section had broken the 220×240 / 167px cover layout); covers top-aligned at natural aspect; send arrow ↑; scene labels 16px medium with lighter gradient; "すべて表示" 14px nowrap; error state no longer shows the empty-state copy.
- 検証: tsc, vite build, design tests 21/21 + new merge test 3/3, regressions 119/119; Codex review ×2 (findings fixed). Deployed Zeabur `6ac4eee04a4c47e13ede418a` (RUNNING) from prod tree + 4 files.
- 本番readback: Companion 1440×900 — card grid x=141, top=520, 5 columns × 228px pitch, heading y≈487, conversation card merged first with default cover; matches Light capture of the same state.
- 残: thumbnail resolve latency (~5s) → P4 speed; default cover still hotlinked from Light.
- 次: build route inventory from Light navigation, then group 1 remaining (designProduction/detail, header/account menu).

### 2026-10-06 iteration 2 — release tooling, Cloudflare probe, /creator
- 変更: `docs/parity/release.sh` + `release-overlay.txt` rebuild prod 360-file tree + overlay, typecheck/build, deploy. /creator fixed (see route-ledger #7).
- 検証: parity tests 67/70 identical before/after (3 pre-existing failures: launcher order ×2, Wear Design Lab card regex). Codex review: only finding = style panel empty after selection → recorded as unconfirmed-light. Deployed `6ac4f1bc4a4c47e13ede41e9`, Companion readback matches Light geometry (video 408–1032, keyword box bottom ≈796, button y≈831).
- **Blocker (P3)**: `wrangler` is logged in (OAuth, account ffa9a931…, d1 write scope) but Claude Code's auto-mode classifier denied a read-only remote D1 query as "Production Reads". Needs the user to allow it (permission rule) — do not work around.
- 次: /printing, /tools/fabric, then 素材 group.

### 2026-10-06 iteration 3 — /printing = AIグラフィックデザイン
- 調査: Light `/printing` is the graphic-design tool (catalog id graphic-design → strict31 `print-design-project`), Heavy had mapped it to printing-image (garment+print). Light empty and after-upload states captured (one neutral test image uploaded to Light, no Light generation; upload outcome visually confirmed, not replayed).
- 変更: new `src/pages/LightchainGraphicDesignPage.tsx` on `useCanonicalImageWorkspace('print-design-project')` (edit-image); sanitizer keeps `assist` + `referenceStrengths`; App routes /printing to it; sr-only selected file name for upload confirmation; brief asks for a flat print graphic.
- 検証: tsc, graphic-design test 3/3, routing 29/30 (1 pre-existing), Codex review (2 findings fixed). Deployed; Companion: layout matches Light (card 368–1072, video 592, settings panel). Provider run `ai-5aabfebc-f7fe-4fcd-af08-6ed5b42df8b7` succeeded; reload restored input + result without resubmission.
- 残: first output rendered a hoodie mockup → brief now requests flat graphic (re-run pending); Gallery/History/Jobs four-surface + D1/R2 identity for this job (P3, blocked on permission).
- 次: re-run one generation to confirm flat output, then /tools/fabric.

### 2026-10-06 iteration 4 — /printing flat output, fabric gate check, D1 probe
- /printing re-run: job `ai-bba23e61-85b9-4bf5-8650-de6db398c40d` returned a flat print graphic (no garment mockup) with the updated brief; result restored via resumeJob.
- /tools/fabric: Heavy code does not apply the source generation gate (`getLightchainSourceGenerationAccess` is unused; Heavy route forces input admission). Production readback of Light/Heavy fabric pending.
- D1: after the user added `.claude/settings.local.json`, one read-only `select name from sqlite_master` succeeded (29 tables incl. heavy_ai_requests, generated_images, generation_jobs, canvas_documents). The next read-only schema query and then Companion tab reads were denied by the auto-mode classifier ("Production Reads"). Stopped and asked the user; no workaround attempted.
- 次: once the user adjusts permissions — fabric Light/Heavy comparison + generation, then P3 identity check for jobs ai-5aabfebc…, ai-bba23e61….

### Iteration 5 (2026-10-06/07) — /tools/fabric
- Changes: sessionKey no longer keyed on currentBrand in the Heavy workspace (fixes inputs/results being wiped when the workspace resolves on first generation); fabric result history scrolls to the newest result.
- Verified in production: upload garment + fabric → AI生成 once → job `ai-be179dd6…` completed (D1 heavy_ai_requests + generated_images), result card shown, inputs kept, reload restores results and lands on newest.
- Tests: material contract 26/27 (only the pre-existing "fitting clothing uploads retain local Canvas source metadata" failure). Codex read-only review: APPROVE.
- Deploy: 6ac50c234a4c47e13ede4627 RUNNING.
- Remaining blockers: local workspace artifact save warning (P4 storage quota), Light's reload behaviour for inputs unconfirmed.
- Next: route #10 /tools/printing (プリントイメージ).

### Iteration 6 (2026-10-07) — /tools/printing プリントイメージ
- 変更: new shared `src/components/lightchain/LightchainDesignToolFrame.tsx` (rail/tabs/notice/result panel, navigation lock); /tools/printing render in `LightchainPrintingWorkspace` replaced with Light layout while keeping draft restore, Canvas handoff, pending reconcile; `useHeavyWorkspaceBrandGate` resolves Heavy workspace before uploads (/tools/printing and /printing); clearer print brief.
- 検証: tsc; printing suites all green (canvas handoff 41, library draft 55, scope, draft, failure, composition…); canonical browser test printing alias 1/1 (baseline worktree showed 24 pre-existing browser failures, none new). Production: layout matches Light at 1440×900; real generation `ai-dfa6dbf0…` completed and displayed; reload restored result.
- Process change: user asked to stop using Codex (2026-10-07). Reviews are now done by Claude Code itself. Earlier Codex rounds on this change found 8 issues, all fixed.
- Deploy: 6ac51eefd96b7ba6d7cd5adf RUNNING.
- 残: Light result-panel presentation unconfirmed; print colours drift slightly vs artwork (P4 quality).
- 次: route #11 /tools/line-draft-to-tile (線画の実写化) and /tools/line (平絵生成) on the shared frame.

### Iteration 7 (2026-10-07) — /tools/line-draft-to-tile, /tools/line
- 変更: `src/pages/LightchainLineToolsPage.tsx` (both tools, shared frame, canonical workspace); hook accepts `line-to-real` / `line-generation` and persists `sourceType` / `styleNote`; App routes switched from the 9.6k-line LightchainWorkbenchPage; frame/printing spacing tightened to Light's measured rhythm.
- 検証: tsc; related suites equal to baseline (provider-adapter 1, launcher-parity 1, provider-coverage 2 pre-existing failures); printing suites green. Production: both tools generate (`ai-101aadd2…`, `ai-959749a0…`), reload restores everything, geometry matches Light.
- Light note: direct loads of Light tool URLs often render blank for ~20s; enter via /designProduction or wait before reading.
- 次: #12 /tools/pattern-to-vector, /tools/vector-special.

### Iteration 8 (2026-10-07) — /tools/pattern-to-vector, /tools/vector-special
- 変更: frame tabs/rail configurable (`LIGHTCHAIN_VECTOR_TOOL_TABS`, railGroup 2); vector page on the frame with Light's pileUp/carveUp cards, 使用回数, coin-1 button; `vectorBrief` asks for a flat colour-region redraw of the pattern only; 同じ依頼を照合 shown only after an interrupted run (printing/line/vector).
- 検証: tsc; vector browser tests 3/3; ui-control-boundaries 22/22 and entry-routing 29/30 (pre-existing) after updating two class-string tests to the shared frame. Production: geometry matches Light; both tabs generate.
- 残 (P2): real SVG output for vector tools; Light card/rail images are still hotlinked from Light's OSS.
- 次: #13 /tools/svg-convert, then #14 /tools/reactor.

### Iteration 9 (2026-10-07) — /tools/svg-convert + real SVG output (P2)
- 変更: `src/lib/rasterToSvg.ts` (colour quantisation, pixel-edge tracing with holes, simplification → filled SVG paths) + `SvgExportPanel` (SVGをダウンロード, 色/パス数) on ベクター化 and 平絵をベクター化 results; /tools/svg-convert routed to the vector page in svg mode (single tab, rail group 衣類生産ツール, Light copy, `svgConvertBrief`); hook feature `svg-convert`.
- 検証: tsc; raster-to-svg 4/4; ui-control-boundaries 22/22; vector browser tests 3/3; others baseline-equal. Production: vector result converts to 7色/7パス SVG after reload; svg-convert run `ai-c900cd58…` completed and converts to 5色/5パス.
- 次: #14 /tools/reactor.

### Iteration 10 (2026-10-07) — /tools/reactor (in progress, paused: usage limit)
- Light reactor = 画像修正: single tab, no deprecation banner, rail highlight フィッティングツール, 280px upload box, 修復内容を選択します + 手足の変形を修正 sub-tab, hint 「マスクツール」を使用して手足の部分をマスクで選択してください, 権限がありません button at (404,828); right: 画像修正 / 手足や顔の奇形をAIが修復します.
- Heavy currently renders LightchainWorkbenchPage for /tools/reactor. Plan: frame with banner off + railGroup 1, canonical feature `image-repair` (edit-image capability exists), brush mask drawn on the source and sent as a red-overlay secondary reference (hook passes secondary as referenceImageUrls).
- 次: implement the above, then #15–#28.

### Iteration 10 (2026-10-07, /goal) — /tools/reactor 画像修正
- 変更: `src/pages/LightchainImageRepairPage.tsx`; frame gains railGroup 1, `showNotice`, `LIGHTCHAIN_IMAGE_REPAIR_TABS`; hook feature `image-repair`; App route.
- 検証: tsc; related suites baseline-equal; production geometry = Light; job `ai-62130895…` completed in D1; reload restores input + result.
- 次: #15–#17 editors.

### Iteration 11 (2026-10-07, /goal) — /editor/pattern デザインアレンジ (#15)
- 変更: `PatternProjectDashboardPage` (no fabricated filler cards, Light new-file card, Light pager, thumbnail fallback); `PatternDesignDetailPage` rebuilt as the Light editor on the canonical workspace (feature `pattern-arrange`, edit-image capability; inputs `arrangeMode` / `arrangeRatio` / `arrangePrompt` persisted so the prompt restores verbatim); overlay gains heavyCapability + both pages.
- 検証: tsc; full script suite diffed against baseline, then suspects re-run singly: two stale tests updated (capability count, vector testId expression), model-tool-settings regression fixed by using dedicated input keys; remaining failures equal baseline. Production 1440×900: board + editor geometry matches Light; run `ai-31d91d84-fe90-4471-bed3-20fd5d5eb2ab` completed in D1; reload restores source, prompt, 1:1 and result.
- 残: Light 質感 tab not observable (blank page); Light editor upload left one test project in the Light account (2107534244744445954).
- 次: #16 /editor/patternDesign.
