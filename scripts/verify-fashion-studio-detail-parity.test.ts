import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const source = readFileSync(new URL('../src/pages/FashionStudioDetailPage.tsx', import.meta.url), 'utf8');
const overviewSource = readFileSync(new URL('../src/pages/FashionStudioPage.tsx', import.meta.url), 'utf8');

test('fashion studio saved-project detail keeps the Light canvas shell landmarks', () => {
  for (const marker of [
    'data-testid="lightchain-fashion-studio-project-detail"',
    'data-testid="lightchain-fashion-studio-canvas"',
        'data-testid="lightchain-fashion-studio-generation-panel"',
        'data-testid="lightchain-fashion-studio-canvas-toolbar"',
        'data-testid="lightchain-fashion-studio-zoom-controls"',
        'cloudflareDataPlane.getCanvasDocument',
        'resolveGeneratedImageUrlWithStatus',
        'data-testid="fashion-studio-saved-main-image"',
        'data-testid="fashion-studio-saved-reference-image"',
        'data-testid="fashion-studio-saved-result-image"',
        'radial-gradient',
  ]) assert.ok(source.includes(marker), `missing parity marker: ${marker}`);
});

test('AI generation remains an explicit safe boundary in the detail shell', () => {
  assert.match(source, /入力内容を保持しました。次の生成条件を確認できます。/);
  assert.doesNotMatch(source, /権利確認後/);
  assert.doesNotMatch(source, /fetch\(|axios\.|supabase\.|generateImage|provider/i);
});

test('saved Fashion Studio cards expose the Light menu landmarks', () => {
  for (const marker of ['ピン留め', 'アセットライブラリに保存', '削除', 'aria-expanded={openProjectMenuId === project.id}']) {
    assert.ok(overviewSource.includes(marker), `missing Fashion Studio overview marker: ${marker}`);
  }
});
