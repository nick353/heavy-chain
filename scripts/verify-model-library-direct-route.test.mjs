import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

test('model library follows the current Light canonical route and rejects the stale plural alias', async () => {
  const [app, catalog] = await Promise.all([
    readFile(new URL('../src/App.tsx', import.meta.url), 'utf8'),
    readFile(new URL('../src/lib/lightchainUnifiedFeatureCatalog.ts', import.meta.url), 'utf8'),
  ]);

  assert.match(app, /path="\/model-library"/);
  assert.match(app, /path="\/models"[\s\S]*?LightchainSourceNotFoundPage/);
  assert.match(app, /path="\/credits"[\s\S]*?LightchainSourceNotFoundPage/);
  assert.match(catalog, /'model-library': \['\/model-library\/model-custom-form', '\/model-library'\]/);
  assert.doesNotMatch(catalog, /'model-library':[^\n]*'\/models'/);
  assert.match(app, /path="\/model-library\/model-custom-form"[\s\S]*?ModelLibraryPage/);
});

test('launcher routes model planning through the canonical Light entrypoint', async () => {
  const workbench = await readFile(new URL('../src/pages/LightchainWorkbenchPage.tsx', import.meta.url), 'utf8');
  const generate = await readFile(new URL('../src/pages/GeneratePage.tsx', import.meta.url), 'utf8');
  const modelLibraryEntry = workbench.match(/\n  \{\n[\s\S]*?id: 'model-library',[\s\S]*?\n  \},/u)?.[0] ?? '';
  assert.match(modelLibraryEntry, /heavyChainHref: '\/model-library\/model-custom-form'/);
  assert.match(generate, /title: 'AIフィッティング', to: '\/model'/);
  assert.match(generate, /title: 'モデル企画ライブラリ', to: '\/model-library\/model-custom-form'/);
  assert.doesNotMatch(modelLibraryEntry, /heavyChainHref: '\/generate\?feature=model-matrix'/);
});
