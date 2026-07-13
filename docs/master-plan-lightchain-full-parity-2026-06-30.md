# Heavy Chain Master Plan: Lightchain Full-Parity and 10M Readiness

Updated: 2026-06-30

## Conclusion

Heavy Chain should not be called fully Lightchain-parity or 10M public-launch ready yet. The right master plan is to make the verified Heavy Chain production app keep its current stable shell, then close the remaining gaps in four layers: Lightchain-style live workbench parity, real all-feature generation, public-launch safety/business gates, and production entrypoint/scale proof.

This plan uses the root `STATE.md` and `plan.md` as source of truth. The Lightchain live-use evidence is under `output/playwright/linkai-live-use-20260630/`.

## What Was Actually Tested On Lightchain

- Logged into `https://jp.linkaigc.com/` with the provided account. The site sometimes shows a concurrent-session confirmation: `現在、このアカウントは他の端末で使用中です。このままログインを続行しますか？`.
- Home/catalog discovery succeeded. The visible top-level Lightchain entries are `マーケティングワークスペース`, `AIフィッティング`, `ウェアデザインラボ`, `動画ワークステーション`, `モデル企画ライブラリ`, `ファッションスタジオ`, `デザインエージェント`, and `Lightchain Lab`.
- Direct `/flow/...` route probing found that most flows open a file list, but creating a new file often navigates to `detail?boardProjectCode=&boardProjectType=` and renders a mostly blank page.
- `ChangeColor` existing project opened successfully. With a safe hoodie test image, file upload worked, the image appeared as a canvas layer, the `クリッピング` tool was visible, the layer toolbar was usable, and the add-asset panel opened.
- `GenerateShortVideo` existing project opened successfully. It exposed two file inputs for image/video, accepted safe image uploads, showed `残り生成回数 9`, `タスク 0 進行中`, `AI生成 1`, and `次のステップ`; clicking `次のステップ` and generation-related text moved the flow back to the list/guide state.

## Important Evidence

- Lightchain login/home discovery: `output/playwright/linkai-master-plan-discovery-20260630/linkai-discovery-summary.json`
- Lightchain flow route probe: `output/playwright/linkai-live-use-20260630/linkai-flow-route-probe.json`
- New-file blank-code proof: `output/playwright/linkai-live-use-20260630/flow-live-use.json`
- Existing project counts: `output/playwright/linkai-live-use-20260630/flow-existing-card-counts.json`
- Safe ChangeColor layer operation: `output/playwright/linkai-live-use-20260630/safe-changecolor-layer-operation.json`
- Video workstation existing project use: `output/playwright/linkai-live-use-20260630/video-existing-use.json`
- Heavy Chain production all-site QA: `output/playwright/all-site-functions-prod-20260630T0925Z/SUMMARY.json`
- Heavy Chain catalog route QA: `output/playwright/all-site-functions-catalog-prod-20260630T0930Z/SUMMARY.json`
- Heavy Chain all-10 generation preflight: `output/playwright/all-10-generation-preflight-prod-20260630T0935Z/SUMMARY.json`
- Production domain/H601 readback: `output/playwright/prod-domain-rights-check-20260630T0952Z/summary.json`

## Current Gap Classification

### A. Lightchain live parity gaps

1. Top cards on Lightchain are not a simple direct workspace navigation model; example cards and `同じもの作成` are part of the real user flow. Heavy Chain must support both top-level workspace starts and example-based starts.
2. Lightchain `/flow/...` new-file creation currently fails or is incomplete for many flows because it opens `detail?boardProjectCode=&boardProjectType=`. Heavy Chain should not copy this bug, but must provide a working new-project equivalent.
3. Existing Lightchain projects prove the real workbench model is canvas-first: add image, place layer, select layer, tool toolbar, clipping, add asset panel, task drawer, zoom, and step guidance.
4. Heavy Chain currently has many route-level and upload preflight passes, but it still needs one unified workbench contract across all functions: input assets, layer state, tool state, generation state, output result, Canvas/Gallery/History/Jobs continuity.

### B. Real generation gaps

1. G617 remains blocked. Runway website direct generation can produce one image, but Heavy Chain still lacks same-run all-10 fresh generation through the approved MCP/local-worker path.
2. The Runway `workspace_limit` blocker is not solved by proving the website can generate once. It must be translated into MCP result JSON, local worker import, DB/Storage readback, scorecard, and cleanup.
3. Lightchain live-use testing did not safely complete all generations; it confirmed UI flows and uploads for existing `ChangeColor` and `GenerateShortVideo`, and exposed blockers for the rest.

### C. Public launch gates

1. `https://heavy-chain.com` is currently unreachable with `ERR_CONNECTION_REFUSED`; Zeabur URL is the verified working production entrypoint.
2. Local H601 rights-confirmation guard passes source verification, but current Zeabur `/generate` does not visibly show the H601 rights copy.
3. H601 final legal/operator decisions and H602 billing/external-publish decisions remain open.
4. G619 real beta evidence remains queued; recorded QA is not enough for a 10M public-launch claim.

## Master Execution Plan

### Phase 1: Canonical Public Entrypoint

