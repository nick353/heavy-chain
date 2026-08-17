import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';
import { compactFittingMaterialReferenceForPersistence } from '../src/lib/fittingPersistence.ts';
import { prepareFittingDraftMaterialReferenceForPersistence } from '../src/lib/fittingPersistence.ts';

test('Fitting history is rebuilt from persisted model-matrix artifacts', async () => {
  const source = await readFile(new URL('../src/pages/FittingPage.tsx', import.meta.url), 'utf8');

  assert.match(source, /listWorkspaceGeneratedImages/);
  assert.match(source, /withSignedImageUrls/);
  assert.match(source, /buildFittingHistoryFromPersistedImages/);
  assert.match(source, /image\.feature_type !== 'model-matrix'/);
  assert.match(source, /metadata\.feature !== 'model-matrix'/);
  assert.match(source, /const remoteJobId = image\.job_id \?\? getGeneratedImageMetadataString/);
  assert.match(source, /materialReference\?\.imageUrl/);
  assert.match(source, /materialReference\?\.extractedImageUrl/);
  assert.match(source, /prompt: image\.prompt \?\? undefined/);
  assert.match(source, /bodyTypes: \[\]/);
  assert.match(source, /ageGroups: \[\]/);
  assert.match(source, /getGeneratedImageMetadataString\(image, 'bodyType'\)/);
  assert.match(source, /getGeneratedImageMetadataString\(image, 'ageGroup'\)/);
  assert.match(source, /setHistory\(buildFittingHistoryFromPersistedImages\(signedImages\)\)/);
  assert.doesNotMatch(source, /const seedHistory: HistoryItem\[\]/);
});

test('Fitting history hydration does not fabricate a record without persisted artifacts', async () => {
  const source = await readFile(new URL('../src/pages/FittingPage.tsx', import.meta.url), 'utf8');
  const historyBuilder = source.slice(
    source.indexOf('export const buildFittingHistoryFromPersistedImages'),
    source.indexOf('const bodyTypeOptions ='),
  );

  assert.match(historyBuilder, /const groups = new Map/);
  assert.match(historyBuilder, /return Array\.from\(groups\.values\(\)\)/);
  assert.doesNotMatch(historyBuilder, /fit-1042|fit-1038/);
});

test('Canvas resume uses only persisted material-reference URLs after reload', async () => {
  const source = await readFile(new URL('../src/pages/FittingPage.tsx', import.meta.url), 'utf8');
  assert.match(
    source,
    /const sourceMaterialImageUrl = item\.sourceMaterialImageUrl\s*\n\s*\?\? item\.materialReference\?\.imageUrl\s*\n\s*\?\? item\.materialReference\?\.extractedImageUrl/,
  );
  assert.match(source, /const prompt = item\.prompt \?\? lastRequest\?\.productDescription/);
  assert.match(source, /bodyTypes: item\.bodyTypes \?\? lastRequest\?\.bodyTypes \?\? \[\]/);
  assert.match(source, /ageGroups: item\.ageGroups \?\? lastRequest\?\.ageGroups \?\? \[\]/);
  assert.match(source, /modelReferenceImageUrl: request\.modelReferenceImageUrl \? '\[provided\]' : null/);
});

