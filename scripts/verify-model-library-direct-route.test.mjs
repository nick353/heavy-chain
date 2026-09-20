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
});
