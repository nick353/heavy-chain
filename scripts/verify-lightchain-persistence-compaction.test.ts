import assert from 'node:assert/strict';
import test from 'node:test';
import { compactLightchainWorkbenchStateForPersistence } from '../src/lib/lightchainPersistence.ts';

const largeDataUrl = `data:image/png;base64,${'A'.repeat(120_000)}`;

test('remote Lightchain results keep the canonical storage path without duplicating the large data URL', () => {
  const state = {
    generatedStoragePath: 'user/brand/workspace/result.png',
    lightchainResult: {
      toolId: 'fitting-background-reference',
      imageUrl: largeDataUrl,
      storagePath: 'user/brand/workspace/result.png',
    },
  };

  const compacted = compactLightchainWorkbenchStateForPersistence(state);

  assert.equal(compacted.lightchainResult.imageUrl, '');
  assert.equal(compacted.lightchainResult.storagePath, state.lightchainResult.storagePath);
  assert.equal(state.lightchainResult.imageUrl, largeDataUrl);
  assert.ok(JSON.stringify(compacted).length < JSON.stringify(state).length / 10);
});

test('local preview results without a canonical storage path remain resumable', () => {
  const state = {
    lightchainResult: {
      toolId: 'fitting-background-reference',
      imageUrl: largeDataUrl,
    },
  };

  const compacted = compactLightchainWorkbenchStateForPersistence(state);

  assert.equal(compacted.lightchainResult.imageUrl, largeDataUrl);
});

test('small previews are not changed', () => {
  const state = {
    generatedStoragePath: 'user/brand/workspace/result.svg',
    lightchainResult: {
      toolId: 'fitting-background-reference',
      imageUrl: 'data:image/svg+xml,%3Csvg/%3E',
      storagePath: 'user/brand/workspace/result.svg',
    },
  };

  assert.deepEqual(compactLightchainWorkbenchStateForPersistence(state), state);
});
