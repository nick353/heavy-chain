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
