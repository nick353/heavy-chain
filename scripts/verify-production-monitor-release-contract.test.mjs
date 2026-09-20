import test from 'node:test';
import assert from 'node:assert/strict';
import { validateProductionMonitorReleasePair } from './verify-release-gate-unified.mjs';

const origin = 'https://heavy-chain-web.nichika2000823.workers.dev';

function fixture(overrides = {}) {
  const monitor = {
    schema: 'heavy-chain.production-monitor.v2', ok: true, mode: 'cloudflare_authenticated_read_only', runId: 'pair-r1', capturedAt: new Date().toISOString(),
    baseUrl: 'https://heavy-chain-api.nichika2000823.workers.dev', brandId: 'brand-1',
    coverage: {
      jobs: 'current_principal_and_brand', media: 'current_principal_recent_sample',
      usage: 'authorized_brand_current_month', ui: 'not_checked', cpu: 'not_measured',
      providerBilling: 'not_available', businessCompletion: 'not_verified',
      pagination: 'bounded_nontransactional_observation',
    },
    window: { hours: 24, staleMinutes: 20 },
    thresholds: { maxFailureRate: 0.15, maxRows: 5000, sampleSize: 20, maxFailedJobs: 0, maxStaleActiveJobs: 0, maxStorageErrors: 0 },
    blockers: [], warnings: [],
    sections: {
      api: { status: 'ok', media: 'private-r2' },
      generation: {
        total: 1, counts: { completed: 1 }, terminal: 1, failed: 0,
        staleActive: 0, failedJobIds: [], staleJobIds: [],
      },
      usage: {
        scope: 'authorized_brand_current_month', billing: 'estimate_not_invoice', imageAIEnabled: true,
        plannedImages: 1, completedImages: 1, runningImages: 0, uncertainImages: 0,
        attemptedImages: 1, unknownEstimateCount: 0, estimatedMicroUSD: 1,
        estimatedNeurons: 1, averageInferenceMs: 10, remainingUnits: 24, monthlyQuota: 25,
      },
      storage: {
        totalRecentImages: 1, checkedImages: 1, readable: 1, errors: 0,
        checks: [{ imageId: 'image-1', ok: true, bytes: 8, sha256: 'a'.repeat(64), checksumVerified: true }],
      },
    },
  };
  const ui = {
    schema: 'heavy-chain.lightchain-production-ui.v2', runId: 'pair-r1', mode: 'production', startedAt: new Date().toISOString(), finishedAt: new Date().toISOString(), baseUrl: origin,
    storageState: '/tmp/authorized-production-state.json',
    targetOrigin: { origin, bound: true },
    authEvidence: { source: 'explicit_env', supplied: true, statePath: '/tmp/authorized-production-state.json', statePathExists: true },
    preflight: { ok: true }, completion: { status: 'verified_read_only', externalActionsStarted: false },
    fatalRunnerError: null, resultCount: 28, failureCount: 0,
    pages: ['dashboard', 'generate', 'fitting', 'marketing', 'studio', 'models', 'patterns', 'video', 'lab', 'gallery', 'history', 'jobs', 'canvas', 'brand-settings'].map((name) => ({ name })),
    viewports: [{ name: 'desktop' }, { name: 'mobile' }],
    results: ['desktop', 'mobile'].flatMap((viewport) => ['dashboard', 'generate', 'fitting', 'marketing', 'studio', 'models', 'patterns', 'video', 'lab', 'gallery', 'history', 'jobs', 'canvas', 'brand-settings'].map((page) => ({ viewport, page, passed: true, redirectedToLogin: false, consoleErrorCount: 0, pageErrorCount: 0, requestFailureCount: 0, missingText: [], legacyViolations: [] }))),
    consoleMessages: [], pageErrors: [], requestFailures: [], legacyViolations: [], cleanup: { contextClosed: true, browserClosed: true },
  };
  return { monitor: { ...monitor, ...(overrides.monitor || {}) }, ui: { ...ui, ...(overrides.ui || {}) } };
}

