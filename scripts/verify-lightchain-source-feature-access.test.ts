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

test('Heavy model-matrix generation uses login and brand context without a Heavy rights UI', async () => {
  assert.equal(getLightchainSourceGenerationAccess('model-matrix'), 'denied');
  const source = await readFile(new URL('../src/pages/GeneratePage.tsx', import.meta.url), 'utf8');
  assert.match(source, /const heavyEntitlementReady = noImageGenerationMode[\s\S]*?Boolean\(user\?\.id\) && Boolean\(currentBrand\?\.id\)/);
  assert.match(source, /const providerRightsConfirmed = heavyEntitlementReady/);
  assert.doesNotMatch(source, /if \(!noImageGenerationMode && !heavyEntitlementReady\)/);
  assert.doesNotMatch(source, /data-testid="heavy-terms-acceptance"|data-testid="heavy-rights-attestation"|data-testid="heavy-terms-copy"/);
  assert.doesNotMatch(source, /Heavy利用条件|権利表明|規約同意/);
  assert.match(source, /const heavyConsent = undefined/);
  assert.doesNotMatch(source, /isLightchainGenerationSurface|sourceGenerationAccess|getLightchainSourceGenerationAccess(?:ForWorkflow)?\(/);
  assert.doesNotMatch(source, /const rightsConfirmed = true/);
  assert.doesNotMatch(source, /権限がありません/);
});

test('unified-workbench workflows use login and brand context rather than Light source generation access', async () => {
  const source = await readFile(new URL('../src/pages/LightchainWorkbenchPage.tsx', import.meta.url), 'utf8');
  assert.match(source, /const heavyEntitlementReady = !heavyOwnedFeature \|\| Boolean\(user\?\.id && currentBrand\?\.id\)/);
  assert.match(source, /const providerRightsConfirmed = !heavyOwnedFeature \|\| heavyEntitlementReady/);
  assert.match(source, /if \(!heavyEntitlementReady\)[\s\S]*?return;/);
  assert.doesNotMatch(source, /getLightchainSourceGenerationAccess(?:ForWorkflow)?\(/);
  assert.doesNotMatch(source, /rightsAlreadyConfirmed|platformAssetRightsConfirmed/);
});
