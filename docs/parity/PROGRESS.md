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
