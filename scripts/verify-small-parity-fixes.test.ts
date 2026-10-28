import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const read = (path: string) => readFileSync(new URL(`../${path}`, import.meta.url), 'utf8');

test('design cards rename in place like Light (click the title, Enter or click away saves the library title)', () => {
  const page = read('src/pages/LightchainParityPages.tsx');
  assert.match(page, /data-testid="design-card-rename-input"/);
  assert.match(page, /updateGeneratedImageLibraryTitle\(remoteImageId, title, context\)/);
  assert.match(page, /metadata\.libraryTitle, metadata\.title/);
  // The title sits in a div (not a button) so a text field can replace it.
  assert.match(page, /role="button"\n        tabIndex=\{href \? 0 : -1\}/);
});

test('the design list signs only what it needs before showing the grid', () => {
  const page = read('src/pages/LightchainParityPages.tsx');
  assert.match(page, /\.filter\(\(row\) => designHistoryFeatureTypes\.has\(row\.feature_type \?\? 'generate-image'\)\)/);
  assert.match(page, /withSignedImageUrls\(rows\.slice\(0, DESIGN_REFERENCE_SIGN_LIMIT\)\)/);
});

test('marketing home matches Light\'s re-measured title and chips', () => {
  const page = read('src/pages/LightchainParityPages.tsx');
  assert.match(page, /pt-\[89px\]/);
  assert.match(page, /text-\[36px\] font-medium leading-10">マーケティングワークスペースへようこそ/);
  assert.match(page, /text-sm font-medium leading-5 text-white">\{sceneCard\.label\}/);
});

test('library groups nest inside a 汎用 group like Light', () => {
  const library = read('src/pages/LightchainLibraryPage.tsx');
  assert.match(library, /parentId: row\.parent_folder_id \?\? null/);
  assert.match(library, /createFolder\(\{ id, brand_id: brandId, name, parent_folder_id: newGroupParent \}\)/);
  assert.match(library, /data-testid="library-new-child-group"/);
  assert.match(library, /data-testid="library-child-group"/);
  assert.match(library, /renderChildGroups\(group\.id, 1\)/);
});

test('marketing project cards match Light: checkbox, bulk delete, rename in place, ··· menu', () => {
  const page = read('src/pages/LightchainParityPages.tsx');
  assert.match(page, /data-testid="marketing-project-select"/);
  assert.match(page, /data-testid="marketing-project-selection-bar"/);
  assert.match(page, /data-testid="marketing-card-rename-input"/);
  assert.match(page, /onClick=\{\(\) => void saveProjectToLibrary\(entry\)\}><Bookmark className="h-4 w-4" \/>アセットライブラリに保存/);
  assert.match(page, /<h2 className="mb-4 text-lg font-normal leading-7">マイプロジェクト<\/h2>/);
});

test('fashion studio list and detail match Light\'s layout', () => {
  const css = read('src/index.css');
  assert.match(css, /div:first-child h1 \{ height: 25px; margin: 0; color: #fff; font-size: 16px; font-weight: 500; line-height: 25px; \}/);
  assert.match(css, /section > div:nth-child\(2\) \{ display: flex; width: 100%; flex-wrap: wrap; gap: 8px; margin-top: 16px; \}/);
  assert.match(css, /\.fashion-studio-source-task \{\n  bottom: 40px;\n  left: 16px;/);
  const detail = read('src/pages/FashionStudioDetailPage.tsx');
  assert.match(detail, /aria-label="キャンバスを整理"/);
  assert.match(detail, /data-testid="fashion-studio-reference-count"/);
  assert.match(detail, />生成設定</);
});
