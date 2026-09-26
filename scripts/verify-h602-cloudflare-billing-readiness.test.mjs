import assert from 'node:assert/strict';
import test from 'node:test';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import {
  H602_BILLING_TRANSACTION_ENTITLEMENT_PATTERN,
  verifyH602CloudflareBillingReadiness,
} from './verify-h602-cloudflare-billing-readiness.mjs';

test('H602 Cloudflare contract passes locally but never grants release approval', () => {
  const report = verifyH602CloudflareBillingReadiness({ root: new URL('..', import.meta.url).pathname });
  assert.equal(report.ok, true);
  assert.equal(report.contractStatus, 'verified_local');
  assert.equal(report.productionProof.status, 'not_verified');
  assert.equal(report.releaseApproval, false);
});

test('H602 Cloudflare verifier fails closed when the contract is missing', async () => {
  const root = await mkdtemp(`${tmpdir()}/heavy-h602-`);
  try {
    const report = verifyH602CloudflareBillingReadiness({ root });
    assert.equal(report.ok, false);
    assert.ok(report.failures.length > 0);
    assert.equal(report.releaseApproval, false);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test('H602 distinguishes Heavy policy entitlement from billing-derived surfaces', () => {
  assert.equal(H602_BILLING_TRANSACTION_ENTITLEMENT_PATTERN.test('/v1/heavy/entitlement'), false);
  assert.equal(H602_BILLING_TRANSACTION_ENTITLEMENT_PATTERN.test('billingEntitlementId'), true);
  assert.equal(H602_BILLING_TRANSACTION_ENTITLEMENT_PATTERN.test('transaction_id_hash'), true);
  assert.equal(H602_BILLING_TRANSACTION_ENTITLEMENT_PATTERN.test('transactionId'), true);
});