test('valid paired v2 API-only monitor and authenticated UI artifact passes', () => {
  const { monitor, ui } = fixture();
  assert.equal(validateProductionMonitorReleasePair(monitor, ui), true);
});

test('API-only and legacy UI-probe monitor evidence fails', () => {
  const pair = fixture({ monitor: { summary: { uiOk: true } } });
  assert.equal(validateProductionMonitorReleasePair(pair.monitor, pair.ui), false);
  const skipped = fixture({ monitor: { warnings: [{ code: 'ui_probe_skipped' }] } });
  assert.equal(validateProductionMonitorReleasePair(skipped.monitor, skipped.ui), false);
  const v1 = fixture({ monitor: { schema: 'heavy-chain.production-monitor.v1' } });
  assert.equal(validateProductionMonitorReleasePair(v1.monitor, v1.ui), false);
});

test('missing, skipped, unauthenticated, or local-proof UI fails', () => {
  for (const ui of [
    { schema: null },
    { completion: { status: 'not_verified', externalActionsStarted: false } },
    { authEvidence: { source: 'missing_explicit_env', supplied: false, statePathExists: false } },
    { authEvidence: { source: 'explicit_env', supplied: true, statePath: 'local-proof-jwt', statePathExists: true }, storageState: 'local-proof-jwt' },
  ]) {
    const pair = fixture({ ui });
    assert.equal(validateProductionMonitorReleasePair(pair.monitor, pair.ui), false);
  }
});

test('runId mismatch, operational blockers, stale-shaped, and malformed evidence fail', () => {
  for (const overrides of [
    { monitor: { runId: 'other-run' } },
    { monitor: { mode: 'read-only' } },
    { monitor: { blockers: [{ code: 'stale_generation_jobs' }] } },
    { monitor: { capturedAt: '2000-01-01T00:00:00.000Z' } },
    { ui: { resultCount: 2 } },
    { ui: { cleanup: { contextClosed: false, browserClosed: true } } },
    { ui: { consoleMessages: [{ text: 'late failure' }] } },
    { ui: { requestFailures: [{ url: origin }] } },
  ]) {
    const pair = fixture(overrides);
    assert.equal(validateProductionMonitorReleasePair(pair.monitor, pair.ui), false);
  }
});

test('missing monitor sections and missing error arrays fail closed', () => {
  const pair = fixture();
  delete pair.monitor.sections;
  assert.equal(validateProductionMonitorReleasePair(pair.monitor, pair.ui), false);

  const missingArrays = fixture();
  delete missingArrays.monitor.warnings;
  delete missingArrays.ui.requestFailures;
  assert.equal(validateProductionMonitorReleasePair(missingArrays.monitor, missingArrays.ui), false);
});

test('rejects incomplete, duplicate, and unknown UI route identities', () => {
  const incomplete = fixture();
  incomplete.ui.results.pop();
  incomplete.ui.resultCount = incomplete.ui.results.length;
  assert.equal(validateProductionMonitorReleasePair(incomplete.monitor, incomplete.ui), false);

  const duplicate = fixture();
  duplicate.ui.results[1] = { ...duplicate.ui.results[0] };
  assert.equal(validateProductionMonitorReleasePair(duplicate.monitor, duplicate.ui), false);

  const unknown = fixture();
  unknown.ui.results[0].page = 'unknown';
  assert.equal(validateProductionMonitorReleasePair(unknown.monitor, unknown.ui), false);
});

test('rejects missing or malformed per-route error counts', () => {
  for (const value of [undefined, null, '0', -1, 0.5, Number.NaN]) {
    const pair = fixture();
    pair.ui.results[0] = { ...pair.ui.results[0], consoleErrorCount: value };
    assert.equal(validateProductionMonitorReleasePair(pair.monitor, pair.ui), false);
  }
});
