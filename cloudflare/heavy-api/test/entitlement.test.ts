import assert from 'node:assert/strict';
import test from 'node:test';
import {
  computeHeavyRequestBinding,
  resolveHeavyEntitlement,
  resolveHeavyEntitlementStatus,
} from '../src/heavy-entitlement.ts';
import { canonical, sha256 } from '../src/image-ai-contracts.ts';
import {
  imageSetup,
  TEST_HEAVY_DOCUMENT_DIGEST,
  TEST_HEAVY_DOCUMENT_VERSION,
  TEST_HEAVY_RIGHTS_VERSION,
  TEST_HEAVY_TERMS_VERSION,
} from './image-ai-fixture.ts';

const actionPath = '/v1/provider-actions/generate-image';

test('Heavy prepare is authenticated, editor-scoped, opaque, and idempotent for one exact input', async (t) => {
  const setup = imageSetup();
  t.after(() => setup.db.sql.close());
  const requestId = crypto.randomUUID();
  const input = { ...setup.input(), seed: 172903 };
  const preparedResponse = await setup.call('/v1/heavy/entitlement/prepare', 'alice', {
    userId: 'bob', brandId: 'brand', action: 'generate-image', requestId, input,
  });
  assert.equal(preparedResponse.status, 200, await preparedResponse.clone().text());
  const prepared = await preparedResponse.json() as Record<string, unknown>;
  assert.equal(prepared.success, true);
  assert.equal(typeof prepared.preparationId, 'string');
  assert.match(String(prepared.inputDigest), /^[0-9a-f]{64}$/);
  assert.ok(Date.parse(String(prepared.expiresAt)) > Date.now());
  for (const key of ['normalizedInput', 'sourceDigests', 'userId', 'brandId']) assert.equal(Object.hasOwn(prepared, key), false);
  const row = setup.db.sql.prepare('SELECT user_id,brand_id,action,input_digest,normalized_input,source_digests,expires_at FROM heavy_generation_preparations WHERE preparation_id=?')
    .get(String(prepared.preparationId)) as Record<string, unknown>;
  assert.equal(row.user_id, 'alice');
  assert.equal(row.brand_id, 'brand');
  assert.equal(row.action, 'generate-image');
  assert.equal(row.input_digest, prepared.inputDigest);
  assert.notEqual(row.normalized_input, JSON.stringify(input));
  assert.equal(row.source_digests, '[]');
  const repeatedResponse = await setup.call('/v1/heavy/entitlement/prepare', 'alice', {
    brandId: 'brand', action: 'generate-image', requestId, input,
  });
  assert.equal(repeatedResponse.status, 200);
  const repeated = await repeatedResponse.json() as Record<string, unknown>;
  assert.equal(repeated.preparationId, prepared.preparationId);
  const changedResponse = await setup.call('/v1/heavy/entitlement/prepare', 'alice', {
    brandId: 'brand', action: 'generate-image', requestId, input: { ...input, prompt: 'changed' },
  });
  assert.equal(changedResponse.status, 409);
  assert.deepEqual(await changedResponse.json(), { success: false, error: 'heavy_preparation_conflict' });
});

test('Heavy acceptance and attestation cannot bypass the preparation proof', async (t) => {
  const setup = imageSetup();
  t.after(() => setup.db.sql.close());
  const requestId = crypto.randomUUID();
  const input = { ...setup.input(), seed: 172903 };
  const acceptance = await setup.call('/v1/heavy/entitlement/acceptance', 'alice', {
    userId: 'bob', brandId: 'brand', action: 'generate-image', requestId,
    termsAccepted: true, termsDocumentVersion: TEST_HEAVY_DOCUMENT_VERSION, termsDocumentDigest: TEST_HEAVY_DOCUMENT_DIGEST,
    inputDigest: 'a'.repeat(64),
  });
  assert.equal(acceptance.status, 403);
  assert.deepEqual(await acceptance.json(), { success: false, error: 'heavy_preparation_required' });
  const attestation = await setup.call('/v1/heavy/entitlement/attestation', 'alice', {
    userId: 'bob', brandId: 'brand', action: 'generate-image', requestId,
    termsAccepted: true, rightsAttested: true, rightsVersion: TEST_HEAVY_RIGHTS_VERSION,
    termsDocumentVersion: TEST_HEAVY_DOCUMENT_VERSION, termsDocumentDigest: TEST_HEAVY_DOCUMENT_DIGEST,
    rightsDocumentVersion: TEST_HEAVY_DOCUMENT_VERSION, rightsDocumentDigest: TEST_HEAVY_DOCUMENT_DIGEST, input,
  });
  assert.equal(attestation.status, 403);
  assert.deepEqual(await attestation.json(), { success: false, error: 'heavy_preparation_required' });
});

