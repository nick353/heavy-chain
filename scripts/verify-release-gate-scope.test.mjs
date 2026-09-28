import test from 'node:test';
import assert from 'node:assert/strict';
import {
  normalizeReleaseGateScope,
  releaseGateReadbackPlan,
} from './verify-release-gate-unified.mjs';

const h602 = { name: 'production H602 billing completion readback' };
const monitor = { name: 'production monitor and UI pair' };

test('omitted and full scope remain strict and do not defer H602', () => {
  assert.deepEqual(normalizeReleaseGateScope(undefined), { valid: true, value: 'full' });
  assert.deepEqual(normalizeReleaseGateScope('full'), { valid: true, value: 'full' });
  assert.deepEqual(releaseGateReadbackPlan('full', [monitor, h602]), {
    required: [monitor, h602],
    deferred: [],
  });
});

test('pre-launch defers H602 explicitly and preserves all other readbacks', () => {
  const plan = releaseGateReadbackPlan('pre-launch', [monitor, h602]);
  assert.deepEqual(plan.required, [monitor]);
  assert.deepEqual(plan.deferred, [{
    name: h602.name,
    status: 'DEFERRED',
    reason: 'user-approved pre-launch deferral',
    reactivateWhen: 'before selling or public launch',
  }]);
});

test('unknown scope is rejected before a readback plan can be built', () => {
  assert.deepEqual(normalizeReleaseGateScope('later'), { valid: false, value: 'later' });
  assert.throws(() => releaseGateReadbackPlan('later', [h602]), /invalid_release_gate_scope/);
});
