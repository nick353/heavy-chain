import assert from 'node:assert/strict';
import test from 'node:test';
import { validateHeavyAuthHydrationReadback } from './verify-heavy-chain-auth-hydration-readback.mjs';

const fixture = (overrides = {}) => ({
  schema: 'heavy_chain_auth_hydration_no_login_form_readback.v1',
  surface: 'aos_chrome_companion_profile_instance',
  sameTaskOwnedSession: true,
  sameTab: true,
  settleWaitSecondsPerRoute: 30,
  deployment: { statusAtCapture: 'RUNNING', healthAtCapture: 200 },
  routes: [{ route: '/designProduction', url: 'https://heavy-chain.zeabur.app/designProduction', title: 'Lightchain AI', readyState: 'complete', textChars: 946, controlCount: 48, loginMarkerCount: 0, loginFormCount: 0, rightsMarkerCount: 0, screenshotBytes: 30303 }],
  transition: { browserNavigationVerified: true, externalActionExecuted: false, unknownEffect: false },
  cleanup: { sessionClosed: true, taskTabClosed: true, foreignTabsMutated: false, externalActionExecuted: false, unknownEffect: false },
  secretRecorded: false,
  ...overrides,
});

test('accepts healthy same-session readback without login or rights UI', () => {
  assert.deepEqual(validateHeavyAuthHydrationReadback(fixture()), { ok: true, issues: [], routeCount: 1 });
});

test('rejects a login marker or rights UI', () => {
  const result = validateHeavyAuthHydrationReadback(fixture({ routes: [{ ...fixture().routes[0], loginMarkerCount: 1, rightsMarkerCount: 1 }] }));
  assert.equal(result.ok, false);
  assert.ok(result.issues.includes('login_ui_present'));
  assert.ok(result.issues.includes('rights_ui_present'));
});

test('rejects insufficient settle or unhealthy deployment', () => {
  const result = validateHeavyAuthHydrationReadback(fixture({ settleWaitSecondsPerRoute: 5, deployment: { statusAtCapture: 'BUILDING', healthAtCapture: 503 } }));
  assert.equal(result.ok, false);
  assert.ok(result.issues.includes('settle_wait_under_30_seconds'));
  assert.ok(result.issues.includes('deployment_not_healthy'));
});

test('rejects incomplete cleanup or secret-bearing evidence', () => {
  const result = validateHeavyAuthHydrationReadback(fixture({ cleanup: { ...fixture().cleanup, taskTabClosed: false }, secretRecorded: true }));
  assert.equal(result.ok, false);
  assert.ok(result.issues.includes('cleanup_incomplete'));
  assert.ok(result.issues.includes('secret_recorded'));
});
