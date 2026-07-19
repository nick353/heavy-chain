-- Only the validated Patterns workspace -> design-gacha path can be classified
-- without guessing from untrusted image content or a generic feature name.
UPDATE public.generated_images
SET metadata = COALESCE(metadata, '{}'::jsonb)
  || jsonb_build_object(
    'assetPurpose', 'print-design',
    'assetPurposeBackfillMigration', '20260719190000_backfill_explicit_pattern_print_design_purpose'
  )
WHERE feature_type = 'design-gacha'
  AND metadata->>'sourceWorkspace' = 'patterns'
  AND metadata->>'workflowVersion' = 'pattern-preview-local-v1'
  AND metadata->>'sourceLabel' = '柄・グラフィック'
  AND metadata->>'sourceResumePath' = '/patterns'
  AND metadata->>'sourceMode' = 'local-workflow-intake'
  AND metadata#>>'{generationIntent,feature}' = 'design-gacha'
  AND NOT (COALESCE(metadata, '{}'::jsonb) ? 'assetPurpose');

-- Idempotent rollback for rows changed by this migration only:
-- UPDATE public.generated_images
-- SET metadata = metadata - 'assetPurpose' - 'assetPurposeBackfillMigration'
-- WHERE metadata->>'assetPurposeBackfillMigration'
--   = '20260719190000_backfill_explicit_pattern_print_design_purpose';
