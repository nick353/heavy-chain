import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import test from 'node:test';

const root = new URL('..', import.meta.url);
const read = (relativePath: string) => fs.readFile(new URL(relativePath, root), 'utf8');

const listReaders = [
  'src/pages/LightchainLibraryPage.tsx',
  'src/pages/LightchainWorkbenchPage.tsx',
  'src/pages/GalleryPage.tsx',
  'src/pages/FittingPage.tsx',
  'src/pages/DashboardPage.tsx',
  'src/lib/workspaceActivity.ts',
];
const gallerySelectorReader = 'src/components/GallerySelector.tsx';

test('generated image list readers use the bounded projection', async () => {
  const sources = await Promise.all(listReaders.map(read));
  for (const source of sources) {
    // Heavy now routes all list/history reads through the Cloudflare data
    // plane. The bounded row shape is applied at the reader boundary by
    // asGeneratedImageListRow/toGeneratedImageListRow; these pages must not
    // reintroduce direct legacy-table reads.
    assert.match(source, /listGeneratedImages\(/);
    assert.doesNotMatch(source, /from\(['"]generated_images['"]\)/);
  }
});

test('GallerySelector uses its purpose-built bounded projection', async () => {
  const source = await read(gallerySelectorReader);
  assert.match(source, /listGeneratedImages\(/);
  assert.doesNotMatch(source, /from\(['"]generated_images['"]\)/);
  assert.match(source, /negative_prompt/);
  assert.match(source, /generation_params/);
});

test('Admin image counts do not request generated-image rows', async () => {
  const source = await read('cloudflare/heavy-api/src/feedback-admin.ts');
  assert.match(source, /SELECT count\(\*\) FROM generated_images/);
  assert.doesNotMatch(source, /SELECT \* FROM generated_images/);
});

test('bounded projection contains all fields needed by list/history readers', async () => {
  const source = await read('src/lib/generatedImageQuery.ts');
  const listProjectionSource = source.slice(
    source.indexOf('export type GeneratedImageListRow'),
    source.indexOf('export type GeneratedImageGallerySelectorRow'),
  );
  for (const column of [
    'id', 'job_id', 'brand_id', 'user_id', 'storage_path', 'image_url',
    'is_favorite', 'created_at', 'prompt', 'feature_type', 'style_preset',
    'model_used', 'metadata',
  ]) {
    assert.match(listProjectionSource, new RegExp(`'${column}'`));
  }
  for (const excludedColumn of ['negative_prompt', 'generation_params', 'thumbnail_path', 'version', 'parent_image_id', 'expires_at']) {
    assert.doesNotMatch(listProjectionSource, new RegExp(`'${excludedColumn}'`));
  }
});

test('GallerySelector projection retains its search and selection fields', async () => {
  const source = await read('src/lib/generatedImageQuery.ts');
  for (const column of ['negative_prompt', 'generation_params', 'feature_type', 'metadata', 'storage_path', 'image_url']) {
    assert.match(source, new RegExp(`GENERATED_IMAGE_GALLERY_SELECTOR_COLUMNS[\\s\\S]{0,260}${column}`));
  }
});
