import assert from 'node:assert/strict';
import test from 'node:test';
import { readFile } from 'node:fs/promises';
import {
  classifyGeneratedImageReference,
  clearCanonicalRemoteImageUrls,
  extractGeneratedImageStoragePath,
  hasGeneratedImageSignedRoute,
  normalizeGeneratedImageStoragePath,
  resolveGeneratedImageStoragePath,
} from '../src/lib/storagePathSafety.ts';

const read = (path) => readFile(new URL(`../${path}`, import.meta.url), 'utf8');

test('raw signed-route captures reject dot traversal before URL normalization', () => {
  const traversal = 'https://example.test/storage/v1/object/sign/generated-images/tenant/../other.png?token=stale';
  const encodedTraversal = 'https://example.test/storage/v1/object/sign/generated-images/tenant/%2e%2e/other.png?token=stale';
  assert.equal(extractGeneratedImageStoragePath(traversal), null);
  assert.equal(extractGeneratedImageStoragePath(encodedTraversal), null);
  assert.deepEqual(resolveGeneratedImageStoragePath('tenant/../other.png'), { ok: false, code: 'path_traversal' });
  assert.deepEqual(resolveGeneratedImageStoragePath('tenant/%2e%2e/other.png'), { ok: false, code: 'path_traversal' });
  assert.equal(extractGeneratedImageStoragePath('https://example.test/storage/v1/object/sign/generated-images/tenant/other.png?token=ok'), 'tenant/other.png');
});

test('signed route without a captured canonical path is never accepted', () => {
  const queryOnly = 'https://example.test/storage/v1/object/sign/generated-images?token=stale';
  const trailingSlash = 'https://example.test/storage/v1/object/sign/generated-images/?token=stale';
  assert.equal(hasGeneratedImageSignedRoute(queryOnly), true);
  assert.equal(hasGeneratedImageSignedRoute(trailingSlash), true);
  assert.equal(extractGeneratedImageStoragePath(queryOnly), null);
  assert.equal(extractGeneratedImageStoragePath(trailingSlash), null);
  assert.deepEqual(classifyGeneratedImageReference(queryOnly), { kind: 'signed', canonicalPath: null });
});

test('signed-route detection is limited to the raw pathname', () => {
  const queryPayload = 'https://example.test/view?next=/storage/v1/object/sign/generated-images/tenant/image.png';
  const fragmentPayload = 'https://example.test/view#next=/storage/v1/object/sign/generated-images/tenant/image.png';
  assert.equal(hasGeneratedImageSignedRoute(queryPayload), false);
  assert.equal(hasGeneratedImageSignedRoute(fragmentPayload), false);
  assert.equal(extractGeneratedImageStoragePath(queryPayload), null);
  assert.equal(extractGeneratedImageStoragePath(fragmentPayload), null);
});

test('opaque data/blob payloads cannot become signed storage paths', () => {
  const routePayload = '/storage/v1/object/sign/generated-images/tenant/image.png?token=stale';
  for (const payload of [`data:text/plain,${routePayload}`, `blob:https://example.test/${routePayload}`]) {
    assert.equal(hasGeneratedImageSignedRoute(payload), false);
    assert.equal(extractGeneratedImageStoragePath(payload), null);
    assert.deepEqual(classifyGeneratedImageReference(payload), {
      kind: payload.startsWith('data:') ? 'data' : 'blob',
      canonicalPath: null,
    });
  }
});

test('generated image storage paths reject alternate buckets and malformed encoding', () => {
  assert.equal(normalizeGeneratedImageStoragePath('generated-images/tenant/image.png'), null);
  assert.equal(normalizeGeneratedImageStoragePath('tenant/image%ZZ.png'), null);
  assert.equal(normalizeGeneratedImageStoragePath('tenant/image%2fother.png'), null);
  assert.equal(normalizeGeneratedImageStoragePath('tenant/image.png'), 'tenant/image.png');
});

