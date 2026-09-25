import test from 'node:test';
import assert from 'node:assert/strict';
import { validateAuthenticatedRouteReadback } from './verify-lightchain-authenticated-route-readback.mjs';

function fixture(overrides = {}) {
  return {
    schema: 'lightchain_source_authenticated_route_readback.v1',
    origin: 'https://jp.linkaigc.com',
    taskOwned: true,
    sameTab: true,
    waitedBeforeSettledReadbackSeconds: 30,
    authContinuity: {
      title: 'Lightchain AI',
      loginTextMatches: 0,
      loginFormMatches: 0,
      originPreserved: true,
      rightsCheckboxCount: 0,
      cookieOrTokenRecorded: false,
    },
    settledRoutes: [{
      route: '/designProduction',
      url: 'https://jp.linkaigc.com/designProduction',
      title: 'Lightchain AI',
      readyState: 'complete',
      textChars: 707,
      controlCount: 48,
      screenshotBytes: 62220,
      loginPhrasePresent: false,
      textPrefix: 'デザインワークスペースへようこそ',
    }],
    cleanup: {
      sessionClosed: true,
      taskTabClosed: true,
      foreignTabsMutated: false,
      externalActionExecuted: false,
      unknownEffect: false,
    },
    ...overrides,
  };
}

test('accepts a settled same-tab authenticated readback with no login UI', () => {
  assert.deepEqual(validateAuthenticatedRouteReadback(fixture()), {
    ok: true,
    issues: [],
    settledRouteCount: 1,
  });
});

test('rejects a route that shows a login marker', () => {
  const value = fixture({
    settledRoutes: [{
      ...fixture().settledRoutes[0],
      loginPhrasePresent: true,
    }],
  });
  const result = validateAuthenticatedRouteReadback(value);
  assert.equal(result.ok, false);
  assert.ok(result.issues.includes('settled_route_login_present'));
});

test('rejects an alternate origin or an insufficient settle wait', () => {
  const value = fixture({
    origin: 'https://evil.example',
    waitedBeforeSettledReadbackSeconds: 5,
  });
  const result = validateAuthenticatedRouteReadback(value);
  assert.equal(result.ok, false);
  assert.ok(result.issues.includes('origin_invalid'));
  assert.ok(result.issues.includes('settle_wait_under_30_seconds'));
});

test('rejects a rights checkbox or secret-bearing cleanup record', () => {
  const value = fixture({
    authContinuity: { ...fixture().authContinuity, rightsCheckboxCount: 1, cookieOrTokenRecorded: true },
    cleanup: { ...fixture().cleanup, unknownEffect: true },
  });
  const result = validateAuthenticatedRouteReadback(value);
  assert.equal(result.ok, false);
  assert.ok(result.issues.includes('rights_checkbox_present'));
  assert.ok(result.issues.includes('secret_recorded'));
  assert.ok(result.issues.includes('unknown_effect'));
});
