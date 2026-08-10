import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { test } from 'node:test';

const helperPath = new URL('../src/lib/printInputPersistence.ts', import.meta.url);
const pagePath = new URL('../src/pages/LightchainMaterialWorkbenchPage.tsx', import.meta.url);
const [helper, page] = await Promise.all([
  readFile(helperPath, 'utf8'),
  readFile(pagePath, 'utf8'),
]);

test('Printing inputs keep image bytes in IndexedDB and only safe metadata in localStorage', () => {
  assert.match(helper, /heavy-chain-print-input-assets/);
  assert.match(helper, /local-print-input:\/\//);
  assert.match(helper, /indexedDB\.open\(DB_NAME, DB_VERSION\)/);
  assert.match(helper, /await putAssets/);
  assert.match(helper, /await deleteAssets/);
  assert.match(helper, /window\.localStorage\.setItem\(storageKey\(brandId\), JSON\.stringify\(metadata\)\)/);
  assert.doesNotMatch(helper, /localStorage\.setItem\([^\n]*image\.url/);
  assert.match(helper, /isLocalImageSource/);
  assert.match(helper, /URL\.createObjectURL\(blob\)/);
});

test('Printing page hydrates inputs before saving state and releases restored object URLs', () => {
  assert.match(page, /restorePrintInputState\(brandId\)/);
  assert.match(page, /persistPrintInputState\(brandId, printGarment, printDesigns\)/);
  assert.match(page, /printInputHydratedBrandRef\.current = brandId/);
  assert.match(page, /releaseRestoredPrintInput/);
  assert.match(page, /printInputHydrationGenerationRef/);
});
