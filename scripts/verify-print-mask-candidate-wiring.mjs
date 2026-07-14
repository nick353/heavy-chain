#!/usr/bin/env node
import fs from 'node:fs';

const page = fs.readFileSync('src/pages/LightchainMaterialWorkbenchPage.tsx', 'utf8');
const library = fs.readFileSync('src/lib/workspaceMaterialReferences.ts', 'utf8');
const picker = fs.readFileSync('src/components/workspace/PrintMaskCandidatePicker.tsx', 'utf8');
const strategy = fs.readFileSync('src/lib/printMaskCandidateStrategy.ts', 'utf8');
const stage = fs.readFileSync('src/components/workspace/PrintingCompositionStage.tsx', 'utf8');
const editor = fs.readFileSync('src/components/workspace/PrintMaskEditor.tsx', 'utf8');
const artworkStrategy = fs.readFileSync('src/lib/printArtworkMaskStrategy.ts', 'utf8');

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
};

const failed = Object.entries(checks).filter(([, ok]) => !ok).map(([name]) => name);
console.log(JSON.stringify({ ok: failed.length === 0, checks, failed }, null, 2));
process.exit(failed.length === 0 ? 0 : 1);
