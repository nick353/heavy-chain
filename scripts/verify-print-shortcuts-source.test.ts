import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

const read = (path: string) => readFile(new URL(path, import.meta.url), 'utf8');

test('printing workbench keeps gallery/upload and shares garment reset logic with bundled blank garment', async () => {
  const source = await read('../src/pages/LightchainMaterialWorkbenchPage.tsx');
  assert.match(source, /data-testid="use-trusted-blank-garment"/);
  assert.match(source, /無地Tシャツを使う（推奨）/);
  assert.match(source, /onChange=\{selectPrintGarment\}/);
  assert.match(source, /selectPrintGarment\(createTrustedBlankGarmentSelection\(\)\)/);
  assert.match(source, /galleryTitle="素材を選択"/);
});

test('the printing page consumes a guarded print handoff once', async () => {
  const printSource = await read('../src/pages/LightchainMaterialWorkbenchPage.tsx');
  assert.match(printSource, /readPrintDesignHandoff\(window\.sessionStorage, currentBrand\.id\)/);
  assert.match(printSource, /!isAuthInitialized[\s\S]*?isAuthLoading[\s\S]*?!currentBrand\?\.id/);
  assert.match(printSource, /acknowledgePrintDesignHandoff\([\s\S]*?'import_committed'/);
  assert.match(printSource, /referenceType: 'pattern'/);
  assert.match(printSource, /void addDesigns\(\[\.\.\.printDesigns, importedDesign\]\)/);
});

test('bundled blank garment is a visible, decoration-free product-owned asset', async () => {
  const source = await read('../public/assets/printing/blank-white-tshirt.svg');
  assert.match(source, /無地の白いTシャツ/);
  assert.match(source, /装飾のない白いTシャツ/);
  assert.doesNotMatch(source, /<image\b/);
});
