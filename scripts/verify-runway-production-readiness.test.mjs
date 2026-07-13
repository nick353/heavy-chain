import assert from 'node:assert/strict';
import test from 'node:test';
import {
  dbReadbackBlocker,
  projectRemoteSecretInspection,
  projectSubscription,
  redact,
  redactObject,
  requiredSecretPresence,
} from './verify-runway-production-readiness.lib.mjs';

function subscriptionRow(overrides = {}) {
  return {
    brand_id: 'brand_123',
    status: 'active',
    current_period_start: '2026-06-01T00:00:00.000Z',
    current_period_end: '2026-07-01T00:00:00.000Z',
    quota_override: null,
    plans: {
      id: 'plan_pro',
      code: 'pro',
      name: 'Pro',
      monthly_quota: 100,
      features: { runway_mcp_generation: true },
      is_active: true,
    },
    ...overrides,
  };
}

test('free and non-runway plans remain readable but are not readiness blockers', () => {
  const freeSubscription = projectSubscription(subscriptionRow({
    plans: {
      id: 'plan_free',
      code: 'free',
      name: 'Free',
      monthly_quota: 0,
      features: { runway_mcp_generation: false },
      is_active: true,
    },
  }));
  const nonRunwaySubscription = projectSubscription(subscriptionRow({
    plans: {
      id: 'plan_team',
      code: 'team',
      name: 'Team',
      monthly_quota: 100,
      features: {},
      is_active: true,
    },
  }));

  assert.equal(freeSubscription.plan.code, 'free');
  assert.equal(freeSubscription.plan.runway_mcp_generation, false);
  assert.equal(nonRunwaySubscription.plan.code, 'team');
  assert.equal(nonRunwaySubscription.plan.runway_mcp_generation, false);
});

test('Supabase plan join is normalized from array or single object', () => {
  const singlePlan = projectSubscription(subscriptionRow());
  const arrayPlan = projectSubscription(subscriptionRow({
    plans: [subscriptionRow().plans],
  }));

  assert.deepEqual(singlePlan.plan, arrayPlan.plan);
  assert.equal(singlePlan.plan.id, 'plan_pro');
  assert.equal(arrayPlan.plan.runway_mcp_generation, true);
});

test('redact hides bearer, token, and bridge secrets', () => {
  const raw = [
    'Authorization: Bearer runway-secret-token',
    'access_token="access-secret"',
    'refresh_token: refresh-secret',
    'RUNWAY_MCP_BRIDGE_TOKEN=bridge-secret',
    'RUNWAY_MCP_BRIDGE_URL=https://bridge.example.com/private',
    'jwt=eyJhbGciOiJIUzI1NiJ9.eyJzdWIiOiIxMjMifQ.signature',
  ].join('\n');
  const redacted = redact(raw);

  assert.equal(redacted.includes('runway-secret-token'), false);
  assert.equal(redacted.includes('access-secret'), false);
  assert.equal(redacted.includes('refresh-secret'), false);
  assert.equal(redacted.includes('bridge-secret'), false);
  assert.equal(redacted.includes('bridge.example.com/private'), false);
  assert.match(redacted, /Bearer \[redacted\]/);
  assert.match(redacted, /access_token=\[redacted\]/);
  assert.match(redacted, /refresh_token=\[redacted\]/);
  assert.match(redacted, /RUNWAY_MCP_BRIDGE_TOKEN=\[redacted\]/);
  assert.match(redacted, /RUNWAY_MCP_BRIDGE_URL=\[redacted\]/);
  assert.match(redacted, /\[redacted-jwt\]/);
});

test('redactObject recursively redacts strings', () => {
  assert.deepEqual(redactObject({
    headers: { authorization: 'Bearer nested-secret' },
    rows: ['RUNWAY_MCP_BRIDGE_TOKEN=nested-bridge-secret'],
  }), {
    headers: { authorization: 'Bearer [redacted]' },
    rows: ['RUNWAY_MCP_BRIDGE_TOKEN=[redacted]'],
  });
});

test('remote secret inspection failures are verification blockers, not missing secret blockers', () => {
  const missingRef = projectRemoteSecretInspection({ projectRef: '', status: null });
  const cliFailure = projectRemoteSecretInspection({
    projectRef: 'project_ref',
    status: 1,
    stdout: 'RUNWAY_MCP_BRIDGE_TOKEN=secret',
    stderr: 'bad token',
  });
  const parseFailure = projectRemoteSecretInspection({
    projectRef: 'project_ref',
    status: 0,
    stdout: 'not json',
    stderr: '',
  });

  for (const result of [missingRef, cliFailure, parseFailure]) {
    assert.equal(result.ok, false);
    assert.deepEqual(result.names, []);
    assert.equal(result.blocker.code, 'production_runway_mcp_secret_inspection_failed');
  }
  assert.equal(cliFailure.check.stdout.includes('secret'), false);
});

test('remote bridge pending can only be evaluated after secret inspection succeeds', () => {
  const inspected = projectRemoteSecretInspection({
    projectRef: 'project_ref',
    status: 0,
    stdout: JSON.stringify({ secrets: [{ name: 'RUNWAY_MCP_BRIDGE_URL' }] }),
    stderr: '',
  });
  const presence = requiredSecretPresence(inspected.names, [
    'RUNWAY_MCP_BRIDGE_URL',
    'RUNWAY_MCP_BRIDGE_TOKEN',
  ]);

  assert.equal(inspected.ok, true);
  assert.equal(inspected.blocker, null);
  assert.deepEqual(presence, {
    RUNWAY_MCP_BRIDGE_URL: true,
    RUNWAY_MCP_BRIDGE_TOKEN: false,
  });
});

test('db readback errors produce verification blockers before product-state classification', () => {
  const blocker = dbReadbackBlocker('brands', { message: 'relation does not exist' });

  assert.equal(blocker.code, 'production_runway_db_readback_failed');
  assert.match(blocker.message, /brands readback failed/);
  assert.match(blocker.message, /relation does not exist/);
  assert.match(blocker.next_action, /rerun npm run verify:runway-readiness/);
  assert.equal(dbReadbackBlocker('brands', null), null);
});
