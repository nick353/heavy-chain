import test from 'node:test';
import assert from 'node:assert/strict';
import {
  validateCompanionAuthenticatedEvidence,
  validateLightchainProductionReadback,
} from './verify-release-gate-unified.mjs';

const productionOrigin = 'https://heavy-chain-web.nichika2000823.workers.dev';

function fixture(overrides = {}) {
  const manifest = ['alpha', 'beta'];
  return {
    manifest,
    artifact: {
      ok: true,
      baseUrl: productionOrigin,
      authState: 'output/playwright/authorized-production/auth-state.json',
      featureCount: manifest.length,
      featureResults: manifest.map((id) => ({ id })),
      assertions: manifest.flatMap((id) => [
        { id: `${id}:shared_workflow_contract_readback`, ok: true },
        { id: `${id}:route_loaded_without_login`, ok: true },
        { id: `mobile_screen:${id}`, ok: true },
      ]),
      failed: [],
      consoleMessages: [],
      pageErrors: [],
      requestFailures: [],
      cleanup: { contextClosed: true, browserClosed: true, previewStopped: true },
      ...overrides,
    },
  };
}

test('accepts an exact current-manifest production readback', () => {
  const { manifest, artifact } = fixture();
  assert.equal(validateLightchainProductionReadback(artifact, manifest), true);
});

test('rejects local proof artifacts even when their assertions pass', () => {
  const { manifest, artifact } = fixture({
    baseUrl: 'http://127.0.0.1:4183',
    authState: 'local-proof-jwt',
  });
  assert.equal(validateLightchainProductionReadback(artifact, manifest), false);
});

test('rejects duplicate, missing, or stale manifest IDs', () => {
  const { manifest, artifact } = fixture({
    featureResults: [{ id: 'alpha' }, { id: 'alpha' }],
  });
  assert.equal(validateLightchainProductionReadback(artifact, manifest), false);

  const stale = fixture({
    featureResults: [{ id: 'alpha' }, { id: 'gamma' }],
  });
  assert.equal(validateLightchainProductionReadback(stale.artifact, stale.manifest), false);
});

test('accepts the verifier split shape with non-video rows plus four video route readbacks', () => {
  const base = fixture();
  const manifest = ['alpha', 'beta', 'video-workstation', 'video-detail'];
  const videoResults = [
    'desktop-video-dashboard',
    'desktop-video-detail',
    'mobile-video-dashboard',
    'mobile-video-detail',
  ].map((id) => ({
    id,
    assertions: [{ id: `${id}:route_readback`, ok: true }],
    observed: { visibleCheckboxCount: 0 },
  }));
  const artifact = {
    ...base.artifact,
    featureCount: 2,
    featureResults: [{ id: 'alpha' }, { id: 'beta' }],
    videoResults,
    assertions: [
      { id: 'alpha:shared_workflow_contract_readback', ok: true },
      { id: 'alpha:route_loaded_without_login', ok: true },
      { id: 'mobile_screen:alpha', ok: true },
      { id: 'beta:shared_workflow_contract_readback', ok: true },
      { id: 'beta:route_loaded_without_login', ok: true },
      { id: 'mobile_screen:beta', ok: true },
    ],
  };
  assert.equal(validateLightchainProductionReadback(artifact, manifest), true);
});

test('rejects a split readback with a missing video route or visible rights checkbox', () => {
  const base = fixture();
  const manifest = ['alpha', 'beta', 'video-workstation', 'video-detail'];
  const videoResults = [
    'desktop-video-dashboard',
    'desktop-video-detail',
    'mobile-video-dashboard',
  ].map((id) => ({
    id,
    assertions: [{ id: `${id}:route_readback`, ok: true }],
    observed: { visibleCheckboxCount: 0 },
  }));
  const artifact = {
    ...base.artifact,
    featureCount: 2,
    featureResults: [{ id: 'alpha' }, { id: 'beta' }],
    videoResults,
    assertions: [
      { id: 'alpha:shared_workflow_contract_readback', ok: true },
      { id: 'alpha:route_loaded_without_login', ok: true },
      { id: 'mobile_screen:alpha', ok: true },
      { id: 'beta:shared_workflow_contract_readback', ok: true },
      { id: 'beta:route_loaded_without_login', ok: true },
      { id: 'mobile_screen:beta', ok: true },
    ],
  };
  assert.equal(validateLightchainProductionReadback(artifact, manifest), false);
  artifact.videoResults.push({
    id: 'mobile-video-detail',
    assertions: [{ id: 'mobile-video-detail:route_readback', ok: true }],
    observed: { visibleCheckboxCount: 1 },
  });
  assert.equal(validateLightchainProductionReadback(artifact, manifest), false);
});

function companionFixture(overrides = {}) {
  const routes = ['/model', '/gallery', '/history', '/jobs', '/canvas/new'].map((path) => ({
    path,
    readyState: 'complete',
    authMarker: path === '/canvas/new' ? 'canvas-save' : 'avatar',
    routeMarkers: ['route marker'],
    semanticReadback: 'verified',
    visualReadback: 'verified',
  }));
  return {
    schema: 'heavy-chain.companion-authenticated-production-evidence.v1',
    source: 'aos_chrome_companion_profile_instance',
    taskId: 'task_123',
    sessionId: 'session_123',
    tabId: 123,
    generation: 'generation_123',
    origin: productionOrigin,
    authSecretExported: false,
    routes,
    businessCompletion: {
      providerReceipt: 'unverified',
      sourceSync: 'unverified',
      reconciliation: 'unverified',
    },
    ...overrides,
  };
}

test('accepts Companion evidence without auth-state.json', () => {
  assert.equal(validateCompanionAuthenticatedEvidence(companionFixture()), true);
});

test('rejects Companion evidence with a missing route or exported secret', () => {
  const missingRoute = companionFixture({ routes: companionFixture().routes.slice(0, 4) });
  assert.equal(validateCompanionAuthenticatedEvidence(missingRoute), false);

  const exportedSecret = companionFixture({ authSecretExported: true });
  assert.equal(validateCompanionAuthenticatedEvidence(exportedSecret), false);
});

test('does not promote Companion UI evidence to provider completion', () => {
  const promoted = companionFixture({
    businessCompletion: {
      providerReceipt: 'verified',
      sourceSync: 'verified',
      reconciliation: 'verified',
    },
  });
  assert.equal(validateCompanionAuthenticatedEvidence(promoted), false);
});
