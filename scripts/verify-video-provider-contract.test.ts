import assert from 'node:assert/strict';
import test from 'node:test';
import {
  VIDEO_PROVIDER_NOT_ADMITTED,
  buildVideoGenerationInput,
  parseVideoDuration,
  resolveVideoProviderGate,
} from '../src/features/lightchain/videoProviderContract.ts';

test('video remains fail-closed until source, credential, and same-run readback are all admitted', () => {
  assert.deepEqual(resolveVideoProviderGate(), {
    route: 'unsupported',
    blocker: VIDEO_PROVIDER_NOT_ADMITTED,
  });
  assert.deepEqual(resolveVideoProviderGate({
    provider: 'runway',
    sourcePermissionConfirmed: true,
    serverCredentialConfigured: true,
    sameRunReceiptReadbackConfirmed: false,
  }), {
    route: 'unsupported',
    blocker: VIDEO_PROVIDER_NOT_ADMITTED,
  });
  assert.deepEqual(resolveVideoProviderGate({
    provider: 'runway',
    sourcePermissionConfirmed: true,
    serverCredentialConfigured: true,
    sameRunReceiptReadbackConfirmed: true,
  }), { route: 'video', provider: 'runway' });
});

test('normalizes only the Light source duration/resolution controls', () => {
  assert.equal(parseVideoDuration('5秒'), 5);
  assert.equal(parseVideoDuration('10秒'), 10);
  assert.equal(parseVideoDuration('15秒'), 15);
  assert.equal(parseVideoDuration('20秒'), null);

  assert.deepEqual(buildVideoGenerationInput({
    sourceAssetRef: 'asset://heavy/video-source-1',
    prompt: '保持人物位置のまま一度うなずく',
    duration: '10秒',
    resolution: '1080P',
    idempotencyKey: 'video-run-1',
  }), {
    sourceAssetRef: 'asset://heavy/video-source-1',
    prompt: '保持人物位置のまま一度うなずく',
    durationSeconds: 10,
    resolution: '1080P',
    idempotencyKey: 'video-run-1',
  });
});

test('rejects incomplete video inputs instead of inventing a fallback request', () => {
  assert.equal(buildVideoGenerationInput({
    sourceAssetRef: 'asset://heavy/video-source-1',
    prompt: 'video',
    duration: '10秒',
    resolution: '1080P',
  }), null);
  assert.equal(buildVideoGenerationInput({
    sourceAssetRef: 'asset://heavy/video-source-1',
    prompt: 'video',
    duration: '10秒',
    resolution: '1K',
    idempotencyKey: 'video-run-1',
  }), null);
});