test('Gallery fallback clears stale canonical remote URLs and preserves local/legacy/data/blob/direct', () => {
  const images = [
    { id: 'local', storage_path: 'local/local.png', image_url: 'data:image/png;base64,local' },
    { id: 'legacy', storage_path: '', image_url: 'https://legacy.example/image.png?token=old' },
    { id: 'data', storage_path: 'data:image/png;base64,inline', image_url: 'data:image/png;base64,inline' },
    { id: 'blob', storage_path: 'blob:https://example.test/blob-id', image_url: 'blob:https://example.test/blob-id' },
    { id: 'direct', storage_path: 'https://cdn.example/image.png', image_url: 'https://cdn.example/image.png' },
    { id: 'direct-signed-stale', storage_path: 'https://cdn.example/direct-stale.png', image_url: 'https://example.test/storage/v1/object/sign/generated-images?token=expired' },
    { id: 'stale', storage_path: 'tenant/canonical.png', image_url: 'https://example.test/storage/v1/object/sign/generated-images/tenant/canonical.png?token=expired' },
    { id: 'canonical-data', storage_path: 'tenant/data.png', image_url: 'data:image/png;base64,inline' },
    { id: 'canonical-direct', storage_path: 'tenant/direct.png', image_url: 'https://cdn.example/direct.png' },
    { id: 'query-only-signed', storage_path: 'https://example.test/storage/v1/object/sign/generated-images?token=expired', image_url: 'https://example.test/storage/v1/object/sign/generated-images?token=expired' },
    { id: 'malformed-signed', storage_path: 'https://example.test/storage/v1/object/sign/generated-images/tenant/image%ZZ.png?token=expired', image_url: 'https://example.test/storage/v1/object/sign/generated-images/tenant/image%ZZ.png?token=expired' },
    { id: 'malformed-canonical-stale', storage_path: 'tenant/image%ZZ.png', image_url: 'https://example.test/storage/v1/object/sign/generated-images/tenant/image.png?token=expired' },
    { id: 'legacy-signed', storage_path: '', image_url: 'https://example.test/storage/v1/object/sign/generated-images?token=expired' },
  ];
  const sanitized = clearCanonicalRemoteImageUrls(images);
  assert.equal(sanitized.find((image) => image.id === 'local')?.image_url, images[0].image_url);
  assert.equal(sanitized.find((image) => image.id === 'legacy')?.image_url, images[1].image_url);
  assert.equal(sanitized.find((image) => image.id === 'data')?.image_url, images[2].image_url);
  assert.equal(sanitized.find((image) => image.id === 'blob')?.image_url, images[3].image_url);
  assert.equal(sanitized.find((image) => image.id === 'direct')?.image_url, images[4].image_url);
  assert.equal(sanitized.find((image) => image.id === 'direct-signed-stale')?.image_url, null);
  assert.equal(sanitized.find((image) => image.id === 'stale')?.image_url, null);
  assert.equal(sanitized.find((image) => image.id === 'canonical-data')?.image_url, images[7].image_url);
  assert.equal(sanitized.find((image) => image.id === 'canonical-direct')?.image_url, images[8].image_url);
  assert.equal(sanitized.find((image) => image.id === 'query-only-signed')?.image_url, null);
  assert.equal(sanitized.find((image) => image.id === 'malformed-signed')?.image_url, null);
  assert.equal(sanitized.find((image) => image.id === 'malformed-canonical-stale')?.image_url, null);
  assert.equal(sanitized.find((image) => image.id === 'legacy-signed')?.image_url, images[12].image_url);
});

test('durable workspace artifacts redact remote query URLs without deleting legacy entries', async () => {
  const source = await read('src/lib/localWorkspaceArtifacts.ts');
  assert.match(source, /normalizeWorkspaceArtifactForPersistence/);
  assert.match(source, /isEphemeralRemoteImageUrl/);
  assert.match(source, /imageUrl: isEphemeralRemoteImageUrl\(artifact\.imageUrl\) && getWorkspaceArtifactCanonicalStoragePath\(artifact\.metadata\)/);
  assert.match(source, /getWorkspaceArtifactCanonicalStoragePath/);
  assert.match(source, /artifact\.imageUrl\.trim\(\) \|\| hasCanonicalStoragePath\(metadata\)/);
  assert.match(source, /nextArtifacts\.map\(normalizeWorkspaceArtifactForPersistence\)/);
  assert.match(source, /current\.artifacts\.filter\(\(item\) => item\.id !== artifact\.id\)/);
  assert.match(source, /preservesLegacyUrlOnlyEntry/);
});

