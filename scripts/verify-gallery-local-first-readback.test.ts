import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

const galleryPage = await readFile(new URL('../src/pages/GalleryPage.tsx', import.meta.url), 'utf8');

test('Gallery renders persisted local results before remote image synchronization', () => {
  const localSnapshot = galleryPage.indexOf('const localFallbackImages = clearCanonicalRemoteImageUrls(localListImages);');
  const localCommit = galleryPage.indexOf('setImages(localFallbackImages);', localSnapshot);
  const remoteQuery = galleryPage.indexOf('const fetchRemoteImages = async () => {', localCommit);

  assert.ok(localSnapshot >= 0, 'local fallback snapshot must exist');
  assert.ok(localCommit > localSnapshot, 'local fallback must be committed after it is built');
  assert.ok(remoteQuery > localCommit, 'remote synchronization must remain after the local commit');
  assert.match(galleryPage, /setIsLoading\(false\);\s*\n\s*}\s*\n\s*const resolveLocalImages/);
  assert.match(galleryPage, /Do not start a second signing round after a remote failure/);
});

test('Gallery keeps a remote-only canonical selection until source resolution succeeds', () => {
  assert.match(galleryPage, /const \[hasResolvedImageSources, setHasResolvedImageSources\] = useState\(false\);/);
  assert.match(galleryPage, /setIsLoading\(true\);\s*setHasResolvedImageSources\(false\);/);
  assert.match(galleryPage, /setImages\(mergedImages\);\s*setHasResolvedImageSources\(true\);/);
  assert.match(galleryPage, /else if \(!isLoading && hasResolvedImageSources\)/);

  const remoteFailure = galleryPage.indexOf('} catch {', galleryPage.indexOf('const remoteRows'));
  const remoteSuccess = galleryPage.indexOf('setHasResolvedImageSources(true);');
  assert.ok(remoteFailure >= 0, 'remote failure path must remain explicit');
  assert.ok(remoteSuccess > remoteFailure, 'source resolution must be marked only after remote merge');
  assert.doesNotMatch(galleryPage.slice(remoteFailure, remoteSuccess), /setHasResolvedImageSources\(true\)/);
});
