import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const entry = readFileSync(new URL('../src/components/GenerateLightchainEntry.tsx', import.meta.url), 'utf8');

test('a 事例 opens Light-style: full screen, 戻る, download / share, right panel with 実現ステップ and 同じもの作成', () => {
  assert.match(entry, /data-testid="case-viewer"/);
  assert.match(entry, /className="fixed inset-0 z-50 flex bg-\[#0a0d0e\]/);
  for (const label of ['戻る', 'ダウンロード', '共有', 'コンテンツはAIによって生成されます', '実現ステップ', '同じもの作成']) {
    assert.ok(entry.includes(label), label);
  }
  // The share button copies a link that reopens the same case.
  assert.match(entry, /\?case=\$\{encodeURIComponent\(selectedCase\.id\)\}/);
  assert.match(entry, /const sharedCaseId = searchParams\.get\('case'\);/);
});
