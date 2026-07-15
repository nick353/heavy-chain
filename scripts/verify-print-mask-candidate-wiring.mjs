#!/usr/bin/env node
import fs from 'node:fs';

const page = fs.readFileSync('src/pages/LightchainMaterialWorkbenchPage.tsx', 'utf8');
const library = fs.readFileSync('src/lib/workspaceMaterialReferences.ts', 'utf8');
const picker = fs.readFileSync('src/components/workspace/PrintMaskCandidatePicker.tsx', 'utf8');
const strategy = fs.readFileSync('src/lib/printMaskCandidateStrategy.ts', 'utf8');
const stage = fs.readFileSync('src/components/workspace/PrintingCompositionStage.tsx', 'utf8');
const editor = fs.readFileSync('src/components/workspace/PrintMaskEditor.tsx', 'utf8');
const artworkStrategy = fs.readFileSync('src/lib/printArtworkMaskStrategy.ts', 'utf8');
const edgeRefinement = fs.readFileSync('src/features/printing/matte/refineAlphaEdge.ts', 'utf8');
const manualPrintableSurface = fs.readFileSync('src/features/printing/surface/manualPrintableSurface.ts', 'utf8');
const surfaceConformer = fs.readFileSync('src/features/printing/render/surfaceConformer.ts', 'utf8');
const boundedSurfaceConformerRoi = fs.readFileSync('src/features/printing/render/boundedSurfaceConformerRoi.ts', 'utf8');
const printableSuggestionRequest = fs.readFileSync('src/features/printing/surface/printableSuggestionRequest.ts', 'utf8');
const printableSuggestionAdapter = fs.readFileSync('src/features/printing/surface/printableSurfaceSuggestionAdapter.ts', 'utf8');

