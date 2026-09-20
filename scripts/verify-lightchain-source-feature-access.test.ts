import assert from 'node:assert/strict';
import test from 'node:test';
import {
  getLightchainSourceFeatureAccess,
  getLightchainSourceGenerationAccess,
} from '../src/features/lightchain/sourceFeatureAccess.ts';

test('source-admitted fabric input access stays separate from rights UI', () => {
  assert.equal(getLightchainSourceFeatureAccess('fabric-image'), 'admitted');
  assert.equal(getLightchainSourceGenerationAccess('fabric-image'), 'denied');
});

test('unobserved source feature access remains fail-closed', () => {
  assert.equal(getLightchainSourceFeatureAccess('printing-image'), 'unknown');
});
