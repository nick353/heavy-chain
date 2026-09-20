import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import {
  hasPrintDesignAssetPurpose,
  PRINT_DESIGN_ASSET_PURPOSE,
  buildPrintDesignAssetPrompt,
  sanitizePrintDesignAssetPurpose,
} from '../src/features/printing/selection/printDesignAssetPurpose.ts';
import { shouldShowPrintDesignCreationCta } from '../src/features/printing/selection/galleryPrintDesignCta.ts';
import { getGalleryImageLabel } from '../src/features/printing/selection/galleryImageLabel.ts';
import { isTrustedPatternsOrigin } from '../src/features/printing/selection/printDesignHandoff.ts';
import { getLightchainProviderRoute } from '../src/features/lightchain/providerAdapter.ts';

const gallerySelector = fs.readFileSync('src/components/GallerySelector.tsx', 'utf8');
const imageSelector = fs.readFileSync('src/components/ImageSelector.tsx', 'utf8');
const printingPage = fs.readFileSync('src/pages/LightchainMaterialWorkbenchPage.tsx', 'utf8');
const handoff = fs.readFileSync('src/features/printing/selection/printDesignHandoff.ts', 'utf8');
const cloudflareCore = fs.readFileSync('cloudflare/heavy-api/src/core.ts', 'utf8');

test('print-design metadata parser accepts only the exact explicit purpose', () => {
  assert.equal(PRINT_DESIGN_ASSET_PURPOSE, 'print-design');
  assert.equal(hasPrintDesignAssetPurpose({ assetPurpose: 'print-design' }), true);
  assert.equal(hasPrintDesignAssetPurpose({ assetPurpose: 'design' }), false);
  assert.equal(hasPrintDesignAssetPurpose({ assetPurpose: 'print-design ' }), false);
  assert.equal(hasPrintDesignAssetPurpose(['print-design']), false);
  assert.equal(hasPrintDesignAssetPurpose(null), false);
});

test('Cloudflare Gallery requests and reapplies the explicit metadata filter before display slicing', () => {
  const filterIndex = gallerySelector.indexOf('assetPurpose: assetPurpose === PRINT_DESIGN_ASSET_PURPOSE ? PRINT_DESIGN_ASSET_PURPOSE : undefined');
  const limitIndex = gallerySelector.indexOf('.slice(0, filter === \'recent\' ? 20 : 50)');
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
  assert.match(printingPage, /galleryTitle="素材を選択"\s+galleryAssetPurpose="print-design"/);
  assert.equal((printingPage.match(/galleryAssetPurpose="print-design"/g) ?? []).length, 2);
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
  assert.equal(isTrustedPatternsOrigin(valid), true);
  assert.equal(isTrustedPatternsOrigin({ ...valid, sourceWorkspace: 'studio' }), false);
  assert.match(handoff, /sourceWorkspace === 'patterns'/);
  assert.match(handoff, /sourceResumePath === '\/patterns\/workbench'/);
});

test('Patterns-origin print assets use an artwork-only prompt without changing product-photo generation', () => {
  const withoutReference = buildPrintDesignAssetPrompt({
    description: 'blue botanical motif',
    directionPrompt: 'minimalist',
    hasReference: false,
  });
  assert.match(withoutReference, /blue botanical motif/);
  assert.match(withoutReference, /exactly one self-contained compact motif or emblem/);
  assert.match(withoutReference, /NO CLOTHING, T-shirt, hoodie, dress, fabric product/);
  assert.match(withoutReference, /person, mannequin, product mockup, room, or scene/);
  assert.match(withoutReference, /uniform pure white \(#FFFFFF\) background reaching every image edge and corner/);
  assert.match(withoutReference, /Do not create a repeating pattern, seamless tile, all-over print, tiled grid, or rows\/columns of repeated elements/);
  assert.match(withoutReference, /every artwork pixel, shape, and stroke entirely inside the composition/);
  assert.match(withoutReference, /no artwork may cross the composition boundary or be cropped, clipped, cut off, or bleed beyond it/);
  assert.match(withoutReference, /generous, clearly visible pure-white margin between every artwork pixel and every one of the four image edges/);
  assert.doesNotMatch(withoutReference, /Use the reference only/);
  const withReference = buildPrintDesignAssetPrompt({
    description: 'chain motif',
    directionPrompt: 'street',
    hasReference: true,
  });
  assert.match(withReference, /Use the reference only as visual motif inspiration/);
  assert.match(withReference, /Do not preserve or reproduce any garment or product silhouette/);
  assert.equal(getLightchainProviderRoute('print-design-detail'), 'edit-image');
  assert.equal(getLightchainProviderRoute('marketing-home'), 'edit-image');
});

test('Gallery labels distinguish print assets without changing other Gallery labels', () => {
  assert.equal(getGalleryImageLabel({ prompt: 'blue flower', featureType: 'design-gacha', index: 0, isPrintDesign: true }), 'blue flower');
  assert.equal(getGalleryImageLabel({ prompt: 'blue flower', featureType: 'design-gacha', index: 0, isPrintDesign: false }), 'design-gacha');
  assert.equal(getGalleryImageLabel({ prompt: '  ', featureType: null, index: 2, isPrintDesign: true }), 'ギャラリー画像 3');
  assert.match(gallerySelector, /isPrintDesign: assetPurpose === PRINT_DESIGN_ASSET_PURPOSE/);
});

test('the active Cloudflare gallery contract preserves the explicit purpose boundary', () => {
  assert.match(cloudflareCore, /asset_purpose/);
  assert.match(cloudflareCore, /assetPurpose !== null && assetPurpose !== "print-design"/);
  assert.match(cloudflareCore, /json_extract\(metadata, '\$\.assetPurpose'\)/);
  assert.match(cloudflareCore, /user_id = \?/);
});

test('current runtime has no package-owned legacy producer dependency', () => {
  assert.doesNotMatch(handoff, /supabase\.functions|supabase\.co|OPENAI_API_KEY/);
  assert.doesNotMatch(cloudflareCore, /supabase\.functions|supabase\.co|\/functions\/v1\//);
});