test('Generation no longer requires a preparation proof even when an old attestation exists', async (t) => {
  const setup = imageSetup();
  t.after(() => setup.db.sql.close());
  const requestId = crypto.randomUUID();
  const input = { ...setup.input(), seed: 172903 };
  const preparedResponse = await setup.call('/v1/heavy/entitlement/prepare', 'alice', {
    brandId: 'brand', action: 'generate-image', requestId, input,
  });
  const prepared = await preparedResponse.json() as { preparationId: string; inputDigest: string };
  const attestation = await setup.call('/v1/heavy/entitlement/attestation', 'alice', {
    brandId: 'brand', action: 'generate-image', requestId, preparationId: prepared.preparationId,
    inputDigest: prepared.inputDigest, termsAccepted: true, rightsAttested: true, rightsVersion: TEST_HEAVY_RIGHTS_VERSION,
    termsDocumentVersion: TEST_HEAVY_DOCUMENT_VERSION, termsDocumentDigest: TEST_HEAVY_DOCUMENT_DIGEST,
    rightsDocumentVersion: TEST_HEAVY_DOCUMENT_VERSION, rightsDocumentDigest: TEST_HEAVY_DOCUMENT_DIGEST, input,
  });
  assert.equal(attestation.status, 200, await attestation.clone().text());
  setup.setAutoProvisionEntitlement(false);
  const generation = await setup.call(actionPath, 'alice', input, requestId);
  assert.equal(generation.status, 200, await generation.clone().text());
  assert.equal((await generation.json() as { success: boolean }).success, true);
  assert.equal(setup.calls.length, 1);
  assert.equal(setup.db.sql.prepare('SELECT COUNT(*) AS n FROM heavy_ai_requests').get()!.n, 1);
});

test('Expired Heavy preparations fail closed at attestation', async (t) => {
  const setup = imageSetup();
  t.after(() => setup.db.sql.close());
  const requestId = crypto.randomUUID();
  const input = { ...setup.input(), seed: 172903 };
  const preparedResponse = await setup.call('/v1/heavy/entitlement/prepare', 'alice', {
    brandId: 'brand', action: 'generate-image', requestId, input,
  });
  const prepared = await preparedResponse.json() as { preparationId: string; inputDigest: string };
  const source = setup.db.sql.prepare('SELECT normalized_input,source_digests FROM heavy_generation_preparations WHERE preparation_id=?')
    .get(prepared.preparationId) as { normalized_input: string; source_digests: string };
  const expiredId = crypto.randomUUID();
  setup.db.sql.prepare(`INSERT INTO heavy_generation_preparations
    (preparation_id,request_id,user_id,brand_id,action,input_digest,normalized_input,source_digests,expires_at,created_at)
    VALUES(?,?,?,?,?,?,?,?,?,?)`).run(expiredId, requestId, 'alice', 'brand', 'generate-image', prepared.inputDigest,
      source.normalized_input, source.source_digests, '2026-01-01T00:00:00.000Z', '2026-01-01T00:00:00.000Z');
  const response = await setup.call('/v1/heavy/entitlement/attestation', 'alice', {
    brandId: 'brand', action: 'generate-image', requestId, preparationId: expiredId, inputDigest: prepared.inputDigest,
    termsAccepted: true, rightsAttested: true, rightsVersion: TEST_HEAVY_RIGHTS_VERSION,
    termsDocumentVersion: TEST_HEAVY_DOCUMENT_VERSION, termsDocumentDigest: TEST_HEAVY_DOCUMENT_DIGEST,
    rightsDocumentVersion: TEST_HEAVY_DOCUMENT_VERSION, rightsDocumentDigest: TEST_HEAVY_DOCUMENT_DIGEST, input,
  });
  assert.equal(response.status, 403);
  assert.deepEqual(await response.json(), { success: false, error: 'heavy_preparation_expired' });
});

test('Heavy entitlement settings no longer gate authenticated image inference', async (t) => {
  const setup = imageSetup();
  t.after(() => setup.db.sql.close());
  setup.env.HEAVY_IMAGE_ENTITLEMENT_ENABLED = 'false';
  setup.setAutoProvisionEntitlement(false);
  const allowedId = crypto.randomUUID();
  const allowed = await setup.call(actionPath, 'alice', setup.input(), allowedId);
  assert.equal(allowed.status, 200, await allowed.clone().text());
  assert.equal((await allowed.json() as { success: boolean }).success, true);
  assert.equal(setup.calls.length, 1);
  assert.equal(setup.bucket.puts, 1);
});

