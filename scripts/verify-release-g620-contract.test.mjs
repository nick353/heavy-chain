import assert from 'node:assert/strict';
import test from 'node:test';
import { validateG620SecurityOps } from './verify-release-gate-unified.mjs';

const requiredChecks = [
  'cloudflare_entrypoints_exist',
  'legacy_runtime_markers_absent',
  'private_media_route_present',
  'provider_action_route_present',
  'runtime_auth_boundary_present',
];

function fixture(overrides = {}) {
  return {
    schema: 'heavy-chain.g620.security-ops.v3',
    ok: true,
    mode: 'read-only-static-cloudflare-no-submit-no-payment-no-deploy',
    failures: [],
    checks: requiredChecks.map((id) => ({ id, passed: true })),
    irreversibleActions: {
      generationSubmit: 'not_clicked',
      purchasePaymentCheckout: 'not_touched',
      deploy: 'not_run',
    },
    ...overrides,
  };
}

test('accepts the current G620 v3 security artifact', () => {
  assert.equal(validateG620SecurityOps(fixture()), true);
});

test('rejects missing or failed required checks', () => {
  const missing = fixture({ checks: requiredChecks.slice(0, -1).map((id) => ({ id, passed: true })) });
  assert.equal(validateG620SecurityOps(missing), false);

  const failed = fixture({
    checks: requiredChecks.map((id) => ({ id, passed: id !== 'runtime_auth_boundary_present' })),
  });
  assert.equal(validateG620SecurityOps(failed), false);
});

test('rejects legacy schema, failures, and duplicate check IDs', () => {
  assert.equal(validateG620SecurityOps(fixture({ schema: 'heavy-chain.g620.security-operations.v2' })), false);
  assert.equal(validateG620SecurityOps(fixture({ failures: ['legacy_marker'] })), false);
  assert.equal(validateG620SecurityOps(fixture({ checks: [...fixture().checks, { id: requiredChecks[0], passed: true }] })), false);
});
