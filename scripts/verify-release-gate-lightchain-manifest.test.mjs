import test from 'node:test';
import assert from 'node:assert/strict';
import { readCurrentLightchainManifest } from './verify-release-gate-unified.mjs';

test('release gate manifest includes the canonical Lightchain video workflows', () => {
  const manifest = readCurrentLightchainManifest();

  assert.ok(manifest.includes('video-workstation'));
  assert.ok(manifest.includes('video-detail'));
  assert.equal(new Set(manifest).size, manifest.length);
});