test('Heavy resolver binds the authenticated request to the current acceptance and attestation', async (t) => {
  const setup = imageSetup();
  t.after(() => setup.db.sql.close());
  const requestId = crypto.randomUUID();
  setup.setAutoProvisionEntitlement(true);
  await setup.provisionEntitlement('alice', setup.input(), 'generate-image', requestId);
  setup.setAutoProvisionEntitlement(false);

  const allowed = await resolveHeavyEntitlement(setup.env, {
    userId: 'alice', brandId: 'brand', action: 'generate-image', requestId,
  });
  assert.equal(allowed.allowed, true);
  assert.equal(allowed.reason, null);
  assert.equal(allowed.termsVersion, TEST_HEAVY_TERMS_VERSION);
  assert.equal(allowed.rightsVersion, TEST_HEAVY_RIGHTS_VERSION);
  assert.equal(allowed.termsAcceptanceId, 'terms-alice-v1');
  assert.match(allowed.rightsAttestationId ?? '', /^[0-9a-f-]{36}$/i);
  assert.equal(allowed.requestBinding?.length, 64);
  assert.equal(allowed.requestScopedAttestationRequired, false);

  const mismatchRequestId = crypto.randomUUID();
  const mismatchInput = setup.input();
  const mismatchInputJSON = canonical(mismatchInput);
  const mismatchInputDigest = await sha256(mismatchInputJSON);
  setup.db.sql.prepare(`INSERT INTO heavy_request_rights_attestations
    (id,request_id,user_id,brand_id,action,terms_acceptance_id,terms_version,rights_version,document_version,document_digest,
      request_binding,input_digest,normalized_input,attested_at,recorded_at)
    VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`).run('att-mismatch',mismatchRequestId,'alice','brand','generate-image','terms-alice-v1',
      TEST_HEAVY_TERMS_VERSION,TEST_HEAVY_RIGHTS_VERSION,TEST_HEAVY_DOCUMENT_VERSION,TEST_HEAVY_DOCUMENT_DIGEST,
      '0'.repeat(64),mismatchInputDigest,mismatchInputJSON,'2026-09-06','2026-09-06');
  const mismatch = await resolveHeavyEntitlement(setup.env, {
    userId: 'alice', brandId: 'brand', action: 'generate-image', requestId: mismatchRequestId,
  });
  assert.equal(mismatch.allowed, false);
  assert.equal(mismatch.reason, 'heavy_request_binding_mismatch');
  assert.equal(mismatch.requestBinding?.length, 64);
});

test('Heavy status read is read-only and remains request-scoped even after terms acceptance', async (t) => {
  const setup = imageSetup();
  t.after(() => setup.db.sql.close());
  setup.setAutoProvisionEntitlement(false);
  const before = setup.db.sql.prepare('SELECT total_changes() AS n').get()!.n;
  const status = await resolveHeavyEntitlementStatus(setup.env, {
    userId: 'alice', brandId: 'brand', action: 'generate-image',
  });
  assert.equal(status.allowed, false);
  assert.equal(status.reason, 'heavy_request_attestation_required');
  assert.equal(status.termsAcceptanceId, 'terms-alice-v1');
  assert.equal(status.requestScopedAttestationRequired, true);
  assert.equal(setup.db.sql.prepare('SELECT total_changes() AS n').get()!.n, before);

  const response = await setup.call('/v1/heavy/entitlement?brand_id=brand&action=generate-image', 'alice');
  assert.equal(response.status, 200);
  assert.deepEqual(await response.json(), {
    success: true,
    allowed: false,
    reason: 'heavy_request_attestation_required',
    termsVersion: TEST_HEAVY_TERMS_VERSION,
    termsDocumentVersion: TEST_HEAVY_DOCUMENT_VERSION,
    termsDocumentDigest: TEST_HEAVY_DOCUMENT_DIGEST,
    rightsVersion: TEST_HEAVY_RIGHTS_VERSION,
    rightsDocumentVersion: TEST_HEAVY_DOCUMENT_VERSION,
    rightsDocumentDigest: TEST_HEAVY_DOCUMENT_DIGEST,
    termsAcceptanceId: 'terms-alice-v1',
    rightsAttestationId: null,
    requestBinding: null,
    inputDigest: null,
    requestScopedAttestationRequired: true,
  });
});

