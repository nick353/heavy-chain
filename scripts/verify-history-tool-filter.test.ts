import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { isHistoryRowFor } from '../src/lib/lightchainHistoryEntries.ts';

test('生成履歴 lists only the open tool, like Light (/printing shows none of /tools/printing)', () => {
  assert.equal(isHistoryRowFor('lightchain-printing-image-provider-result', ['printing-image']), true);
  assert.equal(isHistoryRowFor('lightchain-printing-image', ['printing-image']), true);
  assert.equal(isHistoryRowFor('lightchain-printing-image-provider-result', ['print-design-project']), false);
  assert.equal(isHistoryRowFor('lightchain-fabric-image-provider-result'), true);
});

test('uploaded inputs never appear in 生成履歴', () => {
  for (const type of ['lightchain-library-upload', 'library-upload', 'lightchain-platform-asset', 'local-upload']) {
    assert.equal(isHistoryRowFor(type), false, type);
    assert.equal(isHistoryRowFor(type, ['printing-image']), false, type);
  }
});

test('every tool screen tells the panel which tool it is', () => {
  const read = (path: string) => readFileSync(new URL(`../src/${path}`, import.meta.url), 'utf8');
  assert.match(read('components/lightchain/LightchainDesignToolFrame.tsx'), /toolIds=\{historyToolIds\}/);
  assert.match(read('pages/LightchainGraphicDesignPage.tsx'), /toolIds=\{\['print-design-project'\]\}/);
  assert.match(read('pages/LightchainParityPages.tsx'), /historyToolIds=\{PRINTING_HISTORY_TOOLS\}/);
  assert.match(read('pages/LightchainLineToolsPage.tsx'), /historyToolIds=\{\[mode\]\}/);
  assert.match(read('pages/LightchainImageRepairPage.tsx'), /historyToolIds=\{\['image-repair'\]\}/);
});
