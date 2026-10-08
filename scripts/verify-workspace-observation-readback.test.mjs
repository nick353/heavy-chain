import test from 'node:test';
import assert from 'node:assert/strict';
import { buildWorkspaceObservationReadback } from './build-workspace-observation-readback.mjs';

test('credential-free observation is explicit and never release eligible', () => {
  const report = buildWorkspaceObservationReadback({
    apiOrigin: 'https://heavy-chain-api.nichika2000823.workers.dev',
    brandId: '98718413-7ea3-4a1f-87b1-1804ae2ec957',
    runId: 'ui-observation-1',
    observedAt: '2026-09-28T12:22:44.348Z',
    observations: [{ path: '/generate?feature=model-matrix', title: 'Lightchain AI',
      generationModel: 'gpt-image-2', termsAccepted: true, rightsAttestationChecked: false, generateEnabled: false }],
    blockers: ['rights_attestation_user_owned'],
  });
  assert.equal(report.schema, 'heavy-chain.workspace-readback.v1');
  assert.equal(report.releaseEligible, false);
  assert.equal(report.provenance.credentialMode, 'no_api_credential');
  assert.equal(report.provenance.issuerVerified, false);
  assert.equal(report.observations[0].generateEnabled, false);
  assert.match(report.limitations.join('|'), /does_not_satisfy_production_monitor_or_release_gate/);
  assert.doesNotMatch(JSON.stringify(report), /authorization|Bearer|sk-|cookie|token/i);
});

test('secret-bearing inputs are rejected rather than copied into evidence', () => {
  assert.throws(() => buildWorkspaceObservationReadback({
    apiOrigin: 'https://heavy-chain-api.nichika2000823.workers.dev',
    brandId: 'brand-1', observations: [], token: 'session-secret',
  }), /sensitive_observation_input/);
  assert.throws(() => buildWorkspaceObservationReadback({
    apiOrigin: 'https://heavy-chain-api.nichika2000823.workers.dev',
    brandId: 'brand-1', observations: [{ path: '/generate', title: 'https://example.invalid/a?sig=secret' }],
  }), /sensitive_observation_input/);
});

test('unsafe origin and malformed observations stop before an artifact is built', () => {
  assert.throws(() => buildWorkspaceObservationReadback({ apiOrigin: 'http://heavy.invalid', brandId: 'brand-1', observations: [] }), /invalid_cloudflare_api_origin/);
  assert.throws(() => buildWorkspaceObservationReadback({ apiOrigin: 'https://heavy.invalid', brandId: 'brand-1', observations: [{ path: 'generate' }] }), /invalid_observation_route/);
});
