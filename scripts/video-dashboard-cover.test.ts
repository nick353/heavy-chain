import assert from 'node:assert/strict';
import { test } from 'node:test';
import { buildSavedVideoDashboardProjects } from '../src/lib/videoDashboardProjects.ts';

const artifact = (metadata: Record<string, unknown>) => ({
  id: 'a1', brandId: 'b', featureType: 'video-workstation', title: 'tshirt', createdAt: new Date().toISOString(),
  imageUrl: 'data:image/svg+xml;utf8,storyboard', prompt: '', metadata,
}) as never;

test('a saved video draft shows the uploaded garment, not the storyboard sketch', () => {
  const [withSource] = buildSavedVideoDashboardProjects([artifact({ videoSourceImageUrl: 'https://heavychain.app/media/tshirt.png' })]);
  assert.equal(withSource.imageUrl, 'https://heavychain.app/media/tshirt.png');
  const [blobSource] = buildSavedVideoDashboardProjects([artifact({ videoSourceImageUrl: 'blob:https://heavychain.app/x' })]);
  assert.equal(blobSource.imageUrl, 'data:image/svg+xml;utf8,storyboard');
});

test('video draft saves send a raster image and keep metadata small', async () => {
  const { compactVideoMetadataImage, isRasterDataUrl, rasterSourceDataUrl } = await import('../src/lib/videoWorkspacePersistence.ts');
  const png = 'data:image/png;base64,iVBORw0KGgo=';
  assert.equal(isRasterDataUrl(png), true);
  assert.equal(isRasterDataUrl('data:image/svg+xml;utf8,<svg/>'), false);
  assert.equal(await rasterSourceDataUrl(png), png);
  const fetched = await rasterSourceDataUrl('/x.webp', (async () => new Response(new Blob([new Uint8Array([82, 73, 70, 70])], { type: 'image/webp' }))) as typeof fetch);
  assert.equal(fetched, 'data:image/webp;base64,UklGRg==');
  assert.equal(await rasterSourceDataUrl('/x.svg', (async () => new Response(new Blob(['<svg/>'], { type: 'image/svg+xml' }))) as typeof fetch), null);
  assert.equal(compactVideoMetadataImage(`data:image/png;base64,${'A'.repeat(40_000)}`), '');
  assert.equal(compactVideoMetadataImage('https://heavychain.app/a.png'), 'https://heavychain.app/a.png');
  assert.equal(compactVideoMetadataImage('blob:https://heavychain.app/x'), '');
});
