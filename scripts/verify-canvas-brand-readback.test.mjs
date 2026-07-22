import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

const source = await readFile(new URL('../src/pages/CanvasEditorPage.tsx', import.meta.url), 'utf8');

test('Canvas exposes the current brand without auto-confirming rights', () => {
  assert.match(source, /data-testid="canvas-current-brand"/);
  assert.match(source, /現在のブランド:/);
  assert.match(source, /currentBrand\?\.name\?\.trim\(\) \|\| '未選択'/);
  assert.match(source, /checked=\{rightsConfirmed\}/);
  assert.doesNotMatch(source, /checked=\{true\}/);
});