test('Fitting compacts large cutout data for durable Gallery and platform sources before local readback', async () => {
  const source = await readFile(new URL('../src/pages/FittingPage.tsx', import.meta.url), 'utf8');

  const reference = {
    hasImage: true,
    imageUrl: '/assets/printing/blank-white-tshirt.svg',
    fileName: 'platform.svg',
    materialKind: 'Tシャツ',
    maskMode: 'auto' as const,
    activeLayer: 'base',
    placement: '中央',
    scale: 100,
    note: 'cutout',
    extractedImageUrl: `data:image/png;base64,${'A'.repeat(120_000)}`,
    extractedLayerReady: true,
    nextStepReady: true,
  };

  const compacted = compactFittingMaterialReferenceForPersistence(
    reference,
    '/assets/printing/blank-white-tshirt.svg',
  );
  assert.equal(compacted?.extractedImageUrl, null);
  assert.equal(compacted?.extractedLayerReady, false);
  assert.equal(compacted?.nextStepReady, false);
  assert.match(compacted?.note ?? '', /localStorage容量保護/);
  const smallLocalReference = {
    ...reference,
    imageUrl: 'data:image/png;base64,local-source',
    extractedImageUrl: 'data:image/png;base64,small-cutout',
  };
  assert.equal(
    compactFittingMaterialReferenceForPersistence(smallLocalReference, smallLocalReference.imageUrl)?.extractedImageUrl,
    smallLocalReference.extractedImageUrl,
  );

  const localReference = {
    ...reference,
    imageUrl: `data:image/png;base64,${'B'.repeat(120_000)}`,
    extractedImageUrl: null,
  };
  const localCompacted = compactFittingMaterialReferenceForPersistence(localReference, localReference.imageUrl);
  assert.equal(localCompacted?.hasImage, false);
  assert.equal(localCompacted?.imageUrl, null);
  assert.equal(localCompacted?.extractedImageUrl, null);
  assert.match(localCompacted?.note ?? '', /再アップロードが必要/);
  assert.match(source, /compactFittingMaterialReferenceForPersistence/);
});

test('Fitting stores remote model-matrix results by canonical storage path, not large data URLs', async () => {
  const source = await readFile(new URL('../src/pages/FittingPage.tsx', import.meta.url), 'utf8');
  assert.match(
    source,
    /imageUrl: item\.storagePath \? '' : item\.imageUrl,/,
  );
  assert.match(source, /remoteStoragePath: item\.storagePath \?\? null/);
  assert.match(
    source,
    /Keep the provider data URL available in the active result matrix/,
  );
});

test('Fitting draft persistence clears signed URLs while retaining the canonical source path', () => {
  const prepared = prepareFittingDraftMaterialReferenceForPersistence({
    hasImage: true,
    imageUrl: 'https://signed.example.test/source.png?token=ephemeral',
    sourceStoragePath: 'user-a/brand-a/gallery-1.png',
    fileName: 'Gallery素材',
    materialKind: '衣服画像',
    maskMode: 'auto',
    activeLayer: '衣服',
    placement: 'モデル前面',
    scale: 72,
    note: 'draft',
    extractedLayerReady: false,
    extractedImageUrl: null,
    nextStepReady: false,
  }, 'https://signed.example.test/source.png?token=ephemeral');

  assert.equal(prepared?.imageUrl, null);
  assert.equal(prepared?.sourceStoragePath, 'user-a/brand-a/gallery-1.png');
});

test('Fitting draft persistence retains a bounded remote cutout for reload recovery', () => {
  const prepared = prepareFittingDraftMaterialReferenceForPersistence({
    hasImage: true,
    imageUrl: 'https://signed.example.test/source.png?token=ephemeral',
    sourceStoragePath: 'user-a/brand-a/gallery-1.png',
    fileName: 'Gallery素材',
    materialKind: '衣服画像',
    maskMode: 'auto',
    activeLayer: '衣服',
    placement: 'モデル前面',
    scale: 72,
    note: 'draft',
    extractedLayerReady: true,
    extractedImageUrl: `data:image/png;base64,${'A'.repeat(120_000)}`,
    cutoutMaxDataUrlBytes: 750_000,
    nextStepReady: true,
    maskEngine: 'browser-local-white-background-garment-cutout-v1',
  }, 'https://signed.example.test/source.png?token=ephemeral');

  assert.equal(prepared?.imageUrl, null);
  assert.equal(prepared?.extractedLayerReady, true);
  assert.equal(prepared?.nextStepReady, true);
  assert.match(prepared?.extractedImageUrl ?? '', /^data:image\/png/);
});