test('missing rights document configuration fails closed without a v1 fallback', async (t) => {
  const setup = imageSetup();
  t.after(() => setup.db.sql.close());
  delete setup.env.HEAVY_RIGHTS_DOCUMENT_VERSION;
  delete setup.env.HEAVY_RIGHTS_DOCUMENT_DIGEST;
  delete setup.env.HEAVY_APPROVED_DOCUMENT_VERSION;
  delete setup.env.HEAVY_APPROVED_DOCUMENT_DIGEST;
  const status = await resolveHeavyEntitlementStatus(setup.env, {
    userId: 'alice', brandId: 'brand', action: 'generate-image',
  });
  assert.equal(status.allowed, false);
  assert.equal(status.reason, 'heavy_rights_document_version_unconfigured');
  assert.equal(status.rightsVersion, TEST_HEAVY_RIGHTS_VERSION);
  assert.equal(status.rightsDocumentVersion, null);
  assert.equal(status.rightsDocumentDigest, null);
});

test('Heavy terms and attestation records are append-only', (t) => {
  const setup = imageSetup();
  t.after(() => setup.db.sql.close());
  assert.throws(
    () => setup.db.sql.prepare('UPDATE heavy_terms_acceptances SET terms_version=? WHERE id=?').run('changed', 'terms-alice-v1'),
    /heavy_terms_acceptances_append_only/,
  );
  assert.throws(
    () => setup.db.sql.prepare('DELETE FROM heavy_terms_acceptances WHERE id=?').run('terms-alice-v1'),
    /heavy_terms_acceptances_append_only/,
  );
  const requestId = crypto.randomUUID();
  const binding = 'a'.repeat(64);
  setup.db.sql.prepare(`INSERT INTO heavy_request_rights_attestations
    (id,request_id,user_id,brand_id,action,terms_acceptance_id,terms_version,rights_version,request_binding,attested_at,recorded_at)
    VALUES(?,?,?,?,?,?,?,?,?,?,?)`).run('att-test',requestId,'alice','brand','generate-image','terms-alice-v1',
      TEST_HEAVY_TERMS_VERSION,TEST_HEAVY_RIGHTS_VERSION,binding,'2026-09-06','2026-09-06');
  assert.throws(
    () => setup.db.sql.prepare('UPDATE heavy_request_rights_attestations SET request_binding=? WHERE id=?').run('b'.repeat(64), 'att-test'),
    /heavy_request_rights_attestations_append_only/,
  );
  assert.throws(
    () => setup.db.sql.prepare('DELETE FROM heavy_request_rights_attestations WHERE id=?').run('att-test'),
    /heavy_request_rights_attestations_append_only/,
  );
});

test('server-computed binding is stable across object key order', async () => {
  const normalizedInput = { schema: 'heavy-image-input.v2', contentDigests: ['a'.repeat(64)], sourceContentDigests: ['b'.repeat(64)], settings: { width: 256, height: 256 } };
  const inputDigest = await sha256(canonical(normalizedInput));
  const values = {
    userId: 'alice', brandId: 'brand', action: 'generate-image', requestId: crypto.randomUUID(),
    termsAcceptanceId: 'terms-alice-v1', termsVersion: TEST_HEAVY_TERMS_VERSION,
    termsDocumentVersion: TEST_HEAVY_DOCUMENT_VERSION, termsDocumentDigest: TEST_HEAVY_DOCUMENT_DIGEST,
    rightsVersion: TEST_HEAVY_RIGHTS_VERSION, rightsDocumentVersion: TEST_HEAVY_DOCUMENT_VERSION,
    rightsDocumentDigest: TEST_HEAVY_DOCUMENT_DIGEST, inputDigest, normalizedInput,
  };
  const first = await computeHeavyRequestBinding(values);
  const second = await computeHeavyRequestBinding({
    rightsVersion: values.rightsVersion, termsVersion: values.termsVersion, termsAcceptanceId: values.termsAcceptanceId,
    requestId: values.requestId, action: values.action, brandId: values.brandId, userId: values.userId,
    termsDocumentVersion: values.termsDocumentVersion, termsDocumentDigest: values.termsDocumentDigest,
    rightsDocumentVersion: values.rightsDocumentVersion, rightsDocumentDigest: values.rightsDocumentDigest,
    inputDigest: values.inputDigest, normalizedInput: { settings: { height: 256, width: 256 }, sourceContentDigests: ['b'.repeat(64)], contentDigests: ['a'.repeat(64)], schema: 'heavy-image-input.v2' },
  });
  assert.equal(first, second);
  assert.match(first, /^[0-9a-f]{64}$/);
});
