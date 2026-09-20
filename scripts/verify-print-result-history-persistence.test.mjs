import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { test } from 'node:test';

const helperPath = new URL('../src/lib/printResultHistoryPersistence.ts', import.meta.url);
const pagePath = new URL('../src/pages/LightchainMaterialWorkbenchPage.tsx', import.meta.url);
const [helper, page] = await Promise.all([
  readFile(helperPath, 'utf8'),
  readFile(pagePath, 'utf8'),
]);

test('Printing history stores image bytes in IndexedDB and only safe metadata in localStorage', () => {
  assert.match(helper, /heavy-chain-print-result-assets/);
  assert.match(helper, /createObjectStore\(STORE_NAME/);
  assert.match(helper, /heavy-chain-print-result-history:v2/);
  assert.match(helper, /local-print-result:\/\//);
  assert.match(helper, /URL\.createObjectURL\(blob\)/);
  assert.match(helper, /URL\.revokeObjectURL\(result\.imageUrl\)/);
  assert.match(helper, /await putAssets\(assets\)/);
  assert.match(helper, /await deleteAssets\(staleKeys\)/);
  assert.match(helper, /generationMode\?: 'provider' \| 'preview'/);
  assert.match(helper, /inputLineage\?: PersistedPrintInputLineage\[\]/);
  assert.match(helper, /const \{ imageUrl: _imageUrl, assetRef: _assetRef, \.\.\.safeResult \} = result/);
  assert.match(helper, /window\.localStorage\.setItem\(storageKey\(brandId, scope\), serialized\)/);
  assert.doesNotMatch(helper, /localStorage\.setItem\([^\n]*imageUrl/);
});

test('Printing page hydrates restored results, keeps brand boundaries, and releases blob URLs', () => {
  assert.match(page, /restorePrintResultHistory\(brandId, \{ \.\.\.printHistoryScope, assertCurrent \}\)/);
  assert.match(helper, /result\.brandId === brandId/);
  assert.match(page, /releaseRestoredPrintResult/);
  assert.match(page, /URL\.revokeObjectURL\(url\)/);
  assert.match(page, /printHistoryHydratedScopeRef\.current = scopeKey/);
  assert.match(page, /persistPrintResultHistory\(brandId, results, \{ \.\.\.printHistoryScope, assertCurrent \}\)/);
  assert.match(page, /printHistoryVisibleScope === printHistoryCurrentScopeKey/);
  assert.match(page, /const history = mergePrintResultHistory\(\[persistedResult\], generatedResultsRef\.current/);
  assert.match(page, /let changed = false/);
  assert.match(page, /return changed \? next : current/);
});

test('Printing result cards expose stable download hooks for E2E readback', () => {
  assert.match(page, /data-testid=\{`print-result-download-\$\{result\.id\}`\}/);
  assert.match(page, /data-testid="selected-print-result-download"/);
  assert.match(page, /data-testid="compare-print-results"/);
});

test('local printing previews keep a shared job and remain separate from provider artifacts', () => {
  assert.match(page, /PRINT_LOCAL_RESULT_FEATURE_TYPE = 'lightchain-printing-image-local-result'/);
  assert.match(page, /backendProvider: 'browser-local-print-composition-v1'/);
  assert.match(page, /sourceJobId: runId/);
  assert.match(page, /saveWorkspaceArtifactPersisted\(/);
  assert.match(page, /deleteWorkspaceArtifactsPersisted\(\s*generationBrand\.id/);
  assert.match(page, /sourceLocalPreviewArtifactId: result\.artifactId \?\? null/);
});
