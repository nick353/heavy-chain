import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';
import {
  getLightchainSourceFeatureAccess,
  getLightchainSourceGenerationAccess,
  getLightchainSourceGenerationAccessForWorkflow,
} from '../src/features/lightchain/sourceFeatureAccess.ts';
import { GOAL_CANDIDATE_ROW_IDS } from '../src/features/lightchain/parityContract.ts';

test('source-admitted fabric input access stays separate from rights UI', () => {
  assert.equal(getLightchainSourceFeatureAccess('fabric-image'), 'admitted');
  assert.equal(getLightchainSourceGenerationAccess('fabric-image'), 'denied');
});

test('unobserved source feature access remains fail-closed', () => {
  assert.equal(getLightchainSourceFeatureAccess('printing-image'), 'unknown');
  assert.equal(getLightchainSourceGenerationAccessForWorkflow('printing-image'), 'unknown');
  assert.equal(getLightchainSourceGenerationAccessForWorkflow('marketing-home'), 'unknown');
  assert.equal(getLightchainSourceGenerationAccessForWorkflow('ai-fitting-reference'), 'unknown');
});

test('workflow access aliases only current source observations and never promotes unknown to permitted', () => {
  assert.equal(getLightchainSourceGenerationAccessForWorkflow('ai-fitting'), 'denied');
  assert.equal(getLightchainSourceGenerationAccessForWorkflow('model-matrix'), 'denied');
  assert.equal(getLightchainSourceGenerationAccessForWorkflow('fabric-image'), 'denied');
  for (const workflowId of ['marketing-home', 'design-agent', 'model-face', 'custom-style', 'video-detail']) {
    assert.equal(getLightchainSourceGenerationAccessForWorkflow(workflowId), 'unknown', workflowId);
  }
});

test('all 31 non-video catalog rows remain non-admitted until source permission is observed', () => {
  const videoRows = new Set(['video-workstation', 'video-detail']);
  const nonVideoRows = GOAL_CANDIDATE_ROW_IDS.filter((rowId) => !videoRows.has(rowId));
  assert.equal(nonVideoRows.length, 31);
  for (const rowId of nonVideoRows) {
    assert.notEqual(getLightchainSourceGenerationAccessForWorkflow(rowId), 'permitted', rowId);
  }
});

test('Heavy model-matrix generation uses explicit Heavy consent without Light source permission', async () => {
  assert.equal(getLightchainSourceGenerationAccess('model-matrix'), 'denied');
  const source = await readFile(new URL('../src/pages/GeneratePage.tsx', import.meta.url), 'utf8');
  assert.match(source, /const heavyPolicyConfigured = Boolean\(/);
  assert.match(source, /const heavyEntitlementReady = noImageGenerationMode[\s\S]*?heavyPolicyConfigured && heavyTermsAccepted && heavyRightsAttested/);
  assert.match(source, /const providerRightsConfirmed = heavyEntitlementReady/);
  assert.match(source, /if \(!noImageGenerationMode && !heavyEntitlementReady\)/);
  assert.match(source, /data-testid="heavy-terms-acceptance"/);
  assert.match(source, /data-testid="heavy-rights-attestation"/);
  assert.match(source, /const heavyConsent = noImageGenerationMode \|\| !heavySurface \? undefined/);
  assert.doesNotMatch(source, /isLightchainGenerationSurface|sourceGenerationAccess|getLightchainSourceGenerationAccess(?:ForWorkflow)?\(/);
  assert.doesNotMatch(source, /const rightsConfirmed = true/);
  assert.doesNotMatch(source, /権限がありません/);
});

test('unified-workbench workflows use Heavy entitlement rather than Light source generation access', async () => {
  const source = await readFile(new URL('../src/pages/LightchainWorkbenchPage.tsx', import.meta.url), 'utf8');
  assert.match(source, /const heavyEntitlementReady = !heavyOwnedFeature \|\| \([\s\S]*?requestScopedAttestationRequired === false/);
  assert.match(source, /const providerRightsConfirmed = !heavyOwnedFeature \|\| heavyEntitlementReady/);
  assert.match(source, /if \(!heavyEntitlementReady\)[\s\S]*?return;/);
  assert.doesNotMatch(source, /getLightchainSourceGenerationAccess(?:ForWorkflow)?\(/);
  assert.doesNotMatch(source, /rightsAlreadyConfirmed|platformAssetRightsConfirmed/);
});
