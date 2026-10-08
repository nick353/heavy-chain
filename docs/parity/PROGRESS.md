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

### Iteration 12 (2026-10-07, /goal) — /editor/patternDesign プリントデザイン (#16)
- 変更: `PatternProjectDashboardPage` → shared `LightchainProjectBoard` (config per board; projects = `listGeneratedImages(featureType lightchain-<feature>)`, newest first, one signed-URL batch; limit 100 = API max); `PrintDesignDetailPage` (feature `pattern-print-design`, inputs printMode/printRatio/printResolution/printTile/printPrompt); App routes switched from LightchainWorkbenchPage; capability + overlay updated.
- 検証: tsc; related suites equal to baseline (capability, catalog-route, launcher, runtime, entry-routing, board-parity, all-screen, comparator, model-settings). Production 1440×900: board + editor match Light; run `ai-7669333b-a37a-4612-9e27-fc4ba133ff54` completed in D1; reload restores print, style map, result. #15 board now shows its saved project.
- 残: project saved on first generation rather than first upload; adjustments not persisted.
- 次: #17 /editor/changeColor.

### Iteration 13 (2026-10-07, /goal) — /editor/changeColor 色変更 (#17)
- 変更: `ChangeColorDetailPage` (feature `change-color`, inputs colorTarget/colorArea/colorRatio), `ChangeColorProjectDashboardPage` on the shared board; App routes moved off GeneratePage; capability, overlay, entry-routing test updated to the new surface.
- 検証: tsc; 25 related suites compared one by one with the baseline — equal except entry-routing, fixed by updating its stale GeneratePage expectation. Production 1440×900: guide chooser, panel and toolbar match Light; run `ai-f4d370ca-9ff2-43e9-84c0-61c9e599c181` completed in D1; reload restores everything.
- 次: #18 /model.

### Iteration 14 (2026-10-07, /goal) — /model AIフィッティング (#18)
- 変更: `LightchainWorkbenchPage` header spacing, 207×40 bottom buttons, Light post-upload grid (image + 続けてアップロードする + Gallery素材を選択), file name sr-only, mask controls collapsed in `<details>`; generation reuses the already-selected Heavy workspace brand instead of `ensureHeavyWorkspace()` (that cleared currentBrand and remounted the keyed workbench, losing inputs and the in-flight result); recovery test binding updated; overlay gains the page.
- 検証: tsc; workbench-resume / print-design-recovery / canonical-routes / model-tool-settings / dialogue suites equal to baseline (one parallel-run flake re-run singly = 0 fail). Production 1440×900: inputs persist through generation; run `ai-be628dda-c4b8-4d5d-8236-1f2de102dd54` completed in D1; /model?resumeJob=… restores garment, brief and result.
- 残: model descriptor (gender/age) is not derived from the free-text brief.
- 次: #19 /model-library.

### Iteration 15 (2026-10-07, /goal) — /model-library 8 forms (#19)
- 変更: `SourceModelToolSurface` rebuilt to the source layout per form — per-form example media (self-hosted copies in `public/lightchain-assets/`), source wording (titles, header hints, notes, right subtitles), divider rules, label-left rows, segmented 性別/服装タイプ, stepped angle sliders, switch rows (アパレルサイズをキープ, カスタムボディ, new 背面), 参考画像/カスタム tab, Light bottom bar widths (104/96/199), result shown in the main area, file name sr-only. `modelToolSettings`: optional `backView` for angle-change (older saves stay readable). Model-library custom example image self-hosted.
- 検証: tsc; model-tool-input-parity 34/34 (helper handles radio groups), model-tool-settings-roundtrip 0 fail (default now includes backView), 15 related suites equal to baseline. Light observed via Companion (background tab needs screenshots to render). Production: 8 runs completed in D1 (job ids in ledger); each resumeJob reload restores source, settings and result.
- 残: Heavy-only 入力と生成 panel; rail icons are lucide approximations (P4).
- 次: #20 /model-base/style.

### Iteration 16 (2026-10-07, /goal) — /model-base/style カスタムスタイル (#20)
- 変更: new `LightchainCustomStylePage` (route moved off LightchainWorkbenchPage): Light list layout (rail, upload zone, library tabs with pill indicator, search, 185×222 cards in 6 columns, status badge), detail view (pencil rename, 完了 badge, モデル画像 thumbnails with 現在の表紙, モデル関連情報 / デザイン要素 chips, 一覧に戻る / 削除), contact dialog. Upload saves the style before uploading, stores images in private media + generated_images, sends a vision analysis request (identity saved first so a reload resumes it), and records elements in style_presets. 再学習 for failed analyses.
- 発見: JSON-only prompts make Workers AI return an object → recorded as provider unknown; Worker rejects newlines in stored text. Both handled client-side.
- 検証: tsc; 11 related suites equal to baseline. Production: style 516e966f… created, analysis 57c092c1 completed, status 完了 with 10 elements, rename persisted, list after reload shows the card.
- 次: #21 marketing.

