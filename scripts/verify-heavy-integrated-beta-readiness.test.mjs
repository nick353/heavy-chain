import assert from 'node:assert/strict';
import test from 'node:test';
import { buildIntegratedBetaReadinessReport } from './audit-heavy-integrated-beta-readiness.mjs';

test('current integrated beta audit preserves the 31 non-video and eight-layer boundary', () => {
  const report = buildIntegratedBetaReadinessReport();

  assert.equal(report.status, 'implemented_local');
  assert.equal(report.goalState, 'active');
  assert.equal(report.productionParity, 'PENDING_CONFIRMATION');
  assert.equal(report.scope.nonVideoRows, 31);
  assert.deepEqual(report.scope.excludedVideoRows, ['video-workstation', 'video-detail']);
  assert.deepEqual(report.scope.layers, [
    'input', 'screen', 'generation', 'result', 'save', 'reuse', 'error', 'performance',
  ]);
  assert.equal(report.evidence.productionPromotionDisabled, true);
  assert.equal(report.evidence.verifiedLocalLayers, 80);
  assert.equal(report.evidence.pendingProductionLayers, 168);
  assert.equal(report.evidence.verifiedProductionLayers, 0);
  assert.equal(report.evidence.sourceReadbackPresent, true);
  assert.deepEqual(report.errors, []);
});

test('priority rows keep local workflow proof separate from production parity', () => {
  const report = buildIntegratedBetaReadinessReport();

  for (const rowId of ['fabric-image', 'printing-image', 'ai-fitting']) {
    assert.equal(report.priority[rowId].input, 'verified-local', rowId);
    assert.equal(report.priority[rowId].screen, 'verified-local', rowId);
    for (const layer of ['generation', 'result', 'save', 'reuse', 'error', 'performance']) {
      const expected = ['fabric-image', 'printing-image', 'ai-fitting'].includes(rowId)
        && ['generation', 'result', 'save', 'reuse', 'error'].includes(layer)
        || ['fabric-image', 'printing-image', 'ai-fitting'].includes(rowId)
        && layer === 'performance'
        ? 'verified-local'
        : 'PENDING_CONFIRMATION';
      assert.equal(report.priority[rowId][layer], expected, `${rowId}:${layer}`);
    }
  }
});

test('the audit never turns an incomplete production boundary into completion', () => {
  const report = buildIntegratedBetaReadinessReport({
    schema: 'light-heavy-parity-behavior-ledger.v2',
    scope: { nonVideoRows: 31, excludedVideoRows: ['video-workstation', 'video-detail'] },
    evidenceBoundary: {
      productionPromotion: 'disabled_until_current_same_run_lightchain_and_heavy_readback',
      sourceReadback: 'missing.md',
      localHeavyContract: 'missing.md',
    },
    records: [],
  });

  assert.notEqual(report.productionParity, 'verified');
  assert.notEqual(report.status, 'implemented_local');
});
