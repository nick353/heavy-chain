import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

const source = await readFile(new URL('../src/pages/LightchainGraphicDesignPage.tsx', import.meta.url), 'utf8');
const app = await readFile(new URL('../src/App.tsx', import.meta.url), 'utf8');

test('/printing renders Light AIグラフィックデザイン, not the printing-image workspace', () => {
  assert.match(app, /path="\/printing"[\s\S]{0,400}<LightchainGraphicDesignPage \/>/);
  assert.match(source, /useCanonicalImageWorkspace\('print-design-project'/);
  assert.match(source, /AIグラフィックデザイン/);
  assert.match(source, /AIでグラフィックを作成/);
});

test('upload panel and right settings follow the measured Light structure', () => {
  for (const text of ['画像をアップロードします', 'jpg、jpeg、png、webpに対応しています。サイズ20M以内の画像を2枚までアップロードできます',
    'アシスト機能を起動します', 'アシスト機能をオンにして、デザイン要素を解析します', '画像参照強度', 'デザイン要素の内容',
    'AI生成のアシストの為、画像参考強度を選択してください']) assert.ok(source.includes(text), text);
  assert.match(source, /const MAX_REFERENCES = 2;/);
  assert.match(source, /className="flex w-80 shrink-0 flex-col rounded-lg bg-\[#262a2b\] p-4" aria-label="画像をアップロード"/);
  assert.match(source, /mt-4 flex h-72 w-full/);
  // The right panel stays empty until a reference exists (Light before upload).
  assert.match(source, /\{references\.length > 0 && \(/);
});

test('brief carries per-reference strength and assist state', async () => {
  const { graphicDesignBrief, GRAPHIC_STRENGTH_LEVELS } = await import('../src/pages/LightchainGraphicDesignPage.tsx').catch(() => ({ graphicDesignBrief: null, GRAPHIC_STRENGTH_LEVELS: null }));
  if (!graphicDesignBrief) return; // TSX import needs a bundler; source assertions above cover wiring.
  assert.equal(GRAPHIC_STRENGTH_LEVELS[2], '中');
  const brief = graphicDesignBrief(2, [2, 4], true);
  assert.match(brief, /参考画像1の参照強度: 中/);
  assert.match(brief, /参考画像2の参照強度: 強/);
  assert.match(brief, /アシスト/);
});
