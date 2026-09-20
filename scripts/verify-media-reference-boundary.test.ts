import assert from 'node:assert/strict';
import test from 'node:test';
import {
  createMediaReference,
  normalizeMediaObjectPath,
  normalizeMediaProviderOrder,
  selectMediaReference,
  validateMediaObjectPath,
} from '../src/lib/mediaReference.ts';

test('normalizes safe object paths and rejects traversal or URL-shaped input', () => {
  assert.equal(normalizeMediaObjectPath('  tenant/%E3%83%95%E3%82%A1%E3%82%A4%E3%83%AB.png  '), 'tenant/ファイル.png');
  assert.deepEqual(validateMediaObjectPath('tenant/design.png'), { ok: true, path: 'tenant/design.png' });

  for (const unsafePath of [
    '',
    '../design.png',
    'tenant/../design.png',
    'tenant/%2e%2e/design.png',
    'tenant%2Fdesign.png',
    '/absolute/design.png',
    'tenant\\design.png',
    'https://example.test/design.png',
    'tenant/design.png?download=1',
    'tenant/%ZZ.png',
  ]) {
    assert.equal(normalizeMediaObjectPath(unsafePath), null, unsafePath);
  }
});

test('creates a normalized provider-neutral reference and validates its identity fields', () => {
  const reference = createMediaReference({
    provider: 'cloudflare_r2',
    bucket: ' generated-images ',
    objectPath: ' brand-1/result.png ',
    contentType: ' image/png ',
    size: 128,
    sha256: 'A'.repeat(64),
    version: 1,
  });

  assert.deepEqual(reference, {
    provider: 'cloudflare_r2',
    bucket: 'generated-images',
    objectPath: 'brand-1/result.png',
    contentType: 'image/png',
    size: 128,
    sha256: 'a'.repeat(64),
    version: 1,
  });

  assert.throws(
    () => createMediaReference({ ...reference, objectPath: 'brand-1/../result.png' }),
    /object_path_traversal/,
  );
  assert.throws(
    () => createMediaReference({ ...reference, size: -1 }),
    /invalid_size/,
  );
});

test('selects references only in the explicit provider order', () => {
  const cloudflare = createMediaReference({
    provider: 'cloudflare_r2',
    bucket: 'generated-images',
    objectPath: 'brand-1/result.png',
    contentType: 'image/png',
    size: 128,
    sha256: '1'.repeat(64),
    version: 1,
  });
  const r2 = { ...cloudflare, version: 2 };

  assert.equal(selectMediaReference([cloudflare, r2], ['cloudflare_r2']), cloudflare);
  assert.equal(selectMediaReference([r2], ['cloudflare_r2']), r2);
  assert.throws(() => normalizeMediaProviderOrder(['supabase']), /provider_order_invalid_provider/);
  assert.deepEqual(normalizeMediaProviderOrder(['cloudflare_r2']), ['cloudflare_r2']);
  assert.throws(() => createMediaReference({ ...cloudflare, provider: 'supabase' }), /invalid_provider/);
});