test('resolution exposes signing and missing-canonical-path status separately', async () => {
  const source = await read('src/lib/storage.ts');
  assert.match(source, /GeneratedImageUrlResolutionFailureCode/);
  assert.match(source, /missing_url/);
  assert.match(source, /missing_canonical_path/);
  assert.match(source, /local_workspace_path/);
  assert.match(source, /signing_failed/);
  assert.match(source, /resolveGeneratedImageUrlWithStatus/);
  assert.match(source, /isLocalWorkspaceStoragePath\(trimmed\)/);
});

test('large Galleries sign batches concurrently and salvage valid paths after a mixed batch failure', async () => {
  const source = await read('src/lib/storage.ts');
  assert.match(source, /SIGNED_URL_BATCH_CONCURRENCY/);
  assert.match(source, /chunks\.slice\(index, index \+ SIGNED_URL_BATCH_CONCURRENCY\)/);
  assert.match(source, /unresolvedPaths = chunk\.filter/);
  assert.match(source, /createSignedUrl\(path, SIGNED_URL_TTL_SECONDS\)/);
});

test('local workspace paths stay local while canonical remote paths are re-signed in Gallery', async () => {
  const [storage, gallery] = await Promise.all([
    read('src/lib/storage.ts'),
    read('src/pages/GalleryPage.tsx'),
  ]);
  assert.match(storage, /classifyGeneratedImageReference/);
  assert.match(storage, /clearCanonicalRemoteImageUrls/);
  assert.match(gallery, /withSignedImageUrls\(candidates\)/);
  assert.match(gallery, /withSignedImageUrls\(localImages\)/);
  assert.match(gallery, /clearCanonicalRemoteImageUrls/);
  assert.match(gallery, /gallery_local_signed_urls_fallback_timeout/);
});

test('gallery selection carries storagePath into SelectedImage and print handoff import', async () => {
  const selector = await read('src/components/ImageSelector.tsx');
  const workbench = await read('src/pages/LightchainMaterialWorkbenchPage.tsx');
  assert.match(selector, /storagePath\?: string;/);
  assert.match(selector, /handleGallerySelect = \(imageUrl: string, imageId: string, storagePath\?/);
  assert.match(selector, /\.\.\.\(storagePath \? \{ storagePath \} : \{\}\)/);
  assert.match(workbench, /handoff\.design\.storagePath/);
});

test('URL-only remote images cannot become durable local workspace artifacts', async () => {
  const source = await read('src/lib/localWorkspaceArtifacts.ts');
  assert.match(source, /canPersistWorkspaceArtifactLocally/);
  assert.match(source, /data:\|blob:\|local:/);
  assert.match(source, /hasCanonicalStoragePath/);
  assert.match(source, /Skipping local workspace artifact persistence for URL-only remote image/);
  assert.match(source, /Remote image URL requires canonical storage path metadata/);
});

test('canvas loaders configure CORS before assigning image sources', async () => {
  const [infiniteCanvas, canvasEditor] = await Promise.all([
    read('src/components/canvas/InfiniteCanvas.tsx'),
    read('src/pages/CanvasEditorPage.tsx'),
  ]);
  for (const source of [infiniteCanvas, canvasEditor]) {
    const imageCreation = source.indexOf('const img = new window.Image();');
    const corsAssignment = source.indexOf("img.crossOrigin = 'anonymous';", imageCreation);
    const srcAssignment = source.indexOf('img.src = src;', corsAssignment);
    assert.ok(imageCreation >= 0, 'canvas loader creates an image');
    assert.ok(corsAssignment > imageCreation, 'CORS is configured after image creation');
    assert.ok(srcAssignment > corsAssignment, 'CORS is configured before src assignment');
  }
});
