import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

const source = await readFile(new URL('../src/pages/CanvasEditorPage.tsx', import.meta.url), 'utf8');

test('Canvas exposes the current brand and uses the Heavy entitlement preflight', () => {
  assert.match(source, /data-testid="canvas-current-brand"/);
  assert.match(source, /現在のブランド:/);
  assert.match(source, /currentBrand\?\.name\?\.trim\(\) \|\| '未選択'/);
  assert.match(source, /const heavyGenerationReady = heavyEntitlement\?\.allowed === true[\s\S]*?requestScopedAttestationRequired === false/);
  assert.match(source, /const rightsConfirmed = heavyGenerationReady;/);
  assert.match(source, /legalSafety:\s*\{\s*rightsConfirmed\s*\}/);
  assert.doesNotMatch(source, /type=["']checkbox["']/);
  assert.doesNotMatch(source, /checked=\{true\}/);
});
