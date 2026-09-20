import test from 'node:test';
import assert from 'node:assert/strict';
import {
  validateCompanionAuthenticatedEvidence,
  validateCompanionMassMarketQa,
  validateCompanionProductionRouteMatrix,
  validateLightchainProductionReadback,
  readCurrentLightchainManifest,
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

function companionMassMarketFixture(overrides = {}) {
  const route = (key, path, assertions = []) => ({
    key,
    path,
    url: `${productionOrigin}${path}`,
    title: 'Lightchain AI',
    readyState: 'complete',
    bodyLength: 120,
    domExcerpt: 'Lightchain route',
    semanticReadback: 'verified',
    visualReadback: 'verified',
    assertions,
  });
  const passing = (name, details = {}) => ({ name, passed: true, details });
  const routes = [
    route('dashboard', '/dashboard', [passing('current_lightchain_launcher_visible'), passing('current_lightchain_feature_cards_are_linked')]),
    route('design-production', '/designProduction', [passing('design_production_source_entry_is_complete')]),
    route('generate-campaign', '/generate?feature=campaign-image', [
      passing('lightchain_permission_surface_visible'),
      passing('upload_first_generation_screen_hides_advanced_controls', { phrase: 'で生成' }),
    ]),
    route('marketing', '/marketing'),
    route('fitting', '/model'),
    route('studio', '/studio'),
    route('models', '/model-library'),
    route('patterns', '/patterns'),
    route('video', '/flow/GenerateShortVideo'),
    route('lab', '/lab'),
    route('jobs', '/jobs'),
    route('history', '/history', [passing('history_has_reuse_action_panel'), passing('desktop_history_timeline_is_bounded')]),
    route('gallery', '/gallery', [passing('gallery_no_scary_remote_failure_toast')]),
    route('canvas', '/canvas/new', [passing('mobile_canvas_content_fits_initial_view')]),
    route('brand-settings', '/brand/settings', [passing('brand_settings_hides_removed_readiness_blocks')]),
    route('launcher', '/lightchain'),
  ];
  const mobile = [
    route('mobile-dashboard', '/dashboard', [passing('current_lightchain_launcher_compact')]),
    route('mobile-generate-campaign', '/generate?feature=campaign-image', [
      passing('lightchain_permission_surface_visible'),
      passing('upload_first_generation_screen_hides_advanced_controls', { phrase: 'で生成' }),
      passing('mobile_generate_hides_canvas_toolbar'),
      passing('mobile_generate_starts_at_material_form'),
    ]),
    route('mobile-design-production', '/designProduction'),
    route('mobile-marketing', '/marketing'),
    route('mobile-fitting', '/model'),
    route('mobile-jobs', '/jobs', [passing('mobile_jobs_initial_list_is_bounded')]),
    route('mobile-history', '/history', [passing('history_has_reuse_action_panel'), passing('mobile_history_timeline_is_bounded')]),
    route('mobile-gallery', '/gallery', [passing('gallery_no_scary_remote_failure_toast')]),
    route('mobile-canvas', '/canvas/new', [passing('mobile_canvas_content_fits_initial_view')]),
    route('mobile-lightchain', '/lightchain', [
      passing('mobile_no_intrusive_floating_help_buttons'),
      passing('mobile_lightchain_category_entry_is_compact'),
      passing('mobile_lightchain_category_cards_open_real_feature_routes'),
    ]),
  ];
  return {
    schema: 'heavy-chain.companion-mass-market-qa.v1',
    workflow: 'mass-market-user-journey-qa',
    source: 'aos_chrome_companion_profile_instance',
    taskId: 'task_123',
    sessionId: 'session_123',
    generation: 'generation_123',
    origin: productionOrigin,
    authSecretExported: false,
    capturedAt: new Date().toISOString(),
    ok: true,
    routes,
    mobile,
    failed: [],
    consoleMessages: [],
    pageErrors: [],
    requestFailures: [],
    businessCompletion: { providerReceipt: 'unverified', sourceSync: 'unverified', reconciliation: 'unverified' },
    cleanup: { contextClosed: true, browserClosed: true, sessionClosed: true, leasesReleased: 0 },
    companionCleanup: { ok: true, retained: [], unknown_effect: [] },
    ...overrides,
  };
}

test('accepts current Lightchain Companion mass-market evidence', () => {
  assert.equal(validateCompanionMassMarketQa(companionMassMarketFixture()), true);
});

test('rejects promoted or uncleared Companion mass-market evidence', () => {
  assert.equal(validateCompanionMassMarketQa(companionMassMarketFixture({
    businessCompletion: { providerReceipt: 'verified', sourceSync: 'verified', reconciliation: 'verified' },
  })), false);
  assert.equal(validateCompanionMassMarketQa(companionMassMarketFixture({
    cleanup: { contextClosed: true, browserClosed: true, sessionClosed: true, leasesReleased: 1 },
  })), false);
});

function companionRouteMatrixFixture(overrides = {}) {
  const ids = [...readCurrentLightchainManifest(), 'launcher'];
  const routes = ids.map((id) => ({
    id,
    title: id,
    path: `/${id}`,
    url: `${productionOrigin}/${id}`,
    titleReadback: 'Lightchain AI',
    readyState: 'complete',
    loaded: true,
    semanticReadback: 'verified',
    visualReadback: 'verified',
    textSha256: 'a'.repeat(64),
    markers: 'Lightchain route',
    capturedAt: new Date().toISOString(),
  }));
  return {
    schema: 'heavy-chain.companion-production-route-matrix.v1',
    source: 'aos_chrome_companion_profile_instance',
    taskId: 'task_123',
    sessionId: 'session_123',
    generation: 'generation_123',
    origin: productionOrigin,
    authSecretExported: false,
    routeCount: ids.length,
    loadedCount: ids.length,
    failed: [],
    routes,
    businessCompletion: {
      providerReceipt: 'unverified',
      sourceSync: 'unverified',
      reconciliation: 'unverified',
    },
    cleanup: { sessionClosed: true, leasesReleased: 'per-route' },
    ...overrides,
  };
}

test('accepts the complete Companion production route matrix', () => {
  assert.equal(validateCompanionProductionRouteMatrix(companionRouteMatrixFixture()), true);
});

test('rejects incomplete or promoted Companion route matrices', () => {
  const incomplete = companionRouteMatrixFixture({ loadedCount: 32 });
  assert.equal(validateCompanionProductionRouteMatrix(incomplete), false);

  const promoted = companionRouteMatrixFixture({
    businessCompletion: {
      providerReceipt: 'verified',
      sourceSync: 'verified',
      reconciliation: 'verified',
    },
  });
  assert.equal(validateCompanionProductionRouteMatrix(promoted), false);
});
