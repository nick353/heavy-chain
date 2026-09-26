import assert from 'node:assert/strict';
import test from 'node:test';
import {
  attachHeavyGenerationPreflight,
  validateHeavyGenerationPreflight,
} from '../src/lib/heavyGenerationPreflight.ts';

const valid = () => ({
  preparationId: '11111111-1111-4111-8111-111111111111',
  inputDigest: 'a'.repeat(64),
  expiresAt: new Date(Date.now() + 60_000).toISOString(),
  termsVersion: 'heavy-terms-2026-09',
  termsDocumentVersion: 'heavy-doc-2026-09',
  termsDocumentDigest: 'b'.repeat(64),
  rightsVersion: 'heavy-rights-2026-09',
  rightsDocumentVersion: 'heavy-doc-2026-09',
  rightsDocumentDigest: 'b'.repeat(64),
});

test('client Heavy proof is opaque, exact, and does not auto-consent', () => {
  const proof = validateHeavyGenerationPreflight(valid());
  const input = { brandId: 'brand', prompt: 'exact input', legalSafety: { rightsConfirmed: true } };
  assert.deepEqual(attachHeavyGenerationPreflight(input, proof), {
    ...input,
    preparationId: proof.preparationId,
    inputDigest: proof.inputDigest,
  });
  assert.equal('termsAccepted' in (attachHeavyGenerationPreflight(input, proof) as object), false);
  assert.equal('rightsAttested' in (attachHeavyGenerationPreflight(input, proof) as object), false);
});

test('expired, malformed, and non-UUID preparations fail closed', () => {
  assert.throws(() => validateHeavyGenerationPreflight({ ...valid(), expiresAt: new Date(Date.now() - 1).toISOString() }), /heavy_preparation_invalid/);
  assert.throws(() => validateHeavyGenerationPreflight({ ...valid(), inputDigest: 'not-a-digest' }), /heavy_preparation_invalid/);
  assert.throws(() => validateHeavyGenerationPreflight({ ...valid(), preparationId: 'not-a-uuid' }), /heavy_preparation_invalid/);
});
