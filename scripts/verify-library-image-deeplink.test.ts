import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { LIBRARY_HISTORY_HREF, libraryImageHref } from '../src/lib/lightchainLibraryHandoff.ts';

test('builds a library link that opens one result in 生成履歴', () => {
  const href = libraryImageHref('ai-7c7bdab3/x');
  assert.ok(href.startsWith(`${LIBRARY_HISTORY_HREF}&`));
  const params = new URL(href, 'https://heavy.test').searchParams;
  assert.equal(params.get('group'), '生成履歴');
  assert.equal(params.get('image'), 'ai-7c7bdab3/x');
});

test('the library selects the linked card once it has loaded, by artifact id or generated image id', () => {
  const page = readFileSync(new URL('../src/pages/LightchainLibraryPage.tsx', import.meta.url), 'utf8');
  assert.match(page, /new URLSearchParams\(window\.location\.search\)\.get\('image'\)/);
  assert.match(page, /item\.asset\.id === wanted \|\| item\.asset\.remoteImageId === wanted/);
  assert.match(page, /item\.artifact\.id === wanted \|\| item\.artifact\.metadata\.remoteImageId === wanted/);
  assert.match(page, /deepLinkImageRef\.current = null;\s*setSelectedAssetId/);
});

test('old /gallery?image= links keep the image id through the redirect', () => {
  const app = readFileSync(new URL('../src/App.tsx', import.meta.url), 'utf8');
  assert.match(app, /<Route path="\/gallery" element=\{<GalleryRedirect \/>\} \/>/);
  assert.match(app, /image \? libraryImageHref\(image\) : LIBRARY_HISTORY_HREF/);
});
