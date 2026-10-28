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
