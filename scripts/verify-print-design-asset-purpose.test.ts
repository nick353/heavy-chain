import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import {
  hasPrintDesignAssetPurpose,
  PRINT_DESIGN_ASSET_PURPOSE,
} from '../src/features/printing/selection/printDesignAssetPurpose.ts';
import { shouldShowPrintDesignCreationCta } from '../src/features/printing/selection/galleryPrintDesignCta.ts';
import { getGalleryImageLabel } from '../src/features/printing/selection/galleryImageLabel.ts';
import {
  buildPrintDesignAssetPrompt,
  sanitizePrintDesignAssetPurpose,
} from '../supabase/functions/_shared/printDesignAssetPurpose.ts';

const gallerySelector = fs.readFileSync('src/components/GallerySelector.tsx', 'utf8');
const imageSelector = fs.readFileSync('src/components/ImageSelector.tsx', 'utf8');
const printingPage = fs.readFileSync('src/pages/LightchainMaterialWorkbenchPage.tsx', 'utf8');
const designGacha = fs.readFileSync('supabase/functions/design-gacha/index.ts', 'utf8');
const generateImage = fs.readFileSync('supabase/functions/generate-image/index.ts', 'utf8');
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
  assert.match(imageSelector, /printDesignAssetPurpose\?: PrintDesignAssetPurpose/);
  assert.equal((imageSelector.match(/printDesignAssetPurpose: galleryAssetPurpose/g) ?? []).length, 2);
  assert.equal((imageSelector.match(/assetPurpose=\{galleryAssetPurpose\}/g) ?? []).length, 2);
  assert.match(printingPage, /galleryTitle="プリントデザインを選択"\s+galleryAssetPurpose="print-design"/);
  assert.equal((printingPage.match(/galleryAssetPurpose="print-design"/g) ?? []).length, 1);
  assert.match(imageSelector, /type="file"\s+accept="image\/\*"/);
  assert.match(printingPage, /backgroundProfile: design\.printDesignAssetPurpose === PRINT_DESIGN_ASSET_PURPOSE/);
  assert.match(printingPage, /printDesignAssetPurpose: PRINT_DESIGN_ASSET_PURPOSE/);
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

test('Patterns-origin print assets use an artwork-only prompt without changing product-photo generation', () => {
  const withoutReference = buildPrintDesignAssetPrompt({
    description: 'blue botanical motif',
    directionPrompt: 'minimalist',
    hasReference: false,
  });
  assert.match(withoutReference, /blue botanical motif/);
  assert.match(withoutReference, /NO CLOTHING, T-shirt, hoodie, dress, fabric product/);
  assert.match(withoutReference, /uniform pure white \(#FFFFFF\) background reaching every image edge and corner/);
  assert.match(withoutReference, /nothing may touch the image border/);
  assert.doesNotMatch(withoutReference, /Use the reference only/);
  const withReference = buildPrintDesignAssetPrompt({
    description: 'chain motif',
    directionPrompt: 'street',
    hasReference: true,
  });
  assert.match(withReference, /Use the reference only as visual motif inspiration/);
  assert.match(withReference, /Do not preserve or reproduce any garment or product silhouette/);
  assert.match(designGacha, /if \(finalPrintDesignPurpose\) \{/);
  assert.match(designGacha, /else if \(isProductFixed && originalImageBase64\)/);
  assert.match(designGacha, /else if \(!generatedImage\) \{\s*generatedImage = await generateFromText/);
  assert.match(designGacha, /generationMode: finalPrintDesignPurpose \? 'isolated-print-design' : 'fashion-product-photo'/);
});

test('Gallery labels distinguish print assets without changing other Gallery labels', () => {
  assert.equal(getGalleryImageLabel({ prompt: 'blue flower', featureType: 'design-gacha', index: 0, isPrintDesign: true }), 'blue flower');
  assert.equal(getGalleryImageLabel({ prompt: 'blue flower', featureType: 'design-gacha', index: 0, isPrintDesign: false }), 'design-gacha');
  assert.equal(getGalleryImageLabel({ prompt: '  ', featureType: null, index: 2, isPrintDesign: true }), 'ギャラリー画像 3');
  assert.match(gallerySelector, /isPrintDesign: assetPurpose === PRINT_DESIGN_ASSET_PURPOSE/);
});

test('the active unified generate-image producer preserves metadata and artwork-only prompt policy', () => {
  assert.match(generateImage, /sanitizePrintDesignAssetPurpose\(sourceMetadata\)/);
  assert.match(generateImage, /const productionPrompt = printDesignPurpose\s*\? buildPrintDesignAssetPrompt/);
  assert.match(generateImage, /patterns: \{ label: '柄・グラフィック', resumePath: '\/patterns\/workbench'/);
  assert.ok((generateImage.match(/\.\.\.\(printDesignPurpose \?\? \{\}\)/g) ?? []).length >= 2);
  assert.doesNotMatch(generateImage, /assetPurpose:\s*['"]print-design['"]/);
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
