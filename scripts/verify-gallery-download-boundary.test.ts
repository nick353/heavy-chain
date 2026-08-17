import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

test('Gallery downloads use the shared image validation boundary', async () => {
  const source = await readFile(new URL('../src/pages/GalleryPage.tsx', import.meta.url), 'utf8');
  assert.match(source, /from ['"]\.\.\/lib\/imageDownload['"]/);
  assert.match(source, /downloadValidatedImage\(/);
  assert.match(source, /format,\n\s*\);/);
  assert.match(source, /image\.brand_id !== currentBrand\.id/);
  assert.match(source, /gallery_image_identity_unavailable/);
  assert.match(source, /getGeneratedImageSelectionKey\(candidate\) === currentIdentity/);
  assert.doesNotMatch(source, /const response = await fetch\(imageUrl\)/);
});

test('Gallery selection keeps a stable item id in the URL', async () => {
  const source = await readFile(new URL('../src/pages/GalleryPage.tsx', import.meta.url), 'utf8');
  assert.match(source, /const selectImage = useCallback\(\(image: GeneratedImage \| null\)/);
  assert.match(source, /getGeneratedImageSelectionKey\(image\)/);
  assert.match(source, /: selectImage\(image\)/);
  assert.match(source, /getGeneratedImageSelectionKey\(candidate\) === imageId/);
});
