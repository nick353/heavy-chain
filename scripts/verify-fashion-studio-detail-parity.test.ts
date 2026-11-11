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
        'testId="fashion-studio-saved-result-image"',
        'data-testid="fashion-studio-flow"',
  ]) assert.ok(source.includes(marker), `missing parity marker: ${marker}`);
  assert.match(styleSource, /\.fashion-studio-source-dots[\s\S]*radial-gradient/);
});

// Light (2026-11-11): main → form → result in one row; the reference/model image sits inside the form, not on the canvas.
test('the project canvas is Light\'s main → form → result row with the reference inside the form', () => {
  assert.match(styleSource, /\.fashion-studio-flow \{[\s\S]*?display: flex;[\s\S]*?align-items: flex-start;/);
  assert.match(styleSource, /\.fashion-studio-source-main-node,\n\.fashion-studio-source-result-node \{\n  width: 448px;/);
  assert.match(styleSource, /\.fashion-studio-source-generation-panel \{[\s\S]*?width: 310px;/);
  assert.match(styleSource, /\.fashion-studio-source-generation-inner \{[\s\S]*?zoom: 0\.443;/);
  assert.doesNotMatch(source, /fashion-studio-source-reference-node/);
  assert.match(source, /aria-label=\{`\$\{referenceLabel\}を追加`\}/);
  assert.match(source, /<FlowEdge width=\{FLOW_GAP_IN\}/);
});

test('choosing a function on the empty canvas loads Light\'s example for it', () => {
  for (const marker of ['loadExample(item.id)', 'StudioFunctionIcon fn={item.id}', 'サンプルを読み込み中…', '仕上がりのサンプルをご覧ください。',
    'STUDIO_EXAMPLE_LOADED', 'testId="fashion-studio-example-result-image"']) assert.ok(source.includes(marker), `missing example marker: ${marker}`);
  assert.match(source, /'サンプルを読み込むと、ノードの構成を変更できます。'/);
});

test('each function shows Light\'s own fields', () => {
  for (const marker of ['メイン画像1枚につき', 'インナーフィッティング専用ツール', '指定した領域を3D画像に変換する', '指令と参考画像を使ってワンクリック生成',
    '衣服の画像', 'モデル図', 'フィッティングの説明', 'エリアを選択', '生成対象', 'マスク調整', '融合ポイントを追加', 'aria-label="比率"', 'aria-label="画質"']) {
    assert.ok(source.includes(marker), `missing function field: ${marker}`);
  }
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

// 2026-11-11 production check against Light: four example buttons on one row, Light's TryOnModel icon for 下着,
// the project stays "Untitled" after generating, the fitted flow clears the canvas toolbar, and failures read as text.
test('empty studio keeps Light\'s one-row buttons and real icons; generation keeps the Untitled name', () => {
  assert.match(source, /flex w-max max-w-\[calc\(100%-32px\)\] -translate-x-1\/2 -translate-y-1\/2 flex-col/);
  assert.doesNotMatch(source, /w-\[784px\]/);
  const icons = readFileSync(new URL('../src/components/lightchain/StudioFunctionIcon.tsx', import.meta.url), 'utf8');
  assert.doesNotMatch(icons, /d: 'Union'/);
  assert.match(icons, /'underwear': \[\n    \{ d: 'M6\.0805 19\.9629/);
  const generation = readFileSync(new URL('../src/lib/fashionStudioDetailGeneration.ts', import.meta.url), 'utf8');
  assert.match(generation, /documentId: document\.id, title: document\.title,/);
  assert.doesNotMatch(generation, /namedProjectTitle/);
  assert.match(source, /const top = 40, bottom = 104;/);
  assert.match(source, /toast\.error\(studioErrorMessage\(activityError\)/);
  assert.match(source, /legal_safety_prompt_blocked\/\.test\(error\)\) return '指示テキストに、人物の顔/);
  assert.match(styleSource, /\.fashion-studio-source-task \{[\s\S]*?white-space: nowrap;/);
});
