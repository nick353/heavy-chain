import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const page = readFileSync(new URL('../src/features/designDetail/DesignEntryDetailPage.tsx', import.meta.url), 'utf8');
const hook = readFileSync(new URL('../src/features/designDetail/useDialogueReferences.ts', import.meta.url), 'utf8');

test('a new file turns its first uploaded image into the project, placed on the canvas (Light, measured 2026-10-29)', () => {
  assert.match(page, /if \(isNewFile && images\.length === 1\) \{ newFileUpload\.current = true;/);
  assert.match(page, /openImageProject\(\{ scope: \{ userId, brandId \}, imageId, assertContext, client, measure: designCanvasClient\.measureImage \}\)/);
  assert.match(page, /references\.clear\(\); navigate\(`\$\{workspace\.detailPath\}\?\$\{new URLSearchParams\(\{ projectId: document\.id \}\)\}`/);
});

test('a new file starts without images left by an earlier unfinished new file', () => {
  assert.match(page, /startEmpty: isNewFile/);
  assert.match(hook, /if \(startEmpty\) for \(const reference of activated\) leftovers\.add\(reference\.id\);/);
  assert.match(hook, /dropLeftovers\(\);\n\s+void controller\.restore\(\)/);
});
