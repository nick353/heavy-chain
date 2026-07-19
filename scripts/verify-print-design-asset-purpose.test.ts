import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import {
  hasPrintDesignAssetPurpose,
  PRINT_DESIGN_ASSET_PURPOSE,
} from '../src/features/printing/selection/printDesignAssetPurpose.ts';
import { shouldShowPrintDesignCreationCta } from '../src/features/printing/selection/galleryPrintDesignCta.ts';
import { sanitizePrintDesignAssetPurpose } from '../supabase/functions/_shared/printDesignAssetPurpose.ts';

const gallerySelector = fs.readFileSync('src/components/GallerySelector.tsx', 'utf8');
const imageSelector = fs.readFileSync('src/components/ImageSelector.tsx', 'utf8');
const printingPage = fs.readFileSync('src/pages/LightchainMaterialWorkbenchPage.tsx', 'utf8');
const designGacha = fs.readFileSync('supabase/functions/design-gacha/index.ts', 'utf8');
const migration = fs.readFileSync(
  'supabase/migrations/20260719190000_backfill_explicit_pattern_print_design_purpose.sql',
  'utf8',
);

test('print-design metadata parser accepts only the exact explicit purpose', () => {
  assert.equal(PRINT_DESIGN_ASSET_PURPOSE, 'print-design');
  assert.equal(hasPrintDesignAssetPurpose({ assetPurpose: 'print-design' }), true);
  assert.equal(hasPrintDesignAssetPurpose({ assetPurpose: 'design' }), false);
  assert.equal(hasPrintDesignAssetPurpose({ assetPurpose: 'print-design ' }), false);
  assert.equal(hasPrintDesignAssetPurpose(['print-design']), false);
  assert.equal(hasPrintDesignAssetPurpose(null), false);
});

test('Gallery applies the explicit metadata filter before its result limit', () => {
  const filterIndex = gallerySelector.indexOf("imageQuery.contains('metadata', { assetPurpose: PRINT_DESIGN_ASSET_PURPOSE })");
  const limitIndex = gallerySelector.indexOf('imageQuery = imageQuery.limit(20)');
  assert.ok(filterIndex >= 0, 'print-design metadata filter must exist');
  assert.ok(limitIndex > filterIndex, 'print-design metadata filter must run before limit');
  assert.match(gallerySelector, /assetPurpose === PRINT_DESIGN_ASSET_PURPOSE/);
  assert.match(gallerySelector, /プリントデザインはまだありません。ローカル画像は選択画面からアップロードできます/);
  assert.match(gallerySelector, /to="\/patterns"/);
  assert.match(gallerySelector, /プリントデザインを作る/);
});

test('empty print-design CTA remains visible when unrelated top-level folders exist', () => {
  const baseline = {
    assetPurpose: PRINT_DESIGN_ASSET_PURPOSE,
    normalizedSearchQuery: '',
    filter: 'recent' as const,
    currentFolderId: null,
    visibleImageCount: 0,
  };
  assert.equal(shouldShowPrintDesignCreationCta(baseline), true);
  assert.equal(shouldShowPrintDesignCreationCta({ ...baseline, visibleImageCount: 1 }), false);
  assert.equal(shouldShowPrintDesignCreationCta({ ...baseline, currentFolderId: 'folder-1' }), false);
  assert.equal(shouldShowPrintDesignCreationCta({ ...baseline, normalizedSearchQuery: 'logo' }), false);
  assert.equal(shouldShowPrintDesignCreationCta({ ...baseline, assetPurpose: undefined }), false);
});

test('only the Lightchain print-design picker requests the purpose filter', () => {
  assert.match(imageSelector, /galleryAssetPurpose\?: PrintDesignAssetPurpose/);
  assert.equal((imageSelector.match(/assetPurpose=\{galleryAssetPurpose\}/g) ?? []).length, 2);
  assert.match(printingPage, /galleryTitle="プリントデザインを選択"\s+galleryAssetPurpose="print-design"/);
  assert.equal((printingPage.match(/galleryAssetPurpose="print-design"/g) ?? []).length, 1);
  assert.match(imageSelector, /type="file"\s+accept="image\/\*"/);
});

test('producer sanitizer tags only a validated Patterns-origin design-gacha intent', () => {
  const valid = {
    sourceWorkspace: 'patterns',
    workflowVersion: 'pattern-preview-local-v1',
    sourceLabel: '柄・グラフィック',
    sourceResumePath: '/patterns/workbench',
    sourceMode: 'local-workflow-intake',
    generationIntent: { feature: 'design-gacha' },
  };
  assert.deepEqual(sanitizePrintDesignAssetPurpose(valid), { assetPurpose: 'print-design' });
  assert.equal(sanitizePrintDesignAssetPurpose({ ...valid, sourceWorkspace: 'studio' }), null);
  assert.equal(sanitizePrintDesignAssetPurpose({ ...valid, workflowVersion: 'unknown' }), null);
  assert.equal(sanitizePrintDesignAssetPurpose({ ...valid, sourceResumePath: '/patterns' }), null);
  assert.equal(sanitizePrintDesignAssetPurpose({ ...valid, generationIntent: { feature: 'prompt-edit' } }), null);
  assert.match(designGacha, /sanitizePrintDesignAssetPurpose\(requestSourceMetadata\)/);
  assert.match(designGacha, /sanitizePrintDesignAssetPurpose\(finalSourceMetadata\)/);
  assert.match(designGacha, /patterns: \{ label: '柄・グラフィック', resumePath: '\/patterns\/workbench'/);
  assert.doesNotMatch(designGacha, /assetPurpose:\s*['"]print-design['"]/);
});

test('migration is idempotent, high-confidence, and carries an exact rollback marker', () => {
  assert.match(migration, /WHERE feature_type = 'design-gacha'/);
  assert.match(migration, /metadata->>'sourceWorkspace' = 'patterns'/);
  assert.match(migration, /metadata->>'workflowVersion' = 'pattern-preview-local-v1'/);
  assert.match(migration, /metadata->>'sourceMode' = 'local-workflow-intake'/);
  assert.match(migration, /metadata#>>'\{generationIntent,feature\}' = 'design-gacha'/);
  assert.match(migration, /NOT \(COALESCE\(metadata, '\{\}'::jsonb\) \? 'assetPurpose'\)/);
  assert.match(migration, /assetPurposeBackfillMigration/);
  assert.match(migration, /metadata - 'assetPurpose' - 'assetPurposeBackfillMigration'/);
  assert.doesNotMatch(migration, /prompt\s+(?:LIKE|ILIKE)|ocr|pixel/i);
});