const checks = {
  candidate_builder_used: page.includes('buildPrintGarmentCutoutDataUrl')
    && page.includes('buildDerivedPrintGarmentMaskCandidates')
    && library.includes('buildDerivedPrintGarmentMaskCandidates'),
  stable_candidate_id_state: page.includes('selectedPrintGarmentMaskCandidateId'),
  selection_updates_stage_url: page.includes('setPrintGarmentProcessed(selection.dataUrl)'),
  selection_enters_generation_signature: page.includes('printGarmentMaskCandidateId: selectedPrintGarmentMaskCandidateId'),
  selection_enters_snapshot_signature: strategy.includes('maskCandidateId: input.garment.maskCandidateId') && page.includes('garmentMaskCandidateId: selectedPrintGarmentMaskCandidateId'),
  stale_request_guard_preserved: page.includes('printGarmentCutoutRequestRef.current !== requestId'),
  picker_is_accessible: picker.includes('role="radiogroup"') && picker.includes('aria-checked={selected}'),
  print_cutout_disables_blur: library.includes('postProcessMask = true')
    && (library.match(/postProcessMask: false/g) || []).length >= 2,
  print_garment_uses_same_origin_model: library.includes("modelName: 'silueta',\n      postProcessMask: false")
    && (library.match(/modelName: 'silueta'/g) || []).length >= 2
    && library.includes("modelName = 'silueta'"),
  garment_preview_has_no_blend_halo: stage.includes("mixBlendMode: 'normal'")
    && stage.includes("opacity: 1")
    && stage.includes("filter: 'none'"),
  artwork_uses_conservative_source_mask: library.includes('buildPrintArtworkBackgroundCutoutRgba')
    && artworkStrategy.includes('PRINT_ARTWORK_BACKGROUND_COLOR_DISTANCE = 34')
    && artworkStrategy.includes('enqueue(x + 1, y)')
    && artworkStrategy.includes('enqueue(x, y - 1)'),
  mask_editor_supports_keep_remove_undo_reset_zoom: editor.includes("type PrintMaskBrushMode")
    && editor.includes("setMode('keep')")
    && editor.includes("setMode('remove')")
    && editor.includes('undoRef.current')
    && editor.includes('setZoom'),
  garment_and_design_editor_wired: page.includes('openGarmentMaskEditor')
    && page.includes('openDesignMaskEditor')
    && page.includes('<PrintMaskEditor'),
  mask_revision_enters_signature: strategy.includes('maskRevision: input.garment.maskRevision')
    && strategy.includes('maskRevision: design.maskRevision')
    && page.includes('garmentMaskRevision: printGarmentMaskRevision'),
  exact_and_fabric_compositors_are_wired: page.includes("renderPrintRequestComposition(nextSnapshot, 'exact')")
    && page.includes("renderPrintRequestComposition(nextSnapshot, 'fabric')")
    && library.includes("if (mode === 'fabric')")
    && library.includes('applyFabricLuminanceModulation'),
  result_compare_and_bounded_history_are_wired: page.includes('<ImageCompare')
    && page.includes('mergePrintResultHistory(')
    && strategy.includes('maxResults = 8'),
  mask_editor_undo_is_bounded_to_twelve: editor.includes('MAX_MASK_UNDO_STEPS = 12')
    && editor.includes('MAX_MASK_UNDO_STEPS - 1'),
  print_ai_edges_are_decontaminated_without_blur: library.includes('decontaminateBoundaryRgb')
    && library.includes('if (!postProcessMask)')
    && library.includes('background.sampleSpread <= 72'),
  uniform_garment_background_avoids_model_timeout: library.includes('PRINT_FAST_UNIFORM_BACKGROUND_MAX_SPREAD = 36')
    && library.indexOf('sourceBackground.sampleSpread <= PRINT_FAST_UNIFORM_BACKGROUND_MAX_SPREAD')
      < library.indexOf("modelName: 'silueta',\n      postProcessMask: false"),
  production_model_does_not_silently_fall_back_to_huggingface: library.includes("VITE_REMBG_ISNET_GENERAL_USE_MODEL_URL\n  || ''")
    && library.includes("VITE_REMBG_SILUETA_MODEL_URL\n  || '/models/silueta.onnx'")
    && !library.includes('https://huggingface.co/briaai/RMBG-1.4/resolve/main/onnx/model.onnx'),
  ai_result_records_actual_model_engine: library.includes('engine: `browser-ai-${modelName}-v1`'),
  cutout_timeout_allows_ai_fallback_to_finish: page.includes('const CUTOUT_TIMEOUT_MS = 75_000')
    && library.includes('const REMBG_OPERATION_TIMEOUT_MS = 30_000'),
  automatic_garment_result_is_shown_before_optional_candidates: page.indexOf("setPrintGarmentCutoutState('done')")
    < page.indexOf('buildDerivedPrintGarmentMaskCandidates({ baseResult: automaticResult })'),
  garment_candidate_work_is_dimension_bounded: library.includes('PRINT_CUTOUT_MAX_OUTPUT_DIMENSION = 1_400')
    && library.includes('PRINT_CUTOUT_MAX_OUTPUT_DIMENSION / Math.max(width, height)'),
  refined_candidate_uses_source_edge_refinement_not_morphology: strategy.includes("id: 'refined'")
    && strategy.includes('buildRefinedPrintMaskCandidateRgba')
    && strategy.includes('refineAlphaEdge({ rgba, width, height })')
    && library.includes("candidateId === 'refined'")
    && library.includes('buildRefinedPrintMaskCandidateRgba({ rgba: imageData.data, width, height })')
    && edgeRefinement.includes('centerAlpha < 8 || centerAlpha > 247'),
  optional_mask_candidate_failures_are_isolated: strategy.includes('Promise.all(optionalCandidateIds.map')
    && strategy.includes('onOptionalFailure?.(candidateId, error)')
    && library.includes('Optional garment mask candidate failed: ${candidateId}'),
  mask_candidate_order_keeps_auto_default_and_manual_fallback: strategy.includes("'auto',\n  'refined',\n  'detail',\n  'strict',\n  'manual'")
    && page.includes("useState<PrintGarmentMaskCandidateId>('auto')")
    && strategy.includes('resultWithoutRefinement'),
  manual_printable_surface_is_explicit_and_default_off: page.includes('印刷可能面を手動で指定')
    && page.includes('useState(false)')
    && page.includes('printableSurfaceEnabled ? manualPrintableSurface?.identity : undefined'),
  manual_surface_uses_canonical_hash_and_current_source_validation: manualPrintableSurface.includes("canonicalPayload('garment-source-rgba-v1'")
    && manualPrintableSurface.includes("canonicalPayload('png-alpha-v1'")
    && library.includes('validateEncodedManualPrintableSurface(printableSurface, garmentUrl)'),
  printable_surface_clips_design_only_with_stage_mask: library.includes('snapshot.printableSurface?.stageMask.url ?? snapshot.garment.mask.url')
    && library.includes('buildStageAlphaMaskDataUrl(')
    && stage.includes('designClipMaskUrl ?? garmentMaskUrl'),
  printable_surface_editor_preserves_dimensions_and_resets_on_garment_change: editor.includes('preserveOutputSize')
    && page.includes('PRINTABLE_SURFACE_STALE_TARGET')
    && page.includes('clearManualPrintableSurface('),
  ready_surface_never_silently_falls_back: library.includes("surfaceIdentity?.status === 'manual-ready' || surfaceIdentity?.status === 'semantic-ready'")
    && library.includes("snapshot.surfaceIdentity?.status === 'manual-ready' || snapshot.surfaceIdentity?.status === 'semantic-ready'")
    && library.includes("throw new PrintableSurfaceError('PRINTABLE_SURFACE_MISSING')"),
  printable_surface_commit_checks_exact_garment_request: page.includes('capturedGarmentCutoutRequestId')
    && page.includes('printGarmentProcessedRef.current !== currentGarmentUrl'),
  same_candidate_reselection_is_a_noop: page.includes('if (candidateId === selectedPrintGarmentMaskCandidateId) return;'),
  experimental_surface_result_is_manual_only_and_non_semantic: page.includes("title: '布面追従（試験）'")
    && page.includes('3D・自動面認識ではありません')
    && page.includes('!printableSurfaceEnabled || !manualPrintableSurface'),
  exact_and_fabric_commit_before_surface_attempt: page.indexOf("toast.success('2種類のプリント結果を作成しました')")
    < page.indexOf('setPendingSurfaceJob({')
    && page.includes('requestAnimationFrame(() => window.setTimeout(resolve, 0))')
    && page.includes('renderExperimentalSurfaceComposition(job.snapshot'),
  surface_failure_is_locally_isolated: page.includes("console.warn('Experimental surface composition skipped.'")
    && page.includes('setSurfaceConformStatus(surfaceConformStatusMessage(reason))')
    && library.includes('export async function renderExperimentalSurfaceComposition'),
  roi_wrapper_is_wired_for_high_resolution: boundedSurfaceConformerRoi.includes('conformBoundedSurfaceRoi')
    && boundedSurfaceConformerRoi.includes('BOUNDED_SURFACE_CONFORMER_ROI_TOO_LARGE')
    && boundedSurfaceConformerRoi.includes('frameContactReference')
    && boundedSurfaceConformerRoi.includes('visibleBounds'),
  high_resolution_surface_job_is_not_blanket_skipped: !page.includes('高解像度出力では「布面追従（試験）」を省略し、exact/fabricを高解像度で保存しました。')
    && page.includes('setPendingSurfaceJob({'),
  surface_conformer_is_pure_and_bounded: surfaceConformer.includes('SURFACE_CONFORMER_MAX_PIXELS = 1_000_000')
    && surfaceConformer.includes('SURFACE_CONFORMER_FRAME_CONTACT_REFERENCE_INVALID')
    && surfaceConformer.includes('frameContactReference')
    && surfaceConformer.includes('MAX_DISPLACEMENT') === false
    && !surfaceConformer.includes('document.')
    && surfaceConformer.includes('vectorLength > 2'),
  delayed_surface_preserves_result_order: strategy.includes('mergeDelayedSurfaceResult')
    && page.includes('exactId: nextResults[0].id')
    && page.includes('fabricId: nextResults[1].id'),
  high_resolution_output_is_explicit_and_generation_locked: page.includes('1440 × 1800（高解像度）')
    && page.includes('disabled={isGenerating}')
    && page.includes('stageSize: printOutputStageSize'),
  high_resolution_uses_bounded_surface_after_exact_fabric: page.indexOf("toast.success('2種類のプリント結果を作成しました')")
    < page.indexOf('setPendingSurfaceJob({')
    && library.includes('conformBoundedSurfaceRoi({')
    && !page.includes('高解像度出力では「布面追従（試験）」を省略'),
  png_download_has_stable_dimensions_and_filename: page.includes('PNGをダウンロード')
    && page.includes('download={`heavy-chain-${result.id}-${result.outputSize.width}x${result.outputSize.height}.png`}'),
  preview_surface_mask_stays_at_legacy_resolution: page.includes('stageSize: printPreviewStageSize'),
  printable_suggestion_requires_explicit_review_and_manual_apply: page.includes('印刷面の候補を作る（試験）')
    && page.includes('印刷可能面の候補を確認・修正')
    && page.includes('印刷可能面を保存')
    && page.includes('setPrintableSurfaceEnabled(false)'),
  printable_suggestion_has_full_stale_commit_token: printableSuggestionRequest.includes('captured.requestId === current.requestId')
    && printableSuggestionRequest.includes('captured.garmentUrl === current.garmentUrl')
    && printableSuggestionRequest.includes('captured.cutoutRequestId === current.cutoutRequestId')
    && page.includes('printableSuggestionRequestRef.current === requestId'),
  printable_editor_and_apply_share_monotonic_operation_gate: printableSuggestionRequest.includes('canCommitPrintableSurfaceEditorOperation')
    && page.includes('const applyOperationId = ++printableSurfaceEditorOperationRef.current')
    && page.includes('canCommitPrintableSurfaceEditorOperation(applyOperationId, printableSurfaceEditorOperationRef.current)')
    && page.includes('const editorOperationId = ++printableSurfaceEditorOperationRef.current'),
  garment_change_invalidates_suggestion_synchronously: page.includes('onChange={(image) => {\n                  invalidatePrintableSuggestion();\n                  setPrintGarment(image);'),
  printable_suggestion_adapter_checks_dimensions_and_capacity: printableSuggestionAdapter.includes("reason: 'DIMENSION_MISMATCH'")
    && printableSuggestionAdapter.includes("reason: 'CAPACITY_EXCEEDED'")
    && page.includes('expectedSize: capturedSize')
    && library.includes('estimatePrintMaskDataUrlBytes(dataUrl)'),
};

const failed = Object.entries(checks).filter(([, ok]) => !ok).map(([name]) => name);
console.log(JSON.stringify({ ok: failed.length === 0, checks, failed }, null, 2));
process.exit(failed.length === 0 ? 0 : 1);
