import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';
import { compactFittingMaterialReferenceForPersistence } from '../src/lib/fittingPersistence.ts';
import { prepareFittingDraftMaterialReferenceForPersistence } from '../src/lib/fittingPersistence.ts';

test('new Cloudflare result metadata cannot default to the retired execution backend', async () => {
  for (const page of ['LightchainWorkbenchPage', 'LightchainMaterialWorkbenchPage']) {
    const source = await readFile(new URL(`../src/pages/${page}.tsx`, import.meta.url), 'utf8');
    assert.doesNotMatch(source, /supabase-edge-function/);
    assert.match(source, /backendProvider: (?:response|providerResult)\.backendProvider \?\? 'cloudflare-workers-ai'/);
  }
  const workbench = await readFile(new URL('../src/pages/LightchainWorkbenchPage.tsx', import.meta.url), 'utf8');
  assert.match(workbench, /backendProvider = modelResult\.backendProvider \?\? backendProvider/);
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

test('high-precision Fitting cutout awaits durable local save before the change resolves', async () => {
  const materialWorkbench = await readFile(new URL('../src/components/workspace/MaterialWorkbench.tsx', import.meta.url), 'utf8');

  assert.match(materialWorkbench, /onChange: \(nextState: MaterialReferenceState\) => void \| Promise<void>/);
  assert.match(materialWorkbench, /await updateStateAsync\(\{/);
});

test('Lightchain fitting entry persists the selected Gallery source before navigation', async () => {
  const source = await readFile(new URL('../src/pages/LightchainWorkbenchPage.tsx', import.meta.url), 'utf8');

  assert.match(source, /sourceStoragePath: item\.sourceStoragePath \?\? null/);
  assert.match(source, /sourceImageId: item\.sourceImageId \?\? null/);
  assert.match(source, /prepareFittingDraftMaterialReferenceForPersistence/);
  assert.match(source, /featureType: 'fitting-background-draft'/);
  assert.match(source, /onClick=\{isFittingDetail \? handleFittingActionClick : undefined\}/);
  assert.match(source, /Fitting入力の保存確認に失敗しました/);
  assert.match(source, /getErrorMessage\(persisted\.error\)/);
});