### Iteration 17 (2026-10-07, /goal) — /marketing + /marketing/detail (#21)
- 変更: `LightchainMarketingHomePage` rewritten to Light's markup (sizes measured at 1440×900): prompt + uploaded references start a real project through `createDesignEntryCoordinator` with the new marketing workspace (`DIALOGUE_WORKSPACES`, own draft DB, `/marketing/detail` href); マイプロジェクト lists only those projects (`useDesignConversationProjects(…, 'marketing')`, cover from the first canvas image); scene chips become a removable tag like Light; tour 1/4–4/4. `/marketing/detail` now renders `DesignEntryDetailPage workspace="marketing"`; that page was rebuilt to Light's canvas + assistant layout (shared with /designProduction/detail, #3) and supports a bare-URL new file, uploads (`useDialogueReferences`), rename, layers tab, toolbar/zoom. Light hotlinks on the page replaced by `public/lightchain-assets/{marketing,static}` copies; `DESIGN_PROJECT_DEFAULT_COVER` self-hosted.
- 検証: tsc; marketing-home (rewritten for the new behaviour), design-detail-dialogue (2 cases updated for the new layout/new-file rule), design-project-list, dialogue-wiring, canonical aliases, canonical routes (suspect cases re-run singly: 10/10 both) — no new failures vs baseline (dialogue-wiring and canonical-routes flake in both trees under load). Production: Light /marketing, /marketing/detail (project + new file) measured; Heavy run project 3557a8a9…, job ai-ce0299f2… completed, reload restores; project card shows the generated cover.
- 残: see ledger #21 gaps.
- 次: #22 /flow/integration.

### Iteration 18 (2026-10-07, /goal) — /flow/integration ファッションスタジオ (#22)
- 変更: `FashionStudioPage` filters canvas documents to Fashion Studio projects. `FashionStudioDetailPage` new-file screen rebuilt to Light (guidance, four functions with NEW badge, dashed drop zone, dots); function choice seeds a Heavy-written sample instruction and is stored per project; instruction draft persisted per project; form title follows the function; project icon self-hosted.
- 検証: tsc; 10 fashion/board suites equal to baseline. Light observed: board, project detail (React Flow nodes), new file, sample load. Production: project 176a4d3e…, job ai-95b6af64… completed, reload restores input/instruction/result, board shows only studio projects.
- 次: #23 /flow/laboratory.

### Iteration 19 (2026-10-07, /goal) — /flow/laboratory ラボ (#23)
- 変更: `LightchainLabDetailPage` drop zone moved to Light's measured geometry (768×554 dashed, `relative` root so the page no longer scrolls), self-hosted laboratory icon, sr-only file name status. `useCanonicalImageWorkspace` keeps a per-page draft (uploads by local asset reference, brief, reference note, settings) in localStorage and restores it on a fresh page in its own effect (not inside the initializer, so library/resume/pending paths are untouched); プリントイメージ keeps its own draft store; the draft is removed when a job is saved.
- 発見: putting the restore inside the initializer broke 66 harness cases that evaluate that effect in isolation (missing bindings + storage-effect assertions) — moved to a separate effect.
- 検証: tsc; canonical-library-input-restore 0 fail, model-library-workspace-restore 0 fail, model-tool-settings/input-parity 0 fail, canonical-image-workspace-routes = baseline apart from the Lab geometry expectation (updated to 768×554), source-board-parity = baseline. Production: see ledger #23 (job ai-b55722a0… completed, reloads restore before and after generation).
- 次: #24 /flow/orientedDesign.

### Iteration 20 (2026-10-07, /goal) — /flow/orientedDesign ウェアデザインラボ (#24)
- 変更: `useFeatureProjects` extracted from the pattern board (exported with `ProjectThumbnail`/`formatProjectAge`); the Wear Design Lab board lists real wear-design-lab jobs instead of Light-user cards; a saved card opens its own job (drops the previous candidate/indexes, keeps other params). Detail empty state rebuilt to Light's measured geometry; icon and reference covers self-hosted.
- 検証: tsc; wear-design-lab-routing (mock for the new service, project-card case asserts the exact saved job) 0 fail = baseline; canonical routes boundary case 3/3 (geometry 768×534); source-board / entry-routing = baseline. Production: see ledger #24.
- 次: #25 /agent.

### Iteration 21 (2026-10-07, /goal) — /agent 企画エージェント (#25)
- 変更: new `features/agent/agentTasks.ts` (task model in canvas snapshots, prompts, parsers, profile/project storage) and `AgentSidebar` (real tasks, search, projects, profile dialog, credits); new `HeavyAgentTaskPage` at /agent/:taskId runs theme → choice → plan → visual, storing each request id on the task before sending and only reading back steps in flight; workbench /agent send creates the task, profile/project controls work, fabricated Light task list/credits/project modal removed, hero/reference images self-hosted.
- 検証: tsc; new verify-heavy-agent-tasks 6/6; ui-control-boundaries updated (sidebar/project/recent-task tests now assert the real behaviour) 0 fail = baseline; launcher/all-screen/catalog/unified-shell/capability/provider/source-access/marketing-detail/fashion-hydration = baseline. Production: see ledger #25.
- 次: #26 /canvas/:id.

### Iteration 22 (2026-10-07, /goal) — /canvas/:id (#26)
- 変更: `CanvasEditorPage` derived actions (context menu and edit modal) go through `runDerivedEdits` → `editImageWithPrompt` (real jobs) and keep the durable storage path; zero-size container measurements are ignored. Production canvas differs from the repo file, so the change ships as `docs/parity/release-patches/002-canvas-derived-edits.patch` (dry-run applied to the production file).
- 検証: tsc; canvas-generation-readback (updated for the helper; 1 fail = baseline), canvas-partial-image-editing / color-edit-contract / image-api-only / chat-editor / brand-readback / protected-batch = baseline. Production: see ledger #26.
- 次: #5 /asset-center.

### Iteration 23 (2026-10-07, /goal) — /asset-center ライブラリー (#5)
- 変更: `LightchainLibraryPage` groups come from `/v1/folders` (brand folders) instead of a hard-coded copy of the Light account's group names; system views 履歴アップロード / 生成履歴 / ウェアデザインラボ生成結果 filter their own cards; Light's アセットグループを新規作成 dialog (type + name 0/50); toolbar/sidebar/breadcrumb measured from Light; uploads inside a group are saved to that group. `storage.ts` reuses a signed read URL per user until 5 minutes before expiry and signs 8 at a time.
- 検証: tsc; library suites (board-clipboard, scope-readback, model-library-direct-route, gallery-client, canvas-handoff (updated: server folders, no Light group names), save-scope, original-bytes, remote-save-fail-closed, query-projection, entry-history) = baseline; storage suites = baseline except workspace-save (updated: reuse within validity, concurrency 8). Production: folder 2027SS企画 created once (D1 row), restored after reload.
- 発見: canonical-image-workspace-routes had 2 new failures from #23/#24 — the sr-only upload status repeated the exact file name, so `getByText(name)` matched twice. Status now reads `主素材画像: <name>`; both cases pass, other differences in that suite were load timing (pass individually in both trees).
- 残: Light session was logged out by Light ("別のデバイスでログイン中") during #6 observation — Light comparisons for #6, #28, #3, #4, #2 need the user to sign in to Light again.
- 次: P4 hotlinks (in progress), then #6 once Light is available.

### Iteration 24 (2026-10-07, /goal) — P4 直リンク除去
- 変更: every jp.linkaigc.com / static-*.linkaigc.com / *.aliyuncs.com URL in src/ and index.html replaced by Heavy-served copies under `public/lightchain-assets/` — launcher/home covers (960px webp), route icons (`route-icons/*-on|off.svg`, correct simplified-Chinese originals; several old spellings were 404 on the source), avatar, tool videos (re-encoded 1280px, 93MB→3.2MB, `garment-design / print-on-body / fabric-on-body.mp4`), video-template snapshots, 308 fitting reference images (`fitting-models/<set>/<name>.webp`, 512px), 716 body previews (`model-body/<id>.webp`, 256px = the size the page requested). The video dashboard no longer lists the source account's own Untitled projects (only templates + the user's saved videos).
- 発見: Zeabur's upload prepare step times out by file count (551 files ok, 901 fail; probed with harmless unused files). `release.sh` now packs the self-hosted asset dirs into one tar that the Dockerfile unpacks before `npm run build` (404 files uploaded). A probe build from a clean worktree once stopped early because `public/lightchain-assets/model-library-custom-demo.mp4` was untracked — production was immediately redeployed from the full tree; the file is now committed.
- 検証: `grep -rE 'linkaigc\.com|aliyuncs\.com' src index.html` = 0; production crawl of all 160 JS/CSS bundles = 0 hits; /designProduction network log has no source-domain request; `/lightchain-assets/fitting-models/Male/1.webp` served as image/webp. Tests: 185 related suites run; differences vs baseline only in tests that asserted the old hotlink URLs (entry-routing, launcher-parity, ui-control-boundaries, video-dashboard-crop — updated to the self-hosted paths and now also assert no source-domain URL) and library-home-detail-continuation (harness lacked the #24 `useFeatureProjects` binding and still listed removed fixture constants — updated; now = baseline). `public/*/manifest.json` keep `source` provenance fields (not loaded by the app).
- 次: P2 (#15/#16 upload-time project save, adjustment persistence), then Light routes once the Light session is signed in again.

### Iteration 25 (2026-10-07, /goal) — P2 #15/#16 upload-time project save + adjustment persistence
- 変更: new `features/boardDraftProjects.ts` — first upload on a new file saves the image as a server library upload tagged `boardDraftFeature`, puts the project id in the URL and carries the draft over; boards (`LightchainProjectBoard`) list those drafts from the server (own user, not yet generated) before saved jobs. `useCanonicalImageWorkspace` keys drafts per `boardProjectCode`, keeps `printAdjustSource/Result`, and allows 1000-char prompts (プリントデザイン's limit; 256 cut longer prompts). `PrintDesignDetailPage` restores/saves 色調整・画像調整 (draft input, or per job in localStorage). Wired into デザインアレンジ (#15) and プリントデザイン (#16).
- 発見: the first version required the browser copy to be confirmed and never moved to the project URL (browser store full); the server copy is now authoritative.
- 検証: tsc; 33 related suites — differences vs baseline only from load (workbench-resume, canonical routes: same failing names when run alone, 24 = 24). Production: see ledger #16 (D1 row, reload restores print + rotation/flip, board draft card).
- 次: remaining P2 items; Light routes #6/#28/#3/#4/#2 once Light is signed in again.

### Iteration 26 (2026-10-07, /goal) — #28 /gallery (Heavy side)
- 検証: production /gallery shows the 76 real saved images; favourite on ai-be119a6a…-0 stored (D1 is_favorite=1) and restored after reload under お気に入り. No code change needed.
- 残: Light session logged out ("別のデバイスでログイン中") — #6, #3, #4, #2 and the Light-404 check for #28 wait for the user to sign in to jp.linkaigc.com again.

### Iteration 27 (2026-10-07, /goal) — #6 /board Heavy-side fixes (Light pending)
- 変更: `LightchainBoardPage` no longer fills the list with the source account's sample documents; artifact thumbnails resolve through `readWorkspaceArtifactImage`; dates formatted `YYYY.M.D HH:mm`. Tests updated (board-persistence-contract, entry-routing: sample data must be absent) = baseline.
- 検証: production /board shows the user's 18 saved documents with images and formatted dates (screenshot).
- 残: /board/edit is a placeholder; Light comparison for #6/#3/#4/#2 waits for the Light sign-in.

### Iteration 28 (2026-10-07, /goal) — Light signed in: #6 verified, #28 verified, #4 avatar menu
- 観察: Light /board, /board/edit (existing document), card menu, shape flyout, avatar menu measured at 1440×900; /gallery, /history, /jobs are 404 on Light. #3 needs a new conversation on Light (would spend Light credits and create data in the user's Light account) — not sent.
- 変更: `features/board/boardDocuments.ts` (design-document snapshot format, reader, fit zoom); `LightchainBoardPage` rebuilt — list from the user's server canvas documents with saved-page previews, copy/delete menu, fixed-id create with read-back reconciliation; editor on react-konva with Light's tool panels, pages, header breadcrumb/status/ダウンロード (via new header slots in `Layout`), revision-checked autosave that reads the stored copy before retrying once. `cloudflareApi.deleteCanvasDocument` (shipped as release patch 004, the file differs from the production tree). Avatar menu rebuilt to Light's dark menu.
- 検証: tsc; 47 suites reading Layout/cloudflareApi + board suites = baseline (persistence-contract rewritten for the server design, entry-routing/source-board-parity updated for the new markup). Production index.xK5lDw7A.js: measured boxes identical to Light; document 1440d396… saved (D1 revision 2: rect + stored image) and restored after reload; watermark toggle restored after reload.
- 残: #4 language/help menus; #3 (Light conversation needed); #2 hover/selected states; P2 remainder.

### Iteration 29 (2026-10-07, /goal) — P2: draft inputs on the server; /workspace list cleanup
- 変更: `boardDraftProjects` keeps a draft project's not-yet-generated inputs (brief, note, inputState incl. 色調整/画像調整) in a server canvas document `bd-<projectId>` (fixed id, revision-checked) and, where the browser has no draft of its own, restores the upload from the library copy and the inputs from that document without overwriting what the page holds. `dashboardCanvasProjects` no longer lists design documents, agent tasks or draft-input documents as Canvas projects on /workspace (they would open in the wrong editor).
- 検証: tsc; dashboard-canvas-projects (new case), entry-routing, source-board-parity, wear-design-lab-routing = baseline. Production index.RaZQr86G.js: opening draft wa-0c93f263… wrote D1 canvas_documents `bd-wa-0c93f263…` with printAdjustSource "100,100,100,90,1" (the saved 90° + flip).
- 未確認: the restore on a second device was not exercised (this session has one signed-in browser profile); covered by code review only.
- 残: Light signed out again (別のデバイスでログイン中) — #4 language/help, #2, #3 wait for the user's sign-in; #3 also needs the user's consent to start a Light conversation.

### Iteration 30 (2026-10-07, /goal) — P4 thumbnail delay: one signature per image
- 測定 (production /gallery, fresh tab, Resource Timing): before, every image path was signed twice concurrently (e.g. ai-32c0b07f… 340 ms and 638 ms; ~140 `/v1/media/read` signing calls for ~70 images, 0.3–1.1 s each). The signed-URL cache from iteration 23 only helps once a URL has arrived.
- 変更: `storage.ts` shares one in-flight signing request per user+path.
- 検証: tsc; storage suites = baseline (canonical-image-workspace-routes differed by one name under load; that test passes 3/3 alone in both trees). Production index.Bt3xwS83.js fresh tab: each path signed exactly once (~70 calls). P4 hotlinks re-checked: src+index.html 0, production entry bundles 0.
- 残: the remaining wait is the full-size original download (1.4–2.0 s per image); smaller thumbnails need a resize endpoint in the Worker, which must not be deployed (undeployed WIP there).

### Iteration 31 (2026-10-07, /goal) — #4 language and help menus verified
- 観察 (Light, signed in, 1440×900): language menu 160×122 right-aligned under 日本語 (简体中文 / 日本語✓ / English, 32px rows, 14px text); help menu 200×102 left-aligned under ヘルプセンター (通知 with a red unread dot, よくあるご質問（FAQ）); 通知 opens a full-screen blurred panel (title, 4 tabs すべて表示/システムからのお知らせ/ログを更新します/システム通知, 720px entries with a 104px category/date column); FAQ opens the same kind of panel with 3 rounded sections of accordion rows. Light's "text-base" is 14px.
- 変更: new `components/layout/LightchainHeaderMenus.tsx` (menus, panels, Heavy's own update notes and FAQ answers, per-user seen state for the unread dot); `Layout` wires the triggers (aria-expanded, close on outside click / Escape / navigation). Added to the release overlay.
- 検証: tsc; 10 suites reading Layout = baseline. Production index.Be6z794o.js: language menu box and rows identical to Light; help menu identical (200×102, rows 40); 通知 panel h3 696,56, tabs 407,101 625×40 (Light 406,101 628×40), entries 360,190 720 wide; FAQ h3 528.7,56 382.7×40 (Light 528.8,56 382.3×40), sections 80/1280×387, rows 81; Escape closes; unread dot gone after opening 通知 and still gone after reload.
- 判断: Heavy is Japanese only, so 简体中文/English are listed but disabled rather than switching to an untranslated UI.
- 残: #2 hover/selected states; #3 (needs the user's consent for a Light conversation); P2 remainder; P4 thumbnail size (needs the Worker deploy).

### Iteration 32 (2026-10-07, /goal) — #2 dialogue tab: scene hover, tooltip, draft restore
- 観察 (Light): scene card hover = 8px blur + 50% black layer + centred 使ってみる →, title strip fades; a Radix tooltip shows the title 8px under the card; after a click the only ring is the focus ring (no selected style). Light's own reload drops the dialogue draft and returns to プロジェクトから開始.
- 変更: `LightchainParityPages` scene cards rebuilt to Light's structure (no white selected ring, CSS tooltip), start tab kept per user, unsent prompt + chosen scene kept per user/brand scope and restored after reload (reference images were already kept by the reference controller); the draft is dropped once a project is created from it. Visual test updated for the new markup.
- 検証: tsc; 12 suites reading the page = baseline. Production index.Dy0utQXj.js: card boxes and hover/tooltip identical to Light; after a real reload the tab, 2 reference chips, 32-character prompt and デザインミックス were restored.
- 事故: at 22:43 JST a merge to GitHub `main` (8c3c2d6f, PR #2 "Claude text actions") auto-deployed to the same Zeabur service and replaced production with an old main-based build (title "Lightchain AI", none of the parity work). The queued parity release then replaced it again (index.Dy0utQXj.js). PR #2's feature is therefore not in production; the main auto-deploy will overwrite production again on the next push. Needs the user's decision (fold PR #2 into the release overlay and/or stop main auto-deploy).
- 残: #3 (needs consent for a Light conversation); P2 remainder; P4 thumbnail size (Worker deploy).

### Iteration 33 (2026-10-07, /goal) — P2 matrix
- 確認: route ledger = every row verified except #3 (needs consent for a Light conversation) and #27 (non-goal). D1: the 27 ledger job ids are all `completed` with one stored image each.
- 追加: `docs/parity/p2-matrix.md` maps the 31 strict rows to routes, D1 jobs and the 7 common conditions. Gaps: 7 rows without a row-specific run (marketing/wear-design/print-design detail, ai-fitting, ai-fitting-reference, fitting clothing/background reference); conditions (d) four surfaces, (f) failure/recovery, (g) full-size quality not yet evidenced for any row; (c) R2 object check needs R2 read access.
- 次: the 7 missing per-row runs, then (d) per job.

### Iteration 34 (2026-10-07, /goal) — #3 Light measured; production overwritten by main again
- 本家 (user consented to one conversation): one send from the dialogue tab (生地パターン適用, 5 reference images) opened `/designProduction/detail?boardProjectCode=2107835626584195074&boardProjectType=designProductionCustom&conversationCode=e3436cdd…`. Layout at 1440×900: project card (デザインワークスペース 41,91 w278; back 41,132.5; title button 78,128 241×29); left rail レイヤー / アセット 48×48 at (21,373)/(21,429); bottom toolbar y841 34×34 — 選択 324, ドラッグ 362, 取り消し 400, やり直し 438, 図形 485, パネル 523, テキスト 561, 画像をアップロード 599, 企画提案書 646; zoom − 752 / 20% 780 w80 / + 860; two 40px buttons 900, 948 (y844); right panel tabs AIアシスタント (1022,84 w141) / レイヤー設定 (1167,84 w128), collapse 1395,92, header デザインアシスタント, message with 画像1–5 chips + prompt, 考え中…; input textarea 1031,754 366×32, send 1355,814 40×40.
- 事故(2): GitHub main received PR #3 (c16ecbe1, restore multi-image features with Claude planning) and PR #4 (002b191b, heavychain.app origin); both auto-deployed, so production again serves main (title "Lightchain AI", no parity work). Not redeployed: main is being actively updated, and redeploying the parity release would remove those PRs from production. Waiting for the user's decision on how the parity branch and main are combined.
- P2 fitting run on /model/clothing: garment multi1.jpg attached (衣服の画像 1/4) but not generated; the Companion upload is held for reconciliation (no re-upload).

### Iteration 35 (2026-10-07, /goal) — integrate the parity release into main (PR nick353/heavy-chain#5)
- 判断 (user): integrate parity into main instead of fighting the main auto-deploy.
- 変更: branch `parity/main-integration` from origin/main (002b191b) = release tree from `release.sh` (production input set + overlay + patches; WIP files excluded; assets committed untarred) + PR #2–#4 frontend changes re-applied (ChatEditor planChatEdit, cloudflareApi composite actions, imageApi, GeneratePage). Worker code = main.
- 検証: tsc -b, vite build (title Heavy Chain), verify-provider-action-adapters 10/10, verify-image-api-input-normalization 1/1.
- 次: user confirms the merge of PR #5 (merging auto-deploys production); then re-check #4/#2/#6 on production and continue #3 Heavy side and P2 runs. Future parity releases should go to main through PRs.

### Iteration 36 (2026-10-07, /goal) — main is the release line; heavychain.app and API updated
- PR nick353/heavy-chain#5 merged (3e92ad7e): Zeabur auto-deploy from main now serves the parity release + PR #2–#4 (bundle index.DwTO_n5K.js; draft/notification keys present, chat-plan/image-plan present, "Lightchain AI" 0).
- heavychain.app (heavy-chain-web) deployed from main (version af39fc40): title Heavy Chain, silueta.onnx 44 MB served from R2, /_health 200. Build check fixed for template-literal asset paths (PR #6).
- heavy-chain-api: the deployed code (version 9349c854, 2026-10-01) was reconstructed from this branch by removing undeployed WIP from 5 files (openai-image, image-ai, workspace, image-ai-contracts, domain) until `wrangler deploy --dry-run` matched the deployed bundle; PR #2–#4 Claude text actions added; AI_IMAGE_PROVIDER kept openai; 0012–0015 migrations (already applied in D1) added to main. Worker tests 157/157. PR #7 merged; deployed version 8dd51168. CORS 204 for heavychain.app and zeabur; /model-base/style list loads.
- Not done: consumer-auth deploy (WEB_ORIGINS heavychain.app) awaits the user; live call of Claude actions not exercised.
- 今後: parity releases go to main by PR (main auto-deploys). The branch's Worker WIP (protected projections, native print frames, canvas batches) stays on this branch only.

### Iteration 37 (2026-10-07, /goal) — #3 /designProduction/detail verified
- Heavy: one send from 対話から開始 (restored draft: 襟型変更, multi1/multi2) → project df577fc9, conversation 9a10fe43. D1: design_assistant_requests 6d2e5850 completed (workers-ai llama-4-scout), heavy_ai_requests 3eb91d4a edit-image completed, generated_images ai-3eb91d4a…-0 feature_type design-dialogue.
- 差分 → 修正 (PR nick353/heavy-chain#8, merged 3b258bb1): toolbar +企画提案書 (opens /board/edit), dividers 13px, zoom group gapless, toolbar left calc(50%-400px) / bottom 18px, tabs px-3 gap-1 font-medium, input pb-4 / mt-7.
- 検証: verify-design-detail-dialogue 16/16, verify-design-dialogue-wiring 11/11 (baseline: 1 pre-existing failure). Production readback after reload matches Light within 2px except send x (+5px). Reload restores prompt, 2 references, assistant reply, generated preview and canvas layer.
- 次: P2 missing per-row runs.

### Iteration 38 (2026-10-07, /goal) — P2 marketing-detail run
- /marketing/detail (project 3557a8a9, conversation 75dd6d48): follow-up 「背景を夕方の海辺に変えて、SNS広告向けの明るい雰囲気にしてください」 sent once → design_assistant 6dcfb676 completed, heavy_ai_requests c7037b09 edit-image completed (generated_images feature_type marketing-dialogue).
- Reload restores both turns (prompt, reply, image task 完了, previews ai-ce0299f2-0 and ai-c7037b09-0) and the new canvas layer デザイン 3; no new job on reload.
- 次: wear-design-detail, print-design-detail, ai-fitting, ai-fitting-reference, fitting clothing/background reference.

### Iteration 39 (2026-10-07, /goal) — P2 fitting reference rows, wear/print detail rows, fitting layout shift
- 変更 (PR nick353/heavy-chain#9, #10 earlier): fitting clothing/background reference send the 参考画像 tab's model/pose/background picks as extra references with a fitting-composition prompt, and save/restore those picks (`fittingReferenceSlots`).
- 変更 (PR nick353/heavy-chain#11, merged): the fitting input column slid ~57px left during generation. Cause: the header row (title + mode tabs + task tabs ≈ 489px) is wider than the 432px panel and overflow-hidden boxes can still be scrolled by focus. The four fitting containers now use overflow-clip. Readback after the deploy (chunk LightchainWorkbenchPage.BPU8Ktvy.js): garment image stays at x=25 during generation.
- 検証 (production 1440×900):
  - /model/background-reference: garment multi2.jpg + library model + uploaded background → ai-cade89c9 completed, inputImageCount 3, materialReferences primary / fitting-model / fitting-background. Reload with resumeJob restores garment, モデル画像選択済み, 背景選択済み and the result.
  - /model/clothing: garment + library model → ai-3ba338d8 completed, inputImageCount 2. Reload restores garment, model pick and result.
  - wear-design-detail ai-99ff43af (completed, feature wear-design-detail): fresh tab with resumeJob restores the uploaded material, request text and saved result. print-design-detail = route #8 run ai-7669333b (Iteration earlier).
- Tests: fitting lifecycle 7/3, persistence 8/0, preview 4/0, resilience 4/0, all-screen 6/1, provider coverage 21/2 — failures equal to baseline; tsc clean.
- Notes: materialKind for the garment is still recorded as "Tシャツ" for a blouse; pre-generation garment drafts are not shared across tabs.
- 次: ai-fitting / ai-fitting-reference (model-matrix), then (d)(f)(g) per row and P4 thumbnail speed.

### Iteration 40 (2026-10-07, /goal) — AI fitting rows, grid thumbnails (P4)
- 変更 (PR nick353/heavy-chain#12): ai-fitting / ai-fitting-reference (model-matrix) send the 参考画像 tab's model pick as modelReferenceImageUrl when no secondary material is attached, record it in materialReferences (fitting-model) and save it as fittingReferenceSlots.
- 検証 (production 1440×900): /model?tab=参考図 garment + library model → ai-1368e577 completed (model-matrix, inputImageCount 2, fitting-model reference); reload restores garment, モデル画像選択済み and result. /model garment + 説明生成 text → ai-f90badcb completed; reload restores garment, the 25-character description and result. All 31 P2 rows now have their own run (a, b, c, e).
- 変更 (PR nick353/heavy-chain#13, API Worker version 9204b464): `/v1/media/read?token=…&variant=thumb` returns a 384px WebP built once with the Images binding and stored at `generated-thumbnails/<id>.webp` (dropped on content replace, deleted with the image; falls back to the original). Gallery and library grids request it. Also untracked a `cloudflare/heavy-api/node_modules` symlink that #11 committed by mistake.
- 検証: Worker tests 158/158 (new thumbnail test); gallery image-fit 7/7; production /gallery cards load `…&variant=thumb`; one image 1,777,901 B PNG → 13,392 B WebP 384×384 (0.13 s); gallery cards render.
- P4 hotlinks re-checked on production after these deploys: index + 162 JS chunks, 0 matches for linkaigc / aliyuncs.
- 残: P2 (d) Gallery/Canvas/History/Jobs per job, (f) confirmed failure + recovery per row type, (g) full-size quality review; garment materialKind recorded as "Tシャツ" for a blouse; garment drafts not shared across tabs.

### Iteration 41 (2026-10-07, /goal) — P2 (d) surfaces, (f) input failure
- Route ledger re-read: #1–#26 and #28 are `verified`, #27 is the out-of-scope row. The route part of the goal is complete.
- (d): production /jobs shows 50 completed jobs; the task names on the page cover every generating P2 row (ai-fitting, ai-fitting-reference, fitting clothing/background reference, wear-design-detail/lab, marketing dialogue ×2, design dialogue, design agent, lab, fashion studio, the 8 model-library rows, change-color, pattern-print-design (= print detail), pattern-arrange, image-repair, svg-convert, pattern-vector(+pro), line-to-real, line-generation, printing-image, fabric-image, print-design-project). /history renders the same 50-job timeline; /gallery shows the newest results. Matrix column d set for all generating rows (custom-style has no generation).
- (f) input failure: a corrupt PNG uploaded on /model is dropped (衣服の画像 0/4, AI生成 disabled, no request); a valid image in a new tab restores 1/4 and enables AI生成. The rejected file shows no message. That tab's upload stays unreconciled on purpose (no re-upload).
- 残: (f) provider-side failure and recovery; (g) full-size quality review; a message for rejected uploads.
- (g) first pass (gallery grid at 384px, not full size): today's fitting results keep the garment faithful — ruffled bow blouse with bell sleeves reproduced on the library model (ai-fitting-reference), on a model in a café (ai-fitting), on the 参考画像 model (clothing reference) and on the sunset beach (background reference, ai-cade89c9). The earlier background run with the old prompt (00:32, multi1) turned the polka-dot blouse into a men's collared shirt — the reason for PR #9. Full-size review per feature is still open.

### Iteration 42 (2026-10-07, /goal) — P2 (g) full-size review, (f) toast
- (f): repeating the corrupt-PNG upload with the toast as the confirmation shows 「画像の寸法を読み込めませんでした。」 while 衣服の画像 stays (0/4) — the message exists; my first check was too late.
- (g): every row's own result downloaded at full size (1024 px; model-library rows 1024×1536) through the media gateway and reviewed. 23 rows OK; 7 marked △ in p2-matrix.md (lab trademark-like mark; vector rows keep the test input's black background with glow; angle-change invented label; clothing-size bottoms unchanged; print-design-project on a mockup). pattern-vector re-run with a white-background input (ai-85578203, completed): clean flat colours on white, arch drawn closed.
- 残: provider-side failure + recovery (D1 holds no failed request to reconcile; not induced); prompt work for the △ rows.

### Iteration 43 (2026-10-07, /goal) — quality prompts, provider failure
- 変更 (PR nick353/heavy-chain#14, merged, live in LightchainParityPages.CDIOGVC0.js): vector briefs replace a black/dark source background with white, no glow/halo/blur/vignette, keep open curves open; lab / wear-design-lab / wear-design-detail requests forbid brand-like marks.
- 検証 blocked: the verification run on /tools/pattern-to-vector (black-background test input) failed three times with OpenAI HTTP 429 (ai-a6cc0864, ai-c9b0b5aa, ai-803eb67a). Not caused by the prompt: the error descriptor is status 429 (rate limit / quota). Stopped retrying.
- (f) provider-side failure observed for real: known failed state in D1, message 「画像の生成に失敗しました。保存済みの結果は保持されています。」, input kept, retry possible. Recovery to completed needs the OpenAI quota restored.
- 残: after the quota is back — one pattern-vector run with the black input and one lab run to confirm PR #14; then (f) recovery is complete.

### Iteration 44 (2026-10-07, /goal) — recovery and PR #14 confirmed
- The account owner added OpenAI credit. Same /tools/pattern-to-vector tab, original black-background input: ai-a790ff1d completed (20:21 UTC) — white background, no glow, the open arch kept open. This is also the (f) recovery after the 429 failures (no replay: each earlier request stayed failed).
- /flow/laboratory/detail: the un-generated upload restored from the draft in a new tab (the first tab's upload confirmation was ambiguous and left unreconciled, not re-uploaded); 依頼 「この白いTシャツを、胸に小さな紺色のワンポイント刺繍がある商品写真にしてください。」 → ai-fa8de647 completed: a simple abstract navy mark, no brand-like logo.
- p2-matrix: (f) evidenced for every generating row type (input failure on fitting, provider failure + recovery on edit-image); lab and pattern-vector quality ✅. Remaining △ (pro / svg-convert not re-run, angle-change label, clothing-size bottoms, print-design-project mockup) are recorded quality notes.

### Iteration 45 (2026-10-07, /goal) — remaining quality △ rows
- 変更 (PR nick353/heavy-chain#15): svg-convert does not add a garment to a graphic-only source and keeps every source element; graphic design white background without glow; clothing-size states the selected garment type and asks for a visible size change; angle-change forbids invented labels/tags/logos on unseen faces. (#16): graphic design background as pure white #FFFFFF, not inherited from the reference. (#17): clothing-size keeps other garments unchanged, no new pockets/logos/text/seams. Each confirmed in the served chunk before testing.
- 検証 (production 1440×900, each D1 heavy_ai_requests completed with one generated_images row, full-size image reviewed):
  - pattern-vector-pro ai-6395b84a ✅ (input restored in a new tab after an ambiguous upload confirmation; not re-uploaded).
  - svg-convert ai-1a6d83c8 (before #15: jacket) → ai-78733149 ✅.
  - angle-change 背面 ai-5af143da ✅. clothing-size bottoms L→XXL ai-91ab68c8 (pocket added) → ai-95b8504c ✅.
  - print-design-project ai-ed699633 / ai-1ac6dced: graphic only (mockup fixed) but grey background with glow from the black reference → still △.
- Tests: graphic-design-page 3/3, model-tool-settings-roundtrip 55/55 (= baseline), provider coverage same 2 baseline failures; tsc clean.
- 残: print-design-project background glow with dark references (prompt confirmed sent; model-side). Consumer-auth deploy awaits the user.

### Iteration 46 (2026-10-07, /goal) — route re-check in order, server copy of canonical inputs
- D1 re-check: all 48 job ids named in route-ledger.md / p2-matrix.md are `completed` in heavy_ai_requests, except the three intentional 429 failures (ai-a6cc0864, ai-c9b0b5aa, ai-803eb67a).
- Found while reloading #17: /editor/changeColor/detail?resumeJob=ai-f4d370ca… came back empty. Cause: the browser keeps 30 workspace artifacts per brand; once the job rotated out, resume used the server record, which had no input settings and no slots.
- 変更 (PR nick353/heavy-chain#18, Worker version 903ee6cf): canonical workspace requests send `canonicalInput` (settings, brief, reference note; text only); the Worker keeps it in metadata; the remote resume path reads canonicalInput and materialReferences (same shape as materialSlots). Worker tests 159/159 (new persistence test); canonical/resume/model-tool/printing suites equal to baseline (heavy-canonical-aliases 1 baseline failure in both).
- 検証 after deploy: old job ai-f4d370ca now restores source + result (settings were never saved for it → the page asks for them). New run ai-a78b1830 (ボルドー / Tシャツ全体) has canonicalInput in D1 and a new tab restores source, both settings and result. model-custom ai-34cb6496 (ラベル / 女性): canonicalInput.inputState in D1, new tab restores the mode, 女性 and the result.
- Reload re-check in the goal order (production, 1440×900, Companion): #17 change color ✅, #18 /model (garment, 説明生成 text, result) ✅, #19 model-custom ✅, #20 style card 完了 ✅, #21 marketing project card ✅, #22 fashion studio projects ✅, #23 lab (source, 41-char request, result) ✅, #24 wear design (multi1.jpg, 31-char request, 保存済み) ✅, #25 agent recent task ✅, #26 canvas layers ✅, #5 library folders ✅, #6 2027SS 企画ボード ✅, #28 gallery newest results ✅, #3 design detail (prompt + assistant reply) ✅, #4 avatar menu items ✅, #2 dialogue draft attachments ✅.

### Iteration 47 (2026-10-07, /goal) — inputs on the server, graphic background, R2 check, consumer-auth
- 変更 (PR nick353/heavy-chain#19): before a canonical workspace generation each uploaded input is copied to private media (`media/v1/<id>`, owner-only) and the path travels with the slot (`sourceMediaPath`); the resume path reads it when the browser-local asset is missing. A failed copy does not block; `busy` is held during the copy so a double click cannot start two requests. Graphic design sends references with a uniform dark background replaced by white (stored input stays the original).
- 変更 (#21): graphic design requests gpt-image-1.5 (allowed edit model) — the whitened reference alone still produced dark neon art on gpt-image-1-mini (ai-ed398fc1). (#22): canonicalInput carries toolId so model-library settings restore from the server copy.
- 検証: ai-ed398fc1 completed with `sourceMediaPath` media/v1/81d9104a… in D1; the R2 object's SHA-256 equals the uploaded file (4dc5a735…). ai-fcedf521 (gpt-image-1.5) completed: motif on pure white, no glow. Hook test: no local artifact and no local asset → settings from canonicalInput, input from private media, result restored (model-tool-settings-roundtrip 56/56). New whiten-dark-background 3/3; resume-input 11/11; canonical/print/fitting suites equal to baseline. A real second-browser check needs a login (password), which I cannot enter.
- R2: all 48 storage_paths named in the parity docs exist in heavy-chain-private-media (0 missing).
- consumer-auth: the deployed Worker (2026-09-25) was built from this branch and has PASSWORD_TOO_LONG / email_otp_type_not_available handling that main lacked; deploying main would have regressed it. Verified the branch source bundles to exactly the deployed index.js (0 differing lines), synced it into main (PR #20, tests 78/78), and deployed with WEB_ORIGINS + https://heavychain.app (version 20c34157). Readback: heavychain.app 200 (was 403), zeabur 200, unknown origin 403; deployed bundle identical to before.
- Tabs: this session's Companion tabs closed; the earlier session's tabs (owned by a previous client) cannot be closed by cleanup.

### Iteration 48 (2026-10-08) — 生成履歴 panel, Gallery/History/Jobs folded into the library, no loader flash
- 変更 (PR nick353/heavy-chain#23): shared `LightchainHistoryPanel` opens over the result column from every 生成履歴 button (design-tool frame, model surfaces, graphic design, printing, fabric, workbench); /history, /jobs, /gallery redirect to `/asset-center?group=生成履歴`; Heavy-only nav items, header links, result-card Gallery/History/Jobs links, notification/job-queue/activity links now point at the library or the job's resume link. #24: production rows have image_url = null (154/154), so the panel filters after signing.
- 変更 (#25): pages shared one Suspense boundary instead of one per route. Each navigation used to mount a fresh boundary and flash 「ワークスペースを準備しています」; navigations are router transitions, so the current screen now stays until the next page is ready (user report: Light shows no loader between screens).
- heavychain.app is the Cloudflare Worker heavy-chain-web, deployed by hand from main (cloudflare/heavy-web README); it had not been redeployed since Iteration 36 (served index.CaEFrdN3). Deployed from main after #23, #24, #25.
- 検証: tsc, vite build; changed test files fail on the same tests as the base (provider-coverage 2, material-contract 1, activity-routing 1, workbench-resume 4 — all pre-existing); the two browser suites that differed were flaky and pass when rerun. Production (Zeabur, Companion 1440×900): panel 724,66 700×818 (= Light), 50 items with images and download/delete, close removes it, /history → library 生成履歴.
- 残: delete/全削除 not run on production (irreversible). heavychain.app signed-out in Companion, so its UI was checked by bundle only.


### Iteration 49 (2026-10-08) — main is the only working line
- docs/parity moved into main. From here every change is made on a branch cut from origin/main and merged by PR; the patch-copy step from `handoff/lightchain-parity-20261006` is retired. That branch (pushed at e7df1014) is kept as an archive of unreleased WIP (Worker WIP in heavy-api/src, browser probe scripts, design-card/scene asset importers, ~400 files); salvage pieces from it by PR, never merge it wholesale.
- PR nick353/heavy-chain#26: workflow `Deploy heavychain.app` deploys the heavy-chain-web Worker on every push to main (skips with a warning until CLOUDFLARE_API_TOKEN / CLOUDFLARE_ACCOUNT_ID secrets exist). The five demo videos were ignored by `*.mp4`, so Zeabur served index.html for them; they are now tracked.

### Iteration 50 (2026-10-08) — tests green, 生成履歴 layout, print 適用, watermark, fabric warning, deep link
- 変更 (each merged by PR after the CI "Tests" check; Zeabur auto-deploys; heavychain.app deployed by hand, served index.DBJ8iQe8.js = built):
  - nick353/heavy-chain#28 first-load screen without copy for 2 s, idle prefetch of 11 main screens.
  - #29–#31 every scripts/*.test.* brought to the current code (200 files pass); #32 CI workflow `Tests` (tsc + all tests, Node 24, Playwright Chromium).
  - #33 生成履歴 panel in Light's layout: entries grouped by job, 2-column 314px tiles, hover actions (download / ライブラリーに保存 / delete; edit / send to Canvas, AIフィッティング, 生地イメージ, プリントイメージ), header download-all / delete-all, paging by 40 on scroll.
  - #34 プリントイメージ 「適用」 dialog measured on Light (1296×773): AIマスク認識 (トップス/ボトムス/全身, in-browser cutout), brush / eraser / invert / undo / redo, step 2 print placement (move, resize, rotate, flip), 決定 composites the print into the reference; spot mode asks for 適用 before AI生成, as Light does.
  - #35 透かし: the account-menu switch now stamps "Heavy Chain" bottom-right on every image download (shared helper, ZIP, print/pattern/colour editors, design detail, Canvas export); SVG untouched.
  - #36 生地イメージ: the workbench saved its full-size composite as a data URL into localStorage (≈5 MB limit) and logged `Failed to persist local workspace artifact during save`; data URLs over 256 KB are dropped from the persisted copy when the result has its own storagePath (readback signs the path).
  - #37 ライブラリー `?image=<id>` opens one result; `/gallery?image=` keeps the id through the redirect.
- 検証 (production 1440×900, Companion):
  - #10 print 適用: 適用 → AIマスク認識 トップス (mask exactly on the tee) → print added → 決定 (composite on chest, button 再調整) → AI生成 → result in ~15 s, URL `?resumeJob=ai-7c7bdab3-c977-4125-b850-9853fd294da6`. Evidence: evidence/heavy-printing-apply-mask-1440.jpg, heavy-printing-apply-result-1440.jpg. Light side measured earlier this iteration (light-printing-apply-mask-editor-1440.jpg, light-history-panel-printing-result-1440.jpg).
  - Board (/board/edit): テキスト adds 「テキストを入力」 at the click point and autosaves; ペン drag draws a stroke and autosaves; both undone afterwards (board left as before). ライブラリー flyout lists 3-column thumbnails including the new print result.
  - Widths: /tools/printing at 1280×800 (rightmost control 1252, AI生成 bottom 784) and 2560×1440 (header right 2532, AI生成 pinned at 1368–1408) — nothing outside the viewport.
  - Watermark pixel check (headless Chromium, 800×600 PNG): 1118 bright pixels in the bottom-right label area, 0 in the centre.
- Light re-check: /tools/reactor still 権限がありません and has no file input (#14 mask editor unobtainable); #11 / #13 unchanged (locked). /printing (#8) accepts files only through a native file chooser, which Companion cannot drive (`native_file_chooser_user_required`) — strength labels need the user to pick a file. The other Light tab (1980939119) holds an earlier upload with unknown effect and was not reused.
- Already done before: provider failure → recovery (Iterations 43–44, 429 failures then ai-a790ff1d completed).
- 残 (needs the user): Cloudflare API token + account id as GitHub secrets (auto deploy of heavychain.app); sign-in on heavychain.app in Companion before Zeabur is redirected there; a channel for failure notifications (email / Slack) — nothing configured yet; whether old Gallery/History/Jobs pages may be deleted (they are not in the production bundle; deleting also removes gallerySourceResolution and assertions in 13 test files); delete / 全削除 in the 生成履歴 panel not run on production.

### Iteration 51 (2026-10-08) — automatic heavychain.app deploys, failure emails, heavychain.app as production
- The user added the repository secrets CLOUDFLARE_API_TOKEN and CLOUDFLARE_ACCOUNT_ID. Workflow `Deploy heavychain.app` now runs on every push to main; the first run (37734721266) and every later one succeeded, with readback served = built. Manual deploys are retired.
- nick353/heavy-chain#39 failure emails: a separate Worker `heavy-chain-alerts` (cloudflare/heavy-alerts, cron */15) reads `heavy_ai_requests` read-only and emails nichika2000823@gmail.com through heavychain.app Email Routing when there are 3+ failures in the last hour with a new one in the last 15 minutes, or a request running for over 20 minutes. I added the address as a destination; it showed verified immediately. Test email sent (`sent:true`); `/test` needs a secret token and everything else returns 404.
- heavychain.app checked after the user signed in: /tools/printing loads, and the 生成履歴 panel shows the same 40 server results as Zeabur.
- #40 Zeabur → heavychain.app: page requests get a 302 with the same path and query; `/_health` and `/api/*` are untouched; set `CANONICAL_ORIGIN` to an empty value to undo. Production: `heavy-chain.zeabur.app/tools/printing?x=1` → 302 `https://heavychain.app/tools/printing?x=1`; `/_health` 200.
- #41 removed GalleryPage / HistoryPage / JobsPage and gallerySourceResolution (approved by the user), with their tests. My merge loop treated a failed check as finished and merged #41 while CI was red (an npm script still pointed at a deleted test); #42 fixed it within minutes. main Tests and the heavychain.app deploy are green on cb0191e. Merges now go ahead only when the check reports `pass`.
- Not done (not allowed for me): delete / 全削除 in the 生成履歴 panel (permanent deletion); Light #8 needs a file picked in Light's native chooser.

### Iteration 52 (2026-10-08) — Workers deploy from main; Light #8 closed
- API drift check: the running heavy-chain-api version 903ee6cf was deployed from #18, and main has no heavy-api changes since then, so deployed = main.
- nick353/heavy-chain#44 workflow `Deploy Workers`: on main pushes that touch their code, heavy-chain-api is tested (159/159) and deployed, and heavy-chain-alerts is deployed. The manual run deployed API 07786e01 and alerts 988a43eb. CORS preflight from heavychain.app returned 204, and the heavychain.app 生成履歴 panel loads after the deploy.
- Light #8 (strength labels on Light /printing) is closed at the user's request: Light accepts files only through a native file chooser, and the comparison is not required.

### Iteration 53 (2026-10-08) — AI model settings, Claude for all text AI, daily D1 backups
- nick353/heavy-chain#46: the admin feedback allow-list includes heavychain.app, PUBLIC_APP_ORIGIN is heavychain.app, and consumer-auth deploys from main (tests 78/78; the deployed version matched main #20). A manual `Deploy Workers` run deployed all three Workers; heavychain.app stays signed in.
- #47:
  - ブランド設定 › AIモデル: choose the image model and the Claude text model. Only registered models are listed (`GET /v1/ai/models`). The choice is sent with every request, and the OpenAI call now uses it; before this, the model in a request was ignored. Edits fall back to the default edit model when the chosen model cannot edit.
  - Claude default: Sonnet 5.5.
  - The design consultation chat uses Claude (vision) instead of Workers AI Llama. Migration 0016 was applied to production before deploy; design_assistant_requests kept 10/10 rows.
  - heavy-chain-alerts backs up every D1 table to R2 daily at 03:00 JST. Manual run: backups/d1/2026-10-08, 27 tables, 715 rows, 2.66 MB, plus manifest.
- 検証: Worker tests 163/163, new frontend and backup tests pass, CI green. Production settings page lists 4 OpenAI image models and 3 Claude models, with defaults GPT Image 2 / GPT Image 1 mini and Claude Sonnet 5.5.
- I committed #47 with a broken type block once (the local `tsc -p .` checks nothing; use `tsc -p tsconfig.app.json`). CI caught it and nothing was merged until it passed.

### Iteration 54 (2026-10-08) — Heavy Chain logo, favicons, share image
- nick353/heavy-chain#49: a new Heavy Chain mark (two interlocked chain links, teal and white) replaces the Light-shaped icon in the header, and comes with the "HEAVY CHAIN" wordmark.
- Added favicon.svg, favicon.ico (16/32/48), apple-touch-icon.png, icon-192/512.png and site.webmanifest. og-image.png (1200×630) is a new design. og:url and canonical are https://heavychain.app/, and og:image carries `?v=20261008` to bust caches.
- 検証: CI green. Production returns 200 for og-image, favicons, the touch icon and the manifest. og meta reads heavychain.app URLs. The header on heavychain.app/tools/printing shows the new mark.
- LINE and other apps cache share previews, so they may keep showing the old image for a while.

### Iteration 55 (2026-10-08/09) — design canvas matches Light, all canvas shortcuts work
- 変更 (each merged after the CI check passed; heavychain.app auto-deployed):
  - nick353/heavy-chain#58 removed unused legacy pages. #59 Canvas links open the Light-style design detail. #60 a handed-off Canvas image is attached only once.
  - #61–#63 the design canvas works like Light's project canvas: shapes and text, new shapes sized to the view, a delete button on each layer.
  - #64 inspiration start screen, zoom group and collapsed assistant as in Light. #65 Light's 初心者ガイド and キーボード shortcut panel.
  - #66 every shortcut in that panel works: marquee / Shift+click multi-select, Ctrl+A, Ctrl+G / Ctrl+Shift+G groups, object undo/redo (Ctrl+Z / Ctrl+Shift+Z and the toolbar), Ctrl+click 透過選択, Ctrl+Shift+C copy as PNG. Undo restores only the changed objects, so AI results added meanwhile survive.
  - #67 selection and undo history survive the reload after a save. #68 Ctrl+click 透過選択 on macOS (Ctrl+click is a context-menu click there, so it is handled on pointerdown). #69 projects without a chat re-read only the document after a save; the upload screen no longer flashes.
- 検証 (production, Companion, test project imgp-dc9d322c…): undo/redo, Ctrl+A, group/ungroup, group click, marquee and copy as image (clipboard became the 1024×1024 PNG) on production; Shift+click, multi-object drag and Ctrl/⌘+click in a local Playwright harness that mounts DesignEntryDetailPage with fake clients (Companion cannot hold Shift or Ctrl). The user confirmed Ctrl+click and the flicker fix on production. Test shapes removed afterwards.
- 残: none for the canvas.
