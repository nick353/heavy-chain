import test from 'node:test';
import assert from 'node:assert/strict';
import {
  getGeneratedImageSelectionKey,
  getGeneratedImageIdentityKeys,
  mergeGeneratedImagesByCanonicalIdentity,
  shouldClearWorkspaceArtifactImageUrl,
} from '../src/lib/generatedImageIdentity.ts';
import type { GeneratedImage } from '../src/types/database';

const image = (overrides: Partial<GeneratedImage>): GeneratedImage => ({
  id: 'image-default',
  job_id: null,
  brand_id: 'brand-1',
  user_id: 'user-1',
  storage_path: 'brand/default.png',
  image_url: null,
  thumbnail_path: null,
  version: 1,
  parent_image_id: null,
  is_favorite: false,
  created_at: '2026-08-13T00:00:00.000Z',
  expires_at: null,
  prompt: null,
  negative_prompt: null,
  feature_type: 'test',
  style_preset: null,
  model_used: null,
  generation_params: null,
  metadata: {},
  ...overrides,
});

test('canonical storage identity merges remote rows with local persistence fallback', () => {
  const remote = image({
    id: 'remote-image-1',
    storage_path: 'brand-1/job-1/result.png',
    image_url: 'https://signed.example/remote',
  });
  const local = image({
    id: 'local-artifact-1',
    storage_path: 'local/local-artifact-1',
    image_url: '',
    metadata: {
      remoteStoragePath: 'brand-1/job-1/result.png',
      remoteImageId: 'remote-image-1',
      remoteSaveStatus: 'succeeded',
    },
  });

  const merged = mergeGeneratedImagesByCanonicalIdentity([remote], [local]);
  assert.equal(merged.length, 1);
  assert.equal(merged[0]?.id, 'remote-image-1');
});

test('a non-displayable remote row does not shadow a displayable local fallback', () => {
  const remote = image({
    id: 'remote-image-no-url',
    storage_path: 'brand-1/job-no-url/result.png',
    image_url: null,
  });
  const local = image({
    id: 'local-artifact-with-data',
    user_id: 'local-workspace',
    storage_path: 'local/local-artifact-with-data',
    image_url: 'data:image/png;base64,AAAA',
    metadata: { remoteStoragePath: 'brand-1/job-no-url/result.png' },
  });

  const merged = mergeGeneratedImagesByCanonicalIdentity([remote], [local]);
  assert.equal(merged.length, 1);
  assert.equal(merged[0]?.id, 'local-artifact-with-data');
  assert.equal(merged[0]?.image_url, 'data:image/png;base64,AAAA');
});

test('signed URL rotation does not create a duplicate Gallery item', () => {
  const remote = image({
    id: 'remote-image-2',
    storage_path: 'brand-1/job-2/result.png',
    image_url: 'https://project.supabase.co/storage/v1/object/sign/generated-images/brand-1/job-2/result.png?token=fresh',
  });
  const local = image({
    id: 'local-artifact-2',
    storage_path: 'local/local-artifact-2',
    image_url: '',
    metadata: {
      remoteStoragePath: 'https://project.supabase.co/storage/v1/object/sign/generated-images/brand-1/job-2/result.png?token=old',
    },
  });

  assert.ok(getGeneratedImageIdentityKeys(local).some((key) => key === 'storage:brand-1/job-2/result.png'));
  assert.equal(mergeGeneratedImagesByCanonicalIdentity([remote], [local]).length, 1);
});

test('local backup remains visible when the remote query has no row', () => {
  const local = image({
    id: 'local-only',
    storage_path: 'local/local-only',
    image_url: 'data:image/png;base64,AAAA',
    metadata: { remoteSaveStatus: 'succeeded', remoteImageId: 'remote-not-returned' },
  });
  const merged = mergeGeneratedImagesByCanonicalIdentity([], [local]);
  assert.deepEqual(merged.map((item) => item.id), ['local-only']);
});

test('two images from one job remain distinct without image or storage identity', () => {
  const first = image({ id: 'remote-a', job_id: 'job-1', storage_path: 'brand/a.png' });
  const second = image({ id: 'remote-b', job_id: 'job-1', storage_path: 'brand/b.png' });
  assert.equal(mergeGeneratedImagesByCanonicalIdentity([first, second], []).length, 2);
});

test('local data/blob fallbacks remain displayable even with remote identity metadata', () => {
  assert.equal(shouldClearWorkspaceArtifactImageUrl('data:image/png;base64,AAAA', true), false);
  assert.equal(shouldClearWorkspaceArtifactImageUrl('blob:https://example.test/blob-id', true), false);
  assert.equal(shouldClearWorkspaceArtifactImageUrl('https://signed.example/old', true), true);
  assert.equal(shouldClearWorkspaceArtifactImageUrl('https://signed.example/old', false), false);
});

test('Gallery selection uses one canonical key for remote rows and local fallbacks', () => {
  const remote = image({
    id: 'remote-image-selection',
    storage_path: 'brand-1/job-selection/result.png',
  });
  const local = image({
    id: 'local-selection',
    storage_path: 'local/local-selection',
    metadata: {
      remoteStoragePath: 'brand-1/job-selection/result.png',
      remoteImageId: 'remote-image-selection',
    },
  });
  assert.equal(getGeneratedImageSelectionKey(remote), 'storage:brand-1/job-selection/result.png');
  assert.equal(getGeneratedImageSelectionKey(local), 'storage:brand-1/job-selection/result.png');
});
