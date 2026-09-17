import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const source = readFileSync(new URL('../src/pages/FashionStudioDetailPage.tsx', import.meta.url), 'utf8');

test('fashion studio saved-project detail keeps the Light canvas shell landmarks', () => {
  for (const marker of [
    'data-testid="lightchain-fashion-studio-project-detail"',
    'data-testid="lightchain-fashion-studio-canvas"',
    'data-testid="lightchain-fashion-studio-generation-panel"',
    'data-testid="lightchain-fashion-studio-canvas-toolbar"',
    'data-testid="lightchain-fashion-studio-zoom-controls"',
    'radial-gradient',
  ]) assert.ok(source.includes(marker), `missing parity marker: ${marker}`);
});

test('AI generation remains an explicit safe boundary in the detail shell', () => {
  assert.match(source, /入力内容を保持しました。外部生成は権利確認後に実行できます。/);
  assert.doesNotMatch(source, /fetch\(|axios\.|supabase\.|generateImage|provider/i);
});
