import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const source = readFileSync(new URL('../src/pages/FashionStudioDetailPage.tsx', import.meta.url), 'utf8');
const overviewSource = readFileSync(new URL('../src/pages/FashionStudioPage.tsx', import.meta.url), 'utf8');
const styleSource = readFileSync(new URL('../src/index.css', import.meta.url), 'utf8');

test('fashion studio saved-project detail keeps the Light canvas shell landmarks', () => {
  for (const marker of [
    'data-testid="lightchain-fashion-studio-project-detail"',
    'data-testid="lightchain-fashion-studio-canvas"',
        'data-testid="lightchain-fashion-studio-generation-panel"',
        'data-testid="lightchain-fashion-studio-canvas-toolbar"',
        'data-testid="lightchain-fashion-studio-zoom-controls"',
        'cloudflareDataPlane.getCanvasDocument',
        'resolveGeneratedImageUrlWithStatus',
        'testId="fashion-studio-saved-main-image"',
        'testId="fashion-studio-saved-reference-image"',
        'testId="fashion-studio-saved-result-image"',
  ]) assert.ok(source.includes(marker), `missing parity marker: ${marker}`);
  assert.match(styleSource, /\.fashion-studio-source-dots[\s\S]*radial-gradient/);
});

test('AI generation requires a loaded committed main image and scoped controller', () => {
  assert.match(source, /loadedMain.identity !== mainIdentity/);
  assert.match(source, /createFashionStudioDetailGeneration\(createFashionStudioGenerationAdapters/);
  assert.match(source, /detail.roles.main.status !== 'available'/);
  assert.doesNotMatch(source, /入力内容を保持しました。次の生成条件を確認できます。/);
  assert.doesNotMatch(source, /権利確認後/);
  assert.doesNotMatch(source, /fetch\(|axios\.|supabase\.|useCanvasStore/);
});

test('saved Fashion Studio cards expose the Light menu landmarks', () => {
  for (const marker of ['ピン留め', 'アセットライブラリに保存', '削除', 'aria-expanded={openProjectMenuId === project.id}']) {
    assert.ok(overviewSource.includes(marker), `missing Fashion Studio overview marker: ${marker}`);
  }
});