1. Decide canonical production URL: restore `https://heavy-chain.com` or explicitly make `https://heavy-chain.zeabur.app` the temporary canonical URL.
2. Run desktop/mobile route proof against the chosen public URL.
3. Add canonical URL to `STATE.md`, release gate, launch ops, and production monitor.

Acceptance: route/readback proof passes on the canonical URL, and `heavy-chain.com` is no longer silently assumed if it remains down.

### Phase 2: H601 Production Safety Readback

1. Deploy or reconcile the H601 UI so production `/generate` visibly shows rights confirmation and commercial/legal caveats.
2. Confirm the guard blocks generation when rights are not confirmed.
3. Confirm `/generate`, Canvas generation, Chat generation, Fitting/model-matrix, and Edge functions all pass or enforce `legalSafety.rightsConfirmed`.

Acceptance: `npm run verify:h601-legal-safety` passes and a production browser readback proves H601 copy and behavior on the current deployed asset.

### Phase 3: Lightchain Workbench Contract

Create one durable workbench contract used by every Heavy Chain function:

1. Asset input: upload, gallery reuse, history reuse, reference asset labels.
2. Canvas layer state: object id, z-order, selection, transform, crop/mask, clipping/auto-cut mode.
3. Tool state: clipping, background, color, model, pose, video reference, variation, upscale.
4. Generation state: prompt, model/provider, safety, count, status, job id, task id.
5. Output state: generated image/video, readback, scorecard, Canvas/Gallery/History/Jobs handoff.

Acceptance: every function can produce a JSON workbench state and a UI screenshot proving input -> layer/tool -> generation or blocked state -> output/handoff.

### Phase 4: Function Coverage

Implement or verify each Lightchain-equivalent group:

1. Marketing workspace: product image, model image, copy/banner, EC/SNS output, example-based start.
2. AI fitting: garment image, model/pose/body/background, flat-to-model and model-change variants.
3. Wear design lab: detail change, orientation design, evaluation, adopted candidate.
4. Video workstation: storyboard image, storyboard video, short video, reference video/image handoff.
5. Model library: face, pose, body shape, skin tone, age, background.
6. Fashion studio: garment/model/background/props composition and layer previews.
7. Design agent: trend prompt, series design, design exploration workflow.
8. Graphics: print design, pattern vector, color change, remove background, upscale, variations, partial fix.
9. Canvas editing: upload, local asset, intelligent crop, layer management, export.
10. Example starts: open a reference case and create the same workflow with prefilled assets/settings.

Acceptance: each group has at least one live UI proof, one machine-readable state proof, and either a generated output or an exact blocker.

### Phase 5: Same-Run All-Feature Generation

1. Restore sustained Runway availability in the approved connected workspace.
2. Rerun G617 with a new run id, no prior assets, at most two concurrent generations.
3. Import MCP results through the local worker.
4. Read back 10 jobs, 10 generated images, 10 Storage objects, signed URLs, and zero failed jobs.
5. Score all outputs and clean marker-scoped rows/storage.

Acceptance: strict G617 proof passes and is adopted by `npm run verify:10m-completion`.

### Phase 6: Real Beta Evidence

1. Collect at least three consented real beta sessions.
2. Cover desktop and mobile, at least two personas, and at least five workflows.
3. Store redacted artifacts, notes, readback, and sha256 values.
4. Pass `npm run verify:g619-beta-evidence`.

Acceptance: G619 moves from queued to accepted.

### Phase 7: Business, Legal, and Public Release

1. Close H601 final Terms/Privacy/retention/brand/person/copyright decisions.
2. Close H602 pricing, quota, checkout, support, refund, external-publish scope.
3. Implement only explicitly approved billing/external-publish surfaces.
4. Verify test-mode billing before any production enablement.

Acceptance: no human-needed H601/H602 item remains open.

### Phase 8: 10M Operations Proof

1. Define production-equivalent load targets and stop conditions.
2. Add or confirm alerting for worker liveness, failed jobs, stale jobs, DB/Storage errors, signed URL failures, and Edge/RPC errors.
3. Exercise incident response for Runway failure, worker stop, Storage failure, RLS anomaly, generation-quality regression.
4. Rerun release gate and strict 10M completion audit.

Acceptance: `npm run verify:release-gate` and strict `npm run verify:10m-completion` exit `ok=true`.

## Immediate Next Actions

1. Fix Heavy Chain production H601 visibility and public URL readback first. These are public-launch blockers independent of Runway.
2. Implement a reusable Lightchain-style workbench state contract and verifier before adding more UI polish.
3. Use the Lightchain live-use evidence to build a parity matrix: feature, input assets, tool/layer behavior, generation/output, Heavy Chain equivalent, blocker.
4. Resume G617 only when Runway MCP/local-worker path can sustain image tasks; direct Runway website output is not enough.
5. Keep unsafe surfaces stopped: payment, checkout, external publish, irreversible deletes, final legal decisions, OTP/CAPTCHA/security prompts.

## Non-Acceptance Notes

- Route-level page load is not full parity.
- Upload reflection is not generation completion.
- Direct Runway website generation is not G617 completion.
- Lightchain existing-project operation is useful reference evidence, but it does not prove Heavy Chain parity by itself.
- Screenshots that contain credentials must not be used as accepted proof artifacts.
